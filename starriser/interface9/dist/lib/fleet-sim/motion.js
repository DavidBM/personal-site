/**
 * Curated continuous visual motion API.
 *
 * Thin wrappers over integrate / pack / layout — no formula, stride, or WGSL
 * changes. Preferred entry for go-to-orbit hops: command + step + pack.
 *
 * Domain (discrete path / events) stays under domain/* and worker shims.
 */
import { integrateFleetPos } from "./visual/fleet-integrate-ref.js";
import { FLEET_FLAG_ALIVE, FLEET_FLAG_JUMPING, FLEET_FLAG_SPACE3D, FLEET_GPU_STRIDE, hashFleetId, writeFleetGpu, } from "./visual/fleet-layout.js";
import { FLEET_SHIP_DRAW_FLOATS, initShipSimFromDrawFormation, writeFleetFormation, } from "./visual/fleet-ship-pack.js";
import { clamp01, ease01, integrateShipAgent, } from "./visual/ship-flight-ref.js";
import { SHIP_SIM_STRIDE, ShipSimFields, readShipSim, writeShipSim, } from "./visual/ship-sim-layout.js";
/**
 * Resolve jump vs cruise from travelMode / deprecated jumping.
 * - jump if travelMode === "jump" OR (travelMode unset && jumping !== false)
 * - cruise if travelMode === "cruise" OR jumping === false
 */
export function resolveTravelMode(cmd) {
    if (cmd.travelMode === "jump" || cmd.travelMode === "cruise") {
        return cmd.travelMode;
    }
    return cmd.jumping === false ? "cruise" : "jump";
}
// ---------------------------------------------------------------------------
// Hot-path scratch (stepShips) — one agent object reused across the loop
// ---------------------------------------------------------------------------
const _stepScratch = {
    posX: 0,
    posZ: 0,
    posY: 0,
    heading: 0,
    speed: 0,
    slotX: 0,
    slotY: 0,
    slotZ: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    mode: 0,
    orbitR: 0,
    orbitOmega: 0,
    orbitPhase: 0,
    accel: 0,
    cruiseV: 0,
    omegaMax: 0,
};
/**
 * Fleet-center ease active:
 * - jump: always ease (integrateFleetPos jumping)
 * - travelMode "cruise": ease when durationMs > 0, else park at target
 * - legacy jumping:false (no travelMode): always park at target
 */
function fleetCenterEaseActive(cmd) {
    if (resolveTravelMode(cmd) === "jump")
        return true;
    if (cmd.travelMode === "cruise")
        return cmd.durationMs > 0;
    return false;
}
/** @deprecated internal — use resolveTravelMode; true when jump travel. */
function cmdJumping(cmd) {
    return resolveTravelMode(cmd) === "jump";
}
function pointY(p, fallback = 0) {
    return p.y !== undefined ? p.y : fallback;
}
// ---------------------------------------------------------------------------
// Free functions (tree-shakeable)
// ---------------------------------------------------------------------------
/** CPU: ease fleet center along command. Returns {x,y,z} with y from command or 0. */
export function fleetCenter(cmd, nowRel) {
    // jump: always ease. cruise: ease when durationMs > 0, else park at target.
    // (Legacy jumping:false with from===target is a no-op either way.)
    const ease = fleetCenterEaseActive(cmd);
    const fromY = pointY(cmd.from, 0);
    const targetY = pointY(cmd.target, fromY);
    const xz = integrateFleetPos({
        jumping: ease,
        pathStartX: cmd.from.x,
        pathStartZ: cmd.from.z,
        pathEndX: cmd.target.x,
        pathEndZ: cmd.target.z,
        t0: cmd.t0,
        durationMs: cmd.durationMs,
        now: nowRel,
    });
    let y;
    if (!ease) {
        y = targetY;
    }
    else {
        const u = cmd.durationMs <= 0
            ? 1
            : clamp01((nowRel - cmd.t0) / cmd.durationMs);
        const s = ease01(u);
        y = fromY + (targetY - fromY) * s;
    }
    return { x: xz.x, y, z: xz.z };
}
/** CPU: step one ship in place toward cmd.target (orbit center). Mutates ship. */
export function stepShip(ship, cmd, clock) {
    const fromY = pointY(cmd.from, 0);
    const targetY = pointY(cmd.target, 0);
    const mode = resolveTravelMode(cmd);
    // jump: domainWarp default inferred mid-hop in integrateShipAgent.
    // cruise: domainWarp default false (speed-limited Cruise profile).
    const domainWarpActive = cmd.domainWarpActive !== undefined
        ? cmd.domainWarpActive
        : mode === "cruise"
            ? false
            : undefined;
    return integrateShipAgent(ship, {
        centerX: cmd.target.x,
        centerZ: cmd.target.z,
        centerY: targetY,
        pathStartX: cmd.from.x,
        pathStartZ: cmd.from.z,
        pathStartY: fromY,
        pathEndX: cmd.target.x,
        pathEndZ: cmd.target.z,
        pathEndY: targetY,
        formationHeading: cmd.formationHeading ?? 0,
        dtMs: clock.dtMs,
        nowRel: clock.nowRel,
        t0: cmd.t0,
        durationMs: cmd.durationMs,
        domainWarpActive,
        space3d: cmd.space3d,
    });
}
/**
 * CPU: step many ships in a ShipSim buffer [instanceStart, +count).
 * Reuses one scratch agent; does not allocate per-ship wrappers beyond readShipSim.
 */
