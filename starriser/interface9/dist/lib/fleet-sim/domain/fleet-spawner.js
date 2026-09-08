import { nextFleetId } from "./fleet-world.js";
import { findClusterPath, isFleetRouteConnected } from "./fleet-pathfinding.js";
import { startNextJump, } from "./fleet-simulation.js";
const randomInt = (min, max, random) => Math.floor(random() * (max - min + 1)) + min;
export function buildFleetCounts(random = Math.random) {
    return {
        red: randomInt(0, 2, random),
        blue: randomInt(20, 100, random),
        green: randomInt(100, 1000, random),
    };
}
/**
 * Build + path + start first jump. On success returns fleet already in
 * `jumping` (not yet published). On failure returns null (nothing in world).
 *
 * Single lifecycle publish is the caller's job — avoids awaiting+jump double
 * messages on the main-thread Bus (critical for bulk 50k).
 */
export function trySpawnFleet(world, now, random = Math.random, planner) {
    const start = pickRandomNode(world, random);
    const destination = pickRandomNode(world, random);
    if (!start || !destination)
        return null;
    if (start.clusterId === destination.clusterId &&
        start.solarSystemId === destination.solarSystemId) {
        return null;
    }
    const path = planner ? planner.path(start.clusterId, destination.clusterId)
        : findClusterPath(world, start.clusterId, destination.clusterId);
    const valid = planner ? planner.valid(start, destination, path) : isFleetRouteConnected(world, start, destination, path);
    if (!valid)
        return null;
    const fleet = {
        id: nextFleetId(world),
        counts: buildFleetCounts(random),
        currentNode: start,
        destination,
        pendingEdges: path,
        intraPath: null,
        intraIndex: 0,
        state: {
            state: "awaiting",
            node: start,
        },
    };
    world.fleets.set(fleet.id, fleet);
    // No mid-spawn fleet_state: success path publishes once with jumping state.
    if (!startNextJump(world, fleet, now)) {
        world.fleets.delete(fleet.id);
        return null;
    }
    return fleet;
}
/**
 * Spawn one fleet: random start → dest → path → jump, then **one**
 * publishSpawned with jumping state (no separate awaiting + fleet_state).
 * publishState kept optional for call-site API stability.
 */
export function spawnFleet(world, now, publishSpawned, _publishState) {
    const fleet = trySpawnFleet(world, now);
    if (!fleet)
        return;
    publishSpawned(fleet);
}
/**
 * Park a fleet at `node` (awaiting, no hop). Used when the player generates
 * fleets while a Kepler SCENE is open so ships appear in that jewel.
 */
export function trySpawnParkedAt(world, node, random = Math.random) {
    const cluster = world.clusters.get(node.clusterId);
    if (!cluster || !cluster.solarSystems.has(node.solarSystemId))
        return null;
    const fleet = {
        id: nextFleetId(world),
        counts: buildFleetCounts(random),
        currentNode: node,
        destination: node,
        pendingEdges: [],
        intraPath: null,
        intraIndex: 0,
        state: {
            state: "awaiting",
            node,
        },
    };
    world.fleets.set(fleet.id, fleet);
    return fleet;
}
export function spawnParkedAt(world, node, publishSpawned) {
    const fleet = trySpawnParkedAt(world, node);
    if (!fleet)
        return;
    publishSpawned(fleet);
}
function pickRandomNode(world, random) {
    if (world.clusterIds.length === 0)
        return null;
    for (let attempt = 0; attempt < 12; attempt++) {
        const clusterId = world.clusterIds[randomInt(0, world.clusterIds.length - 1, random)];
        if (clusterId == null)
            continue;
        const cluster = world.clusters.get(clusterId);
        if (!cluster || cluster.solarSystemIds.length === 0)
            continue;
        const solarSystemId = cluster.solarSystemIds[randomInt(0, cluster.solarSystemIds.length - 1, random)];
        if (solarSystemId == null)
            continue;
        return { clusterId, solarSystemId };
    }
    return null;
}
//# sourceMappingURL=fleet-spawner.js.map