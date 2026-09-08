import { computeJumpDuration, getNextNode } from "./fleet-pathfinding.js";
/**
 * Post-jump dwell bounds (fleets **web worker** jump ownership — not GPU ship sim).
 * The fixed 30 s dwell gives the visual agents time to reach and settle into
 * their destination orbit before the next jump begins.
 */
export const COOLDOWN_MS_MIN = 30000;
export const COOLDOWN_MS_MAX = 30000;
/** @deprecated use COOLDOWN_MS_MIN..MAX; kept for import stability. */
export const COOLDOWN_MS = COOLDOWN_MS_MIN;
/** Cooldown duration. The random argument remains for call-site compatibility. */
export function randomCooldownMs(random = Math.random) {
    const span = COOLDOWN_MS_MAX - COOLDOWN_MS_MIN;
    return COOLDOWN_MS_MIN + Math.floor(random() * (span + 1));
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
export function advanceFleet(world, fleet, now, publishState, publishRemoved, random = Math.random) {
    if (fleet.state.state === "jumping") {
        if (now - fleet.state.startTime >= fleet.state.durationMs) {
            const arrivedAt = fleet.state.startTime + fleet.state.durationMs;
            fleet.currentNode = fleet.state.endNode;
            fleet.state = {
                state: "cooldown",
                startTime: arrivedAt,
                node: fleet.currentNode,
                durationMs: randomCooldownMs(random),
            };
            publishState(fleet);
        }
        return;
    }
    if (fleet.state.state === "cooldown") {
        if (now - fleet.state.startTime >= fleet.state.durationMs) {
            const departedAt = fleet.state.startTime + fleet.state.durationMs;
            if (!startNextJump(world, fleet, departedAt, publishState)) {
                world.fleets.delete(fleet.id);
                publishRemoved(fleet.id);
            }
        }
        return;
    }
}
export function tickFleets(world, now, publishState, publishRemoved, random = Math.random) {
    if (world.fleets.size === 0)
        return;
    for (const fleet of world.fleets.values()) {
        advanceFleet(world, fleet, now, publishState, publishRemoved, random);
    }
}
//# sourceMappingURL=fleet-simulation.js.map