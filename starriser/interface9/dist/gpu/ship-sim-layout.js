/**
 * R0 / L5 — ShipSim GPU storage layout (per-ship continuous flight state).
 *
 * Host-shareable-friendly **stride 64** (16-byte aligned). Scalar fields only.
 * Field order is the contract for TS packing, future WGSL structs, and goldens.
 *
 * ShipSim (stride 64):
 *  0  f32 posX
 *  4  f32 posZ
 *  8  f32 heading
 * 12  f32 speed
 * 16  f32 slotX          // local formation (right); world = rotate(slot, formH)
 * 20  f32 slotZ
 * 24  u32 trailWrite     // next ring index (L5b pure trail; power-of-2 ring)
 * 28  f32 sinceSample    // distance since last trail append
 * 32  u32 mode           // SHIP_MODE_* (paused / seek-far=JUMP / seek-near=ORBIT)
 * 36  u32 fleetIndex
 * 40  u32 targetKind     // 0 FLEET_CENTER, 1 PATH_END, 2 WORLD
 * 44  f32 orbitPhase     // hot; advanced each orbit step
 * 48  f32 accel          // personal linear accel (world/s²)
 * 52  f32 cruiseV        // soft cruise (not hard clamp on jump)
 * 56  f32 orbitR
 * 60  f32 orbitOmega     // signed rad/s
 *
 * omegaMax is **not** stored — derived from SHIP_MAX_TURN_RAD_S / orbit defaults.
 * flags dropped (fleet-level FLEET_FLAG_SIM_PAUSED / WARM cover fleet intent).
 *
 * R0–R2: pure TS + layout; WGSL cs_ships runs integrateShipAgent over full stride-64.
 */
/** Bytes — must match WGSL `struct ShipSim` packing. */
export const SHIP_SIM_STRIDE = 64;
export const ShipSimFields = {
    posX: 0,
    posZ: 4,
    heading: 8,
    speed: 12,
    slotX: 16,
    slotZ: 20,
    trailWrite: 24,
    sinceSample: 28,
    mode: 32,
    fleetIndex: 36,
    targetKind: 40,
    orbitPhase: 44,
    accel: 48,
    cruiseV: 52,
    orbitR: 56,
    orbitOmega: 60,
};
/** Target for agent seek: orbit around fleet center. */
export const SHIP_TARGET_FLEET_CENTER = 0;
/** Target: path end + formation / entry offset. */
export const SHIP_TARGET_PATH_END = 1;
/** Target: explicit world point (reserved). */
export const SHIP_TARGET_WORLD = 2;
// Defaults from ship-motion-config.ts (single tuning panel).
export { SHIP_SIM_DEFAULT_ACCEL, SHIP_SIM_DEFAULT_CRUISE_V, SHIP_SIM_DEFAULT_ORBIT_R, SHIP_SIM_DEFAULT_ORBIT_OMEGA, } from "./ship-motion-config.js";
import { SHIP_SIM_DEFAULT_ACCEL, SHIP_SIM_DEFAULT_CRUISE_V, SHIP_SIM_DEFAULT_ORBIT_R, SHIP_SIM_DEFAULT_ORBIT_OMEGA, } from "./ship-motion-config.js";
/** Write one ShipSim record into a DataView at byte offset. */
export function writeShipSim(view, byteOffset, ship) {
    const o = byteOffset;
    view.setFloat32(o + ShipSimFields.posX, ship.posX, true);
    view.setFloat32(o + ShipSimFields.posZ, ship.posZ, true);
    view.setFloat32(o + ShipSimFields.heading, ship.heading, true);
    view.setFloat32(o + ShipSimFields.speed, ship.speed, true);
    view.setFloat32(o + ShipSimFields.slotX, ship.slotX, true);
    view.setFloat32(o + ShipSimFields.slotZ, ship.slotZ, true);
    view.setUint32(o + ShipSimFields.trailWrite, (ship.trailWrite ?? 0) >>> 0, true);
    view.setFloat32(o + ShipSimFields.sinceSample, ship.sinceSample ?? 0, true);
    view.setUint32(o + ShipSimFields.mode, (ship.mode ?? 0) >>> 0, true);
    view.setUint32(o + ShipSimFields.fleetIndex, (ship.fleetIndex ?? 0) >>> 0, true);
    view.setUint32(o + ShipSimFields.targetKind, (ship.targetKind ?? SHIP_TARGET_FLEET_CENTER) >>> 0, true);
    view.setFloat32(o + ShipSimFields.orbitPhase, ship.orbitPhase ?? 0, true);
    view.setFloat32(o + ShipSimFields.accel, ship.accel ?? SHIP_SIM_DEFAULT_ACCEL, true);
    view.setFloat32(o + ShipSimFields.cruiseV, ship.cruiseV ?? SHIP_SIM_DEFAULT_CRUISE_V, true);
    view.setFloat32(o + ShipSimFields.orbitR, ship.orbitR ?? SHIP_SIM_DEFAULT_ORBIT_R, true);
    view.setFloat32(o + ShipSimFields.orbitOmega, ship.orbitOmega ?? SHIP_SIM_DEFAULT_ORBIT_OMEGA, true);
}
/** Read one ShipSim record (all stride-64 fields). */
export function readShipSim(view, byteOffset) {
    const o = byteOffset;
    return {
        posX: view.getFloat32(o + ShipSimFields.posX, true),
        posZ: view.getFloat32(o + ShipSimFields.posZ, true),
        heading: view.getFloat32(o + ShipSimFields.heading, true),
        speed: view.getFloat32(o + ShipSimFields.speed, true),
        slotX: view.getFloat32(o + ShipSimFields.slotX, true),
        slotZ: view.getFloat32(o + ShipSimFields.slotZ, true),
        trailWrite: view.getUint32(o + ShipSimFields.trailWrite, true),
        sinceSample: view.getFloat32(o + ShipSimFields.sinceSample, true),
        mode: view.getUint32(o + ShipSimFields.mode, true),
        fleetIndex: view.getUint32(o + ShipSimFields.fleetIndex, true),
        targetKind: view.getUint32(o + ShipSimFields.targetKind, true),
        orbitPhase: view.getFloat32(o + ShipSimFields.orbitPhase, true),
        accel: view.getFloat32(o + ShipSimFields.accel, true),
        cruiseV: view.getFloat32(o + ShipSimFields.cruiseV, true),
        orbitR: view.getFloat32(o + ShipSimFields.orbitR, true),
        orbitOmega: view.getFloat32(o + ShipSimFields.orbitOmega, true),
    };
}
/**
 * Stamp `fleetIndex` on contiguous ShipSim rows [shipStart, shipStart+count).
 * Pure CPU mirror update — does not touch GPU.
 *
 * Used after structure rebuild: GPU preserve copies full rows including a
 * stale owner index when `fleetOrder` shifts (e.g. removeFleet mid-list).
 * Pose/trail/mode stay; only the parent fleet index is rewritten.
 */
export function stampShipSimFleetIndex(view, shipStart, count, fleetIndex) {
    if (count <= 0)
        return;
    const fi = fleetIndex >>> 0;
    const base = Math.max(0, shipStart | 0) * SHIP_SIM_STRIDE;
    for (let i = 0; i < count; i++) {
        view.setUint32(base + i * SHIP_SIM_STRIDE + ShipSimFields.fleetIndex, fi, true);
    }
}
function assertOffset(actual, expected, name) {
    if (actual !== expected) {
        throw new Error(`${name} offset ${actual} !== ${expected}`);
    }
}
/** Assert ShipSim layout invariants (called from unit tests). */
export function assertShipSimLayoutInvariants() {
    if (SHIP_SIM_STRIDE !== 64) {
        throw new Error(`SHIP_SIM_STRIDE ${SHIP_SIM_STRIDE} !== 64`);
    }
    if (SHIP_SIM_STRIDE % 16 !== 0) {
        throw new Error("SHIP_SIM_STRIDE must be 16-byte aligned");
    }
    assertOffset(ShipSimFields.posX, 0, "ShipSim.posX");
    assertOffset(ShipSimFields.posZ, 4, "ShipSim.posZ");
    assertOffset(ShipSimFields.heading, 8, "ShipSim.heading");
    assertOffset(ShipSimFields.speed, 12, "ShipSim.speed");
    assertOffset(ShipSimFields.slotX, 16, "ShipSim.slotX");
    assertOffset(ShipSimFields.slotZ, 20, "ShipSim.slotZ");
    assertOffset(ShipSimFields.trailWrite, 24, "ShipSim.trailWrite");
    assertOffset(ShipSimFields.sinceSample, 28, "ShipSim.sinceSample");
    assertOffset(ShipSimFields.mode, 32, "ShipSim.mode");
    assertOffset(ShipSimFields.fleetIndex, 36, "ShipSim.fleetIndex");
    assertOffset(ShipSimFields.targetKind, 40, "ShipSim.targetKind");
    assertOffset(ShipSimFields.orbitPhase, 44, "ShipSim.orbitPhase");
    assertOffset(ShipSimFields.accel, 48, "ShipSim.accel");
    assertOffset(ShipSimFields.cruiseV, 52, "ShipSim.cruiseV");
    assertOffset(ShipSimFields.orbitR, 56, "ShipSim.orbitR");
    assertOffset(ShipSimFields.orbitOmega, 60, "ShipSim.orbitOmega");
    if (ShipSimFields.orbitOmega + 4 !== SHIP_SIM_STRIDE) {
        throw new Error("ShipSim last field does not end at SHIP_SIM_STRIDE");
    }
}
//# sourceMappingURL=ship-sim-layout.js.map