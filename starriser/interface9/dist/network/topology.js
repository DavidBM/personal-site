import { opaqueIdAt } from '../contracts/opaque-id.js';
import { check, id, present } from './validate-fields.js';
import { MAX_TOPOLOGY_CLUSTERS, MAX_TOPOLOGY_SYSTEMS, MAX_TOPOLOGY_CONNECTIONS } from './limits.js';
const utf8 = new TextEncoder();
function identifier(value) { id(value); return opaqueIdAt(value); }
function point(value) {
    const p = present(value, 'strategic position');
    check(Number.isFinite(p.x) && Number.isFinite(p.z), 'strategic position');
}
function unique(set, value) {
    const key = identifier(value);
    check(!set.has(key), 'duplicate topology identity');
    set.add(key);
    return key;
}
export function validateTopology(value) {
    id(value.worldId);
    check(value.revision > 0n, 'topology revision');
    check(value.clusters.length <= MAX_TOPOLOGY_CLUSTERS && value.systems.length <= MAX_TOPOLOGY_SYSTEMS && value.connections.length <= MAX_TOPOLOGY_CONNECTIONS, 'topology budget');
    const clusters = new Set();
    const systems = new Set();
    const edges = new Set();
    for (const cluster of value.clusters) {
        unique(clusters, cluster.clusterId);
        point(cluster.position);
        check(utf8.encode(cluster.name).length <= 64 && Number.isFinite(cluster.radius) && cluster.radius > 0, 'cluster metadata');
    }
    for (const system of value.systems) {
        unique(systems, system.systemId);
        point(system.position);
        check(clusters.has(identifier(system.clusterId)), 'missing topology cluster');
        check(utf8.encode(system.name).length <= 64, 'system name');
    }
    for (const edge of value.connections)
        validateEdge(edge.systemA, edge.systemB, systems, edges);
    const hosted = new Set();
    check(value.hostedSystemIds.length <= MAX_TOPOLOGY_SYSTEMS, 'hosted system budget');
    for (const system of value.hostedSystemIds)
        check(systems.has(unique(hosted, system)), 'hosted system outside visible topology');
}
function validateEdge(first, second, systems, edges) {
    const a = identifier(first);
    const b = identifier(second);
    check(a !== b && systems.has(a) && systems.has(b), 'invalid topology edge');
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    check(!edges.has(key), 'duplicate topology edge');
    edges.add(key);
}
/** Called after codec validation. Local observers clone this small projection,
 * not generated message objects or the render stream's transferred buffers. */
export function topologyView(value) {
    return {
        worldId: opaqueIdAt(value.worldId), revision: value.revision,
        hostedSystemIds: value.hostedSystemIds.map(identifier),
        clusters: value.clusters.map(c => ({ id: opaqueIdAt(c.clusterId), name: c.name, x: c.position.x, z: c.position.z, radius: c.radius })),
        systems: value.systems.map(s => ({ id: opaqueIdAt(s.systemId), clusterId: opaqueIdAt(s.clusterId), name: s.name, x: s.position.x, z: s.position.z })),
        connections: value.connections.map(c => ({ a: opaqueIdAt(c.systemA), b: opaqueIdAt(c.systemB) })),
    };
}
//# sourceMappingURL=topology.js.map