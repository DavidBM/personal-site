/** Local numeric handles belong to this complete topology projection. UUIDs stay
 * intact in the lookup; no truncation or GPU index is used as domain identity. */
export function createOnlineTopology(view) {
    const clusters = new Map();
    const nodes = new Map();
    for (const [index, item] of view.clusters.entries())
        clusters.set(item.id, {
            id: index + 1, name: item.name, position: { x: item.x, y: 0, z: item.z }, radius: item.radius,
            color: 0x609bd5, maxSystemDistance: item.radius, connectedTo: [], solarSystems: [],
        });
    for (const [index, item] of view.systems.entries()) {
        const cluster = clusters.get(item.clusterId);
        if (!cluster)
            throw new Error('Strategic projection references missing cluster');
        const id = index + 1;
        cluster.solarSystems.push({ id, name: item.name, position: { x: item.x, y: 0, z: item.z } });
        nodes.set(item.id, { clusterId: cluster.id, solarSystemId: id });
    }
    const ops = [];
    for (const cluster of clusters.values()) {
        const { solarSystems, ...metadata } = cluster;
        ops.push({ type: 'addCluster', payload: { ...metadata, solarSystems: [] } });
        for (const system of solarSystems)
            ops.push({ type: 'addSolarSystem', payload: { ...system, clusterId: cluster.id } });
    }
    for (const edge of view.connections)
        ops.push(connection(nodes, edge.a, edge.b));
    return { worldId: view.worldId, revision: view.revision, ops,
        node(id) {
            const node = nodes.get(id);
            if (!node)
                throw new Error('System is outside strategic projection');
            return { ...node };
        } };
}
function connection(nodes, first, second) {
    const a = nodes.get(first);
    const b = nodes.get(second);
    if (!a || !b)
        throw new Error('Strategic connection references missing system');
    return a.clusterId === b.clusterId
        ? { type: 'connectSolarSystems', payload: { clusterId: a.clusterId, solarSystemId1: a.solarSystemId, solarSystemId2: b.solarSystemId } }
        : { type: 'connectClusters', payload: { clusterId1: a.clusterId, clusterId2: b.clusterId,
                jumpGate1: { id: a.solarSystemId }, jumpGate2: { id: b.solarSystemId } } };
}
//# sourceMappingURL=online-topology.js.map