export function stepShips(shipSimView, instanceStart, count, cmd, clock) {
    if (count <= 0)
        return;
    const scratch = _stepScratch;
    for (let i = 0; i < count; i++) {
        const o = (instanceStart + i) * SHIP_SIM_STRIDE;
        const rec = readShipSim(shipSimView, o);
        scratch.posX = rec.posX;
        scratch.posY = rec.posY;
        scratch.posZ = rec.posZ;
        scratch.speed = rec.speed;
        scratch.qx = rec.qx;
        scratch.qy = rec.qy;
        scratch.qz = rec.qz;
        scratch.qw = rec.qw;
        scratch.slotX = rec.slotX;
        scratch.slotY = rec.slotY;
        scratch.slotZ = rec.slotZ;
        scratch.heading = rec.heading;
        scratch.mode = rec.mode;
        scratch.orbitR = rec.orbitR;
        scratch.orbitOmega = rec.orbitOmega;
        scratch.orbitPhase = rec.orbitPhase;
        scratch.accel = rec.accel;
        scratch.cruiseV = rec.cruiseV;
        scratch.omegaMax = rec.omegaMax;
        // trail / fleetIndex / targetKind stay on the buffer via writeShipSim merge
        stepShip(scratch, cmd, clock);
        writeShipSim(shipSimView, o, {
            posX: scratch.posX,
            posY: scratch.posY,
            posZ: scratch.posZ,
            speed: scratch.speed,
            qx: scratch.qx,
            qy: scratch.qy,
            qz: scratch.qz,
            qw: scratch.qw,
            slotX: scratch.slotX,
            slotY: scratch.slotY,
            slotZ: scratch.slotZ,
            heading: scratch.heading,
            trailWrite: rec.trailWrite,
            sinceSample: rec.sinceSample,
            mode: scratch.mode,
            fleetIndex: rec.fleetIndex,
            targetKind: rec.targetKind,
            orbitPhase: scratch.orbitPhase,
            accel: scratch.accel,
            cruiseV: scratch.cruiseV,
            orbitR: scratch.orbitR,
            orbitOmega: scratch.orbitOmega,
            omegaMax: scratch.omegaMax ?? rec.omegaMax,
        });
    }
}
/**
 * Pack formation draw instances into existing Float32Array at instanceStart.
 * Thin wrap of writeFleetFormation. Returns ship count written.
 */
export function packFormation(instanceData, instanceStart, counts, seed, base) {
    return writeFleetFormation(instanceData, instanceStart, counts, seed, base.x, pointY(base, 0), base.z);
}
/**
 * When `cmd.orbitRadius` is a finite value &gt; 0, stamp that R on contiguous
 * ShipSim rows. Other agent fields (ω, accel, …) are left alone.
 * No-op when unset — keeps hashed personal radii from formation init.
 * Spawn/structure only; never call from rAF.
 */
export function applyOrbitRadiusIfSet(shipSimView, instanceStart, count, cmd) {
    const R = cmd.orbitRadius;
    if (!(typeof R === "number" && Number.isFinite(R) && R > 0) || count <= 0) {
        return;
    }
    const r = Math.max(1e-3, R);
    for (let i = 0; i < count; i++) {
        const o = (instanceStart + i) * SHIP_SIM_STRIDE;
        shipSimView.setFloat32(o + ShipSimFields.orbitR, r, true);
    }
}
/**
 * Init ShipSim from just-packed draw formation + command path context.
 * Thin wrap of initShipSimFromDrawFormation; applies optional orbitRadius after.
 */
export function initShipsFromFormation(opts) {
    const cmd = opts.cmd;
    initShipSimFromDrawFormation(opts.instanceData, opts.shipSimView, opts.instanceStart, opts.count, cmd.from.x, cmd.from.z, cmd.target.x, cmd.target.z, cmdJumping(cmd), cmd.formationHeading ?? 0, opts.fleetIndex ?? 0, opts.seed ?? 1, opts.paused ?? false, opts.localIndexStart ?? 0);
    applyOrbitRadiusIfSet(opts.shipSimView, opts.instanceStart, opts.count, cmd);
}
/**
 * Write FleetGpu path/command row (go-to-orbit into GPU buffer).
 * Thin wrap of writeFleetGpu with cmd fields + meta.
 * Flags are caller-owned (packJumpingFleet sets JUMPING from travelMode);
 * SPACE3D + pathEndY are OR'd when cmd.space3d or any y≠0.
 */
