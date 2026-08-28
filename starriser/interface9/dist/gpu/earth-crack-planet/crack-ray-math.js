/**
 * Pure classic ray-heightfield math for the Earth+crack page.
 * Mirrors WGSL ray_heightfield_classic — Node smoke asserts radius alignment
 * so land transparency does not treat the planet as a smaller sphere.
 *
 * Reference sphere: unit radius (matches Azure disc rr=1 / edgeOuter limb).
 * Surface shell: rSurf = 1 − (1−h)·heightScale  →  h=1 ⇒ rSurf=1 (full limb).
 */
import { CRACK_BIN_REFINE, CRACK_CLASSIC_HEIGHT_SCALE, CRACK_CLASSIC_STEPS, CRACK_RAY_LOOP_CEIL, CRACK_RAY_STEP, classicSurfaceRadius, } from "./crack-relief.js";
export const RAY_REF_SPHERE_RADIUS = 1;
/** Product rule: miss-transparency only for deep dig (not mild shoulders). */
export const DEEP_DIG_H_MAX = 0.4;
/**
 * Height below this: dig through-hole (ray miss → transparent) + dig UV.
 * Must match dig soft footprint on the land height atlas. Thresholds like 0.88/0.92
 * only covered ~70–75% of dig soft → dig parallax looked like a smaller sphere
 * inside the planet (“rotates away earlier than the land”).
 * Pure crust bake is h=1; keep max &lt; 1 so crust stays solid + geom UV.
 */
export const DIG_HOLE_H_MAX = 0.995;
/** @deprecated alias. */
export const DIG_REGION_H_MAX = DIG_HOLE_H_MAX;
/** Same band as dig hole — dig UV covers full dig soft lips (not dig core only). */
export const DIG_UV_H_MAX = 0.995;
/**
 * Wide UV unwrap limit (anti-wrap). Must not shrink dig wall parallax vs dig size.
 */
export const DIG_UV_MAX_OFFSET = 0.5;
/** Pure crust threshold — geometric full-radius land (spec/matte gates). */
export const FULL_CRUST_H_MIN = 0.985;
function sphereToUvSimple(x, y, z) {
    const len = Math.hypot(x, y, z) || 1;
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;
    // Match planet-disc sphereToUv / sphere-map dirToEquirect: lon=atan2(z,x)
    const lon = Math.atan2(nz, nx);
    const lat = Math.asin(Math.min(1, Math.max(-1, ny)));
    const u = lon * (0.5 / Math.PI) + 0.5;
    const v = 0.5 - lat / Math.PI;
    return { u: ((u % 1) + 1) % 1, v: Math.min(1, Math.max(0, v)) };
}
function rayUnitSphere(ox, oy, oz, dx, dy, dz) {
    const b = 2 * (ox * dx + oy * dy + oz * dz);
    const c = ox * ox + oy * oy + oz * oz - RAY_REF_SPHERE_RADIUS * RAY_REF_SPHERE_RADIUS;
    const disc = b * b - 4 * c;
    if (disc < 0)
        return { tNear: 1e9, tFar: -1e9 };
    const s = Math.sqrt(disc);
    const t0 = (-b - s) * 0.5;
    const t1 = (-b + s) * 0.5;
    return { tNear: Math.min(t0, t1), tFar: Math.max(t0, t1) };
}
function insideShell(r2, rSurf, eps = 1e-4) {
    const lim = rSurf + eps;
    return r2 <= lim * lim;
}
/**
 * Classic camera-ray vs radial heightfield (CPU twin of WGSL).
 * @param heightFn (u,v) → structural height in [0,1], 1 = full radius
 */
