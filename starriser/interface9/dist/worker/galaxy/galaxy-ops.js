export function opAddCluster(clusterData) {
    return { type: "addCluster", payload: clusterData };
}
export function opRemoveCluster(clusterId) {
    return { type: "removeCluster", payload: { clusterId } };
}
export function opAddSolarSystem(clusterId, solarSystemData) {
    return { type: "addSolarSystem", payload: { clusterId, ...solarSystemData } };
}
export function opRemoveSolarSystem(clusterId, solarSystemId) {
    return { type: "removeSolarSystem", payload: { clusterId, solarSystemId } };
}
export function opConnectClusters(clusterId1, clusterId2, jumpGate1, jumpGate2) {
    return {
        type: "connectClusters",
        payload: { clusterId1, clusterId2, jumpGate1, jumpGate2 },
    };
}
export function opRemoveConnection(clusterId1, clusterId2, jumpGate1, jumpGate2) {
    return {
        type: "removeConnection",
        payload: { clusterId1, clusterId2, jumpGate1, jumpGate2 },
    };
}
export function opConnectSolarSystems(clusterId, solarSystemId1, solarSystemId2) {
    return {
        type: "connectSolarSystems",
        payload: { clusterId, solarSystemId1, solarSystemId2 },
    };
}
//# sourceMappingURL=galaxy-ops.js.map