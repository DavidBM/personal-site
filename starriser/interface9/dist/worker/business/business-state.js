import { makeGalaxyDataConnectionKeyFromIds } from "../../galaxy-data-connections.js";
import { makeColorGradient, rgbToHex } from "../../utils/color.js";
export function businessClusterFromData(cluster) {
    return {
        id: cluster.id,
        name: cluster.name,
        position: {
            x: cluster.position.x,
            y: cluster.position.y,
            z: cluster.position.z,
        },
        color: cluster.color,
        radius: cluster.radius,
    };
}
export function removeBusinessClusterProjection(projection, clusterId) {
    const idx = projection.clusters.findIndex((cluster) => cluster.id === clusterId);
    if (idx !== -1) {
        projection.clusters.splice(idx, 1);
        projection.clusterIndex.remove(clusterId);
    }
    return projection.clusterById.delete(clusterId) || idx !== -1;
}
export function clearBusinessClusterProjection(projection) {
    projection.clusters.length = 0;
    projection.clusterById.clear();
    projection.clusterIndex.clear();
}
export function syncBusinessClusterProjection(projection, worldData, clusterId) {
    const clusterData = worldData.clusters[clusterId];
    if (!clusterData) {
        removeBusinessClusterProjection(projection, clusterId);
        return null;
    }
    const existing = projection.clusterById.get(clusterId);
    if (existing) {
        copyClusterDataToBusinessCluster(existing, clusterData);
        projection.clusterIndex.remove(clusterId);
        projection.clusterIndex.insert(existing);
        return existing;
    }
    const cluster = businessClusterFromData(clusterData);
    projection.clusters.push(cluster);
    projection.clusterById.set(cluster.id, cluster);
    projection.clusterIndex.insert(cluster);
    return cluster;
}
export function syncBusinessClusterPositionToWorldData(worldData, cluster) {
    const clusterData = worldData.clusters[cluster.id];
    if (!clusterData)
        return false;
    clusterData.position.x = cluster.position.x;
    clusterData.position.y = cluster.position.y;
    clusterData.position.z = cluster.position.z;
    return true;
}
export function updateBusinessClusterProjectionPosition({ projection, worldData, cluster, position, }) {
    cluster.position.x = position.x;
    cluster.position.y = position.y;
    cluster.position.z = position.z;
    const synced = syncBusinessClusterPositionToWorldData(worldData, cluster);
    projection.clusterIndex.remove(cluster.id);
    projection.clusterIndex.insert(cluster);
    return synced;
}
export function applyBusinessEditDragEffect({ projection, worldData, cluster, effect, nextPosition, }) {
    if (effect === "update") {
        if (!nextPosition)
            return null;
        updateBusinessClusterProjectionPosition({
            projection,
            worldData,
            cluster,
            position: nextPosition,
        });
        return {
            topic: "update_cluster",
            payload: {
                clusterId: cluster.id,
                position: cluster.position,
            },
            priority: 0,
        };
    }
    if (effect === "commit") {
        syncBusinessClusterPositionToWorldData(worldData, cluster);
        return {
            topic: "commit_cluster_move",
            payload: {
                clusterId: cluster.id,
                position: cluster.position,
            },
            priority: 0,
        };
    }
    return null;
}
export function applyBusinessOpsEffectsToProjection(projection, worldData, effects) {
    const syncedClusterIds = [];
    const removedClusterIds = [];
    for (const clusterId of effects.clusterIdsToSync) {
        if (syncBusinessClusterProjection(projection, worldData, clusterId)) {
            syncedClusterIds.push(clusterId);
        }
    }
    for (const clusterId of effects.clusterIdsToRemove) {
        if (removeBusinessClusterProjection(projection, clusterId)) {
            removedClusterIds.push(clusterId);
        }
    }
    return {
        syncedClusterIds,
        removedClusterIds,
    };
}
export function planBusinessOpsPostEffects({ effects, selectionState, clusters, connections, currentlyEditingClusterId, maxJumps = 10, }) {
    const missing = effects.clustersChanged
        ? findMissingSelectionState(selectionState, clusters)
        : { selectedMissing: false, hoveredMissing: false };
    const effectiveSelectedId = missing.selectedMissing
        ? null
        : selectionState.selectedId;
    return {
        clearSelected: missing.selectedMissing,
        clearHovered: missing.hoveredMissing,
        connectionColors: effects.connectionsChanged &&
            currentlyEditingClusterId === null &&
            effectiveSelectedId != null
            ? computeConnectionGradient(effectiveSelectedId, maxJumps, connections)
            : null,
    };
}
function copyClusterDataToBusinessCluster(target, source) {
    target.name = source.name;
    target.position.x = source.position.x;
    target.position.y = source.position.y;
    target.position.z = source.position.z;
    target.color = source.color;
    target.radius = source.radius;
}
export function makeConnectionKey(cluster1, cluster2, jumpGate1, jumpGate2) {
    return makeGalaxyDataConnectionKeyFromIds(cluster1, cluster2, jumpGate1, jumpGate2);
}
export function computeConnectionGradient(selectedId, maxJumps, connections) {
    const connectionGraph = new Map();
    for (const conn of connections) {
        const c1 = conn.clusterId1;
        const c2 = conn.clusterId2;
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
export function summarizeBusinessOpsEffects(ops) {
    const clusterIdsToSync = [];
    const clusterIdsToRemove = [];
    let connectionsChanged = false;
    for (const op of ops) {
        if (op.type === "addCluster") {
            clusterIdsToSync.push(op.payload.id);
            connectionsChanged = true;
        }
        else if (op.type === "addSolarSystem") {
            connectionsChanged = true;
        }
        else if (op.type === "connectClusters") {
            connectionsChanged = true;
        }
        else if (op.type === "removeConnection") {
            connectionsChanged = true;
        }
        else if (op.type === "removeSolarSystem") {
            connectionsChanged = true;
        }
        else if (op.type === "removeCluster") {
            clusterIdsToRemove.push(op.payload.clusterId);
            connectionsChanged = true;
        }
    }
    return {
        clusterIdsToSync,
        clusterIdsToRemove,
        clustersChanged: clusterIdsToSync.length > 0 || clusterIdsToRemove.length > 0,
        connectionsChanged,
    };
}
export function findMissingSelectionState(state, clusters) {
    return {
        selectedMissing: state.selectedId != null &&
            !clusters.some((cluster) => cluster.id === state.selectedId),
        hoveredMissing: state.hoveredId != null &&
            !clusters.some((cluster) => cluster.id === state.hoveredId),
    };
}
export function planBusinessSelectionChangeEffects({ hoveredId, selectedId, connections, maxJumps = 10, }) {
    const updateUiState = { hoveredId, selectedId };
    const selectionChanged = { hoveredId, selectedId };
    if (selectedId != null) {
        const coloring = computeConnectionGradient(selectedId, maxJumps, connections);
        return {
            updateUiState,
            selectionChanged,
            connectionColors: coloring,
            connectionEvent: {
                type: "connections_colored",
                payload: { selectedId, coloring },
            },
        };
    }
    return {
        updateUiState,
        selectionChanged,
        connectionColors: {},
        connectionEvent: {
            type: "connections_cleared",
            payload: {},
        },
    };
}
export function planBusinessSelectionChangePublications(effects) {
    return [
        {
            topic: "update_ui_state",
            payload: effects.updateUiState,
        },
        {
            topic: "selection_changed",
            payload: effects.selectionChanged,
        },
        {
            topic: "setConnectionColors",
            payload: effects.connectionColors,
        },
        {
            topic: effects.connectionEvent.type,
            payload: effects.connectionEvent.payload,
        },
    ];
}
//# sourceMappingURL=business-state.js.map