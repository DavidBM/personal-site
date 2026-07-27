/**
 * L5b — pure CPU trail ring (age + distance-gated append) + expand layout.
 *
 * P1: pure age/append/segments for goldens.
 * P2–P4: GPU integrate + fixed-slot line expand + draw match these formulas.
 *
 * ## Config (game vs tests)
 * Production defaults live in {@link DEFAULT_TRAIL_CONFIG} (short rings).
 * Tests / debug may pass a longer {@link TrailConfig} into
 * `FleetInstanceGpuLayer` — that must **not** mutate these module defaults.
 * WGSL + buffer sizes are baked at layer `init` from the resolved layout.
 *
 * ShipSim holds `trailWrite` / `sinceSample`; samples live in a flat f32 buffer
 * (4 floats per sample = TRAIL_SAMPLE_STRIDE bytes).
 *
 * Sample layout (matches fleet-layout TrailSample):
 *   [0] posX  [1] posZ  [2] age01 (or birth ms on GPU)  [3] posY (default 0)
 * Expand ribbons stay XZ-only this phase (ignore posY).
 *
 * Ring: `write` is the next slot to overwrite; wrap with trailWrap.
 * Live samples walk backward from write while age01 < 1.
 *
 * Line expand (fixed slot, no atomics): per ship (RING-1) segments × 20 floats
 * (start pos/col/α, end pos/col/α, prev pos, next pos). Dead segments write
 * degenerate alpha-0 endpoints. prev/next feed continuous miter joints.
 */
import { TRAIL_SAMPLE_STRIDE } from "./fleet-layout.js";
/**
 * Production game trails — short ribbons, cheap VRAM.
 * Do **not** lengthen this for tests; pass overrides into the fleet layer.
 */
export const DEFAULT_TRAIL_CONFIG = {
    // Power-of-2 ring (bitwise wrap). Short ring = cheap expand + fewer ghosts.
    // 8 samples is enough for multi-segment ribbons once hop speed matches the
    // 30s domain clock (fast uncapped hop was filling/overwriting every frame).
    ringSize: 8,
    lifetimeMs: 1400,
    // No distance gate: append every moving integrate step (follow-cam / hop
    // visibility). Re-introduce a floor if short rings thrash at high speed.
    minDist: 0,
    maxIntervalMs: 48,
};
/**
 * Age factor: (1 − age01)^power. Secondary — short rings often never reach
 * high age before overwrite, so this alone barely fades.
 */
export const TRAIL_ALPHA_POWER = 1;
/**
 * Primary fade: (1 − along01)^power where along01 is 0 at the ship (newest)
 * and 1 at the oldest expand slot. Forces a head→tail transparency gradient
 * even when all samples are still “young” in age01.
 * Higher = more transparent sooner. Keep mild (~1.25): ^2+ was still too ghosty.
 */
export const TRAIL_ALONG_POWER = 1.25;
/**
 * Long hop/orbit debug trails for scenario tests only.
 * Wire via `new FleetInstanceGpuLayer(boot, { trail: DEBUG_TRAIL_CONFIG })`.
 */
export const DEBUG_TRAIL_CONFIG = {
    ringSize: 512,
    lifetimeMs: 12000,
    minDist: 0.15,
    maxIntervalMs: 40,
};
/** Floats per expanded trail endpoint: pos.xyz, color.rgb, alpha. */
export const TRAIL_LINE_FLOATS_PER_VERT = 7;
/**
 * Floats per segment instance in trailLines:
 * start(7) + end(7) + prev(3) + next(3) = 20.
 * prev/next are neighbor samples for continuous miter joints in the draw VS.
 */
