/**
 * Sphere-only depth: **camera ray vs radial heightfield** (first-principles).
 *
 * Implicit solid (view-independent radial shell):
 *   ω = normalize(pos)
 *   rSurf(ω) = 1 − heightScale · (1 − h(equirect(ω)))
 *   solid ⇔ |pos| ≤ rSurf(ω)
 *
 * Ray:
 *   pos(t) = cam + t · dir   (dir unit)
 *   unit-sphere chord [t0, t1] from geometric entry to sphere exit
 *
 * March **entry → exit** [max(t0,0), t1]. First t with |pos| ≤ rSurf is the hit
 * (includes cavity far-walls past closest approach t★). No intersection →
 * hit=false (discard). No RIM_H / soft-hit paint. No t★ dig cap (that false-missed).
 *
 * Crust h=1 → rSurf=1 → hit at geometric entry.
 */
import { POM_BINARY_STEPS, POM_LINEAR_STEPS, STEEP_STEPS, dirToUv, sampleParallaxHeight, uvToDir, wrapUV, } from "./heightfield.js";
/** Max radial indent for parallax heightfield (fraction of unit radius). */
export const SPHERE_HEIGHT_SCALE = 0.16;
/** Soft limb: only for UI/legacy; surface radius is view-independent. */
export const SPHERE_LIMB_START = 0.06;
export const SPHERE_LIMB_FULL = 0.22;
/** Nominal step length along the ray (unit-sphere units) for adaptive count. */
export const SPHERE_RAY_STEP = 0.018;
/** Hard cap on linear samples (GPU + CPU). */
export const SPHERE_RAY_MAX_STEPS = 64;
/**
 * @deprecated Heuristic constants — no longer gate visibility.
 * Kept so older smoke imports do not break; resolveDigMiss is a pure miss.
 */
export const SPHERE_UV_SOFT_PAINT = 0.4;
export const SPHERE_UV_LOCAL = SPHERE_UV_SOFT_PAINT;
export const SPHERE_RIM_H = 0.55;
export const SPHERE_DIG_LIMB_FLOOR = 0.08;
export const SPHERE_DIG_MUL = 1.85;
/** @deprecated kept for main.ts import name compatibility */
export const SPHERE_PARALLAX_SCALE = SPHERE_HEIGHT_SCALE;
/** @deprecated */
export const SPHERE_PARALLAX_MAX_ANG = 0.28;
export function clamp01(x) {
    return Math.min(1, Math.max(0, x));
}
export function smoothstep(edge0, edge1, x) {
    const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-8));
    return t * t * (3 - 2 * t);
}
export function sphereLimbWeight(ndotv) {
    return smoothstep(SPHERE_LIMB_START, SPHERE_LIMB_FULL, clamp01(ndotv));
}
/** Seam-aware equirect distance (U wraps). Mirrors WGSL `uv_seam_dist`. */
export function uvSeamDist(u0, v0, u1, v1) {
    let du = Math.abs(u0 - u1);
    if (du > 0.5)
        du = 1 - du;
    const dv = Math.abs(v0 - v1);
    return Math.hypot(du, dv);
}
/**
 * AO mix from UV travel (shipped twin of WGSL `ao_from_uv_delta`).
 * Seam-aware: wrap Δu must NOT max out AO (that painted a grey meridian plane).
 */
export function aoFromUvDelta(u, v, uGeom, vGeom, scale, lo) {
    const amt = Math.min(1, Math.max(0, uvSeamDist(u, v, uGeom, vGeom) * scale));
    return 1 * (1 - amt) + lo * amt;
}
/** Naive (buggy) UV distance — for smoke to prove wrap would darken a full plane. */
export function uvRawDist(u0, v0, u1, v1) {
    return Math.hypot(u0 - u1, v0 - v1);
}
export function uvIsLocal(u0, v0, u1, v1, maxDist = SPHERE_UV_LOCAL) {
    return uvSeamDist(u0, v0, u1, v1) <= maxDist;
}
/**
 * @deprecated Visibility is pure ray hit/miss. Always returns hard miss —
 * unfinished digs never invent a hit (no soft-floor / RIM paint).
 */
