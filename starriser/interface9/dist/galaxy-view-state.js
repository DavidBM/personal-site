export function createGalaxyViewState() {
    return {
        clusters: [],
        connections: [],
        idToCluster: new Map(),
        idToSolarSystem: new Map(),
        connectionIdMap: new Map(),
    };
}
export function makeGalaxySolarSystemViewKey(clusterId, solarSystemId) {
    return `${clusterId}:${solarSystemId}`;
}
export function getClusterFromGalaxyViewState(state, clusterId) {
    return state.idToCluster.get(clusterId) ?? null;
}
export function getSolarSystemFromGalaxyViewState(state, clusterId, solarSystemId) {
    return (state.idToSolarSystem.get(makeGalaxySolarSystemViewKey(clusterId, solarSystemId)) ?? null);
}
export function addClusterToGalaxyView(cluster, clusters, idToCluster) {
    const existing = idToCluster.get(cluster.id) ??
        clusters.find((candidate) => candidate.id === cluster.id);
    if (existing) {
        const existingSolarSystems = existing.solarSystems;
        Object.assign(existing, cluster);
        if (existingSolarSystems) {
            existing.solarSystems =
                existingSolarSystems;
        }
        idToCluster.set(existing.id, existing);
        return existing;
    }
    clusters.push(cluster);
    idToCluster.set(cluster.id, cluster);
    return cluster;
}
export function addClusterToGalaxyViewState(state, cluster) {
    return addClusterToGalaxyView(cluster, state.clusters, state.idToCluster);
}
export function disposeClusterView(cluster) {
    if (cluster.solarSystems) {
        for (const solarSystem of cluster.solarSystems) {
            disposeViewObject(solarSystem);
        }
    }
    disposeViewObject(cluster);
}
function disposeViewObject(viewObject) {
    if (typeof viewObject !== "object" || viewObject === null)
        return;
    const disposable = viewObject;
    if (typeof disposable.dispose === "function") {
        disposable.dispose();
    }
}
export function removeClusterFromGalaxyView(cluster, clusters, idToCluster) {
    const index = clusters.indexOf(cluster);
    if (index === -1)
        return false;
    clusters.splice(index, 1);
    disposeClusterView(cluster);
    idToCluster.delete(cluster.id);
    return true;
}
export function clearGalaxyViewState(input) {
    for (const cluster of input.clusters) {
        disposeClusterView(cluster);
    }
    input.idToCluster.clear();
    input.idToSolarSystem.clear();
    input.connectionIdMap.clear();
    return {
        clusters: [],
        connections: [],
    };
}
export function clearGalaxyViewStateInPlace(state) {
    const cleared = clearGalaxyViewState(state);
    state.clusters = cleared.clusters;
    state.connections = cleared.connections;
    return state;
}
//# sourceMappingURL=galaxy-view-state.js.map