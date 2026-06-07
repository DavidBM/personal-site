export function resolveGalaxyViewReplaySolarSystem(galaxy, clusterId, solarSystemId) {
    const cluster = galaxy.getClusterById(clusterId);
    if (!cluster)
        return null;
    const solarSystem = galaxy.getSolarSystemById(clusterId, solarSystemId);
    if (!solarSystem)
        return null;
    return { cluster, solarSystem };
}
export function resolveGalaxyViewReplaySolarSystemPair(galaxy, clusterId, solarSystemId1, solarSystemId2) {
    const cluster = galaxy.getClusterById(clusterId);
    if (!cluster)
        return null;
    const solarSystem1 = galaxy.getSolarSystemById(clusterId, solarSystemId1);
    const solarSystem2 = galaxy.getSolarSystemById(clusterId, solarSystemId2);
    if (!solarSystem1 || !solarSystem2)
        return null;
    return { cluster, solarSystem1, solarSystem2 };
}
export function resolveGalaxyViewReplayClusterPair(galaxy, clusterId1, clusterId2) {
    const cluster1 = galaxy.getClusterById(clusterId1);
    const cluster2 = galaxy.getClusterById(clusterId2);
    if (!cluster1 || !cluster2)
        return null;
    return { cluster1, cluster2 };
}
export function resolveGalaxyViewReplayClusterConnection(galaxy, clusterId1, clusterId2, jumpGate1, jumpGate2) {
    if (!jumpGate1 || !jumpGate2)
        return null;
    const clusterPair = resolveGalaxyViewReplayClusterPair(galaxy, clusterId1, clusterId2);
    if (!clusterPair)
        return null;
    const jumpGate1View = galaxy.getSolarSystemById(clusterId1, jumpGate1.id);
    const jumpGate2View = galaxy.getSolarSystemById(clusterId2, jumpGate2.id);
    if (!jumpGate1View || !jumpGate2View)
        return null;
    return {
        cluster1: clusterPair.cluster1,
        cluster2: clusterPair.cluster2,
        jumpGate1: jumpGate1View,
        jumpGate2: jumpGate2View,
    };
}
//# sourceMappingURL=galaxy-view-replay-resolve.js.map