import { GalaxyRenderer } from "./galaxy-renderer.js";
import { UIController } from "./ui-controller.js";
import { CameraController } from "./camera-controller.js";
import { Galaxy } from "./galaxy.js";
import { GalaxyMetrics } from "./galaxy-metrics.js";
import { ControlsManager } from "./controls-manager.js";
import { buildClusterSolarSystemPlan } from "./cluster-solar-system-plan.js";
import { replayGalaxyOps } from "./galaxy/galaxy-op-replayer.js";
import { ClusterContextMenuController } from "./main/cluster-context-menu-controller.js";
import { subscribeAppLifecycleDebugTopics, subscribeAppTopics, } from "./main/app-subscriptions.js";
import { initializeAppWorkers } from "./main/app-workers.js";
import { createPointerEventRouter, } from "./main/pointer-event-router.js";
import { Bus } from "./worker/bus/Bus.js";
import { publishTopic, Topics } from "./worker/protocol/topics.js";
import { CursorStatsWidget } from "./ui/cursor-stats-widget.js";
import { createUIContext, createUIRoot } from "./ui/ui-kit.js";
import { buildEditorUI, buildPlayUI, resolveUIMode, } from "./ui/ui-modes.js";
import Stats from "./vendor/stats.js";
import { opAddSolarSystem, opConnectClusters, opConnectSolarSystems, opRemoveConnection, opRemoveSolarSystem, } from "./worker/galaxy/galaxy-ops.js";
import { angleXZ, pointAtAngle } from "./math/galaxy-xz-math.js";
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
        this.renderer.setFleetPositionProvider((node) => {
            const sys = this.galaxy.getSolarSystemById(node.clusterId, node.solarSystemId);
            return sys ? sys.position : null;
        });
        this.cameraController = new CameraController(this.renderer);
        this.contextMenuController = this.createContextMenuController();
        this.uiController =
            this.uiBindings.mode === "editor"
                ? new UIController(this.uiBindings.stats)
                : new UIController();
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
        this.fleetStatusById = new Map();
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
        this.renderFleetList();
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
            await initializeAppWorkers(this.mainBus);
            subscribeAppTopics(this.mainBus, {
                galaxy: {
                    onGalaxyOps: (ops) => {
                        this.processOps(ops);
                        this.updateStats();
                    },
                    onGalaxyComplete: (payload) => {
                        if (!payload || payload.finalizeBuffers !== false) {
                            this.renderer.finalizeBuffers(this.galaxy);
                        }
                        this.updateStats();
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
                        this.renderer.setConnectionColors(connectionColors);
                    },
                    onShowEditHandles: ({ clusterId, handles }) => {
                        this.controlsManager.setEditModeActive(true, clusterId);
                        this.galaxy.showEditHandles(clusterId, handles);
                    },
                    onHideEditHandles: ({ clusterId }) => {
                        this.controlsManager.setEditModeActive(false, null);
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
                        this.handleFleetSpawned(id, counts, state);
                    },
                    onFleetState: ({ id, state }) => {
                        this.handleFleetState(id, state);
                    },
                    onFleetRemoved: ({ id }) => {
                        this.handleFleetRemoved(id);
                    },
                },
            });
            console.log("All workers initialized successfully");
            // Setup event handling after workers are ready
            this.renderer.setCameraController(this.cameraController);
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
            editDragMode,
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
        const canvas = this.renderer?.renderer?.domElement;
        if (!canvas) {
            console.error("Renderer domElement not available for events");
            return;
        }
        this.pointerEventRouter?.dispose();
        this.pointerEventRouter = createPointerEventRouter({
            canvas,
            cameraController: this.cameraController,
            controlsManager: this.controlsManager,
            galaxy: this.galaxy,
            getContextMenuController: () => this.contextMenuController,
            publishPointerEvent: (payload, priority) => this.publishPointerEvent(payload, priority),
        });
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
            y: 0,
            z: cluster.position.z,
        };
        this.clusterDragStarts.delete(clusterId);
        this.galaxy.commitMoveCluster(cluster, startPos, { ...position, y: 0 });
        cluster.position.y = 0;
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
        if (!this.mainBus.isPubSubReady())
            return;
        publishTopic(this.mainBus, Topics.galaxyLocalOps, ops, 0);
    }
    publishRegenerationLifecycle(phase, regenerationId, clusterIds) {
        if (!this.mainBus.isPubSubReady())
            return;
        const payload = {
            regenerationId,
            clusterIds,
            timestamp: Date.now(),
        };
        const eventName = phase === "started"
            ? Topics.galaxyRegenerationStarted
            : Topics.galaxyRegenerationComplete;
        publishTopic(this.mainBus, eventName, payload, 0);
    }
    publishOpsComplete(payload) {
        if (!this.mainBus.isPubSubReady())
            return;
        publishTopic(this.mainBus, Topics.galaxyComplete, payload, 2);
    }
    applyLocalOps(ops) {
        if (!ops.length)
            return;
        this.processOps(ops);
        this.publishLocalOps(ops);
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
    generateGalaxy() {
        console.log("Generating new galaxy...");
        const params = this.getInputParameters();
        if (this.mainBus.isPubSubReady()) {
            publishTopic(this.mainBus, Topics.generateGalaxy, params);
        }
    }
    generateFleet() {
        if (this.mainBus.isPubSubReady()) {
            publishTopic(this.mainBus, Topics.generateFleet, {});
        }
    }
    generateFleetsBulk(count) {
        if (!this.mainBus.isPubSubReady())
            return;
        for (let i = 0; i < count; i++) {
            publishTopic(this.mainBus, Topics.generateFleet, {});
        }
    }
    clearGalaxy() {
        console.log("Clearing galaxy...");
        // Clear renderer
        this.renderer.clear();
        this.renderer.clearFleets();
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
        this.fleetStatusById.clear();
        this.renderFleetList();
        console.log("Galaxy cleared!");
    }
    handleFleetSpawned(id, counts, state) {
        this.fleetStatusById.set(id, { counts, state });
        this.renderFleetList();
        this.renderer.addFleet(id, counts, state);
    }
    handleFleetState(id, state) {
        const existing = this.fleetStatusById.get(id);
        if (existing) {
            existing.state = state;
        }
        this.renderFleetList();
        this.renderer.updateFleetState(id, state);
    }
    handleFleetRemoved(id) {
        this.fleetStatusById.delete(id);
        this.renderFleetList();
        this.renderer.removeFleet(id);
    }
    renderFleetList() {
        if (this.uiBindings.mode !== "editor")
            return;
        this.uiBindings.fleets.render(this.fleetStatusById);
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