export function resolveDigMiss(_lastU, _lastV, geomU, geomV, _hGeom, _limb) {
    return { u: geomU, v: geomV, hit: false };
}
/** @deprecated dig budget no longer limits the march (uses closest-approach). */
export function digBudget(heightScale, limb) {
    return heightScale * Math.max(limb, SPHERE_DIG_LIMB_FLOOR) * SPHERE_DIG_MUL;
}
/**
 * Legacy helper. Opacity: solid on ray hit, transparent on miss / backface.
 */
export function sphereLimbAlpha(ndotv) {
    return ndotv <= 0 ? 0 : 1;
}
export function worldToModelPoint(model, wx, wy, wz, out = new Float32Array(3)) {
    out[0] = model[0] * wx + model[4] * wy + model[8] * wz;
    out[1] = model[1] * wx + model[5] * wy + model[9] * wz;
    out[2] = model[2] * wx + model[6] * wy + model[10] * wz;
    return out;
}
export function worldToModelDir(model, wx, wy, wz, out = new Float32Array(3)) {
    worldToModelPoint(model, wx, wy, wz, out);
    const len = Math.hypot(out[0], out[1], out[2]) || 1;
    out[0] /= len;
    out[1] /= len;
    out[2] /= len;
    return out;
}
/** View toward camera at unit-sphere point P; ndotv = max(V·P, 0). */
export function sphereViewAt(px, py, pz, camX, camY, camZ) {
    let vx = camX - px;
    let vy = camY - py;
    let vz = camZ - pz;
    const len = Math.hypot(vx, vy, vz) || 1;
    vx /= len;
    vy /= len;
    vz /= len;
    const ndotv = Math.max(0, vx * px + vy * py + vz * pz);
    return { vx, vy, vz, ndotv };
}
/**
 * Ray–unit-sphere intersection. dir must be unit. Returns near/far t.
 */
export function rayUnitSphere(ox, oy, oz, dx, dy, dz) {
    const b = 2 * (ox * dx + oy * dy + oz * dz);
    const c = ox * ox + oy * oy + oz * oz - 1;
    const disc = b * b - 4 * c;
    if (disc < 0)
        return null;
    const s = Math.sqrt(disc);
    let t0 = (-b - s) * 0.5;
    let t1 = (-b + s) * 0.5;
    if (t0 > t1) {
        const tmp = t0;
        t0 = t1;
        t1 = tmp;
    }
    return { t0, t1 };
}
/**
 * Radial heightfield radius. View-independent (true 3D shell).
 * `limb` kept for API compatibility; ignored for geometry.
 */
export function surfaceRadius(height, heightScale, _limb = 1) {
    // h=1 → r=1; h=0 → r=1−heightScale
    return 1 - (1 - height) * heightScale;
}
/** Closest-approach t along unit ray: min |cam + t dir| (diagnostics / tests). */
export function rayClosestT(camX, camY, camZ, dx, dy, dz) {
    return -(camX * dx + camY * dy + camZ * dz);
}
/**
 * March interval: geometric entry → sphere **exit** (full chord).
 * tClosest is ignored for the end bound (kept in signature for API stability).
 * Cavity far-walls often first-hit after t★; cutting there caused false misses.
 */
export function rayNearInterval(t0, t1, _tClosest) {
    const tEnter = Math.max(t0, 0);
    let tEnd = t1;
    if (tEnd < tEnter) {
        tEnd = tEnter;
    }
    return { tEnter, tEnd };
}
function adaptiveSteps(tEnter, tEnd, requested) {
    const span = Math.max(0, tEnd - tEnter);
    const byLen = Math.ceil(span / SPHERE_RAY_STEP);
    const n = Math.max(1, requested | 0, byLen);
    return Math.min(SPHERE_RAY_MAX_STEPS, n);
}
/**
 * March camera ray into spherical heightfield; return first intersection UV.
 * hit=false ⇒ no surface along the near chord (caller discards).
 */
