export function getFleetSolarPosition(graph, node) {
    const cluster = graph.clusters.get(node.clusterId);
    if (!cluster)
        return null;
    const sys = cluster.solarSystems.get(node.solarSystemId);
    return sys ? sys.position : null;
}
export function computeFleetJumpDuration(graph, start, end, { minJumpMs, speedUnitsPerSec }) {
    const startPos = getFleetSolarPosition(graph, start);
    const endPos = getFleetSolarPosition(graph, end);
    if (!startPos || !endPos)
        return minJumpMs;
    const dx = endPos.x - startPos.x;
    const dy = endPos.y - startPos.y;
    const dz = endPos.z - startPos.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const duration = (distance / speedUnitsPerSec) * 1000;
    return Math.max(minJumpMs, Math.round(duration));
}
export function findFleetClusterPath(graph, startId, endId) {
    if (startId === endId)
        return [];
    const queue = [startId];
    const visited = new Set([startId]);
    const parent = new Map();
    while (queue.length) {
        const current = queue.shift();
        if (current == null)
            break;
        if (current === endId)
            break;
        const edges = graph.clusterEdges.get(current) ?? [];
        for (const edge of edges) {
            if (visited.has(edge.toClusterId))
                continue;
            visited.add(edge.toClusterId);
            parent.set(edge.toClusterId, { prev: current, edge });
            queue.push(edge.toClusterId);
        }
    }
    if (!visited.has(endId))
        return [];
    const path = [];
    let cursor = endId;
    while (cursor !== startId) {
        const info = parent.get(cursor);
        if (!info)
            break;
        path.push(info.edge);
        cursor = info.prev;
    }
    return path.reverse();
}
export function findFleetSolarPath(graph, clusterId, startId, endId) {
    if (startId === endId)
        return [startId];
    const cluster = graph.clusters.get(clusterId);
    if (!cluster)
        return [startId, endId];
    const queue = [startId];
    const visited = new Set([startId]);
    const parent = new Map();
    while (queue.length) {
        const current = queue.shift();
        if (current == null)
            break;
        if (current === endId)
            break;
        const sys = cluster.solarSystems.get(current);
        if (!sys)
            continue;
        for (const neighbor of sys.connections) {
            if (visited.has(neighbor))
                continue;
            visited.add(neighbor);
            parent.set(neighbor, current);
            queue.push(neighbor);
        }
    }
    if (!visited.has(endId))
        return [startId, endId];
    const path = [endId];
    let cursor = endId;
    while (cursor !== startId) {
        const prev = parent.get(cursor);
        if (prev == null)
            break;
        path.push(prev);
        cursor = prev;
    }
    return path.reverse();
}
//# sourceMappingURL=fleet-path.js.map