export const TRAIL_SEGMENT_FLOATS = TRAIL_LINE_FLOATS_PER_VERT * 2 + 6;
/** Bytes per segment instance (start+end+prev+next). */
export const TRAIL_SEGMENT_STRIDE = TRAIL_SEGMENT_FLOATS * 4;
/** Floats per sample (posX, posZ, age01, pad). */
export const TRAIL_SAMPLE_FLOATS = TRAIL_SAMPLE_STRIDE / 4;
function assertPowerOfTwoRing(ringSize) {
    const n = Math.floor(ringSize);
    if (n < 4 || (n & (n - 1)) !== 0) {
        throw new Error(`trail ringSize must be power of 2 ≥ 4 (got ${ringSize})`);
    }
    return n;
}
/**
 * Resolve a full trail layout. Omits fall back to {@link DEFAULT_TRAIL_CONFIG}
 * (game). Tests pass {@link DEBUG_TRAIL_CONFIG} or a partial override.
 */
export function resolveTrailLayout(partial) {
    const base = DEFAULT_TRAIL_CONFIG;
    const ringSize = assertPowerOfTwoRing(partial?.ringSize ?? base.ringSize);
    const lifetimeMs = partial?.lifetimeMs !== undefined && partial.lifetimeMs > 0
        ? partial.lifetimeMs
        : base.lifetimeMs;
    const minDist = partial?.minDist !== undefined && partial.minDist >= 0
        ? partial.minDist
        : base.minDist;
    const maxIntervalMs = partial?.maxIntervalMs !== undefined && partial.maxIntervalMs > 0
        ? partial.maxIntervalMs
        : base.maxIntervalMs;
    const segsPerShip = ringSize - 1;
    const vertsPerShip = segsPerShip * 2;
    const lineFloatsPerVert = TRAIL_LINE_FLOATS_PER_VERT;
    const segmentFloats = TRAIL_SEGMENT_FLOATS;
    return {
        ringSize,
        lifetimeMs,
        minDist,
        maxIntervalMs,
        segsPerShip,
        sampleFloats: TRAIL_SAMPLE_FLOATS,
        vertsPerShip,
        lineFloatsPerVert,
        segmentFloats,
        // Continuous body: each seg packs start+end+prev+next (not just 2×endpoint).
        lineFloatsPerShip: segsPerShip * segmentFloats,
        lineStride: lineFloatsPerVert * 4,
        segmentStride: segmentFloats * 4,
    };
}
/** Game layout (cached) — what the map view uses by default. */
export const DEFAULT_TRAIL_LAYOUT = resolveTrailLayout();
// ---------------------------------------------------------------------------
// Backward-compatible names = **game** defaults only (never test overrides)
// ---------------------------------------------------------------------------
/** @deprecated Prefer DEFAULT_TRAIL_CONFIG.ringSize / resolveTrailLayout */
export const TRAIL_RING_SIZE = DEFAULT_TRAIL_CONFIG.ringSize;
/** @deprecated Prefer DEFAULT_TRAIL_CONFIG.lifetimeMs */
export const TRAIL_LIFETIME_MS = DEFAULT_TRAIL_CONFIG.lifetimeMs;
/** @deprecated Prefer DEFAULT_TRAIL_CONFIG.minDist */
export const TRAIL_MIN_DIST = DEFAULT_TRAIL_CONFIG.minDist;
/** @deprecated Prefer DEFAULT_TRAIL_CONFIG.maxIntervalMs */
export const TRAIL_MAX_INTERVAL_MS = DEFAULT_TRAIL_CONFIG.maxIntervalMs;
/** Max line segments per ship ring (RING-1). Game default. */
export const TRAIL_SEGS_PER_SHIP = DEFAULT_TRAIL_LAYOUT.segsPerShip;
/** Vertices written per ship (game default). */
export const TRAIL_VERTS_PER_SHIP = DEFAULT_TRAIL_LAYOUT.vertsPerShip;
/** Floats written per ship into the trail line buffer (game default). */
export const TRAIL_LINE_FLOATS_PER_SHIP = DEFAULT_TRAIL_LAYOUT.lineFloatsPerShip;
/** Bytes per expanded trail endpoint. */
export const TRAIL_LINE_STRIDE = DEFAULT_TRAIL_LAYOUT.lineStride;
/** Bytes per expanded trail segment instance (start+end+prev+next). */
export const TRAIL_SEGMENT_STRIDE_DEFAULT = DEFAULT_TRAIL_LAYOUT.segmentStride;
/** Power-of-2 wrap: i & (ringSize − 1). */
export function trailWrap(i, ringSize) {
    return i & (ringSize - 1);
}
/**
 * Age all RING samples: age01 += dtMs/lifetimeMs, clamp 1.
 * Mutates `samples` in place. `sampleStart` is the f32 index of the ring base.
 */
