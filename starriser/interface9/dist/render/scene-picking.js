import { rayFromLookAtCamera, screenToNdc } from "../gpu/math/ground-pick.js";
import { readShipSim, SHIP_SIM_STRIDE } from "../gpu/ship-sim-layout.js";
import { SYSTEM_LOCAL_SPAN } from "../gpu/solar-system-lod.js";
import { ORBIT_R_MAX, SCENE_AGENT_SCALE } from "../gpu/ship-motion-config.js";
import { bodySnapshots } from "./runtime-state.js";
const MAX_GPU_FLEET_CANDIDATES = 8;
const MAX_GPU_PICK_BYTES = 24 * 1024;
const MAX_GPU_PICK_SHIPS = Math.floor(MAX_GPU_PICK_BYTES / SHIP_SIM_STRIDE);
const SCENE_APPROACH_DISTANCE = SYSTEM_LOCAL_SPAN * 0.25;
const MAX_BODY_ORBIT_ALTITUDE_MUL = 3.4;
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
function visualCenter(state, visual) {
    const slot = state.view.readFleetGpuSlot(visual.id);
    if (!slot)
        return null;
    const local = (slot.flags & 128) !== 0 && state.view.solarBodies.systemId != null;
    return { slot, x: slot.pathEndX + (local ? state.view.solarBodies.systemX : 0),
        y: local ? slot.pathEndY : 0, z: slot.pathEndZ + (local ? state.view.solarBodies.systemZ : 0), local };
}
function maxSceneOrbitRadius(state) {
    let radius = ORBIT_R_MAX * SCENE_AGENT_SCALE;
    const store = state.view.solarBodies;
    for (let i = 1; i < store.currentCount; i++) {
        radius = Math.max(radius, (store.radius[i] ?? 0) * MAX_BODY_ORBIT_ALTITUDE_MUL);
    }
    return radius;
}
export function sceneFleetBroadphaseRadius(moving, maxOrbitRadius, pixelTolerance, remotePathLength = 0) {
    const approach = moving ? SCENE_APPROACH_DISTANCE : 0;
    return Math.max(approach, Math.max(0, remotePathLength))
        + Math.max(0, maxOrbitRadius) + Math.max(0, pixelTolerance);
}
function remotePathLength(visual) {
    const path = visual.remote;
    return path ? Math.hypot(path.targetX - path.x, path.targetZ - path.z) : 0;
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
function broadphaseCandidates(state, remote, camera, ray) {
    const candidates = [];
    const orbitRadius = maxSceneOrbitRadius(state);
    for (const ref of sceneRefs(state, remote)) {
        const center = visualCenter(state, ref.visual);
        if (!center)
            continue;
        const eyeDistance = Math.hypot(center.x - ray.origin.x, center.y - ray.origin.y, center.z - ray.origin.z);
        const radius = sceneFleetBroadphaseRadius(ref.visual.state.state !== "awaiting", orbitRadius, pixelRadius(camera, eyeDistance), remotePathLength(ref.visual));
        const distance = raySphere(ray, center.x, center.y, center.z, radius);
        if (!Number.isFinite(distance))
            continue;
        let at = candidates.findIndex((entry) => distance < entry.distance);
        if (at < 0)
            at = candidates.length;
        candidates.splice(at, 0, { ref, center, distance });
        if (candidates.length > MAX_GPU_FLEET_CANDIDATES)
            candidates.pop();
    }
    return candidates;
}
function scenePickStamp(state) {
    const store = state.view.solarBodies;
    return { systemId: store.systemId, systemX: store.systemX, systemZ: store.systemZ };
}
function scenePickStampCurrent(state, stamp) {
    const store = state.view.solarBodies;
    return store.systemId === stamp.systemId && store.systemX === stamp.systemX && store.systemZ === stamp.systemZ;
}
function candidateCurrent(state, candidate) {
    const visual = candidate.ref.visual;
    return state.view.getFleetVisual(visual.id) === visual
        && state.view.readFleetGpuSlot(visual.id)?.fleetSlot === candidate.center.slot.fleetSlot;
}
function pickCandidateRows(candidate, rows, camera, ray, stamp, count, maxDistance) {
    let closest = maxDistance;
    for (let i = 0; i < count; i++) {
        const pose = readShipSim(rows, i * SHIP_SIM_STRIDE);
        const px = pose.posX + (candidate.center.local ? stamp.systemX : 0);
        const pz = pose.posZ + (candidate.center.local ? stamp.systemZ : 0);
        const centerDistance = Math.hypot(px - ray.origin.x, pose.posY - ray.origin.y, pz - ray.origin.z);
        closest = Math.min(closest, raySphere(ray, px, pose.posY, pz, pixelRadius(camera, centerDistance)));
    }
    return closest;
}
function readableCandidateCount(state, candidate, remaining) {
    const count = candidate.ref.visual.instanceActive | 0;
    return count > 0 && count <= remaining && candidateCurrent(state, candidate) ? count : 0;
}
async function readCurrentCandidate(state, candidate, count, stamp) {
    const visual = candidate.ref.visual;
    const buffer = await state.view.fleetsLayer.readbackShipSimRange(visual.instanceStart, count);
    if (!scenePickStampCurrent(state, stamp) || !candidateCurrent(state, candidate))
        return null;
    return new DataView(buffer);
}
async function pickShips(state, candidates, camera, ray, maxDistance, stamp) {
    let closest = maxDistance;
    let hit = null;
    let remaining = MAX_GPU_PICK_SHIPS;
    for (const candidate of candidates) {
        const count = readableCandidateCount(state, candidate, remaining);
        if (count === 0)
            continue;
        remaining -= count;
        const rows = await readCurrentCandidate(state, candidate, count, stamp);
        if (!rows)
            continue;
        const distance = pickCandidateRows(candidate, rows, camera, ray, stamp, count, closest);
        if (distance < closest) {
            closest = distance;
            hit = { result: { kind: "fleet", id: candidate.ref.id }, ref: candidate.ref };
        }
        if (remaining <= 0)
            break;
    }
    if (!hit || !scenePickStampCurrent(state, stamp))
        return null;
    if (state.view.getFleetVisual(hit.ref.visual.id) !== hit.ref.visual)
        return null;
    state.sceneFleetRenderIds.set(hit.ref.id, hit.ref.visual.id);
    return hit.result;
}
export async function pickRuntimeSceneTarget(state, remote, x, y) {
    const { camera, ray } = rayFor(state, x, y);
    const stamp = scenePickStamp(state);
    const body = pickBodies(state, camera, ray);
    const ship = await pickShips(state, broadphaseCandidates(state, remote, camera, ray), camera, ray, body.opaque, stamp);
    if (!scenePickStampCurrent(state, stamp))
        return null;
    return ship ?? body.result;
}
//# sourceMappingURL=scene-picking.js.map