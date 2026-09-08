import { hasClusterEdge, hasClusterEdgeEndpoints } from './fleet-graph.js';
/** A synchronous bulk snapshot. Discard before yielding or calling external code. */
export function createFleetRoutePlanner(world) {
    const ids = [...world.clusters.keys()];
    const indices = new Map(ids.map((id, i) => [id, i]));
    const offsets = new Uint32Array(ids.length + 1);
    const edges = [];
    const targets = [];
    for (let i = 0; i < ids.length; i++) {
        offsets[i] = edges.length;
        for (const edge of world.clusterEdges.get(ids[i]) ?? []) {
            if (!hasClusterEdgeEndpoints(world, edge))
                continue;
            edges.push(edge);
            targets.push(indices.get(edge.toClusterId));
        }
    }
    offsets[ids.length] = edges.length;
    const seen = new Uint32Array(ids.length);
    const parent = new Int32Array(ids.length);
    const queue = new Uint32Array(ids.length);
    let stamp = 0;
    const components = new Map();
    function path(startId, endId) {
        const start = indices.get(startId), end = indices.get(endId);
        if (start === undefined || end === undefined)
            return [];
        stamp = (stamp + 1) >>> 0;
        if (stamp === 0) {
            seen.fill(0);
            stamp = 1;
        }
        let tail = 1;
        queue[0] = start;
        seen[start] = stamp;
        for (let head = 0; head < tail && seen[end] !== stamp; head++) {
            const current = queue[head];
            for (let e = offsets[current]; e < offsets[current + 1]; e++) {
                const next = targets[e];
                if (seen[next] === stamp)
                    continue;
                seen[next] = stamp;
                parent[next] = e;
                queue[tail++] = next;
            }
        }
        if (seen[end] !== stamp)
            return [];
        const result = [];
        for (let cursor = end; cursor !== start;) {
            const edge = edges[parent[cursor]];
            result.push(edge);
            cursor = indices.get(edge.fromClusterId);
        }
        return result.reverse();
    }
    function connected(clusterId, a, b) {
        let labels = components.get(clusterId);
        if (!labels) {
            labels = labelSolarComponents(world, clusterId);
            components.set(clusterId, labels);
        }
        const label = labels.get(a);
        return label !== undefined && label === labels.get(b);
    }
    function valid(start, destination, route) {
        let current = start;
        for (const edge of route) {
            if (current.clusterId !== edge.fromClusterId || !hasClusterEdge(world, edge)
                || !connected(current.clusterId, current.solarSystemId, edge.fromGateId))
                return false;
            current = { clusterId: edge.toClusterId, solarSystemId: edge.toGateId };
        }
        return current.clusterId === destination.clusterId && connected(current.clusterId, current.solarSystemId, destination.solarSystemId);
    }
    return { path, valid };
}
function labelSolarComponents(world, clusterId) {
    const labels = new Map();
    const systems = world.clusters.get(clusterId)?.solarSystems;
    if (!systems)
        return labels;
    for (const id of systems.keys()) {
        if (labels.has(id))
            continue;
        const queue = [id];
        labels.set(id, id);
        for (let head = 0; head < queue.length; head++) {
            for (const next of systems.get(queue[head]).connections) {
                if (labels.has(next) || !systems.has(next))
                    continue;
                labels.set(next, id);
                queue.push(next);
            }
        }
    }
    return labels;
}
//# sourceMappingURL=fleet-route-planner.js.map