/**
 * Pure multi-sample planet atmosphere scatter (CPU).
 * Constants and formulas mirror planet-disc.wgsl.ts — keep in sync.
 *
 * View ray must point from camera toward the origin sphere:
 *   camPos = (0,0,+CAM_DIST), dir = normalize(p.x, p.y, -CAM_DIST)
 * A wrong +Z dir yields t < 0 and ~zero scatter on-disc.
 */
export const SCATTER_CAM_DIST = 10;
export const SCATTER_R_INNER = 1;
export const SCATTER_ATM_THICK = 0.18;
/** Keep in sync with planet-disc.wgsl.ts NUM_OUT_SCATTER / NUM_IN_SCATTER. */
export const SCATTER_NUM_OUT = 2;
export const SCATTER_NUM_IN = 4;
export const SCATTER_INTENSITY = 16;
export const SCATTER_ATM_COLOR = [
    4.2, 14.5, 36.0,
];
/** WGSL markers that dir aims at the sphere (not away). */
export const SCATTER_DIR_TOWARD_SPHERE_MARKERS = [
    "p.y, -CAM_DIST",
    "camPos",
    "in_scatter",
];
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
function sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function rayVsSphere(p, dir, r) {
    const b = dot(p, dir);
    const c = dot(p, p) - r * r;
    const d = b * b - c;
    if (d < 0)
        return { tNear: 1e4, tFar: -1e4 };
    const s = Math.sqrt(d);
    return { tNear: -b - s, tFar: -b + s };
}
function density(p, ph) {
    return Math.exp(-Math.max(len(p) - SCATTER_R_INNER, 0) / SCATTER_ATM_THICK / ph);
}
function optic(p, q, ph) {
    const s = scale(sub(q, p), 1 / SCATTER_NUM_OUT);
    let v = add(p, scale(s, 0.5));
    let sum = 0;
    for (let i = 0; i < SCATTER_NUM_OUT; i++) {
        sum += density(v, ph);
        v = add(v, s);
    }
    return sum * len(s);
}
function phaseRay(cc) {
    return (3 / 16 / Math.PI) * (1 + cc);
}
function phaseMie(g, c, cc) {
    const gg = g * g;
    const a = (1 - gg) * (1 + cc);
    let b = 1 + gg - 2 * g * c;
    b = b * Math.sqrt(Math.max(b, 0));
    b = b * (2 + gg);
    return (3 / 8 / Math.PI) * a / Math.max(b, 1e-4);
}
/**
 * Path-integral in-scatter (mirrors WGSL in_scatter).
 * `e` is [tEnterAtm, tExitAtm clamped to surface entry].
 */
export function inScatter(o, dir, eNear, eFar, light) {
    const phRay = 0.05;
    const phMie = 0.02;
    // Match WGSL: lower extinction for brighter limb
    const kRay = {
        x: SCATTER_ATM_COLOR[0] * 0.55,
        y: SCATTER_ATM_COLOR[1] * 0.55,
        z: SCATTER_ATM_COLOR[2] * 0.55,
    };
    const kMie = { x: 12, y: 12, z: 12 };
    const kMieEx = 1.05;
    let sumRay = { x: 0, y: 0, z: 0 };
    let sumMie = { x: 0, y: 0, z: 0 };
    let nRay0 = 0;
    let nMie0 = 0;
    const segLen = (eFar - eNear) / SCATTER_NUM_IN;
    const s = scale(dir, segLen);
    let v = add(o, scale(dir, eNear + segLen * 0.5));
    for (let i = 0; i < SCATTER_NUM_IN; i++) {
        const dRay = density(v, phRay) * segLen;
        const dMie = density(v, phMie) * segLen;
        nRay0 += dRay;
        nMie0 += dMie;
        const f = rayVsSphere(v, light, SCATTER_R_INNER + SCATTER_ATM_THICK);
        const u = add(v, scale(light, f.tFar));
        const nRay1 = optic(v, u, phRay);
        const nMie1 = optic(v, u, phMie);
        const attR = Math.exp(-(nRay0 + nRay1) * kRay.x - (nMie0 + nMie1) * kMie.x * kMieEx);
        const attG = Math.exp(-(nRay0 + nRay1) * kRay.y - (nMie0 + nMie1) * kMie.y * kMieEx);
        const attB = Math.exp(-(nRay0 + nRay1) * kRay.z - (nMie0 + nMie1) * kMie.z * kMieEx);
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
        v = add(v, s);
    }
    const c = dot(dir, scale(light, -1));
    const cc = c * c;
    const pr = phaseRay(cc);
    const pm = phaseMie(-0.78, c, cc);
    // Emission uses full ATM_COLOR (WGSL: sum_ray * ATM_COLOR * phase)
    const emit = {
        x: SCATTER_ATM_COLOR[0],
        y: SCATTER_ATM_COLOR[1],
        z: SCATTER_ATM_COLOR[2],
    };
    const mieEmit = 18;
    return {
        x: SCATTER_INTENSITY * (sumRay.x * emit.x * pr + sumMie.x * mieEmit * pm),
        y: SCATTER_INTENSITY * (sumRay.y * emit.y * pr + sumMie.y * mieEmit * pm),
        z: SCATTER_INTENSITY * (sumRay.z * emit.z * pr + sumMie.z * mieEmit * pm),
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
 */
export function scatterAtDiscPoint(px, py, light = { x: 0, y: 0, z: 1 }, useWrongSign = false) {
    const { camPos, dir } = useWrongSign
        ? scatterViewRayWrongSign(px, py)
        : scatterViewRay(px, py);
    const atmHit = rayVsSphere(camPos, dir, SCATTER_R_INNER + SCATTER_ATM_THICK);
    let eNear = atmHit.tNear;
    let eFar = atmHit.tFar;
    if (eNear > eFar) {
        return {
            rgb: { x: 0, y: 0, z: 0 },
            tNear: eNear,
            tFar: eFar,
            maxComp: 0,
        };
    }
    const surf = rayVsSphere(camPos, dir, SCATTER_R_INNER);
    if (surf.tNear < surf.tFar) {
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