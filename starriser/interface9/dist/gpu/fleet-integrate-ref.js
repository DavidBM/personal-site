/**
 * L3 — pure CPU reference for fleet continuous pose integrate.
 *
 * Must match WGSL `js/gpu/shaders/fleet-integrate.wgsl.ts` and the jump
 * formula in `lerpJumpPosition` (`fleet-motion-ref.ts`):
 *   u = durationMs <= 0 ? 1 : clamp01((now - t0) / durationMs)
 *   s = ease01(u)   // quintic ease-in-out (pronounced bell)
 *   pos = mix(pathStart, pathEnd, s)
 *
 * Used by `scripts/check-invariants.mjs` (Node). Browser WGSL readback ε-match
 * is a future compute-scenario harness — not required for L3 exit.
 */
import { clamp01, ease01 } from "./ship-flight-ref.js";
export { clamp01 };
/**
 * Continuous visual position between nodes (clock A).
 * Non-jumping: sits at pathEnd (CPU parks start=end=node).
 * Jumping: eased mix; when u clamps at 1 while still jumping, stays at pathEnd.
 */
export function integrateFleetPos(opts) {
    if (!opts.jumping) {
        return { x: opts.pathEndX, z: opts.pathEndZ };
    }
    const u = opts.durationMs <= 0
        ? 1
        : clamp01((opts.now - opts.t0) / opts.durationMs);
    const s = ease01(u);
    return {
        x: opts.pathStartX + (opts.pathEndX - opts.pathStartX) * s,
        z: opts.pathStartZ + (opts.pathEndZ - opts.pathStartZ) * s,
    };
}
//# sourceMappingURL=fleet-integrate-ref.js.map