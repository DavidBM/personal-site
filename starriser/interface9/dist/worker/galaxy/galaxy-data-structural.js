import { clusterPayloadToData, solarSystemPayloadToData, } from "./galaxy-data-adapters.js";
import { addGalaxyDataClusterConnection, addGalaxyDataLocalSolarSystemConnection, isGalaxyDataConnectionTouchingSolarSystem, normalizeGalaxyDataClusterSolarSystemConnections, pruneInvalidGalaxyDataClusterConnections, rebuildGalaxyDataConnectedClusters, removeGalaxyDataConnectionsBetweenClusters, removeGalaxyDataConnectionsTouchingCluster, removeGalaxyDataConnectionsTouchingSolarSystem, removeGalaxyDataSolarSystemReferences, } from "../../galaxy-data-connections.js";
import { clearGalaxyDataSelectionReferences } from "./galaxy-data-selection.js";
export function addClusterToGalaxyData(data, payload) {
    const cluster = clusterPayloadToData(payload);
    normalizeGalaxyDataClusterSolarSystemConnections(cluster);
    data.clusters[payload.id] = cluster;
    if (!data.clusterOrder.includes(payload.id)) {
        data.clusterOrder.push(payload.id);
    }
    pruneInvalidGalaxyDataClusterConnections(data);
    rebuildGalaxyDataConnectedClusters(data);
}
export function removeClusterFromGalaxyData(data, clusterId) {
    delete data.clusters[clusterId];
    data.clusterOrder = data.clusterOrder.filter((id) => id !== clusterId);
    removeGalaxyDataConnectionsTouchingCluster(data, clusterId);
    clearGalaxyDataSelectionReferences(data, clusterId);
    rebuildGalaxyDataConnectedClusters(data);
}
export function addSolarSystemToGalaxyData(data, payload) {
    const cluster = data.clusters[payload.clusterId];
    if (!cluster)
        return;
    const existingIndex = cluster.solarSystems.findIndex((sys) => sys.id === payload.id);
    const solarSystem = solarSystemPayloadToData(payload);
    const requestedConnections = solarSystem.connections.slice();
    solarSystem.connections = [];
    if (existingIndex === -1) {
        cluster.solarSystems.push(solarSystem);
    }
    else {
        removeGalaxyDataSolarSystemReferences(cluster, solarSystem.id);
        cluster.solarSystems[existingIndex] = solarSystem;
        removeInvalidGalaxyDataClusterConnectionsForSolarSystem(data, payload.clusterId, solarSystem.id);
    }
    for (const connectedId of requestedConnections) {
        addGalaxyDataLocalSolarSystemConnection(data, payload.clusterId, solarSystem.id, connectedId);
    }
}
export function removeSolarSystemFromGalaxyData(data, clusterId, solarSystemId) {
    const cluster = data.clusters[clusterId];
    if (!cluster)
        return;
    cluster.solarSystems = cluster.solarSystems.filter((sys) => sys.id !== solarSystemId);
    removeGalaxyDataSolarSystemReferences(cluster, solarSystemId);
    removeGalaxyDataConnectionsTouchingSolarSystem(data, clusterId, solarSystemId);
    rebuildGalaxyDataConnectedClusters(data);
}
export function connectSolarSystemsInGalaxyData(data, clusterId, solarSystemId1, solarSystemId2) {
    addGalaxyDataLocalSolarSystemConnection(data, clusterId, solarSystemId1, solarSystemId2);
}
export function connectClustersInGalaxyData(data, clusterId1, clusterId2, jumpGateId1, jumpGateId2) {
    addGalaxyDataClusterConnection(data, clusterId1, clusterId2, jumpGateId1, jumpGateId2);
}
export function removeClusterConnectionFromGalaxyData(data, clusterId1, clusterId2, jumpGateId1, jumpGateId2) {
    removeGalaxyDataConnectionsBetweenClusters(data, clusterId1, clusterId2, jumpGateId1, jumpGateId2);
    rebuildGalaxyDataConnectedClusters(data);
}
export function removeInvalidGalaxyDataClusterConnectionsForSolarSystem(data, clusterId, solarSystemId) {
    const removed = pruneInvalidGalaxyDataClusterConnections(data, (conn) => isGalaxyDataConnectionTouchingSolarSystem(conn, clusterId, solarSystemId));
    if (removed > 0) {
        rebuildGalaxyDataConnectedClusters(data);
    }
}
//# sourceMappingURL=galaxy-data-structural.js.map