export function ageTrailRing(samples, sampleStart, ringSize, dtMs, lifetimeMs = TRAIL_LIFETIME_MS) {
    let dt = dtMs;
    if (dt < 0)
        dt = 0;
    const delta = lifetimeMs > 0 ? dt / lifetimeMs : 1;
    const floats = TRAIL_SAMPLE_FLOATS;
    for (let i = 0; i < ringSize; i++) {
        const ageIdx = sampleStart + i * floats + 2;
        let age = samples[ageIdx] + delta;
        if (age > 1)
            age = 1;
        samples[ageIdx] = age;
    }
}
/**
 * Distance + time gated append into a ring of `ringSize` TrailSamples (stride 4 f32).
 * Returns new `{ write, sinceSample }`. Does not append when `!allowAppend`.
 *
 * Trails are **not** jump-only: GPU calls this whenever a formation ship is
 * moving (seek or orbit). `allowAppend` is for LOD/icon/paused kill-switches.
 *
 * @param cfg - optional gates; defaults to game {@link DEFAULT_TRAIL_CONFIG}
 */
export function tryAppendTrailSample(samples, ringBaseFloat, write, sinceSample, posX, posZ, distMoved, allowAppend, ringSize = TRAIL_RING_SIZE, cfg = DEFAULT_TRAIL_CONFIG) {
    if (!allowAppend) {
        return { write, sinceSample };
    }
    const dist = sinceSample + distMoved;
    const mask = ringSize - 1;
    const newestIdx = (write - 1) & mask;
    const newestAge = samples[ringBaseFloat + newestIdx * TRAIL_SAMPLE_FLOATS + 2] ?? 1;
    // ε: age01 * LIFETIME can be 39.999… for 40/1000 in f32/f64
    const timeOk = distMoved > 0.05 &&
        newestAge * cfg.lifetimeMs + 1e-3 >= cfg.maxIntervalMs;
    if (dist < cfg.minDist && !timeOk) {
        return { write, sinceSample: dist };
    }
    const w = write & mask;
    const base = ringBaseFloat + w * TRAIL_SAMPLE_FLOATS;
    samples[base] = posX;
    samples[base + 1] = posZ;
    samples[base + 2] = 0; // fresh
    samples[base + 3] = 0; // pad
    return {
        write: (w + 1) & mask,
        sinceSample: 0,
    };
}
/**
 * Live line segments walking backward from `write` for goldens / debug.
 * Newest sample is `(write - 1) & mask`. Stops at dead (age01 >= 1) or full ring.
 * Segment ageA/ageB are ages at the older/newer endpoints respectively
 * (A = toward tail, B = toward head).
 */
export function trailLiveSegments(samples, ringBaseFloat, write, ringSize = TRAIL_RING_SIZE) {
    const mask = ringSize - 1;
    const floats = TRAIL_SAMPLE_FLOATS;
    const segs = [];
    let havePrev = false;
    let prevX = 0;
    let prevZ = 0;
    let prevAge = 0;
    for (let n = 0; n < ringSize; n++) {
        const idx = (write - 1 - n) & mask;
        const base = ringBaseFloat + idx * floats;
        const x = samples[base];
        const z = samples[base + 1];
        const age = samples[base + 2];
        if (age >= 1)
            break;
        if (havePrev) {
            // prev is newer (closer to head); current is older (toward tail)
            segs.push({
                x0: x,
                z0: z,
                x1: prevX,
                z1: prevZ,
                ageA: age,
                ageB: prevAge,
            });
        }
        havePrev = true;
        prevX = x;
        prevZ = z;
        prevAge = age;
    }
    return segs;
}
//# sourceMappingURL=fleet-trail-ref.js.map