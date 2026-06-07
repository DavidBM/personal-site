import { nextFleetId } from "./fleet-world.js";
import { findClusterPath } from "./fleet-pathfinding.js";
import { startNextJump, } from "./fleet-simulation.js";
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
export function buildFleetCounts() {
    return {
        red: randomInt(0, 2),
        blue: randomInt(20, 100),
        green: randomInt(100, 1000),
    };
}
export function spawnFleet(world, now, publishSpawned, publishState, publishRemoved) {
    const start = pickRandomNode(world);
    const destination = pickRandomNode(world);
    if (!start || !destination)
        return;
    if (start.clusterId === destination.clusterId &&
        start.solarSystemId === destination.solarSystemId) {
        return;
    }
    const path = findClusterPath(world, start.clusterId, destination.clusterId);
    const fleet = {
        id: nextFleetId(world),
        counts: buildFleetCounts(),
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
    publishSpawned(fleet);
    if (!startNextJump(world, fleet, now, publishState)) {
        world.fleets.delete(fleet.id);
        publishRemoved(fleet.id);
    }
}
function pickRandomNode(world) {
    if (world.clusterIds.length === 0)
        return null;
    for (let attempt = 0; attempt < 12; attempt++) {
        const clusterId = world.clusterIds[randomInt(0, world.clusterIds.length - 1)];
        const cluster = world.clusters.get(clusterId);
        if (!cluster || cluster.solarSystemIds.length === 0)
            continue;
        const solarSystemId = cluster.solarSystemIds[randomInt(0, cluster.solarSystemIds.length - 1)];
        return { clusterId, solarSystemId };
    }
    return null;
}
//# sourceMappingURL=fleet-spawner.js.map