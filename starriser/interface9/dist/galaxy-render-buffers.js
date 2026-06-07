import { makeGalaxyDataConnectionKeyFromIds } from "./galaxy-data-connections.js";
export function makeGalaxyRenderConnectionKey(cluster1, cluster2, jumpGate1, jumpGate2) {
    return makeGalaxyDataConnectionKeyFromIds(cluster1.id, cluster2.id, jumpGate1.id, jumpGate2.id);
}
export function makeGalaxyRenderSolarSystemKey(clusterId, solarSystemId) {
    return `${clusterId}:${solarSystemId}`;
}
export function buildGalaxyRenderBufferPlan(source, writeColor, makeConnectionKey = makeGalaxyRenderConnectionKey) {
    const solarSystemCount = countSolarSystems(source.clusters);
    const solarSystemPositions = new Float32Array(solarSystemCount * 3);
    const solarSystemColors = new Float32Array(solarSystemCount * 3);
    const solarSystemVisibility = new Uint8Array(solarSystemCount);
    const solarSystemKeyToIndex = new Map();
    writeSolarSystemBuffers(source.clusters, writeColor, solarSystemPositions, solarSystemColors, solarSystemVisibility, solarSystemKeyToIndex);
    const validConnections = source.connections.filter(isRenderableConnection);
    const connectionCount = validConnections.length;
    const connectionPositions = new Float32Array(connectionCount * 2 * 3);
    const connectionColors = new Float32Array(connectionCount * 2 * 3);
    const connectionIdToBufferIndex = new Map();
    writeConnectionBuffers(validConnections, writeColor, makeConnectionKey, connectionPositions, connectionColors, connectionIdToBufferIndex);
    return {
        solarSystemPositions,
        solarSystemColors,
        solarSystemVisibility,
        solarSystemCount,
        solarSystemKeyToIndex,
        connectionPositions,
        connectionColors,
        connectionCount,
        connectionIdToBufferIndex,
    };
}
export function buildGalaxyRenderBufferSourceFromGalaxyData(data) {
    const clusters = [];
    for (const clusterId of data.clusterOrder) {
        const cluster = data.clusters[clusterId];
        if (cluster)
            clusters.push(cluster);
    }
    const connections = [];
    for (const connection of data.connections) {
        const cluster1 = data.clusters[connection.clusterId1] ?? null;
        const cluster2 = data.clusters[connection.clusterId2] ?? null;
        connections.push({
            cluster1,
            cluster2,
            jumpGate1: cluster1
                ? findSolarSystemForRenderBuffer(cluster1, connection.jumpGate1.id)
                : null,
            jumpGate2: cluster2
                ? findSolarSystemForRenderBuffer(cluster2, connection.jumpGate2.id)
                : null,
        });
    }
    return { clusters, connections };
}
function countSolarSystems(clusters) {
    let count = 0;
    for (const cluster of clusters) {
        count += cluster.solarSystems.length;
    }
    return count;
}
function findSolarSystemForRenderBuffer(cluster, solarSystemId) {
    return (cluster.solarSystems.find((solarSystem) => solarSystem.id === solarSystemId) ??
        null);
}
function writeSolarSystemBuffers(clusters, writeColor, positions, colors, visibility, solarSystemKeyToIndex) {
    let index = 0;
    for (const cluster of clusters) {
        for (const solarSystem of cluster.solarSystems) {
            const position = solarSystem.position;
            if (position) {
                positions[index * 3 + 0] = position.x;
                positions[index * 3 + 1] = position.y;
                positions[index * 3 + 2] = position.z;
            }
            writeColor(colors, index * 3, solarSystem.isJumpGate ? 0x00ffff : cluster.color || 0xffffff);
            visibility[index] = 1;
            solarSystemKeyToIndex.set(makeGalaxyRenderSolarSystemKey(cluster.id, solarSystem.id), index);
            index++;
        }
    }
}
function isRenderableConnection(connection) {
    return Boolean(connection.cluster1 &&
        connection.cluster2 &&
        connection.jumpGate1?.position &&
        connection.jumpGate2?.position);
}
function writeConnectionBuffers(connections, writeColor, makeConnectionKey, positions, colors, connectionIdToBufferIndex) {
    for (let index = 0; index < connections.length; index++) {
        const connection = connections[index];
        const position1 = connection.jumpGate1.position;
        const position2 = connection.jumpGate2.position;
        const offset = index * 6;
        positions[offset + 0] = position1.x;
        positions[offset + 1] = position1.y;
        positions[offset + 2] = position1.z;
        positions[offset + 3] = position2.x;
        positions[offset + 4] = position2.y;
        positions[offset + 5] = position2.z;
        writeColor(colors, offset, 0x00ffff);
        writeColor(colors, offset + 3, 0x00ffff);
        connectionIdToBufferIndex.set(makeConnectionKey(connection.cluster1, connection.cluster2, connection.jumpGate1, connection.jumpGate2), index);
    }
}
//# sourceMappingURL=galaxy-render-buffers.js.map