import { applyOps } from "../galaxy/apply-ops.js";
export function createFleetWorld() {
    return {
        clusters: new Map(),
        clusterIds: [],
        clusterEdges: new Map(),
        fleets: new Map(),
        fleetCounter: 1,
    };
}
export function ensureCluster(world, clusterId) {
    let cluster = world.clusters.get(clusterId);
    if (!cluster) {
        cluster = {
            id: clusterId,
            solarSystems: new Map(),
            solarSystemIds: [],
        };
        world.clusters.set(clusterId, cluster);
        world.clusterIds.push(clusterId);
    }
    if (!world.clusterEdges.has(clusterId)) {
        world.clusterEdges.set(clusterId, []);
    }
    return cluster;
}
export function removeCluster(world, clusterId) {
    world.clusters.delete(clusterId);
    const idx = world.clusterIds.indexOf(clusterId);
    if (idx >= 0)
        world.clusterIds.splice(idx, 1);
    world.clusterEdges.delete(clusterId);
    for (const edges of world.clusterEdges.values()) {
        for (let i = edges.length - 1; i >= 0; i--) {
            if (edges[i].toClusterId === clusterId) {
                edges.splice(i, 1);
            }
        }
    }
}
export function addSolarSystem(world, clusterId, system) {
    const cluster = ensureCluster(world, clusterId);
    const existing = cluster.solarSystems.get(system.id);
    if (existing) {
        existing.position = system.position;
        existing.isJumpGate = system.isJumpGate ?? existing.isJumpGate;
        return;
    }
    const entry = {
        id: system.id,
        position: system.position,
        connections: new Set(),
        isJumpGate: system.isJumpGate ?? false,
    };
    cluster.solarSystems.set(system.id, entry);
    cluster.solarSystemIds.push(system.id);
}
export function removeSolarSystem(world, clusterId, solarSystemId) {
    const cluster = world.clusters.get(clusterId);
    if (!cluster)
        return;
    cluster.solarSystems.delete(solarSystemId);
    const idx = cluster.solarSystemIds.indexOf(solarSystemId);
    if (idx >= 0)
        cluster.solarSystemIds.splice(idx, 1);
    for (const sys of cluster.solarSystems.values()) {
        sys.connections.delete(solarSystemId);
    }
}
export function connectSolarSystems(world, clusterId, solarSystemId1, solarSystemId2) {
    const cluster = world.clusters.get(clusterId);
    if (!cluster)
        return;
    const sys1 = cluster.solarSystems.get(solarSystemId1);
    const sys2 = cluster.solarSystems.get(solarSystemId2);
    if (!sys1 || !sys2)
        return;
    sys1.connections.add(solarSystemId2);
    sys2.connections.add(solarSystemId1);
}
export function connectClusters(world, edge) {
    ensureCluster(world, edge.fromClusterId);
    ensureCluster(world, edge.toClusterId);
    const edgesFrom = world.clusterEdges.get(edge.fromClusterId);
    const edgesTo = world.clusterEdges.get(edge.toClusterId);
    if (edgesFrom)
        edgesFrom.push(edge);
    if (edgesTo) {
        edgesTo.push({
            fromClusterId: edge.toClusterId,
            toClusterId: edge.fromClusterId,
            fromGateId: edge.toGateId,
            toGateId: edge.fromGateId,
        });
    }
}
export function removeClusterConnection(world, clusterId1, clusterId2, gate1, gate2) {
    removeDirectedEdge(world, clusterId1, clusterId2, gate1, gate2);
    removeDirectedEdge(world, clusterId2, clusterId1, gate2, gate1);
}
export function applyFleetOps(world, ops) {
    applyOps(ops, {
        addCluster: (payload) => {
            ensureCluster(world, payload.id);
        },
        removeCluster: ({ clusterId }) => {
            removeCluster(world, clusterId);
        },
        addSolarSystem: (payload) => {
            addSolarSystem(world, payload.clusterId, {
                id: payload.id,
                position: payload.position,
                isJumpGate: payload.isJumpGate,
            });
        },
        removeSolarSystem: ({ clusterId, solarSystemId }) => {
            removeSolarSystem(world, clusterId, solarSystemId);
        },
        connectSolarSystems: ({ clusterId, solarSystemId1, solarSystemId2 }) => {
            connectSolarSystems(world, clusterId, solarSystemId1, solarSystemId2);
        },
        connectClusters: ({ clusterId1, clusterId2, jumpGate1, jumpGate2 }) => {
            connectClusters(world, {
                fromClusterId: clusterId1,
                toClusterId: clusterId2,
                fromGateId: jumpGate1.id,
                toGateId: jumpGate2.id,
            });
        },
        removeConnection: ({ clusterId1, clusterId2, jumpGate1, jumpGate2 }) => {
            removeClusterConnection(world, clusterId1, clusterId2, jumpGate1?.id, jumpGate2?.id);
        },
    });
}
export function clearFleetWorld(world) {
    world.clusters.clear();
    world.clusterIds.length = 0;
    world.clusterEdges.clear();
    world.fleets.clear();
}
export function removeInvalidFleets(world) {
    const removed = [];
    for (const fleet of world.fleets.values()) {
        if (isFleetValid(world, fleet))
            continue;
        world.fleets.delete(fleet.id);
        removed.push(fleet.id);
    }
    return removed;
}
export function getSolarPosition(world, node) {
    const cluster = world.clusters.get(node.clusterId);
    if (!cluster)
        return null;
    const sys = cluster.solarSystems.get(node.solarSystemId);
    return sys ? sys.position : null;
}
export function nextFleetId(world) {
    return `fleet_${world.fleetCounter++}`;
}
function removeDirectedEdge(world, fromId, toId, fromGate, toGate) {
    const edges = world.clusterEdges.get(fromId);
    if (!edges)
        return;
    for (let i = edges.length - 1; i >= 0; i--) {
        const edge = edges[i];
        if (edge.toClusterId !== toId)
            continue;
        if (typeof fromGate === "number" &&
            typeof toGate === "number" &&
            !(edge.fromGateId === fromGate && edge.toGateId === toGate)) {
            continue;
        }
        edges.splice(i, 1);
    }
}
function isFleetValid(world, fleet) {
    if (!hasNode(world, fleet.currentNode))
        return false;
    if (!hasNode(world, fleet.destination))
        return false;
    if (fleet.state.state === "jumping") {
        if (!hasNode(world, fleet.state.startNode))
            return false;
        if (!hasNode(world, fleet.state.endNode))
            return false;
    }
    else if (!hasNode(world, fleet.state.node)) {
        return false;
    }
    if (fleet.intraPath) {
        const cluster = world.clusters.get(fleet.currentNode.clusterId);
        if (!cluster)
            return false;
        for (const solarSystemId of fleet.intraPath) {
            if (!cluster.solarSystems.has(solarSystemId))
                return false;
        }
    }
    for (const edge of fleet.pendingEdges) {
        if (!hasClusterGate(world, edge.fromClusterId, edge.fromGateId)) {
            return false;
        }
        if (!hasClusterGate(world, edge.toClusterId, edge.toGateId)) {
            return false;
        }
    }
    return true;
}
function hasNode(world, node) {
    return hasClusterGate(world, node.clusterId, node.solarSystemId);
}
function hasClusterGate(world, clusterId, solarSystemId) {
    return (world.clusters.get(clusterId)?.solarSystems.has(solarSystemId) === true);
}
//# sourceMappingURL=fleet-world.js.map