export function rayHeightfieldClassicHit(camX, camY, camZ, pX, pY, pZ, heightFn, heightScale = CRACK_CLASSIC_HEIGHT_SCALE, steps = CRACK_CLASSIC_STEPS, rayStep = CRACK_RAY_STEP, binRefine = CRACK_BIN_REFINE) {
    const pl = Math.hypot(pX, pY, pZ) || 1;
    const px = pX / pl;
    const py = pY / pl;
    const pz = pZ / pl;
    const uvG = sphereToUvSimple(px, py, pz);
    let dx = px - camX;
    let dy = py - camY;
    let dz = pz - camZ;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < 1e-12) {
        return { hit: true, u: uvG.u, v: uvG.v, rSurfAtHit: classicSurfaceRadius(1, heightScale) };
    }
    const inv = 1 / Math.sqrt(d2);
    dx *= inv;
    dy *= inv;
    dz *= inv;
    const ts = rayUnitSphere(camX, camY, camZ, dx, dy, dz);
    if (ts.tNear > ts.tFar) {
        return { hit: false, u: uvG.u, v: uvG.v, rSurfAtHit: 0 };
    }
    const tEnter = Math.max(ts.tNear, 0);
    const tEnd = Math.max(ts.tFar, tEnter);
    const span = Math.max(tEnd - tEnter, 0);
    const byLen = Math.ceil(span / Math.max(rayStep, 0.004));
    const n = Math.min(Math.max(Math.max(steps, 1), byLen), CRACK_RAY_LOOP_CEIL);
    const sampleAt = (t) => {
        const x = camX + dx * t;
        const y = camY + dy * t;
        const z = camZ + dz * t;
        const r2 = x * x + y * y + z * z;
        const uv = sphereToUvSimple(x, y, z);
        const h = heightFn(uv.u, uv.v);
        const rSurf = classicSurfaceRadius(h, heightScale);
        return { x, y, z, r2, uv, h, rSurf };
    };
    {
        const s = sampleAt(tEnter);
        if (insideShell(s.r2, s.rSurf)) {
            return { hit: true, u: s.uv.u, v: s.uv.v, rSurfAtHit: s.rSurf };
        }
    }
    let tPrev = tEnter;
    const dt = n > 0 ? (tEnd - tEnter) / n : 0;
    for (let i = 1; i <= n; i++) {
        const t = tEnter + dt * i;
        const s = sampleAt(t);
        if (insideShell(s.r2, s.rSurf)) {
            let a = tPrev;
            let b = t;
            for (let j = 0; j < binRefine; j++) {
                const m = (a + b) * 0.5;
                const sm = sampleAt(m);
                if (insideShell(sm.r2, sm.rSurf))
                    b = m;
                else
                    a = m;
            }
            const hit = sampleAt(b);
            return { hit: true, u: hit.uv.u, v: hit.uv.v, rSurfAtHit: hit.rSurf };
        }
        tPrev = t;
    }
    // True miss — transparent dig (no closest-approach equirect “reflection”)
    return { hit: false, u: uvG.u, v: uvG.v, rSurfAtHit: 0 };
}
/**
 * Product land opacity when parallax is on:
 * - dig (hGeom < DIG_HOLE_H_MAX): binary ray hit; miss = transparent hole
 * - non-dig / soft crust: always opaque (Azure limb)
 * limbProtect ignored.
 */
export function productSurfHitLand(hGeom, rayHit, _limbProtect01 = 0, parallaxOn = true) {
    if (!parallaxOn)
        return 1;
    void _limbProtect01;
    void DEEP_DIG_H_MAX;
    void FULL_CRUST_H_MIN;
    if (hGeom >= DIG_HOLE_H_MAX)
        return 1;
    return rayHit ? 1 : 0;
}
/** Face-on camera outside unit sphere; P = front pole. */
export function faceOnCrustProbe(heightScale = CRACK_CLASSIC_HEIGHT_SCALE) {
    const heightFn = () => 1; // pure crust everywhere
    return rayHeightfieldClassicHit(0, 0, 3.5, 0, 0, 1, heightFn, heightScale);
}
/** Grazing billboard point near limb (rr≈0.95), pure crust. */
export function grazingCrustProbe(heightScale = CRACK_CLASSIC_HEIGHT_SCALE) {
    const heightFn = () => 1;
    // Point on unit sphere near equator edge, camera on +Z
    const rr = 0.95;
    const z = Math.sqrt(Math.max(0, 1 - rr * rr));
    return rayHeightfieldClassicHit(0, 0, 3.5, rr, 0, z, heightFn, heightScale);
}
//# sourceMappingURL=crack-ray-math.js.map