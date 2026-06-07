export function attachSolarSystemToClusterView(cluster, solarSystem) {
    const existing = findSolarSystemInClusterView(cluster, solarSystem.id);
    if (existing) {
        Object.assign(existing, solarSystem);
        return existing;
    }
    cluster.solarSystems.push(solarSystem);
    return solarSystem;
}
export function detachSolarSystemFromClusterView(cluster, solarSystem, options = {}) {
    const index = cluster.solarSystems.indexOf(solarSystem);
    if (index === -1)
        return false;
    cluster.solarSystems.splice(index, 1);
    if (options.dispose !== false) {
        solarSystem.dispose?.();
    }
    return true;
}
export function hasSolarSystemInClusterView(cluster, solarSystem) {
    return cluster.solarSystems.includes(solarSystem);
}
export function hasSolarSystemConnectionEndpointsInClusterView(cluster, solarSystemA, solarSystemB) {
    return (hasSolarSystemInClusterView(cluster, solarSystemA) &&
        hasSolarSystemInClusterView(cluster, solarSystemB));
}
export function findSolarSystemInClusterView(cluster, solarSystemId) {
    return cluster.solarSystems.find((sys) => sys.id === solarSystemId) ?? null;
}
export function connectSolarSystemViews(solarSystemA, solarSystemB) {
    const changedA = addUniqueConnection(solarSystemA.connections, solarSystemB.id);
    const changedB = addUniqueConnection(solarSystemB.connections, solarSystemA.id);
    return changedA || changedB;
}
export function disconnectSolarSystemViews(solarSystemA, solarSystemB) {
    const nextA = solarSystemA.connections.filter((id) => id !== solarSystemB.id);
    const nextB = solarSystemB.connections.filter((id) => id !== solarSystemA.id);
    const changed = nextA.length !== solarSystemA.connections.length ||
        nextB.length !== solarSystemB.connections.length;
    solarSystemA.connections = nextA;
    solarSystemB.connections = nextB;
    return changed;
}
export function makeClusterConnectionViewKey(cluster1, cluster2, jumpGate1, jumpGate2) {
    if (cluster1.id > cluster2.id ||
        (cluster1.id === cluster2.id && jumpGate1.id > jumpGate2.id)) {
        return `${cluster2.id}:${cluster1.id}:${jumpGate2.id}:${jumpGate1.id}`;
    }
    return `${cluster1.id}:${cluster2.id}:${jumpGate1.id}:${jumpGate2.id}`;
}
export function findClusterConnectionView(connections, connectionIdMap, cluster1, cluster2, jumpGate1, jumpGate2) {
    const key = makeClusterConnectionViewKey(cluster1, cluster2, jumpGate1, jumpGate2);
    const mappedConnection = connectionIdMap.get(key);
    if (mappedConnection)
        return mappedConnection;
    return (connections.find((conn) => makeClusterConnectionViewKey(conn.cluster1, conn.cluster2, conn.jumpGate1, conn.jumpGate2) === key) ?? null);
}
export function connectClusterViews(connections, connectionIdMap, cluster1, cluster2, jumpGate1, jumpGate2) {
    const key = makeClusterConnectionViewKey(cluster1, cluster2, jumpGate1, jumpGate2);
    const existing = findClusterConnectionView(connections, connectionIdMap, cluster1, cluster2, jumpGate1, jumpGate2);
    if (existing) {
        connectionIdMap.set(key, existing);
        return existing;
    }
    const connection = {
        cluster1,
        cluster2,
        jumpGate1,
        jumpGate2,
    };
    connections.push(connection);
    connectionIdMap.set(key, connection);
    return connection;
}
export function disconnectClusterViews(connections, connectionIdMap, cluster1, cluster2, jumpGate1, jumpGate2) {
    const key = makeClusterConnectionViewKey(cluster1, cluster2, jumpGate1, jumpGate2);
    const mappedConnection = connectionIdMap.get(key);
    const index = mappedConnection
        ? connections.indexOf(mappedConnection)
        : connections.findIndex((conn) => makeClusterConnectionViewKey(conn.cluster1, conn.cluster2, conn.jumpGate1, conn.jumpGate2) === key);
    if (index === -1)
        return null;
    const [connection] = connections.splice(index, 1);
    connectionIdMap.delete(key);
    return connection;
}
export function findClusterConnectionsBetweenClusterViews(connections, cluster1, cluster2) {
    return connections.filter((conn) => isClusterConnectionBetweenClusterViews(conn, cluster1, cluster2));
}
export function isClusterConnectionBetweenClusterViews(connection, cluster1, cluster2) {
    return ((connection.cluster1.id === cluster1.id &&
        connection.cluster2.id === cluster2.id) ||
        (connection.cluster1.id === cluster2.id &&
            connection.cluster2.id === cluster1.id));
}
export function findClusterConnectionsTouchingSolarSystemView(connections, cluster, solarSystem) {
    return connections.filter((conn) => isClusterConnectionTouchingSolarSystemView(conn, cluster, solarSystem));
}
export function isClusterConnectionTouchingSolarSystemView(connection, cluster, solarSystem) {
    return ((connection.cluster1.id === cluster.id &&
        connection.jumpGate1.id === solarSystem.id) ||
        (connection.cluster2.id === cluster.id &&
            connection.jumpGate2.id === solarSystem.id));
}
export function findClusterConnectionsTouchingClusterView(connections, cluster) {
    return connections.filter((conn) => conn.cluster1.id === cluster.id || conn.cluster2.id === cluster.id);
}
export function planSolarSystemRemovalFromClusterView(connections, cluster, solarSystem) {
    const clusterConnections = solarSystem.isJumpGate
        ? findClusterConnectionsTouchingSolarSystemView(connections, cluster, solarSystem)
        : [];
    const solarSystemConnections = [];
    const connectedIds = solarSystem.connections.slice();
    for (const connectedId of connectedIds) {
        const other = findSolarSystemInClusterView(cluster, connectedId);
        if (other) {
            solarSystemConnections.push(other);
        }
    }
    return { clusterConnections, solarSystemConnections };
}
export function planClusterRemovalFromClusterView(connections, cluster) {
    const clusterConnections = findClusterConnectionsTouchingClusterView(connections, cluster);
    const solarSystemConnections = [];
    const removedKeys = new Set();
    for (const solarSystem of cluster.solarSystems) {
        for (const connectedId of solarSystem.connections.slice()) {
            const other = findSolarSystemInClusterView(cluster, connectedId);
            if (!other)
                continue;
            const key = makeSolarSystemConnectionPairKey(solarSystem.id, other.id);
            if (removedKeys.has(key))
                continue;
            removedKeys.add(key);
            solarSystemConnections.push([solarSystem, other]);
        }
    }
    return { clusterConnections, solarSystemConnections };
}
function addUniqueConnection(connections, solarSystemId) {
    if (connections.includes(solarSystemId))
        return false;
    connections.push(solarSystemId);
    return true;
}
function makeSolarSystemConnectionPairKey(solarSystemId1, solarSystemId2) {
    return solarSystemId1 < solarSystemId2
        ? `${solarSystemId1}:${solarSystemId2}`
        : `${solarSystemId2}:${solarSystemId1}`;
}
//# sourceMappingURL=galaxy-view-graph.js.map