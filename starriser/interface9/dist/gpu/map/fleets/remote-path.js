import { FLEET_GPU_STRIDE, FLEET_FLAG_ALIVE, FLEET_FLAG_JUMPING, FLEET_FLAG_SYSTEM_SCENE, FLEET_FLAG_LOCAL_MOVE, FLEET_FLAG_WARM, FleetGpuFields, hashFleetId } from '../../fleet-layout.js';
import { writePathCommand } from '../../fleet-motion-api.js';
import { SHIP_SIM_STRIDE, ShipSimFields } from '../../ship-sim-layout.js';
import { SHIP_MODE_SEEK, SHIP_MODE_ORBIT } from '../../ship-flight-ref.js';
import { FLEET_SHIP_DRAW_FLOATS } from '../../fleet-ship-pack.js';
import { SCENE_AGENT_SCALE } from '../../ship-motion-config.js';
import { LOCAL_MOVE_ACCEL_SCALE, LOCAL_MOVE_CRUISE_SCALE } from '../../../lib/fleet-sim/visual/local-move-profile.js';
/** Spawn/scene-entry observation only. Continuous integration remains GPU owned. */
export function remotePathPosition(path, nowMs) {
    if (path.orbit && nowMs >= path.orbit.epochGpuMs)
        return remoteOrbitPosition(path.orbit, nowMs);
    if (!path.moving)
        return { x: path.x, y: path.y, z: path.z };
    if (nowMs >= path.arrivalGpuMs)
        return { x: path.targetX, y: path.targetY, z: path.targetZ };
    const t = Math.max(0, Math.min(1, (nowMs - path.departureGpuMs) / (path.arrivalGpuMs - path.departureGpuMs)));
    const points = [{ x: path.x, y: path.y, z: path.z }, ...(path.via ?? []), { x: path.targetX, y: path.targetY, z: path.targetZ }];
    let length = 0;
    for (let i = 1; i < points.length; i++)
        length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y, points[i].z - points[i - 1].z);
    let distance = t * length;
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i], segment = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        if (distance <= segment || i === points.length - 1) {
            const u = segment ? Math.min(1, distance / segment) : 0;
            return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u };
        }
        distance -= segment;
    }
    return { x: path.targetX, y: path.targetY, z: path.targetZ };
}
export function writeRemoteFleetPath(storage, visual, inScene, lookup, nowMs) {
    const path = visual.remote;
    const sun = lookup?.(path.node);
    if (!sun)
        throw new Error('Remote presentation system is absent from topology');
    const position = remotePathPosition(path, nowMs);
    const anchorX = inScene ? 0 : sun.x, anchorZ = inScene ? 0 : sun.z;
    let flags = FLEET_FLAG_ALIVE | FLEET_FLAG_LOCAL_MOVE;
    if (path.moving)
        flags |= FLEET_FLAG_JUMPING;
    if (inScene)
        flags |= FLEET_FLAG_SYSTEM_SCENE;
    if (visual.warmFramesLeft > 0)
        flags |= FLEET_FLAG_WARM;
    writePathCommand(storage.fleetGpuView, visual.fleetSlot * FLEET_GPU_STRIDE, {
        from: { x: anchorX + path.x, y: path.y, z: anchorZ + path.z }, target: { x: anchorX + path.targetX, y: path.targetY, z: anchorZ + path.targetZ },
        t0: path.departureGpuMs, durationMs: Math.max(1, path.arrivalGpuMs - path.departureGpuMs), formationHeading: 0, jumping: path.moving,
    }, { posX: anchorX + position.x, posZ: anchorZ + position.z, heading: 0, flags,
        shipBudget: visual.instanceCapacity, instanceStart: visual.instanceStart, fleetIdHash: hashFleetId(visual.id), ...visual.counts });
    storage.markFleetDirty(visual.fleetSlot);
}
/** A moving subscription starts near its observed position, never at its target.
 * Only spawn and a scene-space transition may reset this GPU-owned pose. */
