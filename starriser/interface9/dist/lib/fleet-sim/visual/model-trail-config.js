/**
 * Model-LOD engine trails — thruster attach pot (viewer-measured locals).
 *
 * Only the textured model LOD band uses these emitters. Strategic NEAR/MID
 * ribbons stay on {@link DEFAULT_TRAIL_CONFIG} (single center trail).
 *
 * Body frame (matches quat / ShipSim + meshFix×modelScale as in model-viewer):
 * +Z forward, +Y up, +X right. Locals are **viewer world** points with the
 * ship at origin (same space as `buildViewerWorldPositions` / HUD coords).
 *
 * Expand applies body-local offsets via the ship quaternion each frame.
 */
import { quatRotateVec3 } from "./quat.js";
/**
 * Thruster pot — coordinates from model-viewer attach picks (local mesh frame).
 * 1 large core + 2 medium side engines (3 expand streams / model ship).
 */
export const MODEL_TRAIL_EMITTERS = [
    {
        name: "core",
        // Big / center wash
        local: { x: -0.000632, y: -0.00978, z: -0.222625 },
        intensity: 1.0,
        lengthScale: 1.0,
        widthScale: 1.1,
        large: true,
    },
    {
        name: "port",
        // Medium A (port / −X)
        local: { x: -0.052512, y: -0.018229, z: -0.204167 },
        intensity: 0.55,
        lengthScale: 0.72,
        widthScale: 0.8,
        large: false,
    },
    {
        name: "starboard",
        // Medium B (starboard / +X)
        local: { x: 0.052703, y: -0.018533, z: -0.205907 },
        intensity: 0.55,
        lengthScale: 0.72,
        widthScale: 0.8,
        large: false,
    },
];
/** Emitter count for pot expand (game default). */
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
/** Max widthScale among pot emitters (encode baseline so secondaries can exceed large). */
export function modelTrailMaxWidthScale(emitters = MODEL_TRAIL_EMITTERS) {
    let m = 0;
    for (const e of emitters) {
        if (e.widthScale > m)
            m = e.widthScale;
    }
    return m > 0 ? m : 1;
}
/**
 * Expand alphaMul for ribbon width: peak width ∝ widthScale.
 * Draw uniforms use {@link modelTrailMaxWidthScale} so values stay ≤ 1.
 * (Vertex alpha drives width mix; texture alpha is transparency-only.)
 */
export function modelTrailExpandAlphaMul(e, emitters = MODEL_TRAIL_EMITTERS) {
    const maxW = modelTrailMaxWidthScale(emitters);
    return Math.max(0, e.widthScale / maxW);
}
/** Non-large emitters (medium + small). */
export function modelTrailSmallEmitters() {
    return MODEL_TRAIL_EMITTERS.filter((e) => !e.large);
}
/**
 * True when the first three offsets form a non-degenerate triangle (area² > eps).
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
/** Count large vs small; expects 1 large and ≥1 non-large for the product profile. */
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
 * (visible 1+N distinction).
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
 * Full pot when modelOwned ≤ {@link MODEL_TRAIL_MULTI_MAX_SHIPS}; else 1.
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