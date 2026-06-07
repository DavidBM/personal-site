export function createFleetGraphProjection() {
    return {
        clusters: new Map(),
        clusterIds: [],
        clusterEdges: new Map(),
    };
}
export function clearFleetGraphProjection(graph) {
    graph.clusters.clear();
    graph.clusterIds.length = 0;
    graph.clusterEdges.clear();
}
export function syncFleetClusterProjection(graph, cluster) {
    let fleetCluster = graph.clusters.get(cluster.id);
    if (!fleetCluster) {
        fleetCluster = {
            id: cluster.id,
            solarSystems: new Map(),
            solarSystemIds: [],
        };
        graph.clusters.set(cluster.id, fleetCluster);
        graph.clusterIds.push(cluster.id);
    }
    fleetCluster.solarSystems.clear();
    fleetCluster.solarSystemIds.length = 0;
    for (const sys of cluster.solarSystems) {
        fleetCluster.solarSystems.set(sys.id, {
            id: sys.id,
            position: sys.position,
            connections: new Set(sys.connections),
            isJumpGate: sys.isJumpGate,
        });
        fleetCluster.solarSystemIds.push(sys.id);
    }
    if (!graph.clusterEdges.has(cluster.id)) {
        graph.clusterEdges.set(cluster.id, []);
    }
}
export function removeFleetClusterProjection(graph, clusterId) {
    graph.clusters.delete(clusterId);
    const idx = graph.clusterIds.indexOf(clusterId);
    if (idx >= 0)
        graph.clusterIds.splice(idx, 1);
    graph.clusterEdges.delete(clusterId);
    for (const edges of graph.clusterEdges.values()) {
        for (let i = edges.length - 1; i >= 0; i--) {
            if (edges[i].toClusterId === clusterId) {
                edges.splice(i, 1);
            }
        }
    }
}
export function rebuildFleetClusterEdges(graph, connections) {
    graph.clusterEdges.clear();
    for (const clusterId of graph.clusterIds) {
        graph.clusterEdges.set(clusterId, []);
    }
    for (const conn of connections) {
        addFleetClusterEdge(graph, {
            fromClusterId: conn.clusterId1,
            toClusterId: conn.clusterId2,
            fromGateId: conn.jumpGate1.id,
            toGateId: conn.jumpGate2.id,
        });
    }
}
export function syncFleetGraphFromGalaxyData(graph, data) {
    clearFleetGraphProjection(graph);
    for (const clusterId of data.clusterOrder) {
        const cluster = data.clusters[clusterId];
        if (cluster) {
            syncFleetClusterProjection(graph, cluster);
        }
    }
    rebuildFleetClusterEdges(graph, data.connections);
}
export function summarizeFleetGraphOpsEffects(ops) {
    const clusterIdsToSync = [];
    const seen = new Set();
    let clusterEdgesChanged = false;
    const addClusterId = (clusterId) => {
        if (seen.has(clusterId))
            return;
        seen.add(clusterId);
        clusterIdsToSync.push(clusterId);
    };
    for (const op of ops) {
        switch (op.type) {
            case "addCluster":
                addClusterId(op.payload.id);
                clusterEdgesChanged = true;
                break;
            case "removeCluster":
                addClusterId(op.payload.clusterId);
                clusterEdgesChanged = true;
                break;
            case "addSolarSystem":
                addClusterId(op.payload.clusterId);
                clusterEdgesChanged = true;
                break;
            case "removeSolarSystem":
                addClusterId(op.payload.clusterId);
                clusterEdgesChanged = true;
                break;
            case "connectSolarSystems":
                addClusterId(op.payload.clusterId);
                break;
            case "connectClusters":
            case "removeConnection":
                clusterEdgesChanged = true;
                break;
        }
    }
    return {
        clusterIdsToSync,
        clusterEdgesChanged,
    };
}
function addFleetClusterEdge(graph, edge) {
    if (!graph.clusters.has(edge.fromClusterId))
        return;
    if (!graph.clusters.has(edge.toClusterId))
        return;
    const edgesFrom = graph.clusterEdges.get(edge.fromClusterId) ?? [];
    graph.clusterEdges.set(edge.fromClusterId, edgesFrom);
    const edgesTo = graph.clusterEdges.get(edge.toClusterId) ?? [];
    graph.clusterEdges.set(edge.toClusterId, edgesTo);
    if (!hasEdge(edgesFrom, edge)) {
        edgesFrom.push(edge);
    }
    const reverseEdge = {
        fromClusterId: edge.toClusterId,
        toClusterId: edge.fromClusterId,
        fromGateId: edge.toGateId,
        toGateId: edge.fromGateId,
    };
    if (!hasEdge(edgesTo, reverseEdge)) {
        edgesTo.push(reverseEdge);
    }
}
function hasEdge(edges, edge) {
    return edges.some((existing) => existing.fromClusterId === edge.fromClusterId &&
        existing.toClusterId === edge.toClusterId &&
        existing.fromGateId === edge.fromGateId &&
        existing.toGateId === edge.toGateId);
}
//# sourceMappingURL=fleet-graph.js.map