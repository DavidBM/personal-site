import { computeJumpDuration, getNextNode } from "./fleet-pathfinding.js";
const COOLDOWN_MS = 10000;
export function startNextJump(world, fleet, now, publishState) {
    const nextNode = getNextNode(world, fleet);
    if (!nextNode)
        return false;
    const durationMs = computeJumpDuration(world, fleet.currentNode, nextNode);
    fleet.state = {
        state: "jumping",
        startTime: now,
        startNode: fleet.currentNode,
        endNode: nextNode,
        durationMs,
    };
    publishState(fleet);
    return true;
}
export function advanceFleet(world, fleet, now, publishState, publishRemoved) {
    if (fleet.state.state === "jumping") {
        if (now - fleet.state.startTime >= fleet.state.durationMs) {
            fleet.currentNode = fleet.state.endNode;
            fleet.state = {
                state: "cooldown",
                startTime: now,
                node: fleet.currentNode,
                durationMs: COOLDOWN_MS,
            };
            publishState(fleet);
        }
        return;
    }
    if (fleet.state.state === "cooldown") {
        if (now - fleet.state.startTime >= fleet.state.durationMs) {
            if (!startNextJump(world, fleet, now, publishState)) {
                world.fleets.delete(fleet.id);
                publishRemoved(fleet.id);
            }
        }
        return;
    }
}
export function tickFleets(world, now, publishState, publishRemoved) {
    if (world.fleets.size === 0)
        return;
    for (const fleet of world.fleets.values()) {
        advanceFleet(world, fleet, now, publishState, publishRemoved);
    }
}
//# sourceMappingURL=fleet-simulation.js.map