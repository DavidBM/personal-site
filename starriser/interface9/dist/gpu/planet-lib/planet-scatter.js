/**
 * Pure analytic planet atmosphere scatter (CPU).
 * Constants and formulas mirror planet-disc.wgsl.ts — keep in sync.
 *
 * SCATTER_ANALYTIC: O’Neil-style optical depth + single midpoint in-scatter.
 * No nested NUM_IN×NUM_OUT density lattice.
 *
 * View ray must point from camera toward the origin sphere:
 *   camPos = (0,0,+CAM_DIST), dir = normalize(p.x, p.y, -CAM_DIST)
 * A wrong +Z dir yields t < 0 and ~zero scatter on-disc.
 *
 * Hot math uses the same algebraically equivalent cheaper forms as WGSL:
 * exp → exp2(x*log2(e)), sqrt → x*invSqrt(x), Mie b*sqrt(b) → b²*invSqrt(b).
 */
export const SCATTER_CAM_DIST = 10;
export const SCATTER_R_INNER = 1;
export const SCATTER_ATM_THICK = 0.18;
/** Analytic path — no multi-sample lattice (was NUM_IN=4 / NUM_OUT=2). */
export const SCATTER_ANALYTIC = true;
export const SCATTER_INTENSITY = 16;
export const SCATTER_EXT_SCALE = 0.55;
export const SCATTER_ATM_COLOR = [
    4.2, 14.5, 36.0,
];
export const SCATTER_MIE_EMIT = 18;
/** WGSL markers that dir aims at the sphere (not away). */
export const SCATTER_DIR_TOWARD_SPHERE_MARKERS = [
    "p.y, -CAM_DIST",
    "camPos",
    "in_scatter",
    "SCATTER_ANALYTIC",
];
/** log2(e) — exp(x) ≡ Math.pow(2, x * LOG2_E). Matches WGSL LOG2_E / exp_fast. */
export const SCATTER_LOG2_E = Math.LOG2E;
function len(v) {
    return Math.hypot(v.x, v.y, v.z);
}
function norm(v) {
    const L = len(v) || 1;
    return { x: v.x / L, y: v.y / L, z: v.z / L };
}
function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
function add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function scale(v, s) {
    return { x: v.x * s, y: v.y * s, z: v.z * s };
}
/** exp(x) ≡ 2^(x * log2(e)) — mirrors WGSL exp_fast. */
function expFast(x) {
    return Math.pow(2, x * SCATTER_LOG2_E);
}
/** sqrt(x) for x > 0 via invSqrt; 0 when x ≤ 0 — mirrors WGSL sqrt_fast. */
function sqrtFast(x) {
    return x > 0 ? x * (1 / Math.sqrt(x)) : 0;
}
export function rayVsSphere(p, dir, r) {
    const b = dot(p, dir);
    const c = dot(p, p) - r * r;
    const d = b * b - c;
    if (d < 0)
        return { tNear: 1e4, tFar: -1e4 };
    const s = sqrtFast(d);
    return { tNear: -b - s, tFar: -b + s };
}
function density(p, ph) {
    return expFast(-Math.max(len(p) - SCATTER_R_INNER, 0) / SCATTER_ATM_THICK / ph);
}
/** O’Neil scale(cosθ) — mirrors WGSL oneil_scale. */
export function oneilScale(mu) {
    const x = 1 - Math.max(-1, Math.min(1, mu));
    return (0.25 *
        expFast(-0.00287 + x * (0.459 + x * (3.83 + x * (-6.8 + x * 5.25)))));
}
/**
 * Analytic optical depth from p along dir (mirrors WGSL optic_depth).
 * Outer-shell path only (same convention as the old multi-sample sun optic).
 */
export function opticDepth(p, dir, ph) {
    const rOuter = SCATTER_R_INNER + SCATTER_ATM_THICK;
    const hit = rayVsSphere(p, dir, rOuter);
    const tEnd = hit.tFar;
    if (tEnd <= 1e-5)
        return 0;
    const r = Math.max(len(p), 1e-5);
    const h = Math.max(r - SCATTER_R_INNER, 0) / SCATTER_ATM_THICK;
    const dens = expFast(-h / ph);
    const up = scale(p, 1 / r);
    const mu = Math.max(-1, Math.min(1, dot(dir, up)));
    return dens * oneilScale(mu) * Math.max(tEnd, 0);
}
function phaseRay(cc) {
    return (3 / 16 / Math.PI) * (1 + cc);
}
function phaseMie(g, c, cc) {
    const gg = g * g;
    const a = (1 - gg) * (1 + cc);
    let b = 1 + gg - 2 * g * c;
    // b * sqrt(b) ≡ b² * invSqrt(b) for b > 0 — mirrors WGSL phase_mie
    b = b > 0 ? b * b * (1 / Math.sqrt(b)) : 0;
    b = b * (2 + gg);
    return (3 / 8 / Math.PI) * a / Math.max(b, 1e-4);
}
/** Short outer view march only — keep in sync with WGSL VIEW_SCATTER_STEPS. */
export const SCATTER_VIEW_STEPS = 3;
/**
 * Analytic in-scatter (mirrors WGSL in_scatter).
 * Short non-nested view steps + O’Neil sun OD. `eNear`/`eFar` = clamped air segment.
 */
