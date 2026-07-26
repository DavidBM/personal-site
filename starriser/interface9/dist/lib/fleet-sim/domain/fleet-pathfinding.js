import { distZX } from "../../../math/galaxy-xz-math.js";
import { getSolarPosition } from "./fleet-world.js";
/**
 * Domain hop duration (ms). Product: ~30 s per jump so strategic travel is
 * readable; visual fleet ease uses the same durationMs from the worker.
 */
export const JUMP_DURATION_MS = 30000;
/**
 * @deprecated Prefer {@link JUMP_DURATION_MS}. Kept as the same 30s floor for
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
    while (queue.length) {
        const current = queue.shift();
        if (current == null)
            break;
        if (current === endId)
            break;
        const edges = world.clusterEdges.get(current) ?? [];
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
export function findSolarPath(world, clusterId, startId, endId) {
    if (startId === endId)
        return [startId];
    const cluster = world.clusters.get(clusterId);
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
export function getNextNode(world, fleet) {
    const current = fleet.currentNode;
    if (fleet.intraPath) {
        if (fleet.intraIndex < fleet.intraPath.length) {
            const nextId = fleet.intraPath[fleet.intraIndex];
            fleet.intraIndex += 1;
            return { clusterId: current.clusterId, solarSystemId: nextId };
        }
        fleet.intraPath = null;
    }
    if (fleet.pendingEdges.length > 0) {
        const edge = fleet.pendingEdges[0];
        if (current.clusterId === edge.fromClusterId) {
            if (current.solarSystemId !== edge.fromGateId) {
                const next = enqueueIntraPath(world, fleet, current.clusterId, current.solarSystemId, edge.fromGateId);
                if (next)
                    return next;
            }
            fleet.pendingEdges.shift();
            return {
                clusterId: edge.toClusterId,
                solarSystemId: edge.toGateId,
            };
        }
    }
    if (current.clusterId === fleet.destination.clusterId) {
        if (current.solarSystemId !== fleet.destination.solarSystemId) {
            const next = enqueueIntraPath(world, fleet, current.clusterId, current.solarSystemId, fleet.destination.solarSystemId);
            if (next)
                return next;
            return fleet.destination;
        }
        return null;
    }
    return null;
}
function enqueueIntraPath(world, fleet, clusterId, startId, endId) {
    if (startId === endId)
        return null;
    const path = findSolarPath(world, clusterId, startId, endId);
    if (path.length < 2) {
        return { clusterId, solarSystemId: endId };
    }
    fleet.intraPath = path;
    fleet.intraIndex = 2;
    return { clusterId, solarSystemId: path[1] };
}
//# sourceMappingURL=fleet-pathfinding.js.map