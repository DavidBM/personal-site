import { GalaxyRenderer } from "./galaxy-renderer.js";
import { UIController } from "./ui-controller.js";
import { CameraController } from "./camera-controller.js";
import { Galaxy } from "./galaxy.js";
import { GalaxyMetrics } from "./galaxy-metrics.js";
import { Cluster } from "./cluster.js";
import { SolarSystem } from "./solar-system.js";
import { ControlsManager } from "./controls-manager.js";
import { IncrementalGalaxyBuilder } from "./incremental-galaxy-builder.js";
import { buildClusterSolarSystemPlan } from "./cluster-solar-system-plan.js";
import { Bus } from "./worker/bus/Bus.js";
import { CursorStatsWidget } from "./ui/cursor-stats-widget.js";
import { createUIContext, createUIRoot } from "./ui/ui-kit.js";
import { buildEditorUI, buildPlayUI, resolveUIMode, } from "./ui/ui-modes.js";
import Stats from "./vendor/stats.js";
import { opAddSolarSystem, opConnectClusters, opConnectSolarSystems, opRemoveConnection, opRemoveSolarSystem, } from "./worker/galaxy/galaxy-ops.js";
import { angleXZ, pointAtAngle } from "./worker/galaxy/galaxy-xz-math.js";
export class App {
    constructor() {
        this.statsPanels = [];
        this.uiRoot = createUIRoot();
        this.uiContext = createUIContext(this.uiRoot);
        this.uiMode = resolveUIMode();
        this.uiBindings = this.buildUIBindings(this.uiMode);
        this.contextMenu =
            this.uiBindings.mode === "editor" ? this.uiBindings.contextMenu : null;
        this.contextMenuClusterId = null;
        const statsBar = this.uiBindings.mode === "editor"
            ? (this.uiBindings.stats.container ?? null)
            : null;
        if (statsBar) {
            this.statsPanels.push(createAndInsertStatsPanels(statsBar));
        }
        this.stats = this.statsPanels[0] ?? null;
        this.renderer = new GalaxyRenderer(document.body);
        // Pass all stats panels; GalaxyRenderer will use statsPanels[0] (FPS) for timing, others are still updated for display.
        this.renderer.setStatsPanels(this.statsPanels);
        // Create metrics instance and pass to galaxy for efficient statistics tracking
        this.metrics = new GalaxyMetrics();
        this.galaxy = new Galaxy(this.renderer, this.metrics, (evt) => this.handleClusterEditPointer(evt));
        this.galaxyBuilder = new IncrementalGalaxyBuilder(this.galaxy);
        this.cameraController = new CameraController(this.renderer);
        this.uiController =
            this.uiBindings.mode === "editor"
                ? new UIController(this, this.uiBindings.stats)
                : new UIController(this);
        this.controlsManager = ControlsManager.getInstance();
        // Create main bus for worker management
        this.mainBus = new Bus(window, {
            debug: 1,
            workerLabel: "App/Main",
            workerId: "main",
        });
        this.cursorStatsWidget = null;
        // Throttled stats update mechanism (200ms interval)
        this.statsUpdateInterval = 200; // milliseconds
        this.lastStatsUpdate = 0;
        this.statsUpdatePending = false;
        this.lastUIState = { hoveredId: null, selectedId: null };
        this.clusterDragStarts = new Map();
        this.maxSolarSystemId = 0;
    }
    buildUIBindings(mode) {
        return mode === "play"
            ? buildPlayUI(this.uiContext, this)
            : buildEditorUI(this.uiContext, this);
    }
    setUIMode(mode) {
        if (mode === this.uiMode)
            return;
        this.uiMode = mode;
        this.uiRoot.clear();
        this.uiBindings = this.buildUIBindings(this.uiMode);
        this.contextMenu =
            this.uiBindings.mode === "editor" ? this.uiBindings.contextMenu : null;
        this.contextMenuClusterId = null;
        const statsBar = this.uiBindings.mode === "editor"
            ? (this.uiBindings.stats.container ?? null)
            : null;
        this.statsPanels = [];
        if (statsBar) {
            this.statsPanels.push(createAndInsertStatsPanels(statsBar));
        }
        this.stats = this.statsPanels[0] ?? null;
        this.renderer.setStatsPanels(this.statsPanels);
        this.renderer.setStats(this.stats);
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
    }
    updateUIModeHistory() {
        const url = new URL(window.location.href);
        url.searchParams.set("ui", this.uiMode);
        window.history.replaceState({}, "", url.toString());
    }
    async initialize() {
        await this.initializeWorkers();
    }
    async initializeWorkers() {
        try {
            // Enable pub/sub system first
            await this.mainBus.enablePubSub();
            // Log broker status for debugging
            const brokerStatus = await this.mainBus.getBrokerStatus();
            console.log("📊 Broker system status:", brokerStatus);
            // Launch galaxy worker
            await this.mainBus.launchWorker("../galaxy/galaxy-worker.js", {
                workerId: "galaxy",
                busOptions: { debug: 1 },
            });
            // Launch business worker
            await this.mainBus.launchWorker("../business/business-worker.js", {
                workerId: "business",
                busOptions: { debug: 1 },
            });
            if (!this.mainBus._brokerReady) {
                console.warn("Pub/sub not available on main bus - broker not ready");
            }
            else {
                this.mainBus.subscribe("ops", (ops) => {
                    this.processOps(ops);
                    this.updateStats();
                });
                this.mainBus.subscribe("complete", (payload) => {
                    if (!payload || payload.finalizeBuffers !== false) {
                        this.renderer.finalizeBuffers(this.galaxy);
                    }
                    this.updateStats();
                });
                this.mainBus.subscribe("error", ({ error }) => {
                    alert(`Galaxy Worker error: ${error}`);
                });
                this.mainBus.subscribe("update_ui_state", ({ hoveredId, selectedId }) => {
                    this.handleUIStateUpdate({ hoveredId, selectedId });
                });
                this.mainBus.subscribe("setConnectionColors", (connectionColors) => {
                    this.renderer.setConnectionColors(connectionColors);
                });
                this.mainBus.subscribe("show_edit_handles", ({ clusterId, handles, }) => {
                    this.controlsManager.setEditModeActive(true, clusterId);
                    this.galaxy.showEditHandles(clusterId, handles);
                });
                this.mainBus.subscribe("hide_edit_handles", ({ clusterId }) => {
                    this.controlsManager.setEditModeActive(false, null);
                    this.galaxy.hideEditHandles(clusterId);
                });
                this.mainBus.subscribe("update_cluster", ({ clusterId, position, }) => {
                    this.handleClusterDragUpdate(clusterId, position);
                });
                this.mainBus.subscribe("commit_cluster_move", ({ clusterId, position, }) => {
                    this.handleClusterDragCommit(clusterId, position);
                });
            }
            console.log("All workers initialized successfully");
            // Setup event handling after workers are ready
            this.renderer.setCameraController(this.cameraController);
            this.initEventListeners();
            // Set up pub/sub subscriptions and demo after everything is ready
            setTimeout(() => {
                this.setupMainPubSubSubscriptions();
                this.demonstratePubSubSystem();
            }, 500);
        }
        catch (error) {
            console.error("Failed to initialize workers:", error);
            alert("Failed to initialize application workers. Please refresh the page.");
        }
    }
    publishPointerEvent(payload, priority = 0) {
        if (!this.mainBus._brokerReady)
            return;
        this.mainBus.publish("pointer_event", payload, priority);
    }
    /**
     * Used by Cluster.editHandlePointerEvent to forward a handle drag/move edit event to the business worker.
     * @param {Object} evt - {cluster, type, handleId, handleKind, screenX, screenY, ndcX, ndcY, ...}
     */
    handleClusterEditPointer(evt) {
        // Prepare pointer event for worker (most info packed in evt)
        // Replicate pointer_event structure with additional cluster & handle info
        const { cluster, type, handleId, handleKind, screenX, screenY, ndcX, ndcY, originalEvent, editDragMode, } = evt;
        // Get world ray for pointer position
        const pointerRay = this.cameraController.getPointerRayFromScreenPosition(screenX, screenY);
        const groundPoint = this.cameraController.getGroundPointFromScreenPosition(screenX, screenY) || { x: 0, y: 0, z: 0 };
        const ndc = typeof ndcX === "number" && typeof ndcY === "number"
            ? { x: ndcX, y: ndcY }
            : undefined;
        this.publishPointerEvent({
            type,
            clusterId: cluster.id,
            handleId,
            handleKind,
            editDragMode, // "xz" or "y" for edit dragging
            screen_position: { x: screenX, y: screenY },
            galaxy_position: { x: groundPoint.x, z: groundPoint.z },
            ray: pointerRay,
            ndc,
        });
    }
    initEventListeners() {
        const statsContainer = this.uiBindings.mode === "editor"
            ? (this.uiBindings.stats.container ?? null)
            : null;
        this.cursorStatsWidget = new CursorStatsWidget(this.mainBus, "cursorStats", statsContainer);
        // Hook stats.js begin/end into renderer
        if (this.stats) {
            this.renderer.setStats(this.stats);
        }
        // Unified event handling for camera, selection, and edit handles
        this.setupUnifiedEventHandlers();
    }
    handleContextMenuAction(action) {
        if (!this.contextMenu)
            return;
        const clusterId = this.contextMenuClusterId;
        if (action === "regenerate" && typeof clusterId === "number") {
            this.regenerateCluster(clusterId);
        }
        else if (action === "regenerate_extended" &&
            typeof clusterId === "number") {
            this.regenerateClusterExtended(clusterId);
        }
        this.contextMenu.select.value = "inspect";
        this.hideClusterContextMenu();
    }
    /**
     * Setup unified event handlers for camera controls and selection
     */
    setupUnifiedEventHandlers() {
        const el = this.renderer?.renderer?.domElement;
        if (!el) {
            console.error("Renderer domElement not available for events");
            return;
        }
        // Pointer movement and timing threshold for click/tap
        const CLICK_DIST2 = 50 * 50;
        const TAP_TIME_MS = 200;
        const controlsManager = this.controlsManager;
        el.addEventListener("mousedown", (e) => {
            if (e.button === 0) {
                this.hideClusterContextMenu();
            }
            // 1. Check edit handles first (highest priority)
            if (this.galaxy.handleEditPointerDown(e)) {
                e.preventDefault();
                return;
            }
            // 2. Handle camera controls (local only, no bus)
            this.cameraController.onMouseDown(e);
            // 3. Always track selection state for movement calculation
            controlsManager.pointerDown(e.clientX, e.clientY);
            // Only send bus events if not camera dragging
            if (!this.cameraController.isDragging) {
                const galaxyVec = this.cameraController.getGroundPointFromScreenPosition(e.clientX, e.clientY) || { x: 0, y: 0, z: 0 };
                const pointerRay = this.cameraController.getPointerRayFromScreenPosition(e.clientX, e.clientY);
                this.publishPointerEvent({
                    type: "down",
                    screen_position: { x: e.clientX, y: e.clientY },
                    galaxy_position: { x: galaxyVec.x, z: galaxyVec.z },
                    key_state: controlsManager.getCurrentKeyState(),
                    ray: pointerRay,
                });
            }
        });
        el.addEventListener("mousemove", (e) => {
            // 1. Check edit handles first
            if (this.galaxy.handleEditPointerMove(e)) {
                e.preventDefault();
                return;
            }
            // 2. Handle camera controls (local only)
            this.cameraController.onMouseMove(e);
            // 3. Always track selection movement for distance calculation
            controlsManager.pointerMove(e.clientX, e.clientY);
            // Only send bus events for selection logic
            const galaxyVec = this.cameraController.getGroundPointFromScreenPosition(e.clientX, e.clientY) || { x: 0, y: 0, z: 0 };
            const pointerRay = this.cameraController.getPointerRayFromScreenPosition(e.clientX, e.clientY);
            this.publishPointerEvent({
                type: "move",
                screen_position: { x: e.clientX, y: e.clientY },
                galaxy_position: { x: galaxyVec.x, z: galaxyVec.z },
                key_state: controlsManager.getCurrentKeyState(),
                ray: pointerRay,
            });
        });
        el.addEventListener("mouseup", (e) => {
            // 1. Check edit handles first
            if (this.galaxy.handleEditPointerUp(e)) {
                e.preventDefault();
                return;
            }
            // 2. Handle camera controls (local only)
            this.cameraController.onMouseUp(e);
            // 3. Always track selection state for movement calculation
            controlsManager.pointerUp(e.clientX, e.clientY);
            const galaxyVec = this.cameraController.getGroundPointFromScreenPosition(e.clientX, e.clientY) || { x: 0, y: 0, z: 0 };
            const pointerRay = this.cameraController.getPointerRayFromScreenPosition(e.clientX, e.clientY);
            // Send up event to bus
            this.publishPointerEvent({
                type: "up",
                screen_position: { x: e.clientX, y: e.clientY },
                galaxy_position: { x: galaxyVec.x, z: galaxyVec.z },
                key_state: controlsManager.getCurrentKeyState(),
                ray: pointerRay,
            });
            // Generate tap event only if not camera dragging
            const upTime = Date.now();
            const pointerDownTime = controlsManager._pointerDownTimestamp || upTime;
            const dur = upTime - pointerDownTime;
            const movedDist = controlsManager.pointerMovedDistanceSq();
            const isDragging = this.cameraController.isDragging;
            if (e.button === 0 &&
                movedDist < CLICK_DIST2 &&
                dur < TAP_TIME_MS &&
                !isDragging) {
                this.publishPointerEvent({
                    type: "tap",
                    eventSource: "selection",
                    tapId: `selection_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    screen_position: { x: e.clientX, y: e.clientY },
                    galaxy_position: { x: galaxyVec.x, z: galaxyVec.z },
                    key_state: controlsManager.getCurrentKeyState(),
                    ray: pointerRay,
                });
            }
            controlsManager._pointerDownTimestamp = null;
        });
        // --- Touch Events (Mobile/Tablets) ---
        el.addEventListener("touchstart", (e) => {
            this.hideClusterContextMenu();
            if (e.touches && e.touches.length > 0) {
                const touch = e.touches[0];
                controlsManager.pointerDown(touch.clientX, touch.clientY);
                const galaxyVec = this.cameraController.getGroundPointFromScreenPosition(touch.clientX, touch.clientY) || { x: 0, y: 0, z: 0 };
                const pointerRay = this.cameraController.getPointerRayFromScreenPosition(touch.clientX, touch.clientY);
                this.publishPointerEvent({
                    type: "down",
                    screen_position: { x: touch.clientX, y: touch.clientY },
                    galaxy_position: { x: galaxyVec.x, z: galaxyVec.z },
                    key_state: controlsManager.getCurrentKeyState(),
                    ray: pointerRay,
                });
            }
        });
        el.addEventListener("touchmove", (e) => {
            if (e.touches && e.touches.length > 0) {
                const touch = e.touches[0];
                controlsManager.pointerMove(touch.clientX, touch.clientY);
                const galaxyVec = this.cameraController.getGroundPointFromScreenPosition(touch.clientX, touch.clientY) || { x: 0, y: 0, z: 0 };
                const pointerRay = this.cameraController.getPointerRayFromScreenPosition(touch.clientX, touch.clientY);
                this.publishPointerEvent({
                    type: "move",
                    screen_position: { x: touch.clientX, y: touch.clientY },
                    galaxy_position: { x: galaxyVec.x, z: galaxyVec.z },
                    key_state: controlsManager.getCurrentKeyState(),
                    ray: pointerRay,
                });
            }
        });
        const handleTouchEndOrCancel = (e) => {
            let screenX = 0, screenY = 0;
            let galaxyVec = { x: 0, y: 0, z: 0 };
            if ((e.changedTouches && e.changedTouches.length > 0) ||
                (e.touches && e.touches.length > 0)) {
                const touch = e.changedTouches && e.changedTouches.length > 0
                    ? e.changedTouches[0]
                    : e.touches[0];
                screenX = touch.clientX;
                screenY = touch.clientY;
                galaxyVec = this.cameraController.getGroundPointFromScreenPosition(screenX, screenY) || { x: 0, y: 0, z: 0 };
            }
            controlsManager.pointerUp(screenX, screenY);
            const pointerRay = this.cameraController.getPointerRayFromScreenPosition(screenX, screenY);
            this.publishPointerEvent({
                type: "up",
                screen_position: { x: screenX, y: screenY },
                galaxy_position: { x: galaxyVec.x, z: galaxyVec.z },
                key_state: controlsManager.getCurrentKeyState(),
                ray: pointerRay,
            });
            // Only send 'tap' if pointer moved less than 50px AND was under 500ms
            const upTime = Date.now();
            const pointerDownTime = controlsManager._pointerDownTimestamp || upTime;
            const dur = upTime - pointerDownTime;
            if (controlsManager.pointerMovedDistanceSq() < CLICK_DIST2 &&
                dur < TAP_TIME_MS) {
                this.publishPointerEvent({
                    type: "tap",
                    eventSource: "touch",
                    tapId: `touch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    screen_position: { x: screenX, y: screenY },
                    galaxy_position: { x: galaxyVec.x, z: galaxyVec.z },
                    key_state: controlsManager.getCurrentKeyState(),
                    ray: pointerRay,
                });
            }
            controlsManager._pointerDownTimestamp = null;
        };
        el.addEventListener("touchend", handleTouchEndOrCancel);
        el.addEventListener("touchcancel", handleTouchEndOrCancel);
        el.addEventListener("contextmenu", (e) => {
            if (!this.contextMenu)
                return;
            e.preventDefault();
            e.stopPropagation();
            const pick = this.findClusterForContextMenu(e.clientX, e.clientY);
            if (!pick) {
                this.hideClusterContextMenu();
                return;
            }
            this.showClusterContextMenu(pick.cluster.id, e.clientX, e.clientY);
            const pointerRay = this.cameraController.getPointerRayFromScreenPosition(e.clientX, e.clientY);
            this.publishPointerEvent({
                type: "tap",
                eventSource: "context",
                screen_position: { x: e.clientX, y: e.clientY },
                galaxy_position: { x: pick.ground.x, z: pick.ground.z },
                key_state: controlsManager.getCurrentKeyState(),
                ray: pointerRay,
            });
        });
    }
    findClusterForContextMenu(screenX, screenY) {
        const ground = this.cameraController.getGroundPointFromScreenPosition(screenX, screenY);
        if (!ground)
            return null;
        let closest = null;
        let closestDist = Infinity;
        const maxDist = 600;
        for (const cluster of this.galaxy.clusters) {
            const dx = cluster.position.x - ground.x;
            const dz = cluster.position.z - ground.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < closestDist) {
                closestDist = dist;
                closest = cluster;
            }
        }
        if (!closest || closestDist > maxDist)
            return null;
        return {
            cluster: closest,
            ground: { x: ground.x, y: ground.y, z: ground.z },
        };
    }
    showClusterContextMenu(clusterId, screenX, screenY) {
        if (!this.contextMenu)
            return;
        const panel = this.contextMenu.panel.element;
        this.contextMenu.select.value = "inspect";
        panel.style.display = "block";
        const rect = panel.getBoundingClientRect();
        const width = rect.width || 180;
        const height = rect.height || 80;
        const maxX = window.innerWidth - width - 12;
        const maxY = window.innerHeight - height - 12;
        const x = Math.max(12, Math.min(screenX, maxX));
        const y = Math.max(12, Math.min(screenY, maxY));
        panel.style.left = `${x}px`;
        panel.style.top = `${y}px`;
        this.contextMenuClusterId = clusterId;
    }
    hideClusterContextMenu() {
        if (!this.contextMenu)
            return;
        this.contextMenu.panel.element.style.display = "none";
        this.contextMenuClusterId = null;
    }
    /**
     * No longer needed: use renderer.screenToWorld directly.
     */
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
                y: cluster.position.y,
                z: cluster.position.z,
            });
        }
        this.galaxy.previewMoveCluster(cluster, position);
        this.renderer.updateEditOverlayPosition(clusterId, cluster.position);
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
            y: cluster.position.y,
            z: cluster.position.z,
        };
        this.clusterDragStarts.delete(clusterId);
        this.galaxy.commitMoveCluster(cluster, startPos, position);
        this.renderer.updateEditOverlayPosition(clusterId, cluster.position);
        if (this.lastUIState.selectedId !== null) {
            this.renderer.refreshConnectionOverlays();
        }
        if (this.lastUIState.hoveredId === clusterId) {
            this.galaxy.setHoveredCluster(cluster);
        }
        if (this.lastUIState.selectedId === clusterId) {
            this.galaxy.setSelectedCluster(cluster);
        }
    }
    publishLocalOps(ops) {
        if (!this.mainBus._brokerReady)
            return;
        this.mainBus.publish("ops_local", ops, 0);
    }
    publishRegenerationLifecycle(phase, regenerationId, clusterIds) {
        if (!this.mainBus._brokerReady)
            return;
        const payload = {
            regenerationId,
            clusterIds,
            timestamp: Date.now(),
        };
        const eventName = phase === "started"
            ? "galaxy_regeneration_started"
            : "galaxy_regeneration_complete";
        this.mainBus.publish(eventName, payload, 0);
    }
    publishOpsComplete(payload) {
        if (!this.mainBus._brokerReady)
            return;
        this.mainBus.publish("complete", payload, 2);
    }
    applyLocalOps(ops) {
        if (!ops.length)
            return;
        this.processOps(ops);
        this.publishLocalOps(ops);
    }
    updateMaxSolarSystemId(id) {
        if (id > this.maxSolarSystemId) {
            this.maxSolarSystemId = id;
        }
    }
    regenerateCluster(clusterId) {
        this.regenerateClusters([clusterId]);
    }
    regenerateClusterExtended(clusterId) {
        const cluster = this.galaxy.getClusterById(clusterId);
        if (!cluster)
            return;
        const neighborIds = new Set();
        for (const conn of this.galaxy.connections) {
            if (conn.cluster1.id === clusterId) {
                neighborIds.add(conn.cluster2.id);
            }
            else if (conn.cluster2.id === clusterId) {
                neighborIds.add(conn.cluster1.id);
            }
        }
        const orderedIds = [
            clusterId,
            ...Array.from(neighborIds).sort((a, b) => a - b),
        ];
        this.regenerateClusters(orderedIds);
    }
    regenerateClusters(clusterIds) {
        if (!clusterIds.length)
            return;
        const uniqueIds = [];
        const seen = new Set();
        for (const id of clusterIds) {
            if (seen.has(id))
                continue;
            if (!this.galaxy.getClusterById(id))
                continue;
            seen.add(id);
            uniqueIds.push(id);
        }
        if (!uniqueIds.length)
            return;
        const regenerationId = Date.now();
        this.publishRegenerationLifecycle("started", regenerationId, uniqueIds);
        for (const id of uniqueIds) {
            this.regenerateClusterInternal(id);
        }
        this.updateStats();
        this.publishRegenerationLifecycle("complete", regenerationId, uniqueIds);
        this.publishOpsComplete({
            source: "regeneration",
            regenerationId,
            clusterIds: uniqueIds,
            finalizeBuffers: false,
        });
    }
    regenerateClusterInternal(clusterId) {
        const cluster = this.galaxy.getClusterById(clusterId);
        if (!cluster)
            return;
        const connections = this.galaxy.connections.filter((conn) => conn.cluster1.id === clusterId || conn.cluster2.id === clusterId);
        const neighborInfo = connections.map((conn) => {
            const isCluster1 = conn.cluster1.id === clusterId;
            return {
                neighbor: isCluster1 ? conn.cluster2 : conn.cluster1,
                neighborGate: isCluster1 ? conn.jumpGate2 : conn.jumpGate1,
            };
        });
        const ops = [];
        for (const conn of connections) {
            ops.push(opRemoveConnection(conn.cluster1.id, conn.cluster2.id, { id: conn.jumpGate1.id }, { id: conn.jumpGate2.id }));
        }
        for (const sys of cluster.solarSystems.slice()) {
            ops.push(opRemoveSolarSystem(cluster.id, sys.id));
        }
        if (neighborInfo.length === 0) {
            this.applyLocalOps(ops);
            return;
        }
        let nextId = this.maxSolarSystemId + 1;
        const newGateSeeds = [];
        const newGateByNeighbor = new Map();
        for (const info of neighborInfo) {
            const angle = angleXZ(cluster.position, info.neighbor.position);
            const pos = pointAtAngle(cluster.position, cluster.radius * 1.07, angle);
            const gate = {
                id: nextId++,
                name: `JumpGate ${cluster.id}->${info.neighbor.id}`,
                position: pos,
                connections: [],
                isJumpGate: true,
                connectedToClusterId: info.neighbor.id,
            };
            newGateSeeds.push({ neighborId: info.neighbor.id, gate });
            newGateByNeighbor.set(info.neighbor.id, { id: gate.id });
        }
        const params = this.getInputParameters();
        const plan = buildClusterSolarSystemPlan({
            clusterId: cluster.id,
            clusterPosition: {
                x: cluster.position.x,
                y: cluster.position.y,
                z: cluster.position.z,
            },
            clusterRadius: cluster.radius,
            numSolarSystems: params.numSolarSystems,
            jumpGates: newGateSeeds.map(({ gate }) => ({
                id: gate.id,
                name: gate.name,
                position: gate.position,
                connectedToClusterId: gate.connectedToClusterId,
            })),
            nextSystemId: nextId,
        });
        for (const { gate } of newGateSeeds) {
            ops.push(opAddSolarSystem(cluster.id, gate));
        }
        for (const sys of plan.systems) {
            ops.push(opAddSolarSystem(cluster.id, sys));
        }
        for (const [id1, id2] of plan.connections) {
            ops.push(opConnectSolarSystems(cluster.id, id1, id2));
        }
        for (const info of neighborInfo) {
            const gate = newGateByNeighbor.get(info.neighbor.id);
            if (!gate)
                continue;
            ops.push(opConnectClusters(cluster.id, info.neighbor.id, { id: gate.id }, { id: info.neighborGate.id }));
        }
        this.applyLocalOps(ops);
        cluster.maxSystemDistance = plan.maxSystemDistance;
    }
    removeInternalConnections(cluster) {
        const idToSystem = new Map();
        for (const sys of cluster.solarSystems) {
            idToSystem.set(sys.id, sys);
        }
        for (const sys of cluster.solarSystems) {
            if (!Array.isArray(sys.connections))
                continue;
            for (const connectedId of sys.connections) {
                if (connectedId <= sys.id)
                    continue;
                const other = idToSystem.get(connectedId);
                if (other) {
                    this.galaxy.removeSolarSystemConnection(cluster, sys, other);
                }
            }
        }
    }
    /**
     * Handle OPs using id maps for clusters and solar systems when processing connection ops.
     * All connections use only IDs now (point 5).
     * Business worker consumes ops via broker pub/sub for BFS/gradient.
     */
    processOps(ops) {
        if (!Array.isArray(ops))
            return;
        let connectionsChanged = false;
        for (const op of ops) {
            if (op.type === "addCluster") {
                const c = new Cluster(op.payload, this.galaxy);
                this.galaxy.addCluster(c);
            }
            else if (op.type === "addSolarSystem") {
                const cluster = this.galaxy.getClusterById(op.payload.clusterId);
                if (cluster) {
                    const s = new SolarSystem(op.payload);
                    this.galaxy.addSolarSystem(cluster, s);
                    this.updateMaxSolarSystemId(s.id);
                }
            }
            else if (op.type === "removeSolarSystem") {
                const { clusterId, solarSystemId } = op.payload;
                const cluster = this.galaxy.getClusterById(clusterId);
                const sys = cluster
                    ? this.galaxy.getSolarSystemById(clusterId, solarSystemId)
                    : null;
                if (cluster && sys) {
                    this.galaxy.removeSolarSystem(cluster, sys);
                }
            }
            else if (op.type === "connectSolarSystems") {
                const { clusterId, solarSystemId1, solarSystemId2 } = op.payload;
                const cluster = this.galaxy.getClusterById(clusterId);
                if (cluster) {
                    const sys1 = this.galaxy.getSolarSystemById(clusterId, solarSystemId1);
                    const sys2 = this.galaxy.getSolarSystemById(clusterId, solarSystemId2);
                    if (sys1 && sys2) {
                        this.galaxy.addSolarSystemConnection(cluster, sys1, sys2);
                    }
                }
            }
            else if (op.type === "connectClusters") {
                const { clusterId1, clusterId2, jumpGate1, jumpGate2 } = op.payload;
                const cl1 = this.galaxy.getClusterById(clusterId1);
                const cl2 = this.galaxy.getClusterById(clusterId2);
                const j1 = cl1 && jumpGate1
                    ? this.galaxy.getSolarSystemById(clusterId1, jumpGate1.id)
                    : null;
                const j2 = cl2 && jumpGate2
                    ? this.galaxy.getSolarSystemById(clusterId2, jumpGate2.id)
                    : null;
                if (cl1 && cl2 && j1 && j2) {
                    this.galaxy.connectClusters(cl1, cl2, j1, j2);
                    connectionsChanged = true;
                }
            }
            else if (op.type === "removeConnection") {
                const { clusterId1, clusterId2, jumpGate1, jumpGate2 } = op.payload;
                const cl1 = this.galaxy.getClusterById(clusterId1);
                const cl2 = this.galaxy.getClusterById(clusterId2);
                const j1 = cl1 && jumpGate1
                    ? this.galaxy.getSolarSystemById(clusterId1, jumpGate1.id)
                    : null;
                const j2 = cl2 && jumpGate2
                    ? this.galaxy.getSolarSystemById(clusterId2, jumpGate2.id)
                    : null;
                if (cl1 && cl2 && j1 && j2) {
                    this.galaxy.removeClusterConnection(cl1, cl2, j1, j2);
                    connectionsChanged = true;
                }
            }
            else if (op.type === "removeCluster") {
                const cluster = this.galaxy.getClusterById(op.payload.clusterId);
                if (cluster) {
                    this.galaxy.removeCluster(cluster);
                }
            }
        }
    }
    getInputParameters() {
        if (this.uiBindings.mode === "editor") {
            return this.uiBindings.getGenerationParams();
        }
        return DEFAULT_GENERATION_PARAMS;
    }
    generateGalaxy() {
        console.log("Generating new galaxy...");
        const params = this.getInputParameters();
        if (this.mainBus._brokerReady) {
            this.mainBus.publish("generateGalaxy", params);
        }
    }
    // (Removed: generateGalaxyFromDensityCylinders and all code related to density cylinders)
    // Method to clear all density cylinders
    // (Removed: clearDensityCylinders function for density cylinder editing)
    generateInternalConnections() {
        console.log("Generating internal connections...");
        const params = this.getInputParameters();
        // Use worker to generate internal connections as well
        params.generateInternalConnections = true;
        if (this.mainBus._brokerReady) {
            this.mainBus.publish("generateGalaxy", params);
        }
    }
    clearGalaxy() {
        console.log("Clearing galaxy...");
        // Clear renderer
        this.renderer.clear();
        // Clear galaxy
        this.galaxy.clear();
        this.maxSolarSystemId = 0;
        // Notify workers to clear their state
        if (this.mainBus._brokerReady) {
            this.mainBus.publish("clearGalaxy", {});
        }
        // Reset stats
        this.updateStats({
            clusters: 0,
            solarSystems: 0,
            jumpGates: 0,
            connections: 0,
            internalConnections: 0,
        });
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
    /**
     * Set up main thread pub/sub subscriptions
     */
    setupMainPubSubSubscriptions() {
        if (!this.mainBus.subscribe || !this.mainBus._brokerReady) {
            console.warn("Pub/sub not available on main bus - broker not ready");
            return;
        }
        try {
            const debugLevel = this.mainBus._options.debug ?? 0;
            const isRecord = (value) => typeof value === "object" && value !== null;
            // Subscribe to galaxy generation events
            this.mainBus.subscribe("galaxy_generation_started", (data) => {
                if (isRecord(data) && typeof data.generationId === "number") {
                    console.log("🌌 Galaxy generation started:", data.generationId);
                }
            });
            this.mainBus.subscribe("galaxy_generation_complete", (data) => {
                if (isRecord(data) && typeof data.generationId === "number") {
                    console.log("✅ Galaxy generation complete:", data.generationId);
                }
            });
            this.mainBus.subscribe("galaxy_regeneration_started", (data) => {
                if (isRecord(data) && typeof data.regenerationId === "number") {
                    console.log("🔁 Galaxy regeneration started:", data.regenerationId);
                }
            });
            this.mainBus.subscribe("galaxy_regeneration_complete", (data) => {
                if (isRecord(data) && typeof data.regenerationId === "number") {
                    console.log("✅ Galaxy regeneration complete:", data.regenerationId);
                }
            });
            this.mainBus.subscribe("galaxy_generation_error", (data) => {
                if (isRecord(data) && typeof data.error === "string") {
                    console.error("❌ Galaxy generation error:", data.error);
                }
            });
            // Subscribe to selection events
            this.mainBus.subscribe("selection_changed", (data) => {
                if (debugLevel >= 2) {
                    console.log("🎯 Selection changed:", data);
                }
            });
            // Subscribe to edit mode events
            this.mainBus.subscribe("edit_mode_changed", (data) => {
                if (isRecord(data)) {
                    const clusterId = data.clusterId;
                    const editMode = data.editMode;
                    if (typeof clusterId === "number" && typeof editMode === "boolean") {
                        console.log("✏️ Edit mode changed:", clusterId, "editMode:", editMode);
                    }
                }
            });
            console.log("📢 Main thread pub/sub subscriptions set up successfully");
        }
        catch (error) {
            console.error("❌ Failed to set up main thread pub/sub subscriptions:", error);
        }
    }
    /**
     * Demonstrate the pub/sub system with test messages
     */
    demonstratePubSubSystem() {
        if (!this.mainBus.publish || !this.mainBus._brokerReady) {
            console.warn("Pub/sub not available for demonstration - broker not ready");
            return;
        }
        console.log("🧪 Demonstrating pub/sub system...");
        try {
            // Send a test message after a short delay
            setTimeout(() => {
                try {
                    this.mainBus.publish("test_message", {
                        message: "Hello from main thread!",
                        timestamp: Date.now(),
                    });
                    console.log("📤 Test message published");
                }
                catch (error) {
                    console.error("❌ Failed to publish test message:", error);
                }
            }, 1000);
            // Request galaxy status
            setTimeout(() => {
                try {
                    this.mainBus.publish("request_galaxy_status", {});
                    console.log("📤 Galaxy status request published");
                }
                catch (error) {
                    console.error("❌ Failed to publish galaxy status request:", error);
                }
            }, 2000);
        }
        catch (error) {
            console.error("❌ Failed to demonstrate pub/sub system:", error);
        }
    }
}
const DEFAULT_GENERATION_PARAMS = {
    numClusters: 15000,
    numSolarSystems: 80,
    maxConnections: 3,
    internalConnections: 3,
    galaxySize: 300000,
    centerBias: 0.6,
    minDistance: 1500,
    heightVariation: 0,
    showLabels: true,
    generateInternalConnections: false,
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