import { FLEET_GPU_STRIDE, FLEET_FLAG_ALIVE, FLEET_FLAG_JUMPING, FLEET_FLAG_SYSTEM_SCENE, FLEET_FLAG_LOCAL_MOVE, FLEET_FLAG_WARM, FleetGpuFields, hashFleetId } from '../../fleet-layout.js';
import { writePathCommand } from '../../fleet-motion-api.js';
import { SHIP_SIM_STRIDE, ShipSimFields } from '../../ship-sim-layout.js';
import { SHIP_MODE_SEEK, SHIP_MODE_ORBIT } from '../../ship-flight-ref.js';
import { FLEET_SHIP_DRAW_FLOATS } from '../../fleet-ship-pack.js';
import { SCENE_AGENT_SCALE } from '../../ship-motion-config.js';
import { LOCAL_MOVE_ACCEL_SCALE, LOCAL_MOVE_CRUISE_SCALE } from '../../../lib/fleet-sim/visual/local-move-profile.js';
/** Spawn/scene-entry observation only. Continuous integration remains GPU owned. */
export function remotePathPosition(path, nowMs) {
    if (!path.moving)
        return { x: path.x, z: path.z };
    if (nowMs >= path.arrivalGpuMs)
        return { x: path.targetX, z: path.targetZ };
    const t = Math.max(0, Math.min(1, (nowMs - path.departureGpuMs) / (path.arrivalGpuMs - path.departureGpuMs)));
    return { x: path.x + (path.targetX - path.x) * t, z: path.z + (path.targetZ - path.z) * t };
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
        from: { x: anchorX + path.x, z: anchorZ + path.z }, target: { x: anchorX + path.targetX, z: anchorZ + path.targetZ },
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
        row.setFloat32(offset + ShipSimFields.posY, 0, true);
        row.setFloat32(offset + ShipSimFields.posZ, z, true);
        row.setFloat32(offset + ShipSimFields.speed, 0, true);
        row.setUint32(offset + ShipSimFields.mode, path.moving ? SHIP_MODE_SEEK : SHIP_MODE_ORBIT, true);
        if (path.moving)
            initializeHeading(row, offset, Math.atan2(path.targetX - position.x, path.targetZ - position.z));
        const draw = index * FLEET_SHIP_DRAW_FLOATS;
        storage.instanceData[draw] = x;
        storage.instanceData[draw + 1] = 0;
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
//# sourceMappingURL=remote-path.js.map