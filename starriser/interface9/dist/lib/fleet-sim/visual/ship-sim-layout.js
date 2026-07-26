/**
 * R0 / L5 / 3D — ShipSim GPU storage layout (per-ship continuous flight state).
 *
 * Host-shareable-friendly **stride 96** (16-byte aligned). Scalar fields only.
 * Field order is the contract for TS packing, WGSL structs, and goldens.
 *
 * ShipSim (stride 96):
 *  0  f32 posX
 *  4  f32 posY          // 2D always 0
 *  8  f32 posZ
 * 12  f32 speed
 * 16  f32 qx            // orientation quaternion (source of truth in 3D)
 * 20  f32 qy
 * 24  f32 qz
 * 28  f32 qw
 * 32  f32 slotX         // local formation (right); world = rotate(slot, formH)
 * 36  f32 slotY         // 2D always 0
 * 40  f32 slotZ
 * 44  f32 heading       // CACHED yaw from quat (heading 0 = +Z); draw + tests
 * 48  u32 trailWrite    // next ring index (L5b pure trail; power-of-2 ring)
 * 52  f32 sinceSample   // distance since last trail append
 * 56  u32 mode          // SHIP_MODE_* (paused / seek-far=JUMP / seek-near=ORBIT)
 * 60  u32 fleetIndex
 * 64  u32 targetKind    // 0 FLEET_CENTER, 1 PATH_END, 2 WORLD
 * 68  f32 orbitPhase    // hot; advanced each orbit step
 * 72  f32 accel         // personal linear accel (world/s²)
 * 76  f32 cruiseV       // soft cruise (not hard clamp on jump)
 * 80  f32 orbitR
 * 84  f32 orbitOmega    // signed rad/s
 * 88  f32 omegaMax         // turn rate cap (rad/s); was pad0
 * 92  f32 jumpStaggerMs    // visual hop start delay 0..JUMP_STAGGER_MS_MAX
 *
 * omegaMax is stored per ship (from type config at pack). ≤0 → agents/GPU use
 * ORBIT_DEFAULT_OMEGA_MAX / SHIP_MAX_TURN_RAD_S.
 * Planar production keeps posY=slotY=0 and yaw-only quaternions.
 */
