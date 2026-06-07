import { opAddCluster, opAddSolarSystem, opConnectClusters, opConnectSolarSystems, opRemoveCluster, } from "../galaxy-ops.js";
export function emitAddCluster(opBatcher, cluster) {
    opBatcher.add(opAddCluster(cluster));
}
export function emitAddSolarSystem(opBatcher, clusterId, solarSystem) {
    opBatcher.add(opAddSolarSystem(clusterId, {
        id: solarSystem.id,
        name: solarSystem.name,
        position: solarSystem.position,
        connections: solarSystem.connections,
        isJumpGate: solarSystem.isJumpGate,
        connectedToClusterId: solarSystem.connectedToClusterId ?? null,
    }));
}
export function emitSolarSystemConnection(opBatcher, clusterId, solarSystemA, solarSystemB) {
    opBatcher.add(opConnectSolarSystems(clusterId, solarSystemA.id, solarSystemB.id));
}
export function emitClusterConnection(opBatcher, connection) {
    opBatcher.add(opConnectClusters(connection.clusterA.id, connection.clusterB.id, { id: connection.gateA.id }, { id: connection.gateB.id }));
}
export function emitRemoveCluster(opBatcher, clusterId) {
    opBatcher.add(opRemoveCluster(clusterId));
}
//# sourceMappingURL=galaxy-op-emitter.js.map