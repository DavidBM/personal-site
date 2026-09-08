import { intersectRayPlaneY0, rayFromLookAtCamera, screenToNdc } from "../gpu/math/ground-pick.js";
import { hitEditHandleAtGround, layoutFromRadius } from "../gpu/math/edit-handle-hit.js";
/** Snapshot-only math: main performs input picking but never integrates a camera. */
export function renderPointerRay(camera, x, y) {
    const ndc = screenToNdc(x, y, camera.viewportW, camera.viewportH);
    return rayFromLookAtCamera({
        ...camera, ndcX: ndc.x, ndcY: ndc.y,
        aspect: camera.viewportW / camera.viewportH,
        tanHalfFov: Math.tan(camera.fovyDeg * Math.PI / 360),
    });
}
export function renderGroundPoint(camera, x, y) {
    const ray = renderPointerRay(camera, x, y);
    return intersectRayPlaneY0(ray.origin, ray.direction);
}
export function renderEditHit(snapshot, ndcX, ndcY) {
    if (!snapshot.edit)
        return null;
    const camera = snapshot.camera;
    const ground = renderGroundPoint(camera, (ndcX + 1) * camera.viewportW / 2, (1 - ndcY) * camera.viewportH / 2);
    if (!ground)
        return null;
    return hitEditHandleAtGround(ground.x, ground.z, snapshot.edit.handles, layoutFromRadius(snapshot.edit.radius));
}
function bodyRayDistance(ray, body, camera) {
    const dx = body.x - ray.origin.x;
    const dy = body.y - ray.origin.y;
    const dz = body.z - ray.origin.z;
    const distance = Math.hypot(dx, dy, dz);
    const minRadius = 12 * 2 * Math.max(distance, 1e-4)
        * Math.tan(camera.fovyDeg * Math.PI / 360) / camera.viewportH;
    const radius = Math.max(body.radius, body.radius * Math.min(body.drawMargin, 2), minRadius);
    const along = dx * ray.direction.x + dy * ray.direction.y + dz * ray.direction.z;
    const discriminant = radius * radius - (distance * distance - along * along);
    if (discriminant < 0)
        return Infinity;
    const near = along - Math.sqrt(discriminant);
    const far = along + Math.sqrt(discriminant);
    return near >= 0 ? near : far >= 0 ? far : Infinity;
}
export function pickRenderBody(snapshot, x, y) {
    const ray = renderPointerRay(snapshot.camera, x, y);
    let closest = null;
    let distance = Infinity;
    for (const body of snapshot.bodies) {
        const hit = bodyRayDistance(ray, body, snapshot.camera);
        if (hit >= distance)
            continue;
        closest = body;
        distance = hit;
    }
    return closest;
}
//# sourceMappingURL=render-picking.js.map