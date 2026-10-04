import { rayFromLookAtCamera, screenToNdc, intersectRayPlaneY0 } from './math/ground-pick.js';
import { MAX_ZOOM, SCENE_MIN_ZOOM } from './camera-zoom.js';
function ground(camera, x, y) {
    const ndc = screenToNdc(x, y, camera.viewportW, camera.viewportH);
    const ray = rayFromLookAtCamera({ ...camera, ndcX: ndc.x, ndcY: ndc.y,
        aspect: camera.viewportW / camera.viewportH, tanHalfFov: Math.tan(camera.fovyDeg * Math.PI / 360) });
    return intersectRayPlaneY0(ray.origin, ray.direction);
}
/** Pan/zoom preserves the viewing direction and roll, even below the map plane. */
export function touchCameraPose(camera, input) {
    const out = { ...camera };
    const dx = camera.eyeX - camera.targetX, dy = camera.eyeY - camera.targetY, dz = camera.eyeZ - camera.targetZ;
    const radius = Math.max(1e-8, Math.hypot(dx, dy, dz));
    const r = Math.max(SCENE_MIN_ZOOM, Math.min(MAX_ZOOM, radius * input.zoom));
    out.eyeX = out.targetX + dx * r / radius;
    out.eyeY = out.targetY + dy * r / radius;
    out.eyeZ = out.targetZ + dz * r / radius;
    // Anchor free pan and pinch to the ground under the fingers.
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