export function writePathCommand(view, byteOffset, cmd, meta) {
    const fromY = pointY(cmd.from, 0);
    const targetY = pointY(cmd.target, 0);
    const space3d = cmd.space3d === true ||
        Math.abs(fromY) > 1e-9 ||
        Math.abs(targetY) > 1e-9;
    let flags = meta.flags >>> 0;
    if (space3d)
        flags |= FLEET_FLAG_SPACE3D;
    writeFleetGpu(view, byteOffset, {
        posX: meta.posX,
        posZ: meta.posZ,
        heading: meta.heading,
        pathStartX: cmd.from.x,
        pathStartZ: cmd.from.z,
        pathEndX: cmd.target.x,
        pathEndZ: cmd.target.z,
        t0: cmd.t0,
        durationMs: cmd.durationMs,
        flags,
        shipBudget: meta.shipBudget,
        red: meta.red,
        blue: meta.blue,
        green: meta.green,
        instanceStart: meta.instanceStart,
        fleetIdHash: meta.fleetIdHash,
        pathEndY: space3d ? targetY : 0,
    });
}
/**
 * One-shot pack: FleetGpu row + formation draw + ShipSim for a hop.
 * Default travelMode is jump. Tests only — not for per-frame use.
 */
export function packJumpingFleet(opts) {
    const shipCount = Math.max(1, (opts.shipCount ?? 8) | 0);
    const from = opts.from ?? { x: 0, z: 0 };
    const target = opts.target ?? { x: 8000, z: 0 };
    const t0 = opts.t0 ?? 0;
    const durationMs = opts.durationMs ?? 10000;
    const instanceStart = opts.instanceStart ?? 0;
    const fleetId = opts.fleetId ?? "test-fleet-1";
    const seed = hashFleetId(fleetId);
    const travelMode = opts.travelMode ?? "jump";
    const dx = target.x - from.x;
    const dz = target.z - from.z;
    const heading = opts.formationHeading !== undefined
        ? opts.formationHeading
        : Math.hypot(dx, dz) > 1e-9
            ? Math.atan2(dx, dz)
            : 0;
    const fromY = pointY(from, 0);
    const targetY = pointY(target, 0);
    const space3d = Math.abs(fromY) > 1e-9 || Math.abs(targetY) > 1e-9;
    const cmd = {
        from: { x: from.x, y: fromY, z: from.z },
        target: { x: target.x, y: targetY, z: target.z },
        durationMs,
        t0,
        formationHeading: heading,
        travelMode,
        jumping: travelMode === "jump",
        space3d: space3d || undefined,
    };
    if (typeof opts.orbitRadius === "number" &&
        Number.isFinite(opts.orbitRadius) &&
        opts.orbitRadius > 0) {
        cmd.orbitRadius = opts.orbitRadius;
    }
    const red = shipCount;
    const blue = 0;
    const green = 0;
    const fleetGpuU8 = new Uint8Array(FLEET_GPU_STRIDE);
    const fleetView = new DataView(fleetGpuU8.buffer, fleetGpuU8.byteOffset, fleetGpuU8.byteLength);
    // jump → ALIVE|JUMPING; cruise → ALIVE only (no timed warp flag)
    const flags = travelMode === "jump"
        ? FLEET_FLAG_ALIVE | FLEET_FLAG_JUMPING
        : FLEET_FLAG_ALIVE;
    writePathCommand(fleetView, 0, cmd, {
        posX: from.x,
        posZ: from.z,
        heading,
        flags,
        shipBudget: shipCount,
        red,
        blue,
        green,
        instanceStart,
        fleetIdHash: seed,
    });
    const instanceData = new Float32Array((instanceStart + shipCount) * FLEET_SHIP_DRAW_FLOATS);
    const written = packFormation(instanceData, instanceStart, { red, blue, green }, seed, { x: from.x, y: pointY(from, 0), z: from.z });
    if (written !== shipCount) {
        throw new Error(`packJumpingFleet: packFormation wrote ${written}, expected ${shipCount}`);
    }
    const shipSimU8 = new Uint8Array((instanceStart + shipCount) * SHIP_SIM_STRIDE);
    const shipSimView = new DataView(shipSimU8.buffer, shipSimU8.byteOffset, shipSimU8.byteLength);
    initShipsFromFormation({
        instanceData,
        shipSimView,
        instanceStart,
        count: shipCount,
        cmd,
        fleetIndex: 0,
        seed,
        paused: false,
        localIndexStart: 0,
    });
    return {
        fleetGpuU8,
        fleetView,
        instanceData,
        shipSimU8,
        shipSimView,
        shipCount,
        instanceStart,
        cmd,
        seed,
        heading,
    };
}
/** Factory — same free functions bound into one object. */
export function createMotion() {
    return {
        fleetCenter,
        stepShip,
        stepShips,
        packFormation,
        initShipsFromFormation,
        writePathCommand,
        packJumpingFleet,
        applyOrbitRadiusIfSet,
    };
}
//# sourceMappingURL=motion.js.map