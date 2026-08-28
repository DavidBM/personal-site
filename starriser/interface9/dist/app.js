import { UIController } from "./ui-controller.js";
import { Galaxy } from "./galaxy.js";
import { GalaxyMetrics } from "./galaxy-metrics.js";
import { ControlsManager } from "./controls-manager.js";
import { replayGalaxyOps } from "./galaxy/galaxy-op-replayer.js";
import { ClusterContextMenuController } from "./main/cluster-context-menu-controller.js";
import { subscribeAppLifecycleDebugTopics, subscribeAppTopics, } from "./main/app-subscriptions.js";
import { initializeAppWorkers } from "./main/app-workers.js";
import { createPointerEventRouter, } from "./main/pointer-event-router.js";
import { createEditHandlePointerController, } from "./main/edit-handle-pointer.js";
import { createWebGpuViewHooks } from "./main/webgpu-view-bridge.js";
import { collectExtendedClusterIds, regenerateClusters, } from "./main/cluster-regenerator.js";
import { createFleetStatusController, } from "./main/fleet-status-controller.js";
import { beginBulkAdd, endBulkAdd, installGamePerfGlobal, isBulkActive, noteBulkApplied, } from "./main/game-perf.js";
import { CAP_NEAR, GLOBAL_MAX_INSTANCES } from "./gpu/fleet-lod.js";
import { Bus } from "./worker/bus/Bus.js";
import { publishTopic, Topics } from "./worker/protocol/topics.js";
import { CursorStatsWidget } from "./ui/cursor-stats-widget.js";
import { createUIContext, createUIRoot } from "./ui/ui-kit.js";
import { buildEditorUI, buildPlayUI, resolveUIMode, } from "./ui/ui-modes.js";
import Stats from "./vendor/stats.js";
import { assertWebGpuAvailable } from "./gpu/preferred-backend.js";
import { WebGpuMapView } from "./gpu/webgpu-map-view.js";
import { WebGpuCameraController } from "./gpu/webgpu-camera-controls.js";
import { createSystemFocusController, } from "./main/system-focus-controller.js";
import { WebGpuCameraStub, WebGpuRendererShim, } from "./gpu/webgpu-renderer-shim.js";
export class App {
    constructor() {
        this.statsPanels = [];
        this.uiRoot = createUIRoot();
        this.uiContext = createUIContext(this.uiRoot);
        this.uiMode = resolveUIMode();
        this.uiBindings = this.buildUIBindings(this.uiMode);
        this.contextMenu =
            this.uiBindings.mode === "editor" ? this.uiBindings.contextMenu : null;
        this.contextMenuController = null;
        this.pointerEventRouter = null;
        this.systemFocus = null;
        this.webGpuView = null;
        this.webGpuShim = null;
        this.editHandlePointer = null;
        const statsBar = this.uiBindings.mode === "editor"
            ? (this.uiBindings.stats.container ?? null)
            : null;
        if (statsBar) {
            this.statsPanels.push(createAndInsertStatsPanels(statsBar));
        }
        this.stats = this.statsPanels[0] ?? null;
        this.metrics = new GalaxyMetrics();
        this.controlsManager = ControlsManager.getInstance();
        this.mainBus = new Bus(window, {
            debug: 1,
            workerLabel: "App/Main",
            workerId: "main",
        });
        this.cursorStatsWidget = null;
        this.statsUpdateInterval = 200;
        this.lastStatsUpdate = 0;
        this.statsUpdatePending = false;
        this.lastUIState = { hoveredId: null, selectedId: null };
        this.clusterDragStarts = new Map();
        this.maxSolarSystemId = 0;
        installGamePerfGlobal();
        this.uiController =
            this.uiBindings.mode === "editor"
                ? new UIController(this.uiBindings.stats)
                : new UIController();
        // WebGPU device request is async in initialize() / setupWebGpuGraphics().
        this.cameraController = new WebGpuCameraStub();
        // Temporary empty galaxy until WebGPU view is ready.
        this.galaxy = new Galaxy({}, this.metrics);
        this.fleetStatus = createFleetStatusController({
            renderer: {
                addFleet: () => { },
                updateFleetState: () => { },
                removeFleet: () => { },
            },
            onListChanged: () => { },
        });
        installGamePerfGlobal();
        console.info("[Galaxy] WebGPU backend. Completing device init…");
    }
    /** Finish WebGPU device + map view (async). Always runs; no dual path. */
    async setupWebGpuGraphics() {
        assertWebGpuAvailable();
        this.webGpuView = await WebGpuMapView.create({ container: document.body });
        this.webGpuShim = new WebGpuRendererShim(this.webGpuView);
        this.webGpuShim.setStatsPanels(this.statsPanels);
        this.cameraController = new WebGpuCameraController(this.webGpuView);
        this.systemFocus = createSystemFocusController({
            view: this.webGpuView,
            camera: "focusOnPoint" in this.cameraController
                ? this.cameraController
                : null,
        });
        // Damped zoom/tilt: one tick per rAF before look-at + LOD.
        this.webGpuView.setBeforeFrame((dtMs) => {
            const cam = this.cameraController;
            if (cam && "update" in cam && typeof cam.update === "function") {
                cam.update(dtMs);
            }
            this.systemFocus?.tick();
        });
        this.galaxy = new Galaxy(createWebGpuViewHooks(this.webGpuView, () => this.galaxy), this.metrics);
        this.webGpuView.setFleetPositionProvider((node) => {
            const sys = this.galaxy.getSolarSystemById(node.clusterId, node.solarSystemId);
            return sys ? sys.position : null;
        });
        this.fleetStatus = createFleetStatusController({
            renderer: this.webGpuView,
            onListChanged: (byId) => {
                if (this.uiBindings.mode !== "editor")
                    return;
                this.uiBindings.fleets.render(byId);
            },
            onApplied: (n) => {
                if (!isBulkActive())
                    return;
                noteBulkApplied(n);
                if (!isBulkActive())
                    this.clearBulkShipBudgetHint();
            },
        });
        // Edit handles: pan lock + pointer hit + M4 GPU overlay via view hooks.
        this.editHandlePointer = createEditHandlePointerController({
            target: this.webGpuShim,
            camera: this.cameraController,
            getFallbackClusterId: () => this.galaxy.getLastEditHandleClusterId() ??
                this.lastUIState.selectedId,
            publish: (payload) => this.publishPointerEvent(payload),
        });
        this.contextMenuController = this.createContextMenuController();
        console.info("[Galaxy] WebGPU map view ready (points + lines + fleets + pick + M4 overlays).");
    }
    buildUIBindings(mode) {
        return mode === "play"
            ? buildPlayUI(this.uiContext, this)
            : buildEditorUI(this.uiContext, this);
    }
    createContextMenuController() {
        if (!this.contextMenu)
            return null;
        return new ClusterContextMenuController({
            bindings: this.contextMenu,
            getClusters: () => this.galaxy.clusters,
            getGroundPoint: (screenX, screenY) => this.cameraController.getGroundPointFromScreenPosition(screenX, screenY),
        });
    }
    setUIMode(mode) {
        if (mode === this.uiMode)
            return;
        this.uiMode = mode;
        this.uiRoot.clear();
        this.uiBindings = this.buildUIBindings(this.uiMode);
        this.contextMenu =
            this.uiBindings.mode === "editor" ? this.uiBindings.contextMenu : null;
        this.contextMenuController = this.createContextMenuController();
        const statsBar = this.uiBindings.mode === "editor"
            ? (this.uiBindings.stats.container ?? null)
            : null;
        this.statsPanels = [];
        if (statsBar) {
            this.statsPanels.push(createAndInsertStatsPanels(statsBar));
        }
        this.stats = this.statsPanels[0] ?? null;
        this.webGpuShim?.setStatsPanels(this.statsPanels);
        if (this.uiBindings.mode === "editor") {
            this.uiController.setStatsElements(this.uiBindings.stats);
        }
        else {
            this.uiController.setStatsElements();
        }
        const statsContainer = this.uiBindings.mode === "editor"
            ? (this.uiBindings.stats.container ?? null)
            : null;
        if (this.cursorStatsWidget) {
            this.cursorStatsWidget.setContainer(statsContainer);
        }
        this.updateStats();
        this.updateUIModeHistory();
        this.fleetStatus.renderList();
    }
    updateUIModeHistory() {
        const url = new URL(window.location.href);
        url.searchParams.set("ui", this.uiMode);
        window.history.replaceState({}, "", url.toString());
    }
    async initialize() {
        await this.setupWebGpuGraphics();
        await this.initializeWorkers();
        // Start rAF after workers. (First-frame + broker race was a headless
        // SwiftShader issue; real GPUs are fine. Galaxy complete also ensures loop.)
        this.webGpuView?.startRenderLoop();
        // CDP / game-perf surface (10k bulk loop).
        globalThis.__galaxyApp = {
            generateFleetsBulk: (n) => this.generateFleetsBulk(n),
            generateGalaxy: (overrideParams) => this.generateGalaxy(overrideParams),
            generateFleet: () => this.generateFleet(),
            clearGalaxy: () => this.clearGalaxy(),
            getFleetCount: () => this.webGpuView?.getFleetCount() ?? this.fleetStatus.byId.size,
            getClusterCount: () => this.galaxy.clusters.length,
            getShipHighWater: () => this.webGpuView?.getShipHighWater() ?? 0,
            getBulkShipBudgetHint: () => this.webGpuView?.getBulkShipBudgetHint() ?? null,
            getPendingApplyCount: () => this.fleetStatus.getPendingApplyCount(),
            isDeviceLost: () => this.webGpuView?.isDeviceLost() ?? true,
            beginFrameCpuSample: () => this.webGpuView?.beginFrameCpuSample(),
            getFrameCpuSampleAvg: () => this.webGpuView?.getFrameCpuSampleAvg() ?? 0,
            getFrameCpuSampleCount: () => this.webGpuView?.getFrameCpuSampleCount() ?? 0,
            getFrameGpuSampleAvg: () => this.webGpuView?.getFrameGpuSampleAvg() ?? 0,
            getFrameGpuSampleCount: () => this.webGpuView?.getFrameGpuSampleCount() ?? 0,
            getLastFrameCpuMs: () => this.webGpuView?.getLastFrameCpuMs() ?? 0,
            getLastFrameGpuMs: () => this.webGpuView?.getLastFrameGpuMs() ?? 0,
            measureOneGpuFrameMs: () => this.webGpuView?.measureOneGpuFrameMs() ?? Promise.resolve(0),
            stopRenderLoop: () => this.webGpuView?.stopLoop(),
            setCameraLookAt: (eyeX, eyeY, eyeZ, targetX, targetZ) => this.webGpuView?.setCameraLookAt(eyeX, eyeY, eyeZ, targetX, targetZ),
            /** Live camera dive (controller owns eye; view setCameraLookAt is overwritten). */
            focusOnPoint: (x, z, height) => {
                const cam = this.cameraController;
                if (cam && typeof cam.focusOnPoint === "function") {
                    cam.focusOnPoint(x, z, height);
                }
            },
            resizeView: (w, h) => this.webGpuView?.resize(w, h),
            startRenderLoop: () => this.webGpuView?.startRenderLoop(),
            // Year-1 live CDP hatch (plan step 6): SCENE / lockBody / 4K / origin.
            pickFirstSystem: () => {
                const c = this.galaxy.clusters[0];
                const s = c?.solarSystems[0];
                if (!s)
                    return null;
                return { id: s.id, x: s.position.x, z: s.position.z, bufferIndex: s._bufferIndex ?? -1 };
            },
            lockBody: (index) => this.systemFocus?.lockBody(index),
            pumpHiLoad: () => this.webGpuView?.catalogResidency.pumpHiLoad(),
            observeYear1: () => {
                const v = this.webGpuView;
                if (!v)
                    return { ok: false };
                const sceneIds = Array.from(v.getSystemSceneIds());
                const hyst = v.getSceneHysteresis();
                const cam = v.getCameraState();
                const origin = v.getFrameOrigin();
                const sys = this.galaxy.clusters[0]?.solarSystems[0];
                const neighbor = this.galaxy.clusters[0]?.solarSystems[1];
                const buf = sys?._bufferIndex;
                const hidden5px = buf != null && buf >= 0 ? v.store.lodHidden[buf] === 1 : false;
                const nbuf = neighbor?._bufferIndex;
                const neighborHidden = nbuf != null && nbuf >= 0 ? v.store.lodHidden[nbuf] === 1 : null;
                const bodies = [];
                const n = v.solarBodies.currentCount;
                for (let i = 0; i < n; i++) {
                    bodies.push({
                        i,
                        sun: v.solarBodies.isSun[i] ?? 0,
                        r: v.solarBodies.radius[i] ?? 0,
                        id: v.solarBodies.catalogIds[i] ?? "",
                    });
                }
                const sun = bodies.find((b) => b.sun);
                let park = null;
                let parkScene = null;
                const sysX = sys?.position.x ?? 0;
                const sysZ = sys?.position.z ?? 0;
                for (const id of this.fleetStatus.byId.keys()) {
                    const row = v.readFleetGpuSlot(id);
                    if (!row)
                        continue;
                    const rec = {
                        id,
                        pathEndX: row.pathEndX,
                        pathEndZ: row.pathEndZ,
                        flags: row.flags,
                        off: Math.hypot(row.pathEndX - sysX, row.pathEndZ - sysZ),
                    };
                    if (!park)
                        park = rec;
                    if ((row.flags & 128) !== 0 && !parkScene)
                        parkScene = rec;
                }
                park = parkScene ?? park;
                return {
                    ok: true,
                    fleets: v.getFleetCount(),
                    shipHw: v.getShipHighWater(),
                    clusters: this.galaxy.clusters.length,
                    sceneIds,
                    sceneId: hyst.sceneId,
                    spanPx: v.getSceneSpanPx(),
                    bandBDraws: v.getBandBLastDrawCount(),
                    bandCDraws: v.getLastBandCDrawCount(),
                    hidden5px,
                    neighborHidden,
                    sunR: sun?.r ?? null,
                    park,
                    near: cam.near,
                    fovyDeg: cam.fovyDeg,
                    bufferH: cam.bufferH,
                    bufferIndex: buf ?? -1,
                    systemId: sys?.id ?? null,
                    sysX: sys?.position.x ?? 0,
                    sysZ: sys?.position.z ?? 0,
                    eyeX: cam.eyeX,
                    eyeY: cam.eyeY,
                    eyeZ: cam.eyeZ,
                    targetX: cam.targetX,
                    targetY: cam.targetY,
                    targetZ: cam.targetZ,
                    originX: origin.x,
                    originY: origin.y,
                    originZ: origin.z,
                    focusIndex: v.getFocusedBodyIndex(),
                    hiCatalogId: v.catalogResidency.hiCatalogId(),
                    bodies,
                    bodyN: n,
                };
            },
        };
    }
    /** Finalize/clear/colors surface (WebGPU shim). */
    graphics() {
        if (this.webGpuShim)
            return this.webGpuShim;
        throw new Error("WebGPU graphics not initialized");
    }
    async initializeWorkers() {
        try {
            await initializeAppWorkers(this.mainBus);
            subscribeAppTopics(this.mainBus, {
                galaxy: {
                    onGalaxyOps: (ops) => {
                        this.processOps(ops);
                        this.updateStats();
                    },
                    onGalaxyComplete: (payload) => {
                        if (!payload || payload.finalizeBuffers !== false) {
                            try {
                                this.graphics().finalizeBuffers(this.galaxy);
                            }
                            catch (err) {
                                console.warn("[Galaxy] finalizeBuffers failed:", err);
                            }
                        }
                        // Ensure rAF is running after first topology (safe if already started).
                        this.webGpuView?.startRenderLoop();
                        this.updateStats();
                        globalThis.__galaxyGenComplete =
                            true;
                    },
                    onGalaxyError: (error) => {
                        alert(`Galaxy Worker error: ${error}`);
                    },
                },
                business: {
                    onUIState: ({ hoveredId, selectedId }) => {
                        this.handleUIStateUpdate({ hoveredId, selectedId });
                    },
                    onConnectionColors: (connectionColors) => {
                        this.webGpuShim?.setConnectionColors(connectionColors);
                    },
                    onShowEditHandles: ({ clusterId, handles }) => {
                        // Arm edit mode (pan lock + handle pointer) and GPU gizmo overlay.
                        this.controlsManager.setEditModeActive(true, clusterId);
                        this.editHandlePointer?.setActiveClusterId(clusterId);
                        this.galaxy.showEditHandles(clusterId, handles);
                    },
                    onHideEditHandles: ({ clusterId }) => {
                        this.controlsManager.setEditModeActive(false, null);
                        this.editHandlePointer?.setActiveClusterId(null);
                        this.galaxy.hideEditHandles(clusterId);
                    },
                    onUpdateCluster: ({ clusterId, position }) => {
                        this.handleClusterDragUpdate(clusterId, position);
                    },
                    onCommitClusterMove: ({ clusterId, position }) => {
                        this.handleClusterDragCommit(clusterId, position);
                    },
                },
                fleets: {
                    onFleetSpawned: ({ id, counts, state }) => {
                        // Immediate apply; noteBulkApplied via onApplied when bulk active.
                        this.fleetStatus.handleSpawned(id, counts, state);
                    },
                    onFleetsSpawnedBatch: ({ fleets }) => {
                        // Enqueue only — pack is rAF-budgeted; gamePerf counts real applies.
                        this.fleetStatus.handleSpawnedBatch(fleets);
                    },
                    onFleetState: ({ id, state }) => {
                        this.fleetStatus.handleState(id, state);
                    },
                    onFleetRemoved: ({ id }) => {
                        this.fleetStatus.handleRemoved(id);
                    },
                },
            });
            console.log("All workers initialized successfully");
            this.initEventListeners();
            // Set up optional lifecycle/debug subscriptions after workers are ready.
            setTimeout(() => {
                subscribeAppLifecycleDebugTopics(this.mainBus);
            }, 500);
        }
        catch (error) {
            console.error("Failed to initialize workers:", error);
            alert("Failed to initialize application workers. Please refresh the page.");
        }
    }
    publishPointerEvent(payload, priority = 0) {
        if (!this.mainBus.isPubSubReady())
            return;
        publishTopic(this.mainBus, Topics.pointerEvent, payload, priority);
    }
    initEventListeners() {
        const statsContainer = this.uiBindings.mode === "editor"
            ? (this.uiBindings.stats.container ?? null)
            : null;
        this.cursorStatsWidget = new CursorStatsWidget(this.mainBus, "cursorStats", statsContainer, () => {
            const cam = this.cameraController;
            if (cam && "getZoomLevel" in cam && typeof cam.getZoomLevel === "function") {
                const z = cam.getZoomLevel();
                if (typeof z === "number" && Number.isFinite(z))
                    return z;
            }
            const view = this.webGpuView;
            if (!view)
                return null;
            return view.getCameraState().eyeY;
        });
        this.webGpuShim?.setStatsPanels(this.statsPanels);
        const canvas = this.webGpuView?.canvas;
        if (!canvas) {
            console.error("WebGPU canvas not available for events");
            return;
        }
        // Edit-handle pointer path: hasEditHandles gates hit-test when gizmo is up.
        if (this.editHandlePointer) {
            this.pointerEventRouter?.dispose();
            this.pointerEventRouter = createPointerEventRouter({
                canvas,
                cameraController: this.cameraController,
                controlsManager: this.controlsManager,
                editHandlePointer: this.editHandlePointer,
                getContextMenuController: () => this.contextMenuController,
                publishPointerEvent: (payload, priority) => this.publishPointerEvent(payload, priority),
                tryPickBody: (x, y) => this.systemFocus?.tryPickBody(x, y) ?? false,
                clearFocus: () => {
                    this.systemFocus?.clearFocus();
                },
            });
        }
    }
    handleContextMenuAction(action) {
        const clusterId = this.contextMenuController?.getClusterId() ?? null;
        if (action === "regenerate" && typeof clusterId === "number") {
            this.regenerateCluster(clusterId);
        }
        else if (action === "regenerate_extended" &&
            typeof clusterId === "number") {
            this.regenerateClusterExtended(clusterId);
        }
        this.contextMenuController?.resetAction();
        this.contextMenuController?.hide();
    }
    /**
     * When the business worker emits an overlay/selection update, update renderer accordingly.
     */
    handleUIStateUpdate({ hoveredId, selectedId }) {
        const hoveredCluster = hoveredId != null ? this.galaxy.getClusterById(hoveredId) : null;
        const selectedCluster = selectedId != null ? this.galaxy.getClusterById(selectedId) : null;
        this.lastUIState = { hoveredId, selectedId };
        this.galaxy.setHoveredCluster(hoveredCluster);
        this.galaxy.setSelectedCluster(selectedCluster);
    }
    handleClusterDragUpdate(clusterId, position) {
        const cluster = this.galaxy.getClusterById(clusterId);
        if (!cluster)
            return;
        if (!this.clusterDragStarts.has(clusterId)) {
            this.clusterDragStarts.set(clusterId, {
                x: cluster.position.x,
                y: 0,
                z: cluster.position.z,
            });
        }
        this.galaxy.previewMoveCluster(cluster, { ...position, y: 0 });
        cluster.position.y = 0;
        this.graphics().updateEditOverlayPosition(clusterId, cluster.position);
        if (this.lastUIState.hoveredId === clusterId) {
            this.galaxy.setHoveredCluster(cluster);
        }
        if (this.lastUIState.selectedId === clusterId) {
            this.galaxy.setSelectedCluster(cluster);
        }
    }
    handleClusterDragCommit(clusterId, position) {
        const cluster = this.galaxy.getClusterById(clusterId);
        if (!cluster)
            return;
        const startPos = this.clusterDragStarts.get(clusterId) ?? {
            x: cluster.position.x,
            y: 0,
            z: cluster.position.z,
        };
        this.clusterDragStarts.delete(clusterId);
        this.galaxy.commitMoveCluster(cluster, startPos, { ...position, y: 0 });
        cluster.position.y = 0;
        this.graphics().updateEditOverlayPosition(clusterId, cluster.position);
        if (this.lastUIState.selectedId !== null) {
            this.graphics().refreshConnectionOverlays();
        }
        if (this.lastUIState.hoveredId === clusterId) {
            this.galaxy.setHoveredCluster(cluster);
        }
        if (this.lastUIState.selectedId === clusterId) {
            this.galaxy.setSelectedCluster(cluster);
        }
    }
    publishLocalOps(ops) {
        if (!this.mainBus.isPubSubReady())
            return;
        publishTopic(this.mainBus, Topics.galaxyLocalOps, ops, 0);
    }
    applyLocalOps(ops) {
        if (!ops.length)
            return;
        this.processOps(ops);
        this.publishLocalOps(ops);
    }
    regeneratorDeps() {
        return {
            galaxy: this.galaxy,
            getMaxSolarSystemId: () => this.maxSolarSystemId,
            getGenerationParams: () => this.getInputParameters(),
            applyLocalOps: (ops) => this.applyLocalOps(ops),
            publishRegenerationLifecycle: (phase, regenerationId, clusterIds) => {
                if (!this.mainBus.isPubSubReady())
                    return;
                const eventName = phase === "started"
                    ? Topics.galaxyRegenerationStarted
                    : Topics.galaxyRegenerationComplete;
                publishTopic(this.mainBus, eventName, { regenerationId, clusterIds, timestamp: Date.now() }, 0);
            },
            publishOpsComplete: (payload) => {
                if (!this.mainBus.isPubSubReady())
                    return;
                publishTopic(this.mainBus, Topics.galaxyComplete, payload, 2);
            },
            updateStats: () => this.updateStats(),
        };
    }
    regenerateCluster(clusterId) {
        regenerateClusters(this.regeneratorDeps(), [clusterId]);
    }
    regenerateClusterExtended(clusterId) {
        const ids = collectExtendedClusterIds(this.galaxy, clusterId);
        if (!ids.length)
            return;
        regenerateClusters(this.regeneratorDeps(), ids);
    }
    processOps(ops) {
        const result = replayGalaxyOps(this.galaxy, ops, {
            maxSolarSystemId: this.maxSolarSystemId,
        });
        this.maxSolarSystemId = result.maxSolarSystemId;
    }
    getInputParameters() {
        if (this.uiBindings.mode === "editor") {
            return this.uiBindings.getGenerationParams();
        }
        return DEFAULT_GENERATION_PARAMS;
    }
    generateGalaxy(overrideParams) {
        console.log("Generating new galaxy...");
        const params = {
            ...this.getInputParameters(),
            ...(overrideParams ?? {}),
        };
        if (this.mainBus.isPubSubReady()) {
            publishTopic(this.mainBus, Topics.generateGalaxy, params);
        }
    }
    generateFleet() {
        if (this.mainBus.isPubSubReady()) {
            publishTopic(this.mainBus, Topics.generateFleet, {});
        }
    }
    /**
     * Toggle third-person chase on a random ship (F1 roof-cam).
     * Hold CTRL to free-look; release eases back over 200ms.
     */
    followRandomShip() {
        const view = this.webGpuView;
        const cam = this.cameraController;
        if (!view || typeof cam.setFollowShip !== "function")
            return;
        if (typeof cam.isFollowing === "function" && cam.isFollowing()) {
            cam.setFollowShip(null);
            view?.setFollowShipIndex(null);
            return;
        }
        const picked = view.pickRandomShipPose();
        if (!picked) {
            console.info("[camera] No ships to follow — generate fleets first.");
            return;
        }
        const shipIndex = picked.shipIndex;
        view.setFollowShipIndex(shipIndex);
        cam.setFollowShip(() => view.getLiveShipPose(shipIndex));
        console.info(`[camera] Following ship #${shipIndex} (CTRL free-look)`);
    }
    /**
     * One generate_fleets_bulk to the fleets-worker. Worker pathfinds + chunks;
     * main only applies fleets_spawned_batch (64–128) with fair ship budget.
     *
     * Visual N = min(CAP_NEAR, floor(GLOBAL_MAX / n)) so **10k fleets** packs
     * full formation (~48 → ~480k ships under GLOBAL_MAX_INSTANCES). No soft N=1
     * stand-in — GPU LOD still demotes draw/sim by camera each frame.
     */
    generateFleetsBulk(count) {
        if (!this.mainBus.isPubSubReady())
            return;
        const n = Math.max(0, Math.min(count | 0, 100000));
        if (n <= 0)
            return;
        const hint = Math.max(1, Math.min(CAP_NEAR, Math.floor(GLOBAL_MAX_INSTANCES / Math.max(1, n))));
        const view = this.webGpuView;
        if (view) {
            view.setBulkShipBudgetHint(hint);
            if (!view.isDeviceLost()) {
                try {
                    view.reserveFleetCapacity(n, hint);
                }
                catch (err) {
                    console.warn("[fleets] reserveFleetCapacity failed:", err);
                }
            }
            view.startRenderLoop();
        }
        beginBulkAdd(n);
        publishTopic(this.mainBus, Topics.generateFleetsBulk, { count: n });
    }
    clearBulkShipBudgetHint() {
        this.webGpuView?.setBulkShipBudgetHint(null);
    }
    clearGalaxy() {
        console.log("Clearing galaxy...");
        endBulkAdd();
        this.clearBulkShipBudgetHint();
        // Clear renderer
        this.graphics().clear();
        this.graphics().clearFleets();
        // Clear galaxy
        this.galaxy.clear();
        this.maxSolarSystemId = 0;
        // Notify workers to clear their state
        if (this.mainBus.isPubSubReady()) {
            publishTopic(this.mainBus, Topics.clearGalaxy, {});
        }
        // Reset stats
        this.updateStats({
            clusters: 0,
            solarSystems: 0,
            jumpGates: 0,
            connections: 0,
            internalConnections: 0,
        });
        this.fleetStatus.clear();
        console.log("Galaxy cleared!");
    }
    updateStats(stats) {
        const resolvedStats = stats ?? this.galaxy.getStatistics();
        this.uiController.updateStats(resolvedStats);
    }
    /**
     * Schedule a throttled stats update (max once per 200ms)
     */
    scheduleStatsUpdate() {
        const now = Date.now();
        if (now - this.lastStatsUpdate >= this.statsUpdateInterval) {
            // Enough time has passed, update immediately
            this.updateStats();
            this.lastStatsUpdate = now;
            this.statsUpdatePending = false;
        }
        else if (!this.statsUpdatePending) {
            // Schedule an update for later
            this.statsUpdatePending = true;
            const timeToWait = this.statsUpdateInterval - (now - this.lastStatsUpdate);
            setTimeout(() => {
                if (this.statsUpdatePending) {
                    this.updateStats();
                    this.lastStatsUpdate = Date.now();
                    this.statsUpdatePending = false;
                }
            }, timeToWait);
        }
        // If update is already pending, do nothing
    }
}
const DEFAULT_GENERATION_PARAMS = {
    numClusters: 15000,
    numSolarSystems: 80,
    maxConnections: 3,
    galaxySize: 300000,
    centerBias: 0.6,
    minDistance: 1500,
    heightVariation: 0,
};
function createAndInsertStatsPanels(statsBar) {
    const stats = new Stats();
    stats.dom.style.position = "static";
    stats.dom.style.marginBottom = "3px";
    stats.dom.style.display = "inline";
    // Make each of the 3 canvas children inline
    Array.from(stats.dom.children).forEach((child) => {
        if (child instanceof HTMLElement &&
            child.tagName.toLowerCase() === "canvas") {
            child.style.display = "inline";
        }
    });
    if (statsBar) {
        statsBar.insertBefore(stats.dom, statsBar.firstChild);
    }
    return stats;
}
//# sourceMappingURL=app.js.map