import { rayFromLookAtCamera, screenToNdc, intersectRayPlaneY0 } from './math/ground-pick.js';
import { MAX_ZOOM, SCENE_MIN_ZOOM } from './camera-zoom.js';
function ground(camera, x, y) {
    const ndc = screenToNdc(x, y, camera.viewportW, camera.viewportH);
    const ray = rayFromLookAtCamera({ ...camera, ndcX: ndc.x, ndcY: ndc.y,
        aspect: camera.viewportW / camera.viewportH, tanHalfFov: Math.tan(camera.fovyDeg * Math.PI / 360) });
    return intersectRayPlaneY0(ray.origin, ray.direction);
}
/** Persistent upright orbit about the map look-at; all arithmetic remains in the render worker. */
export function touchCameraPose(camera, input) {
    const out = { ...camera };
    const dx = camera.eyeX - camera.targetX, dy = camera.eyeY - camera.targetY, dz = camera.eyeZ - camera.targetZ;
    const radius = Math.max(1e-8, Math.hypot(dx, dy, dz));
    const yaw = Math.atan2(dx, dz) - input.yaw;
    const pitch = Math.max(0.12, Math.min(Math.PI / 2 - 0.01, Math.asin(Math.max(-1, Math.min(1, dy / radius))) + input.pitch));
    const r = Math.max(SCENE_MIN_ZOOM, Math.min(MAX_ZOOM, radius * input.zoom));
    out.eyeX = out.targetX + Math.sin(yaw) * Math.cos(pitch) * r;
    out.eyeY = out.targetY + Math.sin(pitch) * r;
    out.eyeZ = out.targetZ + Math.cos(yaw) * Math.cos(pitch) * r;
    out.upX = 0;
    out.upY = 1;
    out.upZ = 0;
    // Anchor pan and pinch to the ground under the fingers. Tilting/twisting keeps
    // the center stable instead of panning as a side effect of changed rays.
    if (input.dx || input.dy || input.zoom !== 1) {
        const before = ground(camera, input.x - input.dx, input.y - input.dy), after = ground(out, input.x, input.y);
        if (before && after) {
            const x = before.x - after.x, z = before.z - after.z;
            out.eyeX += x;
            out.targetX += x;
            out.eyeZ += z;
            out.targetZ += z;
        }
    }
    return out;
}
//# sourceMappingURL=touch-camera-pose.js.map