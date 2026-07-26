/**
 * L2 — pack draw instances for WebGPU fleet ships.
 * Formation is CPU-packed once (spawn/rebuild); L3/L5 compute overwrites base
 * + rotation every frame. writeShipBases remains for tests / offline tools.
 * Uses same formation randomness as fleet-geometry when seed provided.
 *
 * L4/W4: writeFleetImpostor / writeFleetIcon / writeFleetVisualShips apply LOD
 * allocations (formation / world impostor / screen-space icon) without GPU APIs.
 *
 * L5/R1: initShipSimFromDrawFormation lifts formation centers into ShipSim
 * **local** slots + full agent fields (mode/fleetIndex/target/orbit/accel).
 */
import { FLEET_SHIP_DRAW_STRIDE } from "../gpu/fleet-ships.wgsl.js";
import { RENDER_PLANE_Y } from "../../../contracts/render-constants.js";
import { BASE_SHIP_SIZE, BLUE_SCALE, countShips, GREEN_SCALE, ICON_SCREEN_PX, impostorColor, RED_SCALE, } from "./fleet-lod.js";
import { rotateLocalSlot, shipDrawRotation, SHIP_MODE_JUMP, SHIP_MODE_PAUSED, } from "./ship-flight-ref.js";
import { hashOrbitParams, hashShipMotionParams } from "./ship-orbit-ref.js";
import { TRAIL_MIN_DIST } from "./fleet-trail-ref.js";
import { SHIP_SIM_STRIDE, SHIP_TARGET_FLEET_CENTER, SHIP_TARGET_PATH_END, readShipSim, writeShipSim, } from "./ship-sim-layout.js";
import { jumpStaggerMs } from "./fleet-lod.js";
/** Draw pad float: >0.5 → size is screen-space px (icon). */
export const SHIP_DRAW_SCREEN_SPACE = 1;
/** Lateral (right) spacing per type scale for grid formation. */
const FORM_LAT_SPACING = 8;
/** Depth (forward) spacing per type scale for grid formation. */
const FORM_DEPTH_SPACING = 10;
/** Floats per draw instance (FLEET_SHIP_DRAW_STRIDE / 4). */
export const FLEET_SHIP_DRAW_FLOATS = FLEET_SHIP_DRAW_STRIDE / 4;
/**
 * Mulberry32 — deterministic PRNG for pack tests / stable formation per fleet id.
 */
