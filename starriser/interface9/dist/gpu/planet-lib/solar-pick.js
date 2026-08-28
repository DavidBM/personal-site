/**
 * Screen / NDC → world ray → body pick. DOM-free (`rayFromNdc` + sphere).
 *
 * Uses the same unproject path as the map / model-viewer
 * ({@link rayFromNdc} + {@link mat4Invert} on view·proj) so double-click
 * pick stays consistent with production WebGPU camera math.
 *
 * {@link solarViewProj} is a **lab helper** (50° / 0.05 / 500). The live map
 * must not call it — it has its own log-height camera.
 */
import { mat4Invert, mat4LookAt, mat4Perspective, mat4ViewProj, } from "../math/mat4.js";
import { rayFromNdc, screenToNdc } from "../math/ground-pick.js";
import { pickBodyIndex, } from "./solar-bodies.js";
/**
 * World-space pick ray through NDC (x,y) for a view·proj matrix.
 * Returns null if view·proj is singular.
 */
export function pickRayFromNdc(ndcX, ndcY, viewProj) {
    const inv = mat4Invert(new Float32Array(16), viewProj);
    if (!inv)
        return null;
    const ray = rayFromNdc(ndcX, ndcY, inv);
    return {
        originX: ray.origin.x,
        originY: ray.origin.y,
        originZ: ray.origin.z,
        dx: ray.direction.x,
        dy: ray.direction.y,
        dz: ray.direction.z,
    };
}
/**
 * Build view·proj for a look-at camera (same FOV / near / far as the showcase).
 */
export function solarViewProj(eyeX, eyeY, eyeZ, targetX, targetY, targetZ, aspect, fovyRad = (50 * Math.PI) / 180, near = 0.05, far = 500, out = new Float32Array(16)) {
    const proj = mat4Perspective(new Float32Array(16), fovyRad, aspect, near, far);
    const view = mat4LookAt(new Float32Array(16), eyeX, eyeY, eyeZ, targetX, targetY, targetZ);
    return mat4ViewProj(out, proj, view);
}
/**
 * Pick body under CSS pixel, using the real view·proj unproject path.
 */
export function pickBodyFromScreen(screenX, screenY, viewportW, viewportH, eyeX, eyeY, eyeZ, targetX, targetY, targetZ, poses) {
    const w = viewportW || 1;
    const h = viewportH || 1;
    const ndc = screenToNdc(screenX, screenY, w, h);
    const viewProj = solarViewProj(eyeX, eyeY, eyeZ, targetX, targetY, targetZ, w / h);
    const ray = pickRayFromNdc(ndc.x, ndc.y, viewProj);
    if (!ray)
        return null;
    // Prefer ray origin from unproject (near plane); fall back to eye.
    return pickBodyIndex(ray.originX, ray.originY, ray.originZ, ray.dx, ray.dy, ray.dz, poses);
}
/**
 * Assert-friendly: center-screen ray direction should align with (target − eye).
 * Returns cosθ of the two unit directions (≈ 1 when healthy).
 */
export function centerRayAlignDot(eyeX, eyeY, eyeZ, targetX, targetY, targetZ, aspect = 16 / 9) {
    const viewProj = solarViewProj(eyeX, eyeY, eyeZ, targetX, targetY, targetZ, aspect);
    const ray = pickRayFromNdc(0, 0, viewProj);
    if (!ray)
        return null;
    let fx = targetX - eyeX;
    let fy = targetY - eyeY;
    let fz = targetZ - eyeZ;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl;
    fy /= fl;
    fz /= fl;
    return ray.dx * fx + ray.dy * fy + ray.dz * fz;
}
//# sourceMappingURL=solar-pick.js.map