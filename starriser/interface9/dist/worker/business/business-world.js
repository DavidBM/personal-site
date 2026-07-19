import { TwoDotFiveDSpatialIndex } from "./TwoDotFiveDSpatialIndex.js";
import { applyOps } from "../galaxy/apply-ops.js";
export function createBusinessWorld() {
    return {
        clusters: [],
        clusterIndex: new TwoDotFiveDSpatialIndex({
            getX: (c) => c.position.x,
            getZ: (c) => c.position.z,
            getYMin: (c) => c.position.y ?? 0,
            getYMax: (c) => c.position.y ?? 0,
            getId: (c) => c.id,
        }),
        lastConnections: [],
    };
}
export function addCluster(world, cluster) {
    if (!cluster)
        return;
    const position = cluster.position;
    const newCluster = {
        id: cluster.id,
        name: cluster.name,
        position: {
            x: position.x,
            y: position.y,
            z: position.z,
        },
        color: cluster.color,
        radius: cluster.radius,
    };
    world.clusters.push(newCluster);
    world.clusterIndex.insert(newCluster);
}
export function removeCluster(world, clusterId) {
    const idx = world.clusters.findIndex((c) => c.id === clusterId);
    if (idx !== -1) {
        world.clusters.splice(idx, 1);
        world.clusterIndex.remove(clusterId);
    }
}
export function applyBusinessOps(world, ops) {
    const result = {
        connectionsChanged: false,
        clustersChanged: false,
    };
    applyOps(ops, {
        addCluster: (payload) => {
            addCluster(world, payload);
            result.clustersChanged = true;
        },
        connectClusters: ({ clusterId1, clusterId2, jumpGate1, jumpGate2 }) => {
            const connection = {
                cluster1: { id: clusterId1 },
                cluster2: { id: clusterId2 },
                jumpGate1: { id: jumpGate1.id },
                jumpGate2: { id: jumpGate2.id },
            };
            world.lastConnections.push(connection);
            result.connectionsChanged = true;
        },
        removeConnection: ({ clusterId1, clusterId2, jumpGate1, jumpGate2 }) => {
            world.lastConnections = world.lastConnections.filter((conn) => {
                const matchesCluster1 = (conn.cluster1.id === clusterId1 &&
                    conn.cluster2.id === clusterId2) ||
                    (conn.cluster1.id === clusterId2 &&
                        conn.cluster2.id === clusterId1);
                const matchesGates = !jumpGate1 || !jumpGate2
                    ? true
                    : (conn.jumpGate1.id === jumpGate1.id &&
                        conn.jumpGate2.id === jumpGate2.id) ||
                        (conn.jumpGate1.id === jumpGate2.id &&
                            conn.jumpGate2.id === jumpGate1.id);
                return !(matchesCluster1 && matchesGates);
            });
            result.connectionsChanged = true;
        },
        removeCluster: ({ clusterId }) => {
            removeCluster(world, clusterId);
            world.lastConnections = world.lastConnections.filter((conn) => conn.cluster1.id !== clusterId && conn.cluster2.id !== clusterId);
            result.clustersChanged = true;
            result.connectionsChanged = true;
        },
    });
    return result;
}
export function clearBusinessWorld(world) {
    world.lastConnections.length = 0;
    world.clusters.length = 0;
    world.clusterIndex.clear();
}
export function hasCluster(world, clusterId) {
    return world.clusters.some((cluster) => cluster.id === clusterId);
}
//# sourceMappingURL=business-world.js.map