export function initializeRemoteShipPose(storage, visual, nowMs) {
    const path = visual.remote;
    const position = remotePathPosition(path, nowMs);
    for (let i = 0; i < visual.instanceCapacity; i++) {
        const index = visual.instanceStart + i, offset = index * SHIP_SIM_STRIDE;
        const row = storage.shipSimView;
        const phase = row.getFloat32(offset + ShipSimFields.orbitPhase, true);
        const radius = row.getFloat32(offset + ShipSimFields.orbitR, true) * SCENE_AGENT_SCALE;
        const x = path.moving ? position.x : position.x + radius * Math.sin(phase);
        const z = path.moving ? position.z : position.z + radius * Math.cos(phase);
        row.setFloat32(offset + ShipSimFields.posX, x, true);
        row.setFloat32(offset + ShipSimFields.posY, position.y, true);
        row.setFloat32(offset + ShipSimFields.posZ, z, true);
        row.setFloat32(offset + ShipSimFields.speed, 0, true);
        row.setUint32(offset + ShipSimFields.mode, path.moving ? SHIP_MODE_SEEK : SHIP_MODE_ORBIT, true);
        if (path.moving)
            initializeHeading(row, offset, Math.atan2(path.targetX - position.x, path.targetZ - position.z));
        const draw = index * FLEET_SHIP_DRAW_FLOATS;
        storage.instanceData[draw] = x;
        storage.instanceData[draw + 1] = position.y;
        storage.instanceData[draw + 2] = z;
    }
    storage.markShipDirty(visual.instanceStart, visual.instanceCapacity);
}
function initializeHeading(row, offset, heading) {
    row.setFloat32(offset + ShipSimFields.heading, heading, true);
    row.setFloat32(offset + ShipSimFields.qx, 0, true);
    row.setFloat32(offset + ShipSimFields.qy, Math.sin(heading * 0.5), true);
    row.setFloat32(offset + ShipSimFields.qz, 0, true);
    row.setFloat32(offset + ShipSimFields.qw, Math.cos(heading * 0.5), true);
}
/** Apply dimensional defaults once, immediately after formation initialization. */
export function configureRemoteShipMotion(storage, visual) {
    const row = storage.shipSimView;
    for (let i = 0; i < visual.instanceCapacity; i++) {
        const offset = (visual.instanceStart + i) * SHIP_SIM_STRIDE;
        row.setFloat32(offset + ShipSimFields.accel, row.getFloat32(offset + ShipSimFields.accel, true) * LOCAL_MOVE_ACCEL_SCALE, true);
        row.setFloat32(offset + ShipSimFields.cruiseV, row.getFloat32(offset + ShipSimFields.cruiseV, true) * LOCAL_MOVE_CRUISE_SCALE, true);
        row.setFloat32(offset + ShipSimFields.pad1, 0, true);
    }
}
export function setRemoteFleetAlive(storage, visual, alive) {
    const offset = visual.fleetSlot * FLEET_GPU_STRIDE + FleetGpuFields.flags;
    const flags = storage.fleetGpuView.getUint32(offset, true);
    storage.fleetGpuView.setUint32(offset, alive ? flags | FLEET_FLAG_ALIVE : flags & ~FLEET_FLAG_ALIVE, true);
    storage.markFleetDirty(visual.fleetSlot);
}
/** Admission only; the same equations run once per fleet on the GPU each frame. */
export function remoteOrbitPosition(orbit, nowMs) {
    const { body: b, radius, periodMs, epochGpuMs } = orbit, elapsed = nowMs - epochGpuMs;
    const bodyAngle = b[3] + (elapsed / 1000 % b[2]) / b[2] * Math.PI * 2;
    const ringAngle = (orbit.ringPhase ?? b[3]) + (elapsed % periodMs) / periodMs * Math.PI * 2;
    const component = (i) => b[0] * (b[4 + i] * Math.cos(bodyAngle) + b[8 + i] * Math.sin(bodyAngle))
        + radius * (b[4 + i] * Math.cos(ringAngle) + b[8 + i] * Math.sin(ringAngle));
    return { x: component(0), y: component(1), z: component(2) };
}
//# sourceMappingURL=remote-path.js.map