import { rayFromLookAtCamera, screenToNdc } from "../gpu/math/ground-pick.js";
// @ts-expect-error JS helper copied into dist; declarations live in halo-pick.mjs.d.ts
import { pickFleetHalo, cssPxToWorld, HALO_MIN_CSS_PX } from "../gpu/map/fleets/halo-pick.mjs";
import { SYSTEM_LOCAL_SPAN } from "../gpu/solar-system-lod.js";
import { bodySnapshots } from "./runtime-state.js";
const SCENE_APPROACH_DISTANCE = SYSTEM_LOCAL_SPAN * 0.25;
function rayFor(state, x, y) {
    const camera = state.view.getCameraState();
    const ndc = screenToNdc(x, y, camera.viewportW, camera.viewportH);
    return { camera, ray: rayFromLookAtCamera({ ...camera, ndcX: ndc.x, ndcY: ndc.y,
            aspect: camera.viewportW / camera.viewportH,
            tanHalfFov: Math.tan(camera.fovyDeg * Math.PI / 360) }) };
}
function raySphere(ray, x, y, z, radius) {
    const dx = x - ray.origin.x, dy = y - ray.origin.y, dz = z - ray.origin.z;
    const along = dx * ray.direction.x + dy * ray.direction.y + dz * ray.direction.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    const disc = radius * radius - (d2 - along * along);
    if (disc < 0)
        return Infinity;
    const root = Math.sqrt(disc), near = along - root, far = along + root;
    return near >= 0 ? near : far >= 0 ? far : Infinity;
}
export function scenePickPixelRadius(distance, fovyDeg, viewportH, px = 12) {
    return px * 2 * Math.max(distance, 1e-4)
        * Math.tan(fovyDeg * Math.PI / 360) / Math.max(1, viewportH);
}
function pixelRadius(camera, distance, px = 12) {
    return scenePickPixelRadius(distance, camera.fovyDeg, camera.viewportH, px);
}
function sceneRefs(state, remote) {
    const refs = [...remote];
    for (const id of state.sceneFleetIds) {
        const visual = state.view.getFleetVisual(id);
        if (visual)
            refs.push({ id, visual });
    }
    return refs;
}
export function sceneFleetBroadphaseRadius(moving, maxOrbitRadius, pixelTolerance, remotePathLength = 0) {
    const approach = moving ? SCENE_APPROACH_DISTANCE : 0;
    return Math.max(approach, Math.max(0, remotePathLength))
        + Math.max(0, maxOrbitRadius) + Math.max(0, pixelTolerance);
}
function pickBodies(state, camera, ray) {
    let closest = Infinity, opaque = Infinity;
    let result = null;
    for (const body of bodySnapshots(state)) {
        const centerDistance = Math.hypot(body.x - ray.origin.x, body.y - ray.origin.y, body.z - ray.origin.z);
        const radius = Math.max(body.radius, body.radius * Math.min(body.drawMargin, 2), pixelRadius(camera, centerDistance));
        opaque = Math.min(opaque, raySphere(ray, body.x, body.y, body.z, body.radius));
        const distance = raySphere(ray, body.x, body.y, body.z, radius);
        if (distance < closest) {
            closest = distance;
            result = { kind: "body", index: body.index, catalogId: body.catalogId };
        }
    }
    return { closest, opaque, result };
}
export function pickRuntimeFleetHalo(state, x, y) {
    if (typeof state.view.haloMarkers !== "function")
        return null;
    const { camera, ray } = rayFor(state, x, y);
    const distance = Math.hypot(camera.eyeX - camera.targetX, camera.eyeY - camera.targetY, camera.eyeZ - camera.targetZ);
    const minR = cssPxToWorld(HALO_MIN_CSS_PX, distance, Math.tan(camera.fovyDeg * Math.PI / 360), camera.viewportH);
    const hit = pickFleetHalo(ray, state.view.haloMarkers(), minR);
    return hit ? { kind: "fleet", id: hit.id, slot: hit.slot } : null;
}
export async function pickRuntimeSceneTarget(state, remote, x, y) {
    const { camera, ray } = rayFor(state, x, y);
    // At most 128 cached centers, no per-ship readback on mouse movement.
    // Match the icon rectangle rather than a ground-plane ray or an old CPU slot.
    const refs = sceneRefs(state, remote);
    let best = null;
    for (const marker of state.view.sceneFleetMarkers()) {
        if (Math.abs(x - marker.x) > marker.width / 2 + 3 || Math.abs(y - marker.y) > marker.height / 2 + 3)
            continue;
        if (best && marker.depth >= best.depth)
            continue;
        const ref = refs.find(row => row.visual.id === marker.id);
        const id = ref?.id ?? marker.id;
        state.sceneFleetRenderIds.set(id, marker.id);
        best = { id, depth: marker.depth };
    }
    if (best)
        return { kind: 'fleet', id: best.id };
    return pickBodies(state, camera, ray).result;
}
//# sourceMappingURL=scene-picking.js.map