export function inScatter(o, dir, eNear, eFar, light) {
    const phRay = 0.05;
    const phMie = 0.02;
    // Match WGSL default ext when body.look1.y ≈ Azure preset (packed as extScale)
    const kRay = {
        x: SCATTER_ATM_COLOR[0] * SCATTER_EXT_SCALE,
        y: SCATTER_ATM_COLOR[1] * SCATTER_EXT_SCALE,
        z: SCATTER_ATM_COLOR[2] * SCATTER_EXT_SCALE,
    };
    const kMie = {
        x: 12 * SCATTER_EXT_SCALE,
        y: 12 * SCATTER_EXT_SCALE,
        z: 12 * SCATTER_EXT_SCALE,
    };
    const kMieEx = 1.05;
    const span = eFar - eNear;
    if (span <= 1e-5) {
        return { x: 0, y: 0, z: 0 };
    }
    const stepLen = span / SCATTER_VIEW_STEPS;
    const stepDir = scale(dir, stepLen);
    let v = add(o, scale(dir, eNear + stepLen * 0.5));
    let sumRay = { x: 0, y: 0, z: 0 };
    let sumMie = { x: 0, y: 0, z: 0 };
    let nRay0 = 0;
    let nMie0 = 0;
    for (let i = 0; i < SCATTER_VIEW_STEPS; i++) {
        const dRay = density(v, phRay) * stepLen;
        const dMie = density(v, phMie) * stepLen;
        nRay0 += dRay;
        nMie0 += dMie;
        const nRay1 = opticDepth(v, light, phRay);
        const nMie1 = opticDepth(v, light, phMie);
        const attR = expFast(-(nRay0 + nRay1) * kRay.x - (nMie0 + nMie1) * kMie.x * kMieEx);
        const attG = expFast(-(nRay0 + nRay1) * kRay.y - (nMie0 + nMie1) * kMie.y * kMieEx);
        const attB = expFast(-(nRay0 + nRay1) * kRay.z - (nMie0 + nMie1) * kMie.z * kMieEx);
        sumRay = {
            x: sumRay.x + dRay * attR,
            y: sumRay.y + dRay * attG,
            z: sumRay.z + dRay * attB,
        };
        sumMie = {
            x: sumMie.x + dMie * attR,
            y: sumMie.y + dMie * attG,
            z: sumMie.z + dMie * attB,
        };
        v = add(v, stepDir);
    }
    const c = Math.max(-1, Math.min(1, dot(dir, scale(light, -1))));
    const cc = c * c;
    const pr = phaseRay(cc);
    const pm = phaseMie(-0.78, c, cc);
    const emit = {
        x: SCATTER_ATM_COLOR[0],
        y: SCATTER_ATM_COLOR[1],
        z: SCATTER_ATM_COLOR[2],
    };
    const mieEmit = SCATTER_MIE_EMIT;
    const scatter = {
        x: sumRay.x * emit.x * pr + sumMie.x * mieEmit * pm,
        y: sumRay.y * emit.y * pr + sumMie.y * mieEmit * pm,
        z: sumRay.z * emit.z * pr + sumMie.z * mieEmit * pm,
    };
    return {
        x: SCATTER_INTENSITY * Math.min(scatter.x, 8),
        y: SCATTER_INTENSITY * Math.min(scatter.y, 8),
        z: SCATTER_INTENSITY * Math.min(scatter.z, 8),
    };
}
/**
 * Shipped camera/dir convention for disc point p (unit-sphere disc coords).
 * dir points from cam toward the sphere (negative Z component).
 */
export function scatterViewRay(px, py) {
    const camPos = { x: 0, y: 0, z: SCATTER_CAM_DIST };
    // Toward origin sphere: same as WGSL normalize(vec3(p.x, p.y, -CAM_DIST))
    const dir = norm({ x: px, y: py, z: -SCATTER_CAM_DIST });
    return { camPos, dir };
}
/** Wrong-sign ray (historical bug) — must yield ~zero on-disc scatter. */
export function scatterViewRayWrongSign(px, py) {
    const camPos = { x: 0, y: 0, z: SCATTER_CAM_DIST };
    const dir = norm({ x: px, y: py, z: SCATTER_CAM_DIST });
    return { camPos, dir };
}
/**
 * Atmosphere RGB at disc point (px,py) with light along +Z in local frame
 * (sun facing camera — strong limb/terminator signal).
 *
 * Optional camDist overrides SCATTER_CAM_DIST. Surface clamp is always hard
 * (soft silhouette unclamp made a pure blue ring — do not reintroduce).
 */
export function scatterAtDiscPoint(px, py, light = { x: 0, y: 0, z: 1 }, useWrongSign = false, camDist = SCATTER_CAM_DIST) {
    const camPos = { x: 0, y: 0, z: camDist };
    const dir = useWrongSign
        ? norm({ x: px, y: py, z: camDist })
        : norm({ x: px, y: py, z: -camDist });
    const atmHit = rayVsSphere(camPos, dir, SCATTER_R_INNER + SCATTER_ATM_THICK);
    let eNear = atmHit.tNear;
    let eFar = atmHit.tFar;
    if (eNear > eFar || eNear <= 0) {
        return {
            rgb: { x: 0, y: 0, z: 0 },
            tNear: eNear,
            tFar: eFar,
            maxComp: 0,
        };
    }
    // Hard surface clamp — atmosphere only in front of the planet disc
    const surf = rayVsSphere(camPos, dir, SCATTER_R_INNER);
    if (surf.tNear < surf.tFar && surf.tNear > 0) {
        eFar = Math.min(eFar, surf.tNear);
    }
    const rgb = inScatter(camPos, dir, eNear, eFar, norm(light));
    return {
        rgb,
        tNear: eNear,
        tFar: eFar,
        maxComp: Math.max(rgb.x, rgb.y, rgb.z),
    };
}
//# sourceMappingURL=planet-scatter.js.map