export function mulberry32(seed) {
    let t = seed >>> 0;
    return () => {
        t += 0x6d2b79f5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}
export function hashStringSeed(id) {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) {
        h ^= id.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
/** Total ship instances for counts (1:1). */
export function countFleetShips(counts) {
    return counts.red + counts.blue + counts.green;
}
/**
 * Write formation once at `instanceStart`. Does not allocate per-ship objects.
 * Layout per instance: base.xyz, center.xyz, rotation, size, color.rgb, pad
 *
 * Centers are **local** formation slots: +X = right, +Z = forward (path-aligned
 * after L5 init / integrate). Each type packs a centered grid with light PRNG
 * jitter (±10% of spacing) so ships stay structured, not a random world blob.
 *
 * Note: mulberry32 is re-seeded from the fleet id each pack, but draw count is
 * sequential per type — when L4 scales visualCounts down/up, later ships shift
 * in the PRNG stream so formation positions can flicker on budget changes.
 * Acceptable for LOD; do not re-pack every frame solely to avoid that.
 *
 * @returns number of instances written
 */
export function writeFleetFormation(data, instanceStart, counts, seed, baseX, baseY, baseZ) {
    const rand = mulberry32(seed);
    let cursor = instanceStart;
    const writeShip = (colorR, colorG, colorB, centerX, centerZ, rotation, size) => {
        const o = cursor * FLEET_SHIP_DRAW_FLOATS;
        data[o] = baseX;
        data[o + 1] = baseY;
        data[o + 2] = baseZ;
        data[o + 3] = centerX;
        data[o + 4] = 0;
        data[o + 5] = centerZ;
        data[o + 6] = rotation;
        data[o + 7] = size;
        data[o + 8] = colorR;
        data[o + 9] = colorG;
        data[o + 10] = colorB;
        data[o + 11] = 0;
        cursor += 1;
    };
    const writeScaled = (count, scale, colorR, colorG, colorB) => {
        if (count <= 0)
            return;
        const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
        const rows = Math.ceil(count / cols);
        const latSpace = FORM_LAT_SPACING * scale;
        const depthSpace = FORM_DEPTH_SPACING * scale;
        const originX = -((cols - 1) * latSpace) / 2;
        const originZ = -((rows - 1) * depthSpace) / 2;
        for (let i = 0; i < count; i++) {
            const col = i % cols;
            const row = (i / cols) | 0;
            // ±10% of spacing
            const jx = (rand() - 0.5) * 0.2 * latSpace;
            const jz = (rand() - 0.5) * 0.2 * depthSpace;
            const slotX = originX + col * latSpace + jx;
            const slotZ = originZ + row * depthSpace + jz;
            writeShip(colorR, colorG, colorB, slotX, slotZ, 0, // L5 init / compute overwrites with path-facing rotation
            BASE_SHIP_SIZE * scale * (0.6 + rand() * 0.4));
        }
    };
    writeScaled(counts.red, RED_SCALE, 1.0, 0.2, 0.2);
    writeScaled(counts.blue, BLUE_SCALE, 0.2, 0.6, 1.0);
    writeScaled(counts.green, GREEN_SCALE, 0.2, 1.0, 0.4);
    return cursor - instanceStart;
}
/**
 * Patch world base.xyz only for a contiguous instance range.
 * Zero allocations. Used by tests; runtime L3 compute scatters bases on GPU.
 */
export function writeShipBases(data, instanceStart, instanceCount, baseX, baseY, baseZ) {
    const end = instanceStart + instanceCount;
    for (let i = instanceStart; i < end; i++) {
        const o = i * FLEET_SHIP_DRAW_FLOATS;
        data[o] = baseX;
        data[o + 1] = baseY;
        data[o + 2] = baseZ;
    }
}
/**
 * L4 / W4 — mid-band icon (same screen-space size as FAR / writeFleetIcon).
 * Dominant type color. Live GPU LOD also uses ICON_SCREEN_PX + pad=1 for MID.
 * Returns 0 if empty else 1.
 */
export function writeFleetImpostor(data, instanceStart, counts, baseX, baseY, baseZ) {
    // Same metrics as FAR icon — only trail policy differs at runtime.
    return writeFleetIcon(data, instanceStart, counts, baseX, baseY, baseZ, ICON_SCREEN_PX);
}
/**
 * W4 — far-band screen-space icon: one triangle, size = ICON_SCREEN_PX,
 * pad = SHIP_DRAW_SCREEN_SPACE. Type color from dominant ship type.
 * Shader converts px → world using cameraY / viewportH / tanHalfFov.
 * Returns 0 if empty else 1. Trails disabled via FLEET_FLAG_NO_TRAIL on FleetGpu.
 */
export function writeFleetIcon(data, instanceStart, counts, baseX, baseY, baseZ, screenPx = ICON_SCREEN_PX) {
    const total = countShips(counts);
    if (total <= 0)
        return 0;
    const color = impostorColor(counts);
    const o = instanceStart * FLEET_SHIP_DRAW_FLOATS;
    data[o] = baseX;
    data[o + 1] = baseY;
    data[o + 2] = baseZ;
    data[o + 3] = 0;
    data[o + 4] = 0;
    data[o + 5] = 0;
    data[o + 6] = 0;
    data[o + 7] = screenPx;
    data[o + 8] = color.r;
    data[o + 9] = color.g;
    data[o + 10] = color.b;
    data[o + 11] = SHIP_DRAW_SCREEN_SPACE;
    return 1;
}
/**
 * L4 / W4 — pack formation, world impostor, or screen-space icon for one fleet.
 * `alloc.visualCounts` must already be scaled to `alloc.shipCount` when formation.
 */
export function writeFleetVisualShips(data, instanceStart, trueCounts, seed, baseX, baseY, baseZ, alloc) {
    if (alloc.shipCount <= 0)
        return 0;
    if (alloc.isIcon) {
        return writeFleetIcon(data, instanceStart, trueCounts, baseX, baseY, baseZ);
    }
    if (alloc.isImpostor) {
        return writeFleetImpostor(data, instanceStart, trueCounts, baseX, baseY, baseZ);
    }
    return writeFleetFormation(data, instanceStart, alloc.visualCounts, seed, baseX, baseY, baseZ);
}
/**
 * Infer ship typeId from packed draw color (0 red / 1 blue / 2 green).
 * Impostor blended colors fall through by dominant channel.
 */
function typeIdFromDrawColor(r, g, b) {
    if (r >= g && r >= b)
        return 0;
    if (b >= g)
        return 1;
    return 2;
}
/**
 * L5 / R1 / R3 — after pack: lift draw center offsets into ShipSim **local** slots, set
 * world pos via path-aligned rotation, path-facing heading/rotation, zero draw centers.
 * Writes full ShipSim64 agent fields (mode, fleetIndex, targetKind, orbit, accel/cruise).
 *
 * For each instance i in [instanceStart, instanceStart+count):
 *   slot = (center.x, center.z) from draw — local right/forward
 *   formH = `formationHeading` only (never path dir — that snaps slots on hop)
 *   world = rotateLocalSlot(slot, formH)
 *   pos = draw base + world  (pack base is current fleet visual / node / mid-lerp)
 *   heading = formH; speed = 0
 *   personal orbit/motion = hashOrbitParams / hashShipMotionParams(seed ^ i)
 *   write full ShipSim; zero draw center; set base = pos; rotation = shipDrawRotation
 *
 * Structure-rebuild only. Jump edges never rewrite ShipSim — GPU pose is the
 * source of truth between rebuilds; a jump is only a FleetGpu path command.
 *
 * R3 impostor/icon: pass `paused=true` → mode PAUSED, target FLEET_CENTER,
 * draw rotation 0 (cs_fleets owns ease translate; ships pass no-ops).
 * Formation: `paused=false` → mode JUMP (cs_ships owns agent + draw).
 * Size/color floats left alone.
 */
export function initShipSimFromDrawFormation(instanceData, shipSimView, instanceStart, count, pathStartX, pathStartZ, pathEndX, pathEndZ, 
/** @deprecated ignored — kept for call-site compatibility; pos always base+rotated(slot) */
_jumping = false, 
/** Fleet formation facing (stable across hops). */
formationHeading = 0, 
/** Owning fleet index into FleetGpu array. */
fleetIndex = 0, 
/** Fleet seed for personal param hashes (xor ship local index). */
seed = 1, 
/**
 * R3: true for impostor/icon → mode=PAUSED + target FLEET_CENTER + rotation 0.
 * Formation keeps false → JUMP + PATH_END + path-facing draw rotation.
 */
paused = false, 
/**
 * Local ship index of `instanceStart` within the fleet (for personal hashes
 * on LOD growth tails). Default 0 = range starts at first fleet ship.
 */
localIndexStart = 0) {
    if (count <= 0)
        return;
    void _jumping;
    void pathStartX;
    void pathStartZ;
    void pathEndX;
    void pathEndZ;
    const formH = formationHeading;
    // R3: impostor/icon draw rotation stays 0 (no ship turn); formation faces formH.
    const rotation = paused ? 0 : shipDrawRotation(formH);
    const mode = paused ? SHIP_MODE_PAUSED : SHIP_MODE_JUMP;
    const targetKind = paused ? SHIP_TARGET_FLEET_CENTER : SHIP_TARGET_PATH_END;
    const fleetIdx = fleetIndex >>> 0;
    const seedU = seed >>> 0;
    const localBase = localIndexStart | 0;
    for (let i = 0; i < count; i++) {
        const inst = instanceStart + i;
        const o = inst * FLEET_SHIP_DRAW_FLOATS;
        const baseX = instanceData[o];
        const baseZ = instanceData[o + 2];
        const slotX = instanceData[o + 3];
        const slotZ = instanceData[o + 5];
        const colorR = instanceData[o + 8];
        const colorG = instanceData[o + 9];
        const colorB = instanceData[o + 10];
        const world = rotateLocalSlot(slotX, slotZ, formH);
        const posX = baseX + world.x;
        const posZ = baseZ + world.z;
        // Personal params: seed ^ local ship index (stable within fleet pack order).
        const personalSeed = (seedU ^ ((localBase + i) >>> 0)) >>> 0;
        const typeId = typeIdFromDrawColor(colorR, colorG, colorB);
        const orbit = hashOrbitParams(personalSeed, typeId);
        const motion = hashShipMotionParams(personalSeed, typeId);
        writeShipSim(shipSimView, inst * SHIP_SIM_STRIDE, {
            posX,
            posY: 0,
            posZ,
            heading: formH,
            speed: 0,
            slotX,
            slotY: 0,
            slotZ,
            // quat derived from heading inside writeShipSim
            trailWrite: 0,
            sinceSample: 0,
            mode,
            fleetIndex: fleetIdx,
            targetKind,
            orbitPhase: orbit.phase0,
            accel: motion.accel,
            cruiseV: motion.cruiseV,
            orbitR: orbit.radius,
            orbitOmega: orbit.omega,
            omegaMax: motion.omegaMax,
            // Visual hop desync 0..500ms so fleet members leave/arrive out of lockstep
            jumpStaggerMs: paused ? 0 : jumpStaggerMs(personalSeed, localBase + i),
        });
        // Draw: world in base, center zeroed; size/color untouched
        // Mesh remains XZ billboard; y = plane (planar pack).
        instanceData[o] = posX;
        instanceData[o + 1] = RENDER_PLANE_Y;
        instanceData[o + 2] = posZ;
        instanceData[o + 3] = 0;
        instanceData[o + 4] = 0;
        instanceData[o + 5] = 0;
        instanceData[o + 6] = rotation;
    }
}
/**
 * Pure helper: keep world pos/heading, zero speed, prime trail gate.
 * Force mode=JUMP + targetKind=PATH_END for hop; preserve personal agent fields.
 *
 * **Not used on the live jump edge.** GPU ShipSim is authoritative after
 * integrate; the CPU mirror is stale, so re-uploading it on jump caused
 * one-frame snaps (mild for fleets just rebuilt, drastic after a prior hop).
 * Production only writes FleetGpu path commands on jump; integrate steers
 * from the live GPU pose toward `pathEnd + rotate(slot, pathH)`.
 *
 * Kept for unit tests / offline tooling that own a fresh CPU mirror.
 *
 * Optional `fleetIndex` overwrites owner index when ≥ 0 (default: keep prev).
 */
export function reinitShipSimAtJumpStart(instanceData, shipSimView, instanceStart, count, _pathStartX, _pathStartZ, _pathEndX, _pathEndZ, fleetIndex = -1) {
    if (count <= 0)
        return;
    void _pathStartX;
    void _pathStartZ;
    void _pathEndX;
    void _pathEndZ;
    for (let i = 0; i < count; i++) {
        const inst = instanceStart + i;
        const prev = readShipSim(shipSimView, inst * SHIP_SIM_STRIDE);
        const posX = prev.posX;
        const posZ = prev.posZ;
        const heading = prev.heading;
        const rotation = shipDrawRotation(heading);
        writeShipSim(shipSimView, inst * SHIP_SIM_STRIDE, {
            posX,
            posY: prev.posY ?? 0,
            posZ,
            heading,
            speed: 0,
            slotX: prev.slotX,
            slotY: prev.slotY ?? 0,
            slotZ: prev.slotZ,
            qx: prev.qx,
            qy: prev.qy,
            qz: prev.qz,
            qw: prev.qw,
            trailWrite: prev.trailWrite,
            sinceSample: TRAIL_MIN_DIST,
            // R1: hop → JUMP toward path end; keep personal orbit/motion + fleetIndex
            mode: SHIP_MODE_JUMP,
            fleetIndex: fleetIndex >= 0 ? fleetIndex >>> 0 : prev.fleetIndex,
            targetKind: SHIP_TARGET_PATH_END,
            orbitPhase: prev.orbitPhase,
            accel: prev.accel,
            cruiseV: prev.cruiseV,
            orbitR: prev.orbitR,
            orbitOmega: prev.orbitOmega,
        });
        const o = inst * FLEET_SHIP_DRAW_FLOATS;
        instanceData[o] = posX;
        instanceData[o + 1] = prev.posY ?? RENDER_PLANE_Y;
        instanceData[o + 2] = posZ;
        instanceData[o + 3] = 0;
        instanceData[o + 4] = 0;
        instanceData[o + 5] = 0;
        instanceData[o + 6] = rotation;
    }
}
/**
 * Pack ship draw instances into a new Float32Array (tests / one-shot rebuilds).
 * Prefer writeFleetFormation once; L3 compute owns per-frame bases.
 */
export function packFleetShipDrawInstances(fleets) {
    let total = 0;
    for (const f of fleets) {
        total += countFleetShips(f.counts);
    }
    const data = new Float32Array(total * FLEET_SHIP_DRAW_FLOATS);
    let cursor = 0;
    for (const fleet of fleets) {
        const n = writeFleetFormation(data, cursor, fleet.counts, fleet.seed ?? 1, fleet.base.x, fleet.base.y ?? RENDER_PLANE_Y, fleet.base.z);
        cursor += n;
    }
    return { data, instanceCount: cursor };
}
//# sourceMappingURL=fleet-ship-pack.js.map