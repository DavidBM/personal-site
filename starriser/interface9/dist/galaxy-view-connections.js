import { connectClusterViews, connectSolarSystemViews, disconnectClusterViews, disconnectSolarSystemViews, findClusterConnectionsBetweenClusterViews, hasSolarSystemConnectionEndpointsInClusterView, } from "./galaxy-view-graph.js";
export function connectClustersInGalaxyViewState(state, renderer, cluster1, cluster2, jumpGate1, jumpGate2) {
    return connectClustersInGalaxyView(state.connections, state.connectionIdMap, renderer, cluster1, cluster2, jumpGate1, jumpGate2);
}
export function connectClustersInGalaxyView(connections, connectionIdMap, renderer, cluster1, cluster2, jumpGate1, jumpGate2) {
    const connectionCount = connections.length;
    const connection = connectClusterViews(connections, connectionIdMap, cluster1, cluster2, jumpGate1, jumpGate2);
    if (connections.length !== connectionCount) {
        renderer.connectClusters(cluster1, cluster2, jumpGate1, jumpGate2);
    }
    return connection;
}
export function removeClusterConnectionFromGalaxyView(connections, connectionIdMap, renderer, cluster1, cluster2, jumpGate1, jumpGate2) {
    const connection = disconnectClusterViews(connections, connectionIdMap, cluster1, cluster2, jumpGate1, jumpGate2);
    if (!connection)
        return false;
    renderer.removeClusterConnection(connection.cluster1, connection.cluster2, connection.jumpGate1, connection.jumpGate2);
    return true;
}
export function removeClusterConnectionFromGalaxyViewState(state, renderer, cluster1, cluster2, jumpGate1, jumpGate2) {
    return removeClusterConnectionFromGalaxyView(state.connections, state.connectionIdMap, renderer, cluster1, cluster2, jumpGate1, jumpGate2);
}
export function removeClusterConnectionsBetweenFromGalaxyView(connections, connectionIdMap, renderer, cluster1, cluster2) {
    const matchingConnections = findClusterConnectionsBetweenClusterViews(connections, cluster1, cluster2);
    let removed = 0;
    for (const connection of matchingConnections) {
        if (removeClusterConnectionFromGalaxyView(connections, connectionIdMap, renderer, connection.cluster1, connection.cluster2, connection.jumpGate1, connection.jumpGate2)) {
            removed += 1;
        }
    }
    return removed;
}
export function removeClusterConnectionsBetweenFromGalaxyViewState(state, renderer, cluster1, cluster2) {
    return removeClusterConnectionsBetweenFromGalaxyView(state.connections, state.connectionIdMap, renderer, cluster1, cluster2);
}
export function addSolarSystemConnectionToGalaxyView(cluster, solarSystemA, solarSystemB, renderer, options = {}) {
    if (!hasSolarSystemConnectionEndpointsInClusterView(cluster, solarSystemA, solarSystemB)) {
        return false;
    }
    const changed = connectSolarSystemViews(solarSystemA, solarSystemB);
    if (changed) {
        renderer.addSolarSystemConnection(cluster, solarSystemA, solarSystemB, options);
    }
    return changed;
}
export function removeSolarSystemConnectionFromGalaxyView(cluster, solarSystemA, solarSystemB, renderer) {
    if (!hasSolarSystemConnectionEndpointsInClusterView(cluster, solarSystemA, solarSystemB)) {
        return false;
    }
    const changed = disconnectSolarSystemViews(solarSystemA, solarSystemB);
    if (changed) {
        renderer.removeSolarSystemConnection(cluster, solarSystemA, solarSystemB);
    }
    return changed;
}
//# sourceMappingURL=galaxy-view-connections.js.map