export function sphereRayHeightfieldUV(camX, camY, camZ, 
/** Geometric surface point on unit sphere (model space). */
px, py, pz, heightFn = sampleParallaxHeight, steps = 16, heightScale = SPHERE_HEIGHT_SCALE) {
    const plen = Math.hypot(px, py, pz) || 1;
    const Pgx = px / plen;
    const Pgy = py / plen;
    const Pgz = pz / plen;
    const view = sphereViewAt(Pgx, Pgy, Pgz, camX, camY, camZ);
    let dx = Pgx - camX;
    let dy = Pgy - camY;
    let dz = Pgz - camZ;
    const dlen = Math.hypot(dx, dy, dz) || 1;
    dx /= dlen;
    dy /= dlen;
    dz /= dlen;
    const uvGeom = wrapUV(dirToUv(Pgx, Pgy, Pgz)[0], dirToUv(Pgx, Pgy, Pgz)[1]);
    const hitSph = rayUnitSphere(camX, camY, camZ, dx, dy, dz);
    if (!hitSph || hitSph.t1 < 0) {
        // Ray misses unit sphere — no surface (lockstep with WGSL: hit=false)
        return { u: uvGeom.u, v: uvGeom.v, ndotv: view.ndotv, indent: 0, hit: false, t: 0 };
    }
    const tClosest = rayClosestT(camX, camY, camZ, dx, dy, dz);
    // Full chord entry→exit (tClosest only for diagnostics / tests)
    const { tEnter, tEnd } = rayNearInterval(hitSph.t0, hitSph.t1, tClosest);
    const n = adaptiveSteps(tEnter, tEnd, steps);
    const dt = n > 0 ? (tEnd - tEnter) / n : 0;
    // Sample at entry — crust hits immediately
    {
        const posx = camX + dx * tEnter;
        const posy = camY + dy * tEnter;
        const posz = camZ + dz * tEnter;
        const r = Math.hypot(posx, posy, posz) || 1;
        const wE = wrapUV(dirToUv(posx, posy, posz)[0], dirToUv(posx, posy, posz)[1]);
        const rSurf = surfaceRadius(heightFn(wE.u, wE.v), heightScale, 1);
        if (r <= rSurf + 1e-4) {
            return {
                u: wE.u,
                v: wE.v,
                ndotv: view.ndotv,
                indent: Math.max(0, 1 - r),
                hit: true,
                t: tEnter,
            };
        }
    }
    let tPrev = tEnter;
    for (let i = 1; i <= n; i++) {
        const t = tEnter + dt * i;
        const posx = camX + dx * t;
        const posy = camY + dy * t;
        const posz = camZ + dz * t;
        const r = Math.hypot(posx, posy, posz) || 1e-8;
        const w = wrapUV(dirToUv(posx, posy, posz)[0], dirToUv(posx, posy, posz)[1]);
        const rSurf = surfaceRadius(heightFn(w.u, w.v), heightScale, 1);
        if (r <= rSurf + 1e-4) {
            // Binary refine first crossing in [tPrev, t]
            let a = tPrev;
            let b = t;
            for (let j = 0; j < 8; j++) {
                const m = (a + b) * 0.5;
                const mx = camX + dx * m;
                const my = camY + dy * m;
                const mz = camZ + dz * m;
                const mr = Math.hypot(mx, my, mz) || 1e-8;
                const mw = wrapUV(dirToUv(mx, my, mz)[0], dirToUv(mx, my, mz)[1]);
                const mrs = surfaceRadius(heightFn(mw.u, mw.v), heightScale, 1);
                if (mr <= mrs + 1e-4)
                    b = m;
                else
                    a = m;
            }
            const hx = camX + dx * b;
            const hy = camY + dy * b;
            const hz = camZ + dz * b;
            const hw = wrapUV(dirToUv(hx, hy, hz)[0], dirToUv(hx, hy, hz)[1]);
            const hr = Math.hypot(hx, hy, hz) || 1;
            return {
                u: hw.u,
                v: hw.v,
                ndotv: view.ndotv,
                indent: Math.max(0, 1 - hr),
                hit: true,
                t: b,
            };
        }
        tPrev = t;
    }
    // No intersection along full chord — true empty (discard), no soft paint
    return {
        u: uvGeom.u,
        v: uvGeom.v,
        ndotv: view.ndotv,
        indent: 0,
        hit: false,
        t: tEnd,
    };
}
/**
 * Linear search + binary refine (POM). Same near-chord geometry as linear march.
 */
