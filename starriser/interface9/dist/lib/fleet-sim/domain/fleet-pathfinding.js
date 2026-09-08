import { distZX } from "../../../math/galaxy-xz-math.js";
import { getSolarPosition } from "./fleet-world.js";
import { hasClusterEdge, hasClusterEdgeEndpoints, hasFleetHop, hasFleetNode } from "./fleet-graph.js";
/**
 * Domain hop duration (ms). Product: 15 s per jump so strategic travel is
 * readable; visual fleet ease uses the same durationMs from the worker.
 */
export const JUMP_DURATION_MS = 15000;
/**
 * @deprecated Prefer {@link JUMP_DURATION_MS}. Kept as the same 15s floor for
 * import stability / older call sites that treated this as a minimum.
 */
export const MIN_JUMP_MS = JUMP_DURATION_MS;
/**
 * Legacy distance→time scale (unused for domain hops now that duration is fixed).
 * Match ship-motion SHIP_MAX_SPEED for docs / tools.
 */
export const SPEED_UNITS_PER_SEC = 12000;
export function computeJumpDuration(world, start, end) {
    // Fixed product hop clock — still validate endpoints exist.
    const startPos = getSolarPosition(world, start);
    const endPos = getSolarPosition(world, end);
    if (!startPos || !endPos)
        return JUMP_DURATION_MS;
    void distZX(startPos, endPos); // keep import / distance path exercised
    return JUMP_DURATION_MS;
}
export function findClusterPath(world, startId, endId) {
    if (startId === endId)
        return [];
    const queue = [startId];
    const visited = new Set([startId]);
    const parent = new Map();
    for (let head = 0; head < queue.length; head++) {
        const current = queue[head];
        if (current === endId)
            break;
        const edges = world.clusterEdges.get(current) ?? [];
        for (const edge of edges) {
            if (visited.has(edge.toClusterId) || !hasClusterEdgeEndpoints(world, edge))
                continue;
            visited.add(edge.toClusterId);
            parent.set(edge.toClusterId, { prev: current, edge });
            queue.push(edge.toClusterId);
        }
    }
    if (!visited.has(endId))
        return [];
    return traceClusterPath(parent, startId, endId);
}
function traceClusterPath(parent, startId, endId) {
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
export function findSolarPath(world, clusterId, startId, endId) {
    const cluster = world.clusters.get(clusterId);
    if (!cluster?.solarSystems.has(startId) || !cluster.solarSystems.has(endId))
        return [];
    const queue = [startId];
    const visited = new Set([startId]);
    const parent = new Map();
    for (let head = 0; head < queue.length; head++) {
        const current = queue[head];
        if (current === endId)
            break;
        const sys = cluster.solarSystems.get(current);
        for (const neighbor of sys.connections) {
            if (visited.has(neighbor) || !cluster.solarSystems.has(neighbor))
                continue;
            visited.add(neighbor);
            parent.set(neighbor, current);
            queue.push(neighbor);
        }
    }
    if (!visited.has(endId))
        return [];
    return traceSolarPath(parent, startId, endId);
}
function traceSolarPath(parent, startId, endId) {
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
export function getNextNode(world, fleet) {
    const current = fleet.currentNode;
    if (!hasFleetNode(world, current) || !hasFleetNode(world, fleet.destination))
        return null;
    if (fleet.intraPath) {
        if (fleet.intraIndex < fleet.intraPath.length) {
            return takeCachedIntraHop(world, fleet);
        }
        fleet.intraPath = null;
    }
    if (fleet.pendingEdges.length > 0)
        return nextGateHop(world, fleet);
    if (current.clusterId === fleet.destination.clusterId) {
        if (current.solarSystemId !== fleet.destination.solarSystemId) {
            return enqueueIntraPath(world, fleet, current.clusterId, current.solarSystemId, fleet.destination.solarSystemId);
        }
        return null;
    }
    return null;
}
function takeCachedIntraHop(world, fleet) {
    const next = {
        clusterId: fleet.currentNode.clusterId,
        solarSystemId: fleet.intraPath[fleet.intraIndex],
    };
    if (!hasFleetHop(world, fleet.currentNode, next))
        return null;
    fleet.intraIndex++;
    return next;
}
function nextGateHop(world, fleet) {
    const current = fleet.currentNode;
    const edge = fleet.pendingEdges[0];
    if (current.clusterId !== edge.fromClusterId || !hasClusterEdge(world, edge))
        return null;
    if (current.solarSystemId !== edge.fromGateId) {
        return enqueueIntraPath(world, fleet, current.clusterId, current.solarSystemId, edge.fromGateId);
    }
    fleet.pendingEdges.shift();
    return { clusterId: edge.toClusterId, solarSystemId: edge.toGateId };
}
/** Reject an incomplete route before publishing a fleet that cannot arrive. */
export function isFleetRouteConnected(world, start, destination, edges) {
    let current = start;
    for (const edge of edges) {
        if (current.clusterId !== edge.fromClusterId || !hasClusterEdge(world, edge))
            return false;
        if (findSolarPath(world, current.clusterId, current.solarSystemId, edge.fromGateId).length === 0)
            return false;
        current = { clusterId: edge.toClusterId, solarSystemId: edge.toGateId };
    }
    return current.clusterId === destination.clusterId &&
        findSolarPath(world, current.clusterId, current.solarSystemId, destination.solarSystemId).length > 0;
}
function enqueueIntraPath(world, fleet, clusterId, startId, endId) {
    if (startId === endId)
        return null;
    const path = findSolarPath(world, clusterId, startId, endId);
    if (path.length < 2)
        return null;
    fleet.intraPath = path;
    fleet.intraIndex = 2;
    return { clusterId, solarSystemId: path[1] };
}
//# sourceMappingURL=fleet-pathfinding.js.map