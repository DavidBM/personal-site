export function hasFleetNode(world, node) {
    return world.clusters.get(node.clusterId)?.solarSystems.has(node.solarSystemId) === true;
}
export function hasClusterEdge(world, edge) {
    if (!hasClusterEdgeEndpoints(world, edge))
        return false;
    return world.clusterEdges.get(edge.fromClusterId)?.some((candidate) => candidate.toClusterId === edge.toClusterId &&
        candidate.fromGateId === edge.fromGateId &&
        candidate.toGateId === edge.toGateId) === true;
}
/** Adjacency traversal already establishes membership; avoid scanning it again. */
export function hasClusterEdgeEndpoints(world, edge) {
    return world.clusters.get(edge.fromClusterId)?.solarSystems.has(edge.fromGateId) === true &&
        world.clusters.get(edge.toClusterId)?.solarSystems.has(edge.toGateId) === true;
}
/** Every authoritative hop must follow an edge that exists now. */
export function hasFleetHop(world, start, end) {
    if (!hasFleetNode(world, start) || !hasFleetNode(world, end))
        return false;
    if (start.clusterId !== end.clusterId) {
        return hasClusterEdge(world, {
            fromClusterId: start.clusterId, fromGateId: start.solarSystemId,
            toClusterId: end.clusterId, toGateId: end.solarSystemId,
        });
    }
    return world.clusters.get(start.clusterId)?.solarSystems.get(start.solarSystemId)
        ?.connections.has(end.solarSystemId) === true;
}
//# sourceMappingURL=fleet-graph.js.map