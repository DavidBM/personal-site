import { UIController } from "./ui-controller.js";
import { createOnlineSession } from './main/online-session.js';
import { followOnlineShip } from './main/online-navigation.js';
import { createOnlineTopology } from './main/online-topology.js';
import { Galaxy } from "./galaxy.js";
import { GalaxyMetrics } from "./galaxy-metrics.js";
import { ControlsManager } from "./controls-manager.js";
import { replayGalaxyOps } from "./galaxy/galaxy-op-replayer.js";
import { ClusterContextMenuController } from "./main/cluster-context-menu-controller.js";
import { subscribeAppLifecycleDebugTopics, subscribeAppTopics, } from "./main/app-subscriptions.js";
import { initializeAppWorkers } from "./main/app-workers.js";
import { createPointerEventRouter, } from "./main/pointer-event-router.js";
import { createEditHandlePointerController, } from "./main/edit-handle-pointer.js";
import { createRenderViewHooks } from "./main/render-view-hooks.js";
import { RenderClient } from "./main/render-client.js";
import { createRenderCameraInput } from "./main/render-camera-input.js";
import { pickRenderBody } from "./main/render-picking.js";
import { createScenePointerFeedback } from "./ui/scene-pointer-feedback.js";
import { installAppRenderDiagnostics } from "./main/app-render-diagnostics.js";
import { collectExtendedClusterIds, regenerateClusters, } from "./main/cluster-regenerator.js";
import { createFleetStatusController, } from "./main/fleet-status-controller.js";
import { beginBulkAdd, cancelGamePerfWork, endBulkAdd, installGamePerfGlobal, isBulkActive, noteBulkApplied, } from "./main/game-perf.js";
import { CAP_NEAR, GLOBAL_MAX_INSTANCES } from "./gpu/fleet-lod.js";
import { Bus } from "./worker/bus/Bus.js";
import { publishTopic, Topics } from "./worker/protocol/topics.js";
import { CursorStatsWidget } from "./ui/cursor-stats-widget.js";
import { createUIContext, createUIRoot } from "./ui/ui-kit.js";
import { buildEditorUI, buildPlayUI, resolveUIMode, } from "./ui/ui-modes.js";
import { createRenderPerformancePanel } from "./main/render-performance-panel.js";
import { assertWebGpuAvailable } from "./gpu/preferred-backend.js";
import { directorFlyToSystem, fleetLocsFromState, pickRandomCluster, pickRandomSystem, pickSystemWithShips, arrivalShipsPresent, } from "./gpu/camera-director.js";
import { SCENE_ENTER_PX, distanceForSpanPx, } from "./gpu/solar-system-lod.js";
export class App {
    constructor(options = {}) {
        this.online = null;
        this.onlineAttempt = 0;
        this.onlineNode = null;
        this.lastSceneFleetIdsKey = "";
        this.scenePointerFeedback = null;
        this.scenePickBusy = false;
        this.pendingScenePick = null;
        this.scenePickGeneration = 0;
        this.sceneSelectionGeneration = 0;
        this.solarInputIsolated = false;
        this.galaxyEditOverlay = null;
        this.onlineSceneFleetSystemId = null;
        this.onlineSceneFleets = new Map();
        this.lastRenderFleetCount = 0;
        this.disposed = false;
        this.disposePromise = null;
        this.startupAbort = new AbortController();
        this.subscriptionDispose = null;
        this.authority = options.authority ?? 'offline';
        this.statsPanels = [];
        this.uiRoot = createUIRoot();
        this.uiContext = createUIContext(this.uiRoot);
        this.uiMode = this.authority === 'online' ? 'play' : resolveUIMode();
        this.uiBindings = this.buildUIBindings(this.uiMode);
        this.contextMenu =
            this.uiBindings.mode === "editor" ? this.uiBindings.contextMenu : null;
        this.contextMenuController = null;
        this.pointerEventRouter = null;
        this.renderClient = null;
        this.editHandlePointer = null;
        const statsBar = editorStatsContainer(this.uiBindings);
        if (statsBar) {
            this.statsPanels.push(createRenderPerformancePanel(statsBar));
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
        this.lastPlanetPanelKey = "";
        this.lastDirectorTarget = null;
        installGamePerfGlobal();
        this.uiController =
            this.uiBindings.mode === "editor"
                ? new UIController(this.uiBindings.stats)
                : new UIController();
        // WebGPU device request is async in initialize() / setupWebGpuGraphics().
        this.cameraController = null;
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
    /** Transfer the canvas once; workers own camera, GPU simulation, and rendering. */
    async setupWebGpuGraphics() {
        assertWebGpuAvailable();
        const client = await RenderClient.create({
            container: document.body,
            onState: (snapshot) => this.handleRenderState(snapshot),
            onError: (error) => console.error("[Galaxy] Render worker failed:", error),
            signal: this.startupAbort.signal,
        });
        if (this.disposed) {
            await client.dispose();
            throw new Error("App disposed during renderer initialization");
        }
        this.renderClient = client;
        this.scenePointerFeedback = createScenePointerFeedback(document.body);
        this.cameraController = createRenderCameraInput(client, this.controlsManager, () => this.clearSceneSelection());
        const bridge = createRenderViewHooks(client, () => this.galaxy);
        this.galaxy = new Galaxy(bridge.hooks, this.metrics);
        this.fleetStatus.dispose();
        this.fleetStatus = createFleetStatusController({
            renderer: {
                addFleet: (id, counts, state) => client.send({ type: "fleetSpawn", fleets: [{ id, counts, state }] }),
                addFleetBatch: (fleets) => client.send({ type: "fleetSpawn", fleets: [...fleets] }),
                updateFleetState: (id, state) => client.send({ type: "fleetState", id, state }),
                removeFleet: (id) => client.send({ type: "fleetRemove", id }),
            },
            onListChanged: (byId) => {
                if (this.uiBindings.mode === "editor")
                    this.uiBindings.fleets.render(byId);
            },
        });
        this.editHandlePointer = createEditHandlePointerController({
            target: bridge.editTarget,
            camera: this.cameraController,
            getFallbackClusterId: () => this.galaxy.getLastEditHandleClusterId() ?? this.lastUIState.selectedId,
            publish: (payload) => this.publishPointerEvent(payload),
        });
        this.contextMenuController = this.createContextMenuController();
        this.syncPlanetPanel();
    }
    handleRenderState(snapshot) {
        if (this.disposed)
            return;
        this.setSolarInputIsolation(snapshot.systemId != null);
        for (const panel of this.statsPanels)
            panel.update(snapshot);
        const added = Math.max(0, snapshot.metrics.fleetCount - this.lastRenderFleetCount);
        this.lastRenderFleetCount = snapshot.metrics.fleetCount;
        if (added > 0 && isBulkActive()) {
            noteBulkApplied(added);
            if (!isBulkActive())
                this.clearBulkShipBudgetHint();
        }
        this.syncPlanetPanel();
        this.cursorStatsWidget?.refreshZoom();
    }
    buildUIBindings(mode) {
        return mode === "play"
            ? buildPlayUI(this.uiContext, this, this.authority === 'online')
            : buildEditorUI(this.uiContext, this);
    }
    createContextMenuController() {
        if (!this.contextMenu)
            return null;
        return new ClusterContextMenuController({
            bindings: this.contextMenu,
            getClusters: () => this.galaxy.clusters,
            getGroundPoint: (screenX, screenY) => this.cameraController?.getGroundPointFromScreenPosition(screenX, screenY) ?? null,
        });
    }
    isSolarSceneActive() {
        return this.solarInputIsolated || this.renderClient?.snapshot()?.systemId != null;
    }
    showGalaxyEditOverlay(clusterId, handles) {
        if (!this.galaxy.getClusterById(clusterId))
            return;
        this.controlsManager.setEditModeActive(true, clusterId);
        this.renderClient?.send({ type: "editMode", active: true });
        this.editHandlePointer?.setActiveClusterId(clusterId);
        this.galaxy.showEditHandles(clusterId, [...handles]);
    }
    setSolarInputIsolation(active) {
        if (active === this.solarInputIsolated)
            return;
        this.solarInputIsolated = active;
        this.contextMenuController?.hide();
        if (active) {
            this.controlsManager.setEditModeActive(false, null);
            this.editHandlePointer?.setActiveClusterId(null);
            this.renderClient?.send({ type: "editMode", active: false });
            this.renderClient?.send({ type: "hideEditHandles" });
            this.renderClient?.send({ type: "hover", ring: null });
            this.renderClient?.send({ type: "select", ring: null });
            return;
        }
        this.applyGalaxyUIState(this.lastUIState);
        const edit = this.galaxyEditOverlay;
        if (edit)
            this.showGalaxyEditOverlay(edit.clusterId, edit.handles);
    }
    setUIMode(mode) {
        if (this.authority === 'online' && mode !== 'play')
            return;
        if (mode === this.uiMode)
            return;
        this.uiMode = mode;
        this.uiRoot.clear();
        this.uiBindings = this.buildUIBindings(this.uiMode);
        this.contextMenu =
            this.uiBindings.mode === "editor" ? this.uiBindings.contextMenu : null;
        this.contextMenuController = this.createContextMenuController();
        const statsBar = editorStatsContainer(this.uiBindings);
        for (const panel of this.statsPanels)
            panel.dispose();
        this.statsPanels = [];
        if (statsBar) {
            this.statsPanels.push(createRenderPerformancePanel(statsBar));
        }
        this.stats = this.statsPanels[0] ?? null;
        this.uiController.setStatsElements(this.uiBindings.stats);
        const statsContainer = editorStatsContainer(this.uiBindings);
        if (this.cursorStatsWidget) {
            this.cursorStatsWidget.setContainer(statsContainer);
        }
        this.updateStats();
        this.updateUIModeHistory();
        this.fleetStatus.renderList();
        this.lastPlanetPanelKey = "";
        this.syncPlanetPanel();
    }
    updateUIModeHistory() {
        const url = new URL(window.location.href);
        url.searchParams.set("ui", this.uiMode);
        window.history.replaceState({}, "", url.toString());
    }
    async initialize() {
        try {
            if (this.disposed)
                throw new Error("App disposed");
            await this.setupWebGpuGraphics();
            await this.initializeWorkers();
            if (this.disposed)
                throw new Error("App disposed during initialization");
            this.renderClient?.send({ type: "start" });
            installAppRenderDiagnostics(this);
        }
        catch (error) {
            await this.dispose();
            throw error;
        }
    }
    async connectOnline(options) {
        if (this.authority !== 'online' || !this.renderClient || this.disposed)
            throw new Error('Online App is not initialized');
        const attempt = ++this.onlineAttempt;
        await this.online?.dispose();
        if (this.disposed || attempt !== this.onlineAttempt)
            throw new Error('Online connection was superseded');
        const session = createOnlineSession({ ...options, bus: this.mainBus, renderer: this.renderClient,
            installTopology: (view, subscription) => this.installServerTopology(view, subscription) });
        this.online = session;
        await session.ready;
        if (this.disposed || this.online !== session)
            throw new Error('Online connection was superseded');
        return session;
    }
    installServerTopology(view, subscription) {
        const topology = createOnlineTopology(view);
        const node = topology.node(subscription.systemId);
        this.onlineNode = node;
        this.renderClient?.send({ type: 'clear' });
        this.galaxy.clear();
        this.maxSolarSystemId = 0;
        this.fleetStatus.clear();
        this.lastRenderFleetCount = 0;
        this.lastDirectorTarget = null;
        publishTopic(this.mainBus, Topics.clearGalaxy, {}, 0);
        this.processOps(topology.ops);
        publishTopic(this.mainBus, Topics.galaxyLocalOps, topology.ops, 0);
        this.renderClient?.send({ type: 'finalize' });
        const system = this.galaxy.getSolarSystemById(node.clusterId, node.solarSystemId);
        this.startDirectorFly({ ...node, x: system.position.x, z: system.position.z }, { durationMs: 750 });
        this.updateStats();
        return node;
    }
    async followOnlineShip(shipId) {
        const renderer = this.renderClient, session = this.online, node = this.onlineNode;
        if (!renderer || !session || !node)
            throw new Error('Connect to a server first');
        const system = this.galaxy.getSolarSystemById(node.clusterId, node.solarSystemId);
        await followOnlineShip({ renderer, session, node,
            current: () => !this.disposed && this.online === session,
            navigate: () => { this.startDirectorFly({ ...node, x: system.position.x, z: system.position.z }, { durationMs: 500 }); },
        }, shipId);
    }
    async initializeWorkers() {
        try {
            await initializeAppWorkers(this.mainBus, this.authority);
            if (this.disposed)
                throw new Error("App disposed during worker initialization");
            this.subscriptionDispose = subscribeAppTopics(this.mainBus, {
                galaxy: {
                    onGalaxyOps: async (ops, signal) => {
                        this.processOps(ops);
                        if (!this.renderClient)
                            throw new Error('Renderer unavailable during generation');
                        // Queries flush preceding topology and resolve after worker replay.
                        await this.renderClient.query({ type: 'snapshot' }, { timeoutMs: null, signal });
                        this.updateStats();
                    },
                    onGalaxyComplete: (payload) => {
                        if (!payload || payload.finalizeBuffers !== false) {
                            try {
                                this.renderClient?.send({ type: "finalize" });
                            }
                            catch (err) {
                                console.warn("[Galaxy] finalizeBuffers failed:", err);
                            }
                        }
                        // Ensure rAF is running after first topology (safe if already started).
                        this.renderClient?.send({ type: "start" });
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
                        if (connectionColors)
                            this.renderClient?.send({ type: "connectionColors", colors: connectionColors });
                    },
                    onShowEditHandles: ({ clusterId, handles }) => {
                        this.galaxyEditOverlay = { clusterId, handles: [...handles] };
                        if (!this.isSolarSceneActive())
                            this.showGalaxyEditOverlay(clusterId, handles);
                    },
                    onHideEditHandles: ({ clusterId }) => {
                        this.galaxyEditOverlay = null;
                        this.controlsManager.setEditModeActive(false, null);
                        this.renderClient?.send({ type: "editMode", active: false });
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
                if (this.disposed)
                    return;
                subscribeAppLifecycleDebugTopics(this.mainBus);
            }, 500);
        }
        catch (error) {
            if (this.disposed)
                throw error;
            console.error("Failed to initialize workers:", error);
            alert("Failed to initialize application workers. Please refresh the page.");
            throw error;
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
            return this.renderClient?.snapshot()?.camera.eyeY ?? null;
        });
        const canvas = this.renderClient?.canvas;
        if (!canvas || !this.cameraController) {
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
                tryPickBody: (x, y) => this.tryPickBody(x, y),
                tryPickSceneTarget: (x, y) => this.tryPickSceneTarget(x, y),
                updateSceneHover: (x, y) => this.updateSceneHover(x, y),
                clearFocus: () => this.clearSceneSelection(),
                isSceneActive: () => this.isSolarSceneActive(),
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
        this.lastUIState = { hoveredId, selectedId };
        if (this.isSolarSceneActive()) {
            this.galaxy.setHoveredCluster(null);
            this.galaxy.setSelectedCluster(null);
            return;
        }
        this.applyGalaxyUIState({ hoveredId, selectedId });
    }
    applyGalaxyUIState({ hoveredId, selectedId }) {
        const hoveredCluster = hoveredId != null ? this.galaxy.getClusterById(hoveredId) : null;
        const selectedCluster = selectedId != null ? this.galaxy.getClusterById(selectedId) : null;
        this.galaxy.setHoveredCluster(hoveredCluster);
        this.galaxy.setSelectedCluster(selectedCluster);
    }
    handleClusterDragUpdate(clusterId, position) {
        if (this.authority === 'online' || this.isSolarSceneActive())
            return;
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
        this.renderClient?.send({ type: "moveCluster", clusterId, position: { ...cluster.position }, commit: false });
        if (this.lastUIState.hoveredId === clusterId) {
            this.galaxy.setHoveredCluster(cluster);
        }
        if (this.lastUIState.selectedId === clusterId) {
            this.galaxy.setSelectedCluster(cluster);
        }
    }
    handleClusterDragCommit(clusterId, position) {
        if (this.authority === 'online' || this.isSolarSceneActive())
            return;
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
        this.renderClient?.send({ type: "moveCluster", clusterId, position: { ...cluster.position }, commit: true });
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
        if (this.authority === 'online')
            return;
        regenerateClusters(this.regeneratorDeps(), [clusterId]);
    }
    regenerateClusterExtended(clusterId) {
        if (this.authority === 'online')
            return;
        const ids = collectExtendedClusterIds(this.galaxy, clusterId);
        if (!ids.length)
            return;
        regenerateClusters(this.regeneratorDeps(), ids);
    }
    processOps(ops) {
        this.renderClient?.send({ type: "topology", ops });
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
        if (this.authority === 'online')
            return;
        console.log("Generating new galaxy...");
        this.clearGalaxy();
        globalThis.__galaxyGenComplete = false;
        const params = {
            ...this.getInputParameters(),
            ...(overrideParams ?? {}),
        };
        if (this.mainBus.isPubSubReady()) {
            publishTopic(this.mainBus, Topics.generateGalaxy, params);
        }
    }
    generateFleet() {
        if (this.authority === 'online')
            return;
        if (!this.mainBus.isPubSubReady())
            return;
        const at = this.renderClient?.snapshot()?.sceneNode ?? undefined;
        publishTopic(this.mainBus, Topics.generateFleet, at ? { at } : {});
    }
    followRandomShip() {
        this.renderClient?.send({ type: "followRandomShip" });
    }
    selectSceneBody(index) {
        this.sceneSelectionGeneration++;
        const snapshot = this.renderClient?.snapshot();
        const body = snapshot?.bodies.find((candidate) => candidate.index === index);
        if (!body || snapshot?.systemId == null)
            return;
        this.renderClient?.send({ type: "selectBody", index, systemId: snapshot.systemId, catalogId: body.catalogId });
    }
    selectSceneFleet(id) {
        this.sceneSelectionGeneration++;
        const snapshot = this.renderClient?.snapshot();
        const local = this.authority === "offline" && this.fleetStatus.byId.has(id);
        if (!local && !snapshot?.sceneFleets.some((fleet) => fleet.id === id) && !this.onlineSceneFleets.has(id))
            return;
        this.renderClient?.send({ type: "selectFleet", id });
    }
    clearSceneSelection() {
        this.sceneSelectionGeneration++;
        this.renderClient?.send({ type: "clearFocus" });
    }
    loadMoreSceneFleets() {
        const client = this.renderClient;
        const snapshot = client?.snapshot();
        if (!client || !snapshot || this.authority !== "online")
            return;
        const systemId = snapshot.systemId;
        void client.query({ type: "sceneFleetPage", offset: this.onlineSceneFleets.size, limit: 256 })
            .then((value) => {
            const page = value;
            if (client.snapshot()?.systemId !== systemId)
                return;
            for (const fleet of page.fleets)
                this.onlineSceneFleets.set(fleet.id, fleet);
            this.lastPlanetPanelKey = "";
            this.syncPlanetPanel();
        }).catch(() => { });
    }
    tryPickBody(x, y) {
        const client = this.renderClient;
        const snapshot = client?.snapshot();
        if (!client || !snapshot || snapshot.systemId == null)
            return false;
        const rect = client.canvas.getBoundingClientRect();
        const body = pickRenderBody(snapshot, x - rect.left, y - rect.top);
        if (!body)
            return false;
        this.selectSceneBody(body.index);
        return true;
    }
    tryPickSceneTarget(x, y) {
        const client = this.renderClient;
        const snapshot = client?.snapshot();
        if (!client || !snapshot || snapshot.systemId == null)
            return false;
        this.queueScenePick(x, y, true);
        return true;
    }
    updateSceneHover(x, y) {
        if (x < 0 || y < 0) {
            this.scenePickGeneration++;
            this.pendingScenePick = this.pendingScenePick?.select ? this.pendingScenePick : null;
            this.scenePointerFeedback?.update(null);
            return;
        }
        if (!this.sceneHoverAvailable()) {
            this.scenePointerFeedback?.update(null);
            return;
        }
        this.queueScenePick(x, y, false);
    }
    sceneHoverAvailable() {
        const snapshot = this.renderClient?.snapshot();
        return this.scenePointerFeedback != null && snapshot != null && snapshot.systemId != null;
    }
    queueScenePick(x, y, select) {
        const pending = this.pendingScenePick;
        if (pending?.select && !select)
            return;
        const selectionGeneration = select ? ++this.sceneSelectionGeneration : this.sceneSelectionGeneration;
        this.pendingScenePick = { x, y, select, generation: ++this.scenePickGeneration, selectionGeneration };
        if (!this.scenePickBusy)
            void this.drainScenePick();
    }
    async drainScenePick() {
        const request = this.pendingScenePick;
        const client = this.renderClient;
        if (!request || !client || this.disposed)
            return;
        this.pendingScenePick = null;
        this.scenePickBusy = true;
        const sceneId = client.snapshot()?.systemId ?? null;
        const rect = client.canvas.getBoundingClientRect();
        try {
            await this.executeScenePick(client, request, sceneId, rect);
        }
        catch {
            this.scenePointerFeedback?.update(null);
        }
        finally {
            this.scenePickBusy = false;
            if (this.pendingScenePick)
                void this.drainScenePick();
        }
    }
    async executeScenePick(client, request, sceneId, rect) {
        const target = await client.query({ type: "pickSceneTarget", x: request.x - rect.left, y: request.y - rect.top });
        const after = client.snapshot();
        if (!after || sceneId !== after.systemId)
            return;
        if (request.select && request.selectionGeneration !== this.sceneSelectionGeneration)
            return;
        if (!request.select && request.generation !== this.scenePickGeneration)
            return;
        this.handleScenePickResponse(request, target);
    }
    handleScenePickResponse(request, target) {
        if (request.select) {
            this.applyScenePick(target);
            return;
        }
        let kind = null;
        if (target)
            kind = target.kind === "body" ? "planet" : "fleet";
        this.scenePointerFeedback?.update(kind, request.x, request.y);
    }
    applyScenePick(target) {
        if (target?.kind === "body") {
            const systemId = this.renderClient?.snapshot()?.systemId;
            if (systemId != null)
                this.renderClient?.send({ type: "selectBody", index: target.index, systemId, catalogId: target.catalogId });
        }
        // The worker already validated the fleet's scene and GPU-slot identity.
        // A picked online fleet may sit beyond the UI's currently loaded page.
        else if (target?.kind === "fleet")
            this.renderClient?.send({ type: "selectFleet", id: target.id });
        else
            this.clearSceneSelection();
    }
    syncPlanetPanel() {
        const snapshot = this.renderClient?.snapshot();
        if (!snapshot || snapshot.systemId == null || snapshot.bodies.length === 0) {
            if (this.lastPlanetPanelKey === "0")
                return;
            this.lastPlanetPanelKey = "0";
            this.lastSceneFleetIdsKey = "";
            this.onlineSceneFleetSystemId = null;
            this.onlineSceneFleets.clear();
            this.uiBindings.planetPanel.sync({ visible: false, bodies: [], focusIndex: null, fleets: [], selectedFleetId: null });
            return;
        }
        const node = snapshot.sceneNode;
        this.syncSceneFleetIds(node);
        const fleets = this.sceneFleetRows(snapshot);
        const key = `${snapshot.systemId}:${snapshot.focusIndex}:${snapshot.selectedFleetId}:${snapshot.sceneFleetCount}:${snapshot.bodies.map((body) => body.catalogId).join("|")}:${fleets.map((fleet) => `${fleet.id}:${fleet.shipCount}:${fleet.state}`).join("|")}`;
        if (key === this.lastPlanetPanelKey)
            return;
        this.lastPlanetPanelKey = key;
        this.uiBindings.planetPanel.sync({ visible: true, bodies: snapshot.bodies, focusIndex: snapshot.focusIndex,
            fleets, fleetTotal: this.authority === "offline" ? fleets.length : snapshot.sceneFleetCount,
            selectedFleetId: snapshot.selectedFleetId });
    }
    syncSceneFleetIds(node) {
        if (!node || this.authority !== "offline")
            return;
        const ids = this.fleetStatus.fleetIdsAt(node.clusterId, node.solarSystemId);
        const idsKey = `${node.clusterId}:${node.solarSystemId}:${ids.join("|")}`;
        if (idsKey === this.lastSceneFleetIdsKey)
            return;
        this.lastSceneFleetIdsKey = idsKey;
        this.renderClient?.send({ type: "sceneFleetIds", ids: [...ids] });
    }
    sceneFleetRows(snapshot) {
        const node = snapshot.sceneNode;
        if (this.authority !== "offline" || !node) {
            if (this.onlineSceneFleetSystemId !== snapshot.systemId) {
                this.onlineSceneFleetSystemId = snapshot.systemId;
                this.onlineSceneFleets.clear();
            }
            for (const fleet of snapshot.sceneFleets)
                this.onlineSceneFleets.set(fleet.id, fleet);
            return [...this.onlineSceneFleets.values()].map((fleet) => ({ id: fleet.id, shipCount: fleet.shipCount, state: fleet.state }));
        }
        return this.fleetStatus.fleetIdsAt(node.clusterId, node.solarSystemId).map((id) => {
            const fleet = this.fleetStatus.byId.get(id);
            return { id, shipCount: fleet.counts.red + fleet.counts.blue + fleet.counts.green, state: fleet.state.state };
        });
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
        if (this.authority === 'online')
            return;
        if (!this.mainBus.isPubSubReady())
            return;
        const n = Math.max(0, Math.min(count | 0, 100000));
        if (n <= 0)
            return;
        const hint = Math.max(1, Math.min(CAP_NEAR, Math.floor(GLOBAL_MAX_INSTANCES / Math.max(1, n))));
        const view = this.renderClient;
        if (view) {
            view.send({ type: "fleetBudget", count: hint });
            if (!view.isDeviceLost()) {
                try {
                    view.send({ type: "reserveFleets", count: n, shipsPerFleet: hint });
                }
                catch (err) {
                    console.warn("[fleets] reserveFleetCapacity failed:", err);
                }
            }
            view.send({ type: "start" });
        }
        this.lastRenderFleetCount = this.renderClient?.snapshot()?.metrics.fleetCount ?? 0;
        beginBulkAdd(n);
        // Bulk is always galaxy-wide. Parking 1k fleets in one jewel floods
        // NEAR triangles (screenshot mess). Single "Generate a Fleet" may park.
        publishTopic(this.mainBus, Topics.generateFleetsBulk, { count: n });
    }
    /** Topology systems for the director (skip jump gates). */
    collectDirectorSystems(includeJumpGates = false) {
        const out = [];
        const clusters = this.galaxy.clusters;
        for (let i = 0; i < clusters.length; i++) {
            const cluster = clusters[i];
            const systems = cluster.solarSystems;
            for (let j = 0; j < systems.length; j++) {
                const sys = systems[j];
                if (!includeJumpGates && sys.isJumpGate)
                    continue;
                out.push({
                    clusterId: cluster.id,
                    solarSystemId: sys.id,
                    x: sys.position.x,
                    z: sys.position.z,
                });
            }
        }
        return out;
    }
    collectDirectorFleets(includeJumping = true) {
        const out = [];
        for (const [id, entry] of this.fleetStatus.byId) {
            const locs = fleetLocsFromState(entry.state, { includeJumping });
            if (locs.length === 0)
                continue;
            out.push({ id, locs });
        }
        return out;
    }
    currentDirectorPose() {
        const st = this.renderClient?.snapshot()?.camera;
        if (!st) {
            return {
                eyeX: 0,
                eyeY: 2000,
                eyeZ: 0,
                targetX: 0,
                targetY: 0,
                targetZ: 0,
            };
        }
        return {
            eyeX: st.eyeX,
            eyeY: st.eyeY,
            eyeZ: st.eyeZ,
            targetX: st.targetX,
            targetY: st.targetY,
            targetZ: st.targetZ,
        };
    }
    /**
     * Kepler-enter height from current viewport. Floor stays well above MIN_ZOOM
     * so a fly is an ease, not a one-frame slam to the galaxy-pan floor.
     */
    directorFlyHeight(opts) {
        const h = opts?.height;
        if (isPositiveFinite(h))
            return h;
        const camera = this.renderClient?.snapshot()?.camera;
        if (!camera)
            return 350;
        // Land inside the enter band: an exact 50px boundary can round below it
        // after the large-world camera transform, leaving the scene unloaded.
        const sceneH = distanceForSpanPx(SCENE_ENTER_PX + 1, camera.bufferH, camera.fovyDeg);
        if (Number.isFinite(sceneH) && sceneH > 0.05)
            return sceneH;
        return 350;
    }
    startDirectorFly(system, opts) {
        if (!this.renderClient)
            return { ok: false, reason: "director not ready" };
        const durationMs = typeof opts?.durationMs === "number" && Number.isFinite(opts.durationMs)
            ? opts.durationMs
            : 2500;
        const height = this.directorFlyHeight(opts);
        const step = directorFlyToSystem(this.currentDirectorPose(), system, height, durationMs);
        this.renderClient.send({ type: "directorFly", ...system, height, durationMs });
        this.lastDirectorTarget = {
            clusterId: system.clusterId,
            solarSystemId: system.solarSystemId,
        };
        this.renderClient?.send({ type: "start" });
        return { ok: true, system, step };
    }
    directorGoToSystemWithShips(opts) {
        if (!this.renderClient)
            return { ok: false, reason: "director not ready" };
        const systems = this.collectDirectorSystems(false);
        // Prefer parked (awaiting/cooldown) so arrival screenshots show ships
        // at the dest, not a mid-hop that only *ends* there.
        let system = pickSystemWithShips(systems, this.collectDirectorFleets(false));
        if (!system) {
            system = pickSystemWithShips(systems, this.collectDirectorFleets(true));
        }
        if (!system) {
            system = pickSystemWithShips(this.collectDirectorSystems(true), this.collectDirectorFleets(true));
        }
        if (!system)
            return { ok: false, reason: "no system with ships" };
        return this.startDirectorFly(system, opts);
    }
    pickNonJumpSystem() {
        return (this.collectDirectorSystems(false)[0] ??
            this.collectDirectorSystems(true)[0] ??
            null);
    }
    /**
     * Ease the camera to xz/height (jewel zoom in/out). Optional topology ids
     * so arrival checks still key a system.
     */
    directorFlyTo(opts) {
        const system = {
            clusterId: opts.clusterId ?? this.lastDirectorTarget?.clusterId ?? 0,
            solarSystemId: opts.solarSystemId ?? this.lastDirectorTarget?.solarSystemId ?? 0,
            x: opts.x,
            z: opts.z,
        };
        return this.startDirectorFly(system, {
            durationMs: opts.durationMs,
            height: opts.height,
        });
    }
    async observeJewel() {
        if (!this.renderClient)
            return null;
        const data = await this.renderClient.query({ type: "sceneDiagnostics" });
        const snapshot = data.snapshot;
        return {
            sceneId: snapshot.systemId, spanPx: snapshot.sceneSpanPx, bandBDraws: snapshot.bandBDraws,
            systemId: snapshot.systemId, fleetCount: snapshot.metrics.fleetCount,
            sceneBitCount: data.fleets.filter((fleet) => (fleet.slot.flags & 128) !== 0).length,
            camera: snapshot.camera, sceneNode: snapshot.sceneNode,
        };
    }
    directorGoToRandomSystem(opts) {
        if (!this.renderClient)
            return { ok: false, reason: "director not ready" };
        const systems = this.collectDirectorSystems(false);
        const cluster = pickRandomCluster(this.galaxy.clusters);
        let system = null;
        if (cluster) {
            const inCluster = systems.filter((s) => s.clusterId === cluster.id);
            system = pickRandomSystem(inCluster.length > 0 ? inCluster : systems);
        }
        else {
            system = pickRandomSystem(systems);
        }
        if (!system)
            return { ok: false, reason: "no solar system" };
        return this.startDirectorFly(system, opts);
    }
    directorStatus() {
        return {
            playing: this.renderClient?.snapshot()?.director.playing ?? false,
            meta: this.renderClient?.snapshot()?.director.target ?? this.lastDirectorTarget,
            pose: this.currentDirectorPose(),
            target: this.lastDirectorTarget,
        };
    }
    directorArrivalShipsPresent() {
        const t = this.lastDirectorTarget;
        if (!t)
            return { present: false, count: 0, ids: [] };
        return arrivalShipsPresent(this.collectDirectorFleets(true), t.clusterId, t.solarSystemId);
    }
    clearBulkShipBudgetHint() {
        this.renderClient?.send({ type: "fleetBudget", count: null });
    }
    clearGalaxy() {
        if (this.authority === 'online')
            return;
        console.log("Clearing galaxy...");
        endBulkAdd();
        this.clearBulkShipBudgetHint();
        // Clear renderer
        this.renderClient?.send({ type: "clear" });
        this.lastRenderFleetCount = 0;
        this.lastDirectorTarget = null;
        this.solarInputIsolated = false;
        this.galaxyEditOverlay = null;
        this.controlsManager.setEditModeActive(false);
        this.editHandlePointer?.setActiveClusterId(null);
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
    dispose() {
        this.disposePromise ?? (this.disposePromise = this.disposeResources());
        return this.disposePromise;
    }
    async disposeResources() {
        this.disposed = true;
        this.onlineAttempt++;
        this.startupAbort.abort();
        cancelGamePerfWork();
        this.pointerEventRouter?.dispose();
        this.scenePointerFeedback?.dispose();
        this.scenePointerFeedback = null;
        this.cameraController?.dispose();
        this.controlsManager.setEditModeActive(false);
        this.cursorStatsWidget?.dispose();
        this.subscriptionDispose?.();
        this.fleetStatus.dispose();
        for (const panel of this.statsPanels)
            panel.dispose();
        await this.online?.dispose();
        this.mainBus.destroy();
        await this.renderClient?.dispose();
        this.uiRoot.clear();
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
                if (!this.disposed && this.statsUpdatePending) {
                    this.updateStats();
                    this.lastStatsUpdate = Date.now();
                    this.statsUpdatePending = false;
                }
            }, timeToWait);
        }
        // If update is already pending, do nothing
    }
}
function isPositiveFinite(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function editorStatsContainer(bindings) {
    return bindings.mode === "editor" ? bindings.stats.container ?? null : null;
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
//# sourceMappingURL=app.js.map