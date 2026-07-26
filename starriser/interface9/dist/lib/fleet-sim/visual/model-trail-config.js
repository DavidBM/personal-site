/**
 * Model-LOD engine trails — triangular thruster pot (1 large + 2 small).
 *
 * Only the textured model LOD band uses these emitters. Strategic NEAR/MID
 * ribbons stay on {@link DEFAULT_TRAIL_CONFIG} (single center trail).
 *
 * Body frame (matches quat / ShipSim): +Z forward, +Y up, +X right.
 * Pot sits aft of the origin so ribbons leave the engines under roof-cam.
 *
 * Expand applies body-local offsets via the ship quaternion each frame (short
 * ring ≈ rigid thruster cluster). Width/intensity differ by profile so the
 * center wash reads larger than the two outboard jets — one expand stream,
 * one draw (no fake multi-pass re-draw of the same ribbon).
 */
import { quatRotateVec3 } from "./quat.js";
/**
 * Triangular pot: rear center (large) + left/right outboard (small).
 * Tunable later — only layout contract is non-collinear triangle + 1 large / 2 small.
 */
export const MODEL_TRAIL_EMITTERS = [
    {
        name: "core",
        // Aft of mesh volume (modelScale~0.25 hull) so ribbons start outside the
        // solid hull under roof-cam, not buried in depth.
        local: { x: 0, y: 0.06, z: -0.42 },
        intensity: 1.0,
        lengthScale: 1.0,
        widthScale: 1.35,
        large: true,
    },
    {
        name: "port",
        local: { x: -0.14, y: 0.05, z: -0.36 },
        intensity: 0.42,
        lengthScale: 0.62,
        widthScale: 0.55,
        large: false,
    },
    {
        name: "starboard",
        local: { x: 0.14, y: 0.05, z: -0.36 },
        intensity: 0.42,
        lengthScale: 0.62,
        widthScale: 0.55,
        large: false,
    },
];
/** Always 3 for the pot contract. */
export const MODEL_TRAIL_EMITTER_COUNT = MODEL_TRAIL_EMITTERS.length;
/**
 * @deprecated Alias — prefer {@link MODEL_TRAIL_EMITTERS}.
 * Kept so older imports/tests that re-draw intensity layers still resolve.
 */
export const MODEL_TRAIL_VARIANTS = MODEL_TRAIL_EMITTERS;
/**
 * Above this many model-owned trail ships, collapse to a **single** center
 * emitter (still model-gated) so expand cost stays bounded under bulk.
 */
export const MODEL_TRAIL_MULTI_MAX_SHIPS = 2500;
/** Large emitter (exactly one). */
export function modelTrailLargeEmitter() {
    const large = MODEL_TRAIL_EMITTERS.find((e) => e.large);
    if (!large) {
        throw new Error("MODEL_TRAIL_EMITTERS must include one large emitter");
    }
    return large;
}
/** The two small outboard emitters. */
export function modelTrailSmallEmitters() {
    return MODEL_TRAIL_EMITTERS.filter((e) => !e.large);
}
/**
 * True when three offsets form a non-degenerate triangle (area² > eps).
 * Uses XZ (horizontal pot); Y may match.
 */
export function isModelTrailPotTriangle(emitters = MODEL_TRAIL_EMITTERS, eps = 1e-10) {
    if (emitters.length < 3)
        return false;
    const a = emitters[0].local;
    const b = emitters[1].local;
    const c = emitters[2].local;
    // 2× signed area in XZ
    const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    return cross * cross > eps;
}
/** Count large vs small; expects 1 large and ≥1 small for the product profile. */
export function modelTrailSizeProfile(emitters = MODEL_TRAIL_EMITTERS) {
    let large = 0;
    let small = 0;
    for (const e of emitters) {
        if (e.large)
            large++;
        else
            small++;
    }
    return { large, small };
}
/**
 * True when large and small profiles differ in width and/or intensity
 * (visible 1+2 distinction).
 */
export function modelTrailProfilesDiffer(emitters = MODEL_TRAIL_EMITTERS) {
    const L = emitters.filter((e) => e.large);
    const S = emitters.filter((e) => !e.large);
    if (L.length < 1 || S.length < 1)
        return false;
    const l = L[0];
    for (const s of S) {
        if (Math.abs(l.widthScale - s.widthScale) > 1e-6 ||
            Math.abs(l.intensity - s.intensity) > 1e-6) {
            return true;
        }
    }
    return false;
}
/**
 * World-space sample offset for one emitter: shipPos + R(quat) * local.
 * Matches GPU expand (quatRotateVec3).
 */
export function modelTrailEmitterWorldPos(shipX, shipY, shipZ, qx, qy, qz, qw, local) {
    const r = quatRotateVec3(qx, qy, qz, qw, local.x, local.y, local.z);
    return {
        x: shipX + r.x,
        y: shipY + r.y,
        z: shipZ + r.z,
    };
}
/**
 * How many expand slots one model-owned ship writes under current policy.
 * Full pot (3) when modelOwned ≤ {@link MODEL_TRAIL_MULTI_MAX_SHIPS}; else 1.
 */
export function modelTrailExpandSlotsPerShip(modelOwnedCount) {
    if (modelOwnedCount <= 0)
        return 0;
    if (modelOwnedCount > MODEL_TRAIL_MULTI_MAX_SHIPS)
        return 1;
    return MODEL_TRAIL_EMITTER_COUNT;
}
/**
 * Total dense expand slots for a model-only frame (mode 2).
 */
export function modelTrailDenseExpandBudget(modelOwnedCount) {
    const n = Math.max(0, modelOwnedCount | 0);
    return n * modelTrailExpandSlotsPerShip(n);
}
//# sourceMappingURL=model-trail-config.js.map