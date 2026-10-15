import { copyRow } from './copy.js';
import { opaqueIdAt } from '../../contracts/opaque-id.js';
export function createViewOverview(world, connection) {
    let topology, generation = 0n, sequence = 0n;
    const summaries = new Map(), nodes = new Map();
    let interests = [];
    function install(value) {
        const { clusters, systems, edges } = topologyRows(value);
        installNodes(clusters, systems, edges, nodes);
        topology = { worldId: world, revision: value.topologyRevision, hostedSystemIds: systems.map(row => opaqueIdAt(row.systemId)),
            clusters: clusters.map(row => ({ id: opaqueIdAt(row.clusterId), name: row.name, x: row.position.x, z: row.position.z, radius: row.radius })),
            systems: systems.map(row => ({ id: opaqueIdAt(row.systemId), clusterId: opaqueIdAt(row.clusterId), name: row.name, x: row.position.x, z: row.position.z })),
            connections: edges.map(row => ({ a: opaqueIdAt(row.systemA), b: opaqueIdAt(row.systemB) })) };
        summaries.clear();
        for (const row of value.rows.tables.get('summaries')?.values() ?? [])
            if (row.$typeName === 'galaxy.v1.OverviewSystem')
                summaries.set(opaqueIdAt(row.systemId), row);
        generation = value.requestGeneration;
        sequence = value.sequence;
        return topology;
    }
    function delta(rows, next) {
        for (const id of rows.removedSystemIds)
            summaries.delete(opaqueIdAt(id));
        for (const row of rows.summaries)
            summaries.set(opaqueIdAt(row.systemId), copyRow(row));
        sequence = next;
        return !!(rows.clusters.length + rows.systems.length + rows.connections.length + rows.removedClusterIds.length + rows.removedSystemIds.length + rows.removedConnections.length);
    }
    function snapshot() {
        const systems = [];
        for (const id of interests) {
            const row = summaries.get(id), o = row?.observation, s = o?.scope;
            if (!row || !o || !s)
                continue;
            systems.push({ scope: { worldId: opaqueIdAt(s.worldId), shardId: opaqueIdAt(s.shardId), systemId: id, ownerEpoch: s.ownerEpoch, recoveryGeneration: s.recoveryGeneration },
                counts: o.availability === 1 ? { systemRevision: o.revision, committedServerTimeMs: o.committedServerMs, presentFleets: row.presentFleets, movingFleets: row.movingFleets } : undefined });
        }
        return { ...frontier(), status: topology ? 'view' : 'unavailable', systems };
    }
    function frontier() { return { connectionGeneration: connection, interestGeneration: generation, sequence }; }
    return { install, delta, snapshot, frontier, node: (id) => nodes.get(id), first: () => topology?.systems[0]?.id,
        interest(ids, request) { if (ids.length > 32)
            throw new Error('Aggregate page limit'); interests = [...ids]; generation = request; },
        installHandles(rows) {
            validateHandleCount(rows, topology?.systems.length);
            const expected = new Map(topology.systems.map(row => [row.id, row.clusterId]));
            const next = new Map(), systems = new Set(), clusters = new Map();
            for (const row of rows) {
                if (next.has(row.systemId) || expected.get(row.systemId) !== row.clusterId)
                    throw new Error('Unknown topology handle identity');
                const node = row.node;
                validateNodeHandle(node, systems);
                if (clusters.has(row.clusterId) && clusters.get(row.clusterId) !== node.clusterId)
                    throw new Error('Inconsistent cluster handle');
                clusters.set(row.clusterId, node.clusterId);
                systems.add(node.solarSystemId);
                next.set(row.systemId, { ...node });
            }
            if (new Set(clusters.values()).size !== clusters.size)
                throw new Error('Duplicate cluster handle');
            nodes.clear();
            for (const [id, node] of next)
                nodes.set(id, node);
        },
        clear() { topology = undefined; nodes.clear(); summaries.clear(); } };
}
function topologyRows(value) {
    const table = value.rows.tables;
    return { clusters: [...(table.get('clusters')?.values() ?? [])].filter(row => row.$typeName === 'galaxy.v1.TopologyCluster'),
        systems: [...(table.get('systems')?.values() ?? [])].filter(row => row.$typeName === 'galaxy.v1.TopologySystem'),
        edges: [...(table.get('connections')?.values() ?? [])].filter(row => row.$typeName === 'galaxy.v1.TopologyConnection') };
}
function installNodes(clusters, systems, edges, nodes) {
    const clusterIds = new Map(clusters.map((row, index) => [opaqueIdAt(row.clusterId), index + 1]));
    nodes.clear();
    for (const [index, row] of systems.entries()) {
        const clusterId = clusterIds.get(opaqueIdAt(row.clusterId));
        if (!clusterId)
            throw new Error('View topology cluster missing');
        nodes.set(opaqueIdAt(row.systemId), { clusterId, solarSystemId: index + 1 });
    }
    for (const edge of edges)
        if (!nodes.has(opaqueIdAt(edge.systemA)) || !nodes.has(opaqueIdAt(edge.systemB)))
            throw new Error('View topology edge missing');
}
function validHandle(id) { return Number.isSafeInteger(id) && id > 0 && id <= 0xffffff; }
function validateNodeHandle(node, systems) {
    if (!validHandle(node.clusterId) || !validHandle(node.solarSystemId) || systems.has(node.solarSystemId))
        throw new Error('Invalid topology handle');
}
function validateHandleCount(rows, expected) {
    if (!Array.isArray(rows) || rows.length !== expected)
        throw new Error('Incomplete topology handle acknowledgement');
}
//# sourceMappingURL=overview.js.map