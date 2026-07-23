/**
 * CPU reference for fleet *visual* motion (single-clock option A).
 *
 * Game phase transitions stay in fleets-worker (`tickFleets`).
 * This module only answers “where should the fleet be drawn at `now`?”
 * given jump/cooldown state and node positions — same math WGSL compute
 * must match in L3 (ε-equal readback tests).
 *
 * Jump position uses quintic ease01 (not linear lerp):
 *   u = durationMs <= 0 ? 1 : clamp01((now - t0) / durationMs)
 *   s = ease01(u)
 *   pos = mix(start, end, s)
 */
import { clamp01, ease01 } from "./ship-flight-ref.js";
export { clamp01 };
/** Eased world position along a jump at time `now` (smoothstep, not linear). */
export function lerpJumpPosition(start, end, startTime, durationMs, now) {
    const u = durationMs <= 0 ? 1 : clamp01((now - startTime) / durationMs);
    const s = ease01(u);
    return {
        x: start.x + (end.x - start.x) * s,
        y: start.y + (end.y - start.y) * s,
        z: start.z + (end.z - start.z) * s,
    };
}
/**
 * Resolve visual world position for a fleet state.
 * Returns null if nodes are unknown (caller may hide the fleet).
 */
export function resolveFleetVisualPosition(state, now, lookup) {
    if (state.state === "jumping") {
        const start = lookup(state.startNode);
        const end = lookup(state.endNode);
        if (!start || !end)
            return null;
        return lerpJumpPosition(start, end, state.startTime, state.durationMs, now);
    }
    if (state.state === "cooldown") {
        return lookup(state.node);
    }
    if (state.state === "awaiting") {
        return lookup(state.node);
    }
    return null;
}
//# sourceMappingURL=fleet-motion-ref.js.map