import { computeJumpDuration, getNextNode } from "./fleet-pathfinding.js";
/**
 * Post-jump dwell bounds (fleets **web worker** jump ownership — not GPU ship sim).
 * Each hop rolls a fresh duration in this range when the jump completes.
 * Product: 5–20 s so cooldowns read as intentional pauses between hops.
 */
export const COOLDOWN_MS_MIN = 5000;
export const COOLDOWN_MS_MAX = 20000;
/** @deprecated use COOLDOWN_MS_MIN..MAX; kept for import stability. */
export const COOLDOWN_MS = COOLDOWN_MS_MIN;
/** Uniform random cooldown in [COOLDOWN_MS_MIN, COOLDOWN_MS_MAX] ms. */
export function randomCooldownMs() {
    const span = COOLDOWN_MS_MAX - COOLDOWN_MS_MIN;
    return COOLDOWN_MS_MIN + Math.floor(Math.random() * (span + 1));
}
export function startNextJump(world, fleet, now, 
/** Optional — spawn path publishes once via fleet_spawned with jumping state. */
publishState) {
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
    publishState?.(fleet);
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
                durationMs: randomCooldownMs(),
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