export function sphereRayHeightfieldPomUV(camX, camY, camZ, px, py, pz, heightFn = sampleParallaxHeight, linSteps = POM_LINEAR_STEPS, binSteps = POM_BINARY_STEPS, heightScale = SPHERE_HEIGHT_SCALE) {
    const plen = Math.hypot(px, py, pz) || 1;
    const Pgx = px / plen;
    const Pgy = py / plen;
    const Pgz = pz / plen;
    const view = sphereViewAt(Pgx, Pgy, Pgz, camX, camY, camZ);
    let dx = Pgx - camX;
    let dy = Pgy - camY;
    let dz = Pgz - camZ;
    const dlen = Math.hypot(dx, dy, dz) || 1;
    dx /= dlen;
    dy /= dlen;
    dz /= dlen;
    const uvGeom = wrapUV(dirToUv(Pgx, Pgy, Pgz)[0], dirToUv(Pgx, Pgy, Pgz)[1]);
    const hitSph = rayUnitSphere(camX, camY, camZ, dx, dy, dz);
    if (!hitSph || hitSph.t1 < 0) {
        return { u: uvGeom.u, v: uvGeom.v, ndotv: view.ndotv, indent: 0, hit: false, t: 0 };
    }
    const tClosest = rayClosestT(camX, camY, camZ, dx, dy, dz);
    const { tEnter, tEnd } = rayNearInterval(hitSph.t0, hitSph.t1, tClosest);
    const n = adaptiveSteps(tEnter, tEnd, linSteps);
    const dt = n > 0 ? (tEnd - tEnter) / n : 0;
    const bins = Math.max(0, binSteps | 0);
    void tClosest;
    {
        const posx = camX + dx * tEnter;
        const posy = camY + dy * tEnter;
        const posz = camZ + dz * tEnter;
        const r = Math.hypot(posx, posy, posz) || 1;
        const wE = wrapUV(dirToUv(posx, posy, posz)[0], dirToUv(posx, posy, posz)[1]);
        const rSurf = surfaceRadius(heightFn(wE.u, wE.v), heightScale, 1);
        if (r <= rSurf + 1e-4) {
            return {
                u: wE.u,
                v: wE.v,
                ndotv: view.ndotv,
                indent: Math.max(0, 1 - r),
                hit: true,
                t: tEnter,
            };
        }
    }
    let tPrev = tEnter;
    for (let i = 1; i <= n; i++) {
        const t = tEnter + dt * i;
        const posx = camX + dx * t;
        const posy = camY + dy * t;
        const posz = camZ + dz * t;
        const r = Math.hypot(posx, posy, posz) || 1e-8;
        const w = wrapUV(dirToUv(posx, posy, posz)[0], dirToUv(posx, posy, posz)[1]);
        const rSurf = surfaceRadius(heightFn(w.u, w.v), heightScale, 1);
        if (r <= rSurf + 1e-4) {
            let a = tPrev;
            let b = t;
            for (let j = 0; j < bins; j++) {
                const m = (a + b) * 0.5;
                const mx = camX + dx * m;
                const my = camY + dy * m;
                const mz = camZ + dz * m;
                const mr = Math.hypot(mx, my, mz) || 1e-8;
                const mw = wrapUV(dirToUv(mx, my, mz)[0], dirToUv(mx, my, mz)[1]);
                const mrs = surfaceRadius(heightFn(mw.u, mw.v), heightScale, 1);
                if (mr <= mrs + 1e-4)
                    b = m;
                else
                    a = m;
            }
            const hx = camX + dx * b;
            const hy = camY + dy * b;
            const hz = camZ + dz * b;
            const hw = wrapUV(dirToUv(hx, hy, hz)[0], dirToUv(hx, hy, hz)[1]);
            return {
                u: hw.u,
                v: hw.v,
                ndotv: view.ndotv,
                indent: Math.max(0, 1 - Math.hypot(hx, hy, hz)),
                hit: true,
                t: b,
            };
        }
        tPrev = t;
    }
    return {
        u: uvGeom.u,
        v: uvGeom.v,
        ndotv: view.ndotv,
        indent: 0,
        hit: false,
        t: tEnd,
    };
}
function asHeightFn(height) {
    if (typeof height === "function")
        return height;
    const h = height;
    return () => h;
}
export function sphereClassicParallaxUV(u, v, camLocalX, camLocalY, camLocalZ, height, _scale, _maxAng) {
    const P = uvToDir(u, v);
    const r = sphereRayHeightfieldUV(camLocalX, camLocalY, camLocalZ, P[0], P[1], P[2], asHeightFn(height), 4, SPHERE_HEIGHT_SCALE);
    return { u: r.u, v: r.v, ndotv: r.ndotv, ang: r.indent };
}
export function sphereIterativeParallaxUV(u, v, camLocalX, camLocalY, camLocalZ, height, _iters, _scale, _maxAng) {
    const P = uvToDir(u, v);
    const r = sphereRayHeightfieldUV(camLocalX, camLocalY, camLocalZ, P[0], P[1], P[2], asHeightFn(height), 10, SPHERE_HEIGHT_SCALE);
    return { u: r.u, v: r.v, ndotv: r.ndotv };
}
export function sphereSteepParallaxUV(u, v, camLocalX, camLocalY, camLocalZ, height, layers = STEEP_STEPS, _scale, _maxAng) {
    const P = uvToDir(u, v);
    const r = sphereRayHeightfieldUV(camLocalX, camLocalY, camLocalZ, P[0], P[1], P[2], asHeightFn(height), layers, SPHERE_HEIGHT_SCALE);
    return { u: r.u, v: r.v, layers, ndotv: r.ndotv };
}
export function spherePomParallaxUV(u, v, camLocalX, camLocalY, camLocalZ, height, linSteps = POM_LINEAR_STEPS, binSteps = POM_BINARY_STEPS, _scale, _maxAng) {
    const P = uvToDir(u, v);
    const r = sphereRayHeightfieldPomUV(camLocalX, camLocalY, camLocalZ, P[0], P[1], P[2], asHeightFn(height), linSteps, binSteps, SPHERE_HEIGHT_SCALE);
    return { u: r.u, v: r.v, layers: linSteps, ndotv: r.ndotv };
}
/** @deprecated surface-tangent walk removed; returns geometric UV. */
export function sphereWalkDir(_px, _py, _pz, _vx, _vy, _vz) {
    return { tx: 0, ty: 0, tz: 0 };
}
/** @deprecated */
export function sphereStep(px, py, pz, _tx, _ty, _tz, _ang) {
    const uv = wrapUV(dirToUv(px, py, pz)[0], dirToUv(px, py, pz)[1]);
    return { x: px, y: py, z: pz, u: uv.u, v: uv.v };
}
//# sourceMappingURL=sphere-parallax.js.map