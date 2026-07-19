/**
 * Three-free screen → ray → ground-plane (y = 0) pick math.
 *
 * Bus pointer payloads should use `galaxy_position: { x, z }` from the
 * ground hit (drop `y`; it is always 0 on the render plane).
 *
 * Clip space matches {@link mat4Perspective} (OpenGL-style RH, NDC z ∈ [-1, 1]).
 */
import { mat4Invert, mat4LookAt, mat4Perspective, mat4ViewProj, } from "./mat4.js";
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
 * Full pick: screen → NDC → inv(view·proj) ray → y=0.
 * Returns null if view·proj is singular or the ray misses the ground plane.
 * Pass {@link GroundPickScratch} from a long-lived controller to skip mat allocs.
 */
export function groundPickFromScreen(opts, scratch) {
    const fovyDeg = opts.fovyDeg ?? 60;
    const near = opts.near ?? 10;
    const far = opts.far ?? 1e10;
    const targetY = opts.targetY ?? 0;
    const aspect = (opts.viewportW || 1) / (opts.viewportH || 1);
    const proj = scratch?.proj ?? new Float32Array(16);
    const view = scratch?.view ?? new Float32Array(16);
    const viewProj = scratch?.viewProj ?? new Float32Array(16);
    const invViewProj = scratch?.invViewProj ?? new Float32Array(16);
    mat4Perspective(proj, (fovyDeg * Math.PI) / 180, aspect, near, far);
    mat4LookAt(view, opts.eyeX, opts.eyeY, opts.eyeZ, opts.targetX, targetY, opts.targetZ);
    mat4ViewProj(viewProj, proj, view);
    if (mat4Invert(invViewProj, viewProj) == null) {
        return null;
    }
    const ndc = screenToNdc(opts.screenX, opts.screenY, opts.viewportW, opts.viewportH);
    const ray = rayFromNdc(ndc.x, ndc.y, invViewProj);
    const ground = intersectRayPlaneY0(ray.origin, ray.direction);
    if (ground == null) {
        return null;
    }
    return { ground, ray };
}
//# sourceMappingURL=ground-pick.js.map