export function findClusterInGalaxyData(worldData, clusterId) {
    return worldData.clusters[clusterId] ?? null;
}
export function findSolarSystemInClusterData(cluster, solarSystemId) {
    return cluster.solarSystems.find((sys) => sys.id === solarSystemId) ?? null;
}
export function findSolarSystemInGalaxyData(worldData, clusterId, solarSystemId) {
    const cluster = findClusterInGalaxyData(worldData, clusterId);
    return cluster
        ? findSolarSystemInClusterData(cluster, solarSystemId)
        : null;
}
export function findNearestClusterInGalaxyData(worldData, point, maxDistance = Infinity) {
    let bestClusterId = null;
    let bestDistanceSq = Infinity;
    const maxDistanceSq = maxDistance * maxDistance;
    for (const clusterId of worldData.clusterOrder) {
        const cluster = worldData.clusters[clusterId];
        if (!cluster)
            continue;
        const dx = cluster.position.x - point.x;
        const dz = cluster.position.z - point.z;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq < bestDistanceSq) {
            bestDistanceSq = distanceSq;
            bestClusterId = cluster.id;
        }
    }
    if (bestClusterId === null || bestDistanceSq > maxDistanceSq) {
        return null;
    }
    return {
        clusterId: bestClusterId,
        distance: Math.sqrt(bestDistanceSq),
    };
}
export function findClusterConnectionsInGalaxyData(worldData, clusterId) {
    return worldData.connections.filter((conn) => conn.clusterId1 === clusterId || conn.clusterId2 === clusterId);
}
export function getOtherClusterIdForGalaxyDataConnection(connection, clusterId) {
    if (connection.clusterId1 === clusterId)
        return connection.clusterId2;
    if (connection.clusterId2 === clusterId)
        return connection.clusterId1;
    return null;
}
export function getConnectedClusterIdsFromGalaxyData(worldData, clusterId) {
    const neighborIds = new Set();
    for (const conn of findClusterConnectionsInGalaxyData(worldData, clusterId)) {
        const neighborId = getOtherClusterIdForGalaxyDataConnection(conn, clusterId);
        if (neighborId !== null) {
            neighborIds.add(neighborId);
        }
    }
    return Array.from(neighborIds).sort((a, b) => a - b);
}
//# sourceMappingURL=galaxy-data-query.js.map