import { quatFromYaw, quatIsZero } from "./quat.js";
import { SHIP_MAX_TURN_RAD_S } from "./ship-motion-config.js";
/** Bytes — must match WGSL `struct ShipSim` packing. */
export const SHIP_SIM_STRIDE = 96;
export const ShipSimFields = {
    posX: 0,
    posY: 4,
    posZ: 8,
    speed: 12,
    qx: 16,
    qy: 20,
    qz: 24,
    qw: 28,
    slotX: 32,
    slotY: 36,
    slotZ: 40,
    heading: 44,
    trailWrite: 48,
    sinceSample: 52,
    mode: 56,
    fleetIndex: 60,
    targetKind: 64,
    orbitPhase: 68,
    accel: 72,
    cruiseV: 76,
    orbitR: 80,
    orbitOmega: 84,
    /** Turn rate cap (rad/s). */
    omegaMax: 88,
    /** @deprecated use omegaMax — same offset 88 */
    pad0: 88,
    /**
     * Visual jump start delay (ms). Agent holds until nowRel ≥ fleet.t0 + this.
     * @deprecated alias pad1
     */
    jumpStaggerMs: 92,
    pad1: 92,
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
/** Default turn cap when write omits omegaMax (matches red / global). */
export const SHIP_SIM_DEFAULT_OMEGA_MAX = SHIP_MAX_TURN_RAD_S;
/** Resolve quat + heading pair for write (heading fills zero quat). */
function resolveOrientation(ship) {
    const qx = ship.qx ?? 0;
    const qy = ship.qy ?? 0;
    const qz = ship.qz ?? 0;
    const qw = ship.qw ?? 0;
    if (quatIsZero(qx, qy, qz, qw)) {
        const q = quatFromYaw(ship.heading);
        return { heading: ship.heading, qx: q.x, qy: q.y, qz: q.z, qw: q.w };
    }
    // Non-zero quat provided — store both; planar pack usually derives quat from heading.
    return { heading: ship.heading, qx, qy, qz, qw };
}
/** Write one ShipSim record into a DataView at byte offset. */
export function writeShipSim(view, byteOffset, ship) {
    const o = byteOffset;
    const orient = resolveOrientation(ship);
    view.setFloat32(o + ShipSimFields.posX, ship.posX, true);
    view.setFloat32(o + ShipSimFields.posY, ship.posY ?? 0, true);
    view.setFloat32(o + ShipSimFields.posZ, ship.posZ, true);
    view.setFloat32(o + ShipSimFields.speed, ship.speed, true);
    view.setFloat32(o + ShipSimFields.qx, orient.qx, true);
    view.setFloat32(o + ShipSimFields.qy, orient.qy, true);
    view.setFloat32(o + ShipSimFields.qz, orient.qz, true);
    view.setFloat32(o + ShipSimFields.qw, orient.qw, true);
    view.setFloat32(o + ShipSimFields.slotX, ship.slotX, true);
    view.setFloat32(o + ShipSimFields.slotY, ship.slotY ?? 0, true);
    view.setFloat32(o + ShipSimFields.slotZ, ship.slotZ, true);
    view.setFloat32(o + ShipSimFields.heading, orient.heading, true);
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
    view.setFloat32(o + ShipSimFields.omegaMax, ship.omegaMax ?? SHIP_SIM_DEFAULT_OMEGA_MAX, true);
    view.setFloat32(o + ShipSimFields.jumpStaggerMs, ship.jumpStaggerMs ?? ship.pad1 ?? 0, true);
}
/** Read one ShipSim record (all stride-96 fields). */
export function readShipSim(view, byteOffset) {
    const o = byteOffset;
    return {
        posX: view.getFloat32(o + ShipSimFields.posX, true),
        posY: view.getFloat32(o + ShipSimFields.posY, true),
        posZ: view.getFloat32(o + ShipSimFields.posZ, true),
        speed: view.getFloat32(o + ShipSimFields.speed, true),
        qx: view.getFloat32(o + ShipSimFields.qx, true),
        qy: view.getFloat32(o + ShipSimFields.qy, true),
        qz: view.getFloat32(o + ShipSimFields.qz, true),
        qw: view.getFloat32(o + ShipSimFields.qw, true),
        slotX: view.getFloat32(o + ShipSimFields.slotX, true),
        slotY: view.getFloat32(o + ShipSimFields.slotY, true),
        slotZ: view.getFloat32(o + ShipSimFields.slotZ, true),
        heading: view.getFloat32(o + ShipSimFields.heading, true),
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
        omegaMax: view.getFloat32(o + ShipSimFields.omegaMax, true),
        jumpStaggerMs: view.getFloat32(o + ShipSimFields.jumpStaggerMs, true),
        pad1: view.getFloat32(o + ShipSimFields.pad1, true),
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
    if (SHIP_SIM_STRIDE !== 96) {
        throw new Error(`SHIP_SIM_STRIDE ${SHIP_SIM_STRIDE} !== 96`);
    }
    if (SHIP_SIM_STRIDE % 16 !== 0) {
        throw new Error("SHIP_SIM_STRIDE must be 16-byte aligned");
    }
    assertOffset(ShipSimFields.posX, 0, "ShipSim.posX");
    assertOffset(ShipSimFields.posY, 4, "ShipSim.posY");
    assertOffset(ShipSimFields.posZ, 8, "ShipSim.posZ");
    assertOffset(ShipSimFields.speed, 12, "ShipSim.speed");
    assertOffset(ShipSimFields.qx, 16, "ShipSim.qx");
    assertOffset(ShipSimFields.qy, 20, "ShipSim.qy");
    assertOffset(ShipSimFields.qz, 24, "ShipSim.qz");
    assertOffset(ShipSimFields.qw, 28, "ShipSim.qw");
    assertOffset(ShipSimFields.slotX, 32, "ShipSim.slotX");
    assertOffset(ShipSimFields.slotY, 36, "ShipSim.slotY");
    assertOffset(ShipSimFields.slotZ, 40, "ShipSim.slotZ");
    assertOffset(ShipSimFields.heading, 44, "ShipSim.heading");
    assertOffset(ShipSimFields.trailWrite, 48, "ShipSim.trailWrite");
    assertOffset(ShipSimFields.sinceSample, 52, "ShipSim.sinceSample");
    assertOffset(ShipSimFields.mode, 56, "ShipSim.mode");
    assertOffset(ShipSimFields.fleetIndex, 60, "ShipSim.fleetIndex");
    assertOffset(ShipSimFields.targetKind, 64, "ShipSim.targetKind");
    assertOffset(ShipSimFields.orbitPhase, 68, "ShipSim.orbitPhase");
    assertOffset(ShipSimFields.accel, 72, "ShipSim.accel");
    assertOffset(ShipSimFields.cruiseV, 76, "ShipSim.cruiseV");
    assertOffset(ShipSimFields.orbitR, 80, "ShipSim.orbitR");
    assertOffset(ShipSimFields.orbitOmega, 84, "ShipSim.orbitOmega");
    assertOffset(ShipSimFields.omegaMax, 88, "ShipSim.omegaMax");
    assertOffset(ShipSimFields.pad0, 88, "ShipSim.pad0 (alias omegaMax)");
    assertOffset(ShipSimFields.pad1, 92, "ShipSim.pad1");
    if (ShipSimFields.pad1 + 4 !== SHIP_SIM_STRIDE) {
        throw new Error("ShipSim last field does not end at SHIP_SIM_STRIDE");
    }
}
//# sourceMappingURL=ship-sim-layout.js.map