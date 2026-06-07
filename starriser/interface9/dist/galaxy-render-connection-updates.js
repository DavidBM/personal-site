import { makeGalaxyRenderConnectionKey } from "./galaxy-render-buffers.js";
export const DEFAULT_SOLAR_SYSTEM_CONNECTION_COLOR = 0xffc700;
export const DEFAULT_CLUSTER_CONNECTION_COLOR = 0x00ffff;
export function makeGalaxyRenderSolarConnectionKey(clusterId, solarSystemId1, solarSystemId2) {
    return solarSystemId1 < solarSystemId2
        ? `${solarSystemId1}-${solarSystemId2}_${clusterId}`
        : `${solarSystemId2}-${solarSystemId1}_${clusterId}`;
}
export function buildSolarSystemConnectionLinePlan(cluster, solarSystemA, solarSystemB, color = DEFAULT_SOLAR_SYSTEM_CONNECTION_COLOR) {
    return {
        key: makeGalaxyRenderSolarConnectionKey(cluster.id, solarSystemA.id, solarSystemB.id),
        p1: solarSystemA.position,
        p2: solarSystemB.position,
        color,
    };
}
export function buildClusterConnectionLinePlan(cluster1, cluster2, jumpGate1, jumpGate2, color = DEFAULT_CLUSTER_CONNECTION_COLOR, makeConnectionKey = makeGalaxyRenderConnectionKey) {
    return {
        key: makeConnectionKey(cluster1, cluster2, jumpGate1, jumpGate2),
        p1: jumpGate1.position,
        p2: jumpGate2.position,
        color,
    };
}
export function collectSolarSystemConnectionEndpointUpdates(cluster) {
    const idToSystem = new Map();
    for (const system of cluster.solarSystems) {
        idToSystem.set(system.id, system);
    }
    const updates = [];
    for (const system of cluster.solarSystems) {
        if (!Array.isArray(system.connections))
            continue;
        for (const connectedId of system.connections) {
            if (connectedId <= system.id)
                continue;
            const other = idToSystem.get(connectedId);
            if (!other)
                continue;
            updates.push({
                key: makeGalaxyRenderSolarConnectionKey(cluster.id, system.id, other.id),
                p1: system.position,
                p2: other.position,
            });
        }
    }
    return updates;
}
export function collectClusterConnectionEndpointUpdates(connections, clusterId, makeConnectionKey = makeGalaxyRenderConnectionKey) {
    const updates = [];
    for (const connection of connections) {
        if (connection.cluster1.id !== clusterId &&
            connection.cluster2.id !== clusterId) {
            continue;
        }
        updates.push({
            key: makeConnectionKey(connection.cluster1, connection.cluster2, connection.jumpGate1, connection.jumpGate2),
            p1: connection.jumpGate1.position,
            p2: connection.jumpGate2.position,
        });
    }
    return updates;
}
export function removeClusterConnectionEndpointRecord(connections, cluster1, cluster2, jumpGate1, jumpGate2, makeConnectionKey = makeGalaxyRenderConnectionKey) {
    const key = makeConnectionKey(cluster1, cluster2, jumpGate1, jumpGate2);
    const nextConnections = [];
    let removed = false;
    for (const connection of connections) {
        const connectionKey = makeConnectionKey(connection.cluster1, connection.cluster2, connection.jumpGate1, connection.jumpGate2);
        if (connectionKey === key) {
            removed = true;
            continue;
        }
        nextConnections.push(connection);
    }
    return {
        key,
        removed,
        connections: nextConnections,
    };
}
//# sourceMappingURL=galaxy-render-connection-updates.js.map