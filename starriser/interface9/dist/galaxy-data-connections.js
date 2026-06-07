export function makeGalaxyDataClusterPairKey(clusterId1, clusterId2) {
    return `${Math.min(clusterId1, clusterId2)}:${Math.max(clusterId1, clusterId2)}`;
}
export function makeGalaxyDataConnectionKey(connection) {
    return makeGalaxyDataConnectionKeyFromIds(connection.clusterId1, connection.clusterId2, connection.jumpGate1.id, connection.jumpGate2.id);
}
export function makeGalaxyDataConnectionKeyFromIds(clusterId1, clusterId2, jumpGateId1, jumpGateId2) {
    if (clusterId1 > clusterId2 ||
        (clusterId1 === clusterId2 && jumpGateId1 > jumpGateId2)) {
        return `${clusterId2}_${clusterId1}_${jumpGateId2}_${jumpGateId1}`;
    }
    return `${clusterId1}_${clusterId2}_${jumpGateId1}_${jumpGateId2}`;
}
export function makeGalaxyDataSolarSystemConnectionKey(clusterId, solarSystemId1, solarSystemId2) {
    return `${clusterId}:${Math.min(solarSystemId1, solarSystemId2)}:${Math.max(solarSystemId1, solarSystemId2)}`;
}
export function isSameGalaxyDataConnection(connection, clusterId1, clusterId2, jumpGateId1, jumpGateId2) {
    const forward = connection.clusterId1 === clusterId1 &&
        connection.clusterId2 === clusterId2 &&
        connection.jumpGate1.id === jumpGateId1 &&
        connection.jumpGate2.id === jumpGateId2;
    const reverse = connection.clusterId1 === clusterId2 &&
        connection.clusterId2 === clusterId1 &&
        connection.jumpGate1.id === jumpGateId2 &&
        connection.jumpGate2.id === jumpGateId1;
    return forward || reverse;
}
export function isGalaxyDataConnectionBetweenClusters(connection, clusterId1, clusterId2) {
    return ((connection.clusterId1 === clusterId1 &&
        connection.clusterId2 === clusterId2) ||
        (connection.clusterId1 === clusterId2 &&
            connection.clusterId2 === clusterId1));
}
export function isGalaxyDataConnectionTouchingCluster(connection, clusterId) {
    return connection.clusterId1 === clusterId || connection.clusterId2 === clusterId;
}
export function isGalaxyDataConnectionTouchingSolarSystem(connection, clusterId, solarSystemId) {
    return ((connection.clusterId1 === clusterId &&
        connection.jumpGate1.id === solarSystemId) ||
        (connection.clusterId2 === clusterId &&
            connection.jumpGate2.id === solarSystemId));
}
export function canUseGalaxyDataJumpGateForClusterConnection(gate, connectedClusterId) {
    return (gate.isJumpGate &&
        (gate.connectedToClusterId === null ||
            gate.connectedToClusterId === connectedClusterId));
}
export function canConnectGalaxyDataClusters(data, clusterId1, clusterId2, jumpGateId1, jumpGateId2) {
    if (clusterId1 === clusterId2)
        return false;
    const cluster1 = data.clusters[clusterId1];
    const cluster2 = data.clusters[clusterId2];
    if (!cluster1 || !cluster2)
        return false;
    const jumpGate1 = findGalaxyDataSolarSystemInCluster(cluster1, jumpGateId1);
    const jumpGate2 = findGalaxyDataSolarSystemInCluster(cluster2, jumpGateId2);
    if (!jumpGate1 || !jumpGate2)
        return false;
    return (canUseGalaxyDataJumpGateForClusterConnection(jumpGate1, clusterId2) &&
        canUseGalaxyDataJumpGateForClusterConnection(jumpGate2, clusterId1));
}
export function isValidGalaxyDataClusterConnection(data, connection) {
    return canConnectGalaxyDataClusters(data, connection.clusterId1, connection.clusterId2, connection.jumpGate1.id, connection.jumpGate2.id);
}
export function pruneInvalidGalaxyDataClusterConnections(data, shouldCheckConnection = () => true) {
    const previousConnectionCount = data.connections.length;
    data.connections = data.connections.filter((connection) => !shouldCheckConnection(connection) ||
        isValidGalaxyDataClusterConnection(data, connection));
    return previousConnectionCount - data.connections.length;
}
export function addGalaxyDataClusterConnection(data, clusterId1, clusterId2, jumpGateId1, jumpGateId2) {
    if (!canConnectGalaxyDataClusters(data, clusterId1, clusterId2, jumpGateId1, jumpGateId2)) {
        return false;
    }
    const exists = data.connections.some((connection) => isSameGalaxyDataConnection(connection, clusterId1, clusterId2, jumpGateId1, jumpGateId2));
    if (!exists) {
        data.connections.push({
            clusterId1,
            clusterId2,
            jumpGate1: { id: jumpGateId1 },
            jumpGate2: { id: jumpGateId2 },
        });
    }
    addGalaxyDataConnectedClusterPair(data.clusters, clusterId1, clusterId2);
    return !exists;
}
export function removeGalaxyDataConnectionsTouchingCluster(data, clusterId) {
    return removeGalaxyDataClusterConnectionsWhere(data, (connection) => isGalaxyDataConnectionTouchingCluster(connection, clusterId));
}
export function removeGalaxyDataConnectionsTouchingSolarSystem(data, clusterId, solarSystemId) {
    return removeGalaxyDataClusterConnectionsWhere(data, (connection) => isGalaxyDataConnectionTouchingSolarSystem(connection, clusterId, solarSystemId));
}
export function removeGalaxyDataConnectionsBetweenClusters(data, clusterId1, clusterId2, jumpGateId1 = null, jumpGateId2 = null) {
    return removeGalaxyDataClusterConnectionsWhere(data, (connection) => {
        if (!isGalaxyDataConnectionBetweenClusters(connection, clusterId1, clusterId2)) {
            return false;
        }
        if (jumpGateId1 === null || jumpGateId2 === null) {
            return true;
        }
        return isSameGalaxyDataConnection(connection, clusterId1, clusterId2, jumpGateId1, jumpGateId2);
    });
}
export function addGalaxyDataConnectedClusterPair(clusters, clusterId1, clusterId2) {
    if (clusterId1 === clusterId2)
        return false;
    const cluster1 = clusters[clusterId1];
    const cluster2 = clusters[clusterId2];
    if (!cluster1 || !cluster2)
        return false;
    const changed1 = addUniqueClusterId(cluster1.connectedTo, clusterId2);
    const changed2 = addUniqueClusterId(cluster2.connectedTo, clusterId1);
    return changed1 || changed2;
}
export function rebuildGalaxyDataConnectedClusters(data) {
    for (const cluster of Object.values(data.clusters)) {
        cluster.connectedTo = [];
    }
    for (const connection of data.connections) {
        addGalaxyDataConnectedClusterPair(data.clusters, connection.clusterId1, connection.clusterId2);
    }
}
export function addGalaxyDataSolarSystemConnection(cluster, solarSystemId1, solarSystemId2) {
    if (solarSystemId1 === solarSystemId2)
        return false;
    const solarSystem1 = findGalaxyDataSolarSystemInCluster(cluster, solarSystemId1);
    const solarSystem2 = findGalaxyDataSolarSystemInCluster(cluster, solarSystemId2);
    if (!solarSystem1 || !solarSystem2)
        return false;
    const changed1 = addUniqueSolarSystemId(solarSystem1.connections, solarSystem2.id);
    const changed2 = addUniqueSolarSystemId(solarSystem2.connections, solarSystem1.id);
    return changed1 || changed2;
}
export function addGalaxyDataLocalSolarSystemConnection(data, clusterId, solarSystemId1, solarSystemId2) {
    const cluster = data.clusters[clusterId];
    if (!cluster)
        return false;
    return addGalaxyDataSolarSystemConnection(cluster, solarSystemId1, solarSystemId2);
}
export function normalizeGalaxyDataClusterSolarSystemConnections(cluster) {
    const systemsById = new Map();
    const systemOrder = [];
    const requestedConnectionsById = new Map();
    for (const system of cluster.solarSystems) {
        const requestedConnections = system.connections.slice();
        system.connections = [];
        if (!systemsById.has(system.id)) {
            systemOrder.push(system.id);
        }
        systemsById.set(system.id, system);
        requestedConnectionsById.set(system.id, requestedConnections);
    }
    cluster.solarSystems = systemOrder
        .map((systemId) => systemsById.get(systemId))
        .filter((system) => Boolean(system));
    for (const system of cluster.solarSystems) {
        const requestedConnections = requestedConnectionsById.get(system.id) ?? [];
        for (const connectedId of requestedConnections) {
            addGalaxyDataSolarSystemConnection(cluster, system.id, connectedId);
        }
    }
}
export function removeGalaxyDataSolarSystemReferences(cluster, solarSystemId) {
    let removed = 0;
    for (const system of cluster.solarSystems) {
        const previousLength = system.connections.length;
        system.connections = system.connections.filter((id) => id !== solarSystemId);
        removed += previousLength - system.connections.length;
    }
    return removed;
}
function removeGalaxyDataClusterConnectionsWhere(data, shouldRemoveConnection) {
    const previousConnectionCount = data.connections.length;
    data.connections = data.connections.filter((connection) => !shouldRemoveConnection(connection));
    return previousConnectionCount - data.connections.length;
}
function addUniqueClusterId(items, item) {
    if (items.includes(item)) {
        return false;
    }
    items.push(item);
    return true;
}
function addUniqueSolarSystemId(items, item) {
    if (items.includes(item)) {
        return false;
    }
    items.push(item);
    return true;
}
function findGalaxyDataSolarSystemInCluster(cluster, solarSystemId) {
    return cluster.solarSystems.find((system) => system.id === solarSystemId) ?? null;
}
//# sourceMappingURL=galaxy-data-connections.js.map