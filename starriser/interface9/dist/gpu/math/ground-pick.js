/**
 * Three-free screen → ray → ground-plane (y = 0) pick math.
 *
 * Bus pointer payloads should use `galaxy_position: { x, z }` from the
 * ground hit (drop `y`; it is always 0 on the render plane).
 *
 * Clip space matches {@link mat4Perspective} (OpenGL-style RH, NDC z ∈ [-1, 1]).
 */
import { lookAtAxes } from "./mat4.js";
/** CSS pixel → NDC (y flipped; origin top-left). */
export function screenToNdc(screenX, screenY, viewportW, viewportH) {
    const w = viewportW || 1;
    const h = viewportH || 1;
    return {
        x: (screenX / w) * 2 - 1,
        y: -(screenY / h) * 2 + 1,
    };
}
/** Column-major Mat4 × clip vec4, then perspective-divide. */
function unprojectNdc(ndcX, ndcY, ndcZ, invViewProj) {
    const x = invViewProj[0] * ndcX +
        invViewProj[4] * ndcY +
        invViewProj[8] * ndcZ +
        invViewProj[12];
    const y = invViewProj[1] * ndcX +
        invViewProj[5] * ndcY +
        invViewProj[9] * ndcZ +
        invViewProj[13];
    const z = invViewProj[2] * ndcX +
        invViewProj[6] * ndcY +
        invViewProj[10] * ndcZ +
        invViewProj[14];
    const w = invViewProj[3] * ndcX +
        invViewProj[7] * ndcY +
        invViewProj[11] * ndcZ +
        invViewProj[15];
    const invW = w !== 0 ? 1 / w : 0;
    return { x: x * invW, y: y * invW, z: z * invW };
}
/**
 * Build a world-space ray through NDC (x, y) using inverse view·proj.
 *
 * Second sample uses NDC z = 0 (clip mid), **not** z = +1. With large
 * far/near ratios (e.g. near=10, far=1e10) float32 inv(view·proj) makes
 * unproject(z=+1) singular (clip w→0 → origin), so every screen ray
 * aimed at world origin and map pan deltas were always zero.
 * (Three.js Raycaster uses a mid NDC z for the same reason.)
 */
export function rayFromNdc(ndcX, ndcY, invViewProj) {
    const near = unprojectNdc(ndcX, ndcY, -1, invViewProj);
    const mid = unprojectNdc(ndcX, ndcY, 0, invViewProj);
    let dx = mid.x - near.x;
    let dy = mid.y - near.y;
    let dz = mid.z - near.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len;
    dy /= len;
    dz /= len;
    return {
        origin: near,
        direction: { x: dx, y: dy, z: dz },
    };
}
/**
 * Ray ∩ plane y = 0. Null if parallel (dir.y ≈ 0) or hit is behind the ray (t < 0).
 */
export function intersectRayPlaneY0(origin, direction) {
    const dy = direction.y;
    if (!Number.isFinite(dy) || Math.abs(dy) < 1e-12) {
        return null;
    }
    const t = -origin.y / dy;
    if (t < 0) {
        return null;
    }
    return {
        x: origin.x + direction.x * t,
        y: 0,
        z: origin.z + direction.z * t,
    };
}
/**
 * Screen ray from look-at camera axes — **not** inv(view·proj).
 *
 * MAP_NEAR=0.0004 vs far=1e10 makes f32 inv(view·proj) miss y=0 at galaxy
 * |xz|≳5e4, so pan `dragStartGround` was null and LMB did nothing. This
 * ray is independent of clip planes. Same −Z up fallback as mat4LookAt.
 */
export function rayFromLookAtCamera(opts) {
    const a = lookAtAxes(opts.eyeX, opts.eyeY, opts.eyeZ, opts.targetX, opts.targetY, opts.targetZ);
    const vx = opts.ndcX * opts.aspect * opts.tanHalfFov;
    const vy = opts.ndcY * opts.tanHalfFov;
    const vz = -1;
    let dx = vx * a.xx + vy * a.yx + vz * a.zx;
    let dy = vx * a.xy + vy * a.yy + vz * a.zy;
    let dz = vx * a.xz + vy * a.yz + vz * a.zz;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len;
    dy /= len;
    dz /= len;
    return {
        origin: { x: opts.eyeX, y: opts.eyeY, z: opts.eyeZ },
        direction: { x: dx, y: dy, z: dz },
    };
}
/**
 * Full pick: screen → camera-basis ray → y=0.
 * Returns null if the ray misses the ground plane (parallel / behind).
 * Scratch mats are unused (kept so the pan hot path’s call shape stays).
 */
export function groundPickFromScreen(opts, _scratch) {
    const fovyDeg = opts.fovyDeg ?? 60;
    const targetY = opts.targetY ?? 0;
    const aspect = (opts.viewportW || 1) / (opts.viewportH || 1);
    const tanHalfFov = Math.tan(((fovyDeg * Math.PI) / 180) * 0.5);
    const ndc = screenToNdc(opts.screenX, opts.screenY, opts.viewportW, opts.viewportH);
    const ray = rayFromLookAtCamera({
        ndcX: ndc.x,
        ndcY: ndc.y,
        aspect,
        tanHalfFov,
        eyeX: opts.eyeX,
        eyeY: opts.eyeY,
        eyeZ: opts.eyeZ,
        targetX: opts.targetX,
        targetY,
        targetZ: opts.targetZ,
    });
    const ground = intersectRayPlaneY0(ray.origin, ray.direction);
    if (ground == null) {
        return null;
    }
    return { ground, ray };
}
//# sourceMappingURL=ground-pick.js.map