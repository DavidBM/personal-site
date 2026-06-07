import { opAddCluster, opAddSolarSystem, opConnectClusters, opRemoveCluster, } from "./galaxy-ops.js";
export function buildAddGeneratedClusterOps(clusters) {
    return clusters.map((cluster) => opAddCluster(cluster));
}
export function buildGeneratedClusterConnectionOps({ clusterAId, clusterBId, gateA, gateB, attachedJumpGates, }) {
    const ops = [];
    for (const { clusterId, jumpGate } of attachedJumpGates) {
        ops.push(opAddSolarSystem(clusterId, jumpGate));
    }
    ops.push(opConnectClusters(clusterAId, clusterBId, { id: gateA.id }, { id: gateB.id }));
    return ops;
}
export function applyGeneratedClusterSolarSystemUpdateToCluster(cluster, update) {
    cluster.solarSystems = update.solarSystems;
    cluster.maxSystemDistance = update.maxSystemDistance;
    return update.success ? update.ops : [];
}
export function buildRemoveGeneratedClusterOps(clusterIds) {
    return clusterIds.map((clusterId) => opRemoveCluster(clusterId));
}
//# sourceMappingURL=generation-ops.js.map