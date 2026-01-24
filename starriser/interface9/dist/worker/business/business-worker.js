// Business logic worker: cluster picking, selection state, and event forwarding to UI
import { TwoDotFiveDSpatialIndex } from "./TwoDotFiveDSpatialIndex.js";
import { SelectionService } from "./SelectionService.js";
import { makeColorGradient, rgbToHex } from "../../utils/color.js";
/**
 * Business Worker Constructor - called by worker bootstrap
 */
export function busConstructor(bus) {
    // --- Core business state ---
    let clusters = [];
    const clusterIndex = new TwoDotFiveDSpatialIndex({
        getX: (c) => c.position.x,
        getZ: (c) => c.position.z,
        getYMin: (c) => c.position.y ?? 0,
        getYMax: (c) => c.position.y ?? 0,
        getId: (c) => c.id,
    });
    // --- UI Handles/Objects for Edit Mode ---
    let uiObjects = [];
    const uiObjectIndex = new TwoDotFiveDSpatialIndex({
        getX: (obj) => obj.x,
        getZ: (obj) => obj.z,
        getYMin: (obj) => obj.yMin,
        getYMax: (obj) => obj.yMax,
        getId: (obj) => obj.id,
    });
    let currentlyEditingClusterId = null;
    let editDragClusterId = null;
    let editDragOffset = null;
    let editDragAxis = null;
    let editDragStart = null;
    // Flag to prevent recursive tap event processing
    let isProcessingTap = false;
    let pubSubReady = false;
    const addCluster = (cluster) => {
        if (!cluster)
            return;
        const position = cluster.position;
        const newCluster = {
            id: cluster.id,
            name: cluster.name,
            position: {
                x: position.x,
                y: position.y,
                z: position.z,
            },
            color: cluster.color,
            radius: cluster.radius,
        };
        clusters.push(newCluster);
        clusterIndex.insert(newCluster);
    };
    const removeCluster = (clusterId) => {
        const idx = clusters.findIndex((c) => c.id === clusterId);
        if (idx !== -1) {
            clusters.splice(idx, 1);
            clusterIndex.remove(clusterId);
        }
    };
    const handlePointerEvent = (data) => {
        if (!clusters.length)
            return;
        const isEditMode = currentlyEditingClusterId !== null;
        // Edit mode cluster dragging (axis-aware)
        if (isEditMode && typeof data.clusterId === "number") {
            const cluster = clusters.find((c) => c.id === data.clusterId);
            const pointerPos = data.galaxy_position;
            const screenPos = data.screen_position;
            if (!cluster) {
                editDragClusterId = null;
                editDragOffset = null;
                editDragAxis = null;
                editDragStart = null;
            }
            else {
                if (data.type === "down" && pointerPos) {
                    editDragClusterId = cluster.id;
                    editDragOffset = {
                        dx: cluster.position.x - pointerPos.x,
                        dy: 0,
                        dz: cluster.position.z - pointerPos.z,
                    };
                    editDragAxis =
                        data.handleKind === "axisX"
                            ? "x"
                            : data.handleKind === "axisY"
                                ? "y"
                                : data.handleKind === "axisZ"
                                    ? "z"
                                    : data.handleKind === "planeXZ"
                                        ? "xz"
                                        : data.editDragMode === "y"
                                            ? "y"
                                            : "xz";
                    editDragStart = {
                        screenX: screenPos.x,
                        screenY: screenPos.y,
                        position: {
                            x: cluster.position.x,
                            y: cluster.position.y,
                            z: cluster.position.z,
                        },
                    };
                }
                if (data.type === "move" && editDragClusterId === cluster.id) {
                    const axis = editDragAxis ?? "xz";
                    if ((axis === "xz" || axis === "x" || axis === "z") && pointerPos) {
                        if (axis === "xz" || axis === "x") {
                            cluster.position.x =
                                pointerPos.x + (editDragOffset ? editDragOffset.dx : 0);
                        }
                        if (axis === "xz" || axis === "z") {
                            cluster.position.z =
                                pointerPos.z + (editDragOffset ? editDragOffset.dz : 0);
                        }
                    }
                    if (axis === "y" && editDragStart && screenPos) {
                        const dy = screenPos.y - editDragStart.screenY;
                        const scale = 2;
                        cluster.position.y = editDragStart.position.y - dy * scale;
                    }
                    clusterIndex.remove(cluster.id);
                    clusterIndex.insert(cluster);
                    bus.publish("update_cluster", {
                        clusterId: cluster.id,
                        position: cluster.position,
                    }, 0);
                }
                if (data.type === "up" && editDragClusterId === cluster.id) {
                    editDragClusterId = null;
                    editDragOffset = null;
                    editDragAxis = null;
                    editDragStart = null;
                    bus.publish("commit_cluster_move", {
                        clusterId: cluster.id,
                        position: cluster.position,
                    }, 0);
                }
                if (data.type === "move" || data.type === "down" || data.type === "up")
                    return;
            }
        }
        // Otherwise, normal cluster picking follows (only if not in drag/edit with UI handle)
        if (data.type === "move" || data.type === "tap") {
            const galaxyPosition = data.galaxy_position;
            if (!galaxyPosition)
                return;
            // Use galaxy position (XZ) for query
            const hit = clusterIndex.query(galaxyPosition.x, galaxyPosition.z);
            const withinHoverThreshold = hit.dist <= 3000;
            const withinSelectThreshold = hit.dist <= 600;
            if (data.type === "move") {
                const hoveredId = withinHoverThreshold && hit.item ? hit.item.id : null;
                SelectionService.setHovered(hoveredId);
            }
            if (data.type === "tap") {
                // Prevent recursive tap processing
                if (isProcessingTap) {
                    return;
                }
                isProcessingTap = true;
                const currentState = SelectionService.getState();
                if (!withinSelectThreshold || !hit.item) {
                    // Clicked outside any cluster - clear everything
                    if (currentlyEditingClusterId !== null) {
                        bus.publish("hide_edit_handles", {
                            clusterId: currentlyEditingClusterId,
                        });
                    }
                    currentlyEditingClusterId = null;
                    clearUIObjects();
                    SelectionService.setSelected(null);
                }
                else if (currentlyEditingClusterId === hit.item.id) {
                    // Third tap: exit edit mode, keep cluster selected, show overlay again
                    bus.publish("hide_edit_handles", {
                        clusterId: currentlyEditingClusterId,
                    });
                    currentlyEditingClusterId = null;
                    clearUIObjects();
                    // Trigger overlay to show again by re-setting selection
                    const coloring = computeConnectionGradient(hit.item.id, clusters, 10, lastConnections);
                    bus.publish("setConnectionColors", coloring);
                    // Publish edit mode change
                    bus.publish("edit_mode_changed", {
                        clusterId: hit.item.id,
                        editMode: false,
                    });
                }
                else if (currentState.selectedId === hit.item.id &&
                    currentlyEditingClusterId === null) {
                    // Second tap: same cluster selected, not in edit mode -> enter edit mode
                    currentlyEditingClusterId = hit.item.id;
                    // Attach UI objects: add arrows/plane for this cluster
                    attachUIObjectsForCluster(hit.item);
                    bus.publish("show_edit_handles", {
                        clusterId: hit.item.id,
                        handles: uiObjects,
                    });
                    // Remove the connection overlay when entering edit mode
                    bus.publish("setConnectionColors", {});
                    // Publish edit mode change
                    bus.publish("edit_mode_changed", {
                        clusterId: hit.item.id,
                        editMode: true,
                    });
                }
                else {
                    // First tap: select cluster (either new cluster or no previous selection)
                    if (currentlyEditingClusterId !== null) {
                        bus.publish("hide_edit_handles", {
                            clusterId: currentlyEditingClusterId,
                        });
                    }
                    currentlyEditingClusterId = null;
                    clearUIObjects();
                    SelectionService.setSelected(hit.item.id);
                    // Note: The 10-jump radius overlay will be shown automatically by the
                    // SelectionService.subscribe callback which calls computeConnectionGradient
                }
                // Clear the processing flag
                isProcessingTap = false;
            }
        }
    };
    const handleSelectionChange = ({ hoveredId, selectedId, }) => {
        bus.publish("update_ui_state", { hoveredId, selectedId });
        // Publish selection events via pub/sub for other workers to hear
        bus.publish("selection_changed", { hoveredId, selectedId });
        // On selection, also trigger BFS/color generation for connection highlighting
        if (selectedId != null) {
            const coloring = computeConnectionGradient(selectedId, clusters, 10, lastConnections);
            bus.publish("setConnectionColors", coloring);
            // Publish connection coloring event
            bus.publish("connections_colored", { selectedId, coloring });
        }
        else {
            // Clear the overlay if no selection
            bus.publish("setConnectionColors", {});
            // Publish clear event
            bus.publish("connections_cleared", {});
        }
    };
    // Attach UI handles (arrows, planes) for a cluster in edit mode
    function attachUIObjectsForCluster(cluster) {
        // Remove existing handles
        clearUIObjects();
        const axisLength = (cluster.radius || 400) * 1.5;
        uiObjects = [
            {
                id: `axis_x_${cluster.id}`,
                x: cluster.position.x,
                z: cluster.position.z,
                yMin: cluster.position.y - 40,
                yMax: cluster.position.y + 40,
                kind: "axisX",
                clusterId: cluster.id,
            },
            {
                id: `axis_y_${cluster.id}`,
                x: cluster.position.x,
                z: cluster.position.z,
                yMin: cluster.position.y,
                yMax: cluster.position.y + axisLength,
                kind: "axisY",
                clusterId: cluster.id,
            },
            {
                id: `axis_z_${cluster.id}`,
                x: cluster.position.x,
                z: cluster.position.z,
                yMin: cluster.position.y - 40,
                yMax: cluster.position.y + 40,
                kind: "axisZ",
                clusterId: cluster.id,
            },
            {
                id: `plane_xz_${cluster.id}`,
                x: cluster.position.x,
                z: cluster.position.z,
                yMin: cluster.position.y - 50,
                yMax: cluster.position.y + 50,
                kind: "planeXZ",
                clusterId: cluster.id,
            },
        ];
        uiObjectIndex.build(uiObjects);
    }
    function clearUIObjects() {
        if (uiObjects.length > 0 && currentlyEditingClusterId != null) {
            bus.publish("hide_edit_handles", {
                clusterId: currentlyEditingClusterId,
            });
        }
        uiObjects = [];
        uiObjectIndex.clear();
    }
    /**
     * Find all connections up to maxJumps away from the selected cluster, and assign per-connection colors.
     */
    function makeConnectionKey(cluster1, cluster2, jumpGate1, jumpGate2) {
        const c1id = typeof cluster1 === "object" ? cluster1.id : cluster1;
        const c2id = typeof cluster2 === "object" ? cluster2.id : cluster2;
        const jg1id = typeof jumpGate1 === "object" ? jumpGate1.id : jumpGate1;
        const jg2id = typeof jumpGate2 === "object" ? jumpGate2.id : jumpGate2;
        let arr = [c1id, c2id, jg1id, jg2id];
        if (c1id > c2id || (c1id === c2id && jg1id > jg2id)) {
            arr = [c2id, c1id, jg2id, jg1id];
        }
        return arr.join("_");
    }
    function computeConnectionGradient(selectedId, _clusters, maxJumps, connections) {
        const connectionGraph = new Map();
        const connectionsFlat = connections ?? [];
        for (const conn of connectionsFlat) {
            const c1 = conn.cluster1.id;
            const c2 = conn.cluster2.id;
            const list1 = connectionGraph.get(c1) ?? [];
            const list2 = connectionGraph.get(c2) ?? [];
            const connKey = makeConnectionKey(c1, c2, conn.jumpGate1.id, conn.jumpGate2.id);
            list1.push({ to: c2, key: connKey });
            list2.push({ to: c1, key: connKey });
            connectionGraph.set(c1, list1);
            connectionGraph.set(c2, list2);
        }
        const queue = [
            { id: selectedId, dist: 0 },
        ];
        const visited = new Set([selectedId]);
        const connToDist = new Map();
        while (queue.length > 0) {
            const current = queue.shift();
            if (!current)
                break;
            const { id, dist } = current;
            if (dist > maxJumps)
                continue;
            const neighbors = connectionGraph.get(id) ?? [];
            for (const neighbor of neighbors) {
                if (!visited.has(neighbor.to)) {
                    visited.add(neighbor.to);
                    queue.push({ id: neighbor.to, dist: dist + 1 });
                }
                if (dist < maxJumps) {
                    const prev = connToDist.get(neighbor.key);
                    const nextDist = Math.min(dist + 1, prev ?? Infinity);
                    connToDist.set(neighbor.key, nextDist);
                }
            }
        }
        const gradient = makeColorGradient(0xff3c3c, 0x3c5cff, maxJumps, true);
        const out = {};
        for (const [key, dist] of connToDist.entries()) {
            if (dist >= 1 && dist <= maxJumps) {
                out[key] = rgbToHex(gradient[dist - 1]);
            }
        }
        return out;
    }
    // --- Internal connection storage for BFS ---
    let lastConnections = [];
    // Process ops from galaxy worker to build state in parallel
    const handleOps = (ops) => {
        if (!Array.isArray(ops))
            return;
        let connectionsChanged = false;
        let clustersChanged = false;
        for (const op of ops) {
            if (op.type === "addCluster") {
                addCluster(op.payload);
                clustersChanged = true;
            }
            else if (op.type === "connectClusters") {
                const { clusterId1, clusterId2, jumpGate1, jumpGate2 } = op.payload;
                const connection = {
                    cluster1: { id: clusterId1 },
                    cluster2: { id: clusterId2 },
                    jumpGate1: { id: jumpGate1.id },
                    jumpGate2: { id: jumpGate2.id },
                };
                lastConnections.push(connection);
                connectionsChanged = true;
            }
            else if (op.type === "removeConnection") {
                const { clusterId1, clusterId2, jumpGate1, jumpGate2 } = op.payload;
                lastConnections = lastConnections.filter((conn) => {
                    const matchesCluster1 = (conn.cluster1.id === clusterId1 &&
                        conn.cluster2.id === clusterId2) ||
                        (conn.cluster1.id === clusterId2 &&
                            conn.cluster2.id === clusterId1);
                    const matchesGates = !jumpGate1 || !jumpGate2
                        ? true
                        : (conn.jumpGate1.id === jumpGate1.id &&
                            conn.jumpGate2.id === jumpGate2.id) ||
                            (conn.jumpGate1.id === jumpGate2.id &&
                                conn.jumpGate2.id === jumpGate1.id);
                    return !(matchesCluster1 && matchesGates);
                });
                connectionsChanged = true;
            }
            else if (op.type === "removeCluster") {
                const { clusterId } = op.payload;
                removeCluster(clusterId);
                lastConnections = lastConnections.filter((conn) => conn.cluster1.id !== clusterId && conn.cluster2.id !== clusterId);
                clustersChanged = true;
                connectionsChanged = true;
            }
        }
        if (clustersChanged) {
            const state = SelectionService.getState();
            const selectedMissing = state.selectedId != null &&
                !clusters.find((cluster) => cluster.id === state.selectedId);
            const hoveredMissing = state.hoveredId != null &&
                !clusters.find((cluster) => cluster.id === state.hoveredId);
            if (selectedMissing) {
                SelectionService.setSelected(null);
            }
            if (hoveredMissing) {
                SelectionService.setHovered(null);
            }
        }
        if (connectionsChanged && currentlyEditingClusterId === null) {
            const { selectedId } = SelectionService.getState();
            if (selectedId != null) {
                const coloring = computeConnectionGradient(selectedId, clusters, 10, lastConnections);
                bus.publish("setConnectionColors", coloring);
            }
        }
    };
    const handleClearGalaxy = () => {
        lastConnections.length = 0;
        clusters.length = 0;
        clusterIndex.clear();
        clearUIObjects();
        currentlyEditingClusterId = null;
        editDragClusterId = null;
        editDragOffset = null;
        editDragAxis = null;
        editDragStart = null;
        SelectionService.clear();
    };
    const setupPubSubSubscriptions = () => {
        if (pubSubReady || !bus._brokerPort)
            return;
        pubSubReady = true;
        const debugLevel = bus._options.debug ?? 0;
        if (debugLevel >= 1) {
            console.log("📢 Business worker setting up pub/sub subscriptions");
        }
        SelectionService.subscribe(handleSelectionChange);
        bus.subscribe("pointer_event", handlePointerEvent);
        bus.subscribe("ops", handleOps);
        bus.subscribe("ops_local", handleOps);
        bus.subscribe("clearGalaxy", handleClearGalaxy);
        bus.subscribe("galaxy_generation_complete", () => {
            if (debugLevel >= 1) {
                console.log("🌌 Business worker received galaxy generation complete");
            }
        });
        bus.subscribe("galaxy_regeneration_complete", (data) => {
            if (debugLevel >= 1) {
                console.log("🔁 Business worker received galaxy regeneration complete", data);
            }
        });
        bus.subscribe("cluster_updated", (data) => {
            if (debugLevel >= 2) {
                console.log("🔄 Business worker received cluster update:", data);
            }
        });
        bus.subscribe("test_message", (data) => {
            if (debugLevel >= 1) {
                console.log("📨 Business worker received test message:", data);
            }
        });
    };
    if (bus._brokerPort) {
        setupPubSubSubscriptions();
    }
    bus.on("setup_broker_port", () => {
        setupPubSubSubscriptions();
    });
    // Worker ready notification
    bus.send("worker_ready", { role: "business" });
    // Return worker instance
    return {
        destroy: () => {
            SelectionService.unsubscribe(handleSelectionChange);
            clearUIObjects();
            clusters.length = 0;
            clusterIndex.clear();
            uiObjects.length = 0;
            uiObjectIndex.clear();
            lastConnections.length = 0;
        },
    };
}
//# sourceMappingURL=business-worker.js.map