/**
 * L5 / R0 — pure CPU reference for per-ship **non-holonomic** flight (clock A).
 *
 * GPU-relative times (`t0`, `nowRel`, `durationMs`) match FleetGpu path commands.
 * Game phase transitions stay in fleets-worker; this module integrates continuous
 * visual ship pose.
 *
 * ## Unified controller (integrateShipAgent) — Rev 2
 * Modes: PAUSED | SEEK (=JUMP, geometric far) | CIRCULATE (=ORBIT, on ring).
 * **Mode is geometric band, not domain warp.**
 *
 *   SEEK: external-tangent entrance T (planar ring or sphere); desiredSpeedSeek
 *   CIRCULATE: polar XZ (planar) or sphere radial/tangential (space3d)
 * Profiles: Jump (domain warp SEEK, or residual dump) vs Cruise (default ring).
 * Capture: ρ ≤ max(ε_tiny, 0.2R) OR r ≤ 1.05R; exit r > 1.35R only when residual clear.
 * Space3d: full 3D |P−C| band + rem to sphere tangent aim.
 * Residual (no stride bit): active while v > 1.2·v_orb — Jump dump + freeze EXIT.
 * Design set@1.5/clear@1.2 approximated by sticky-until-1.2 while near (closes 1.2–1.5 thrash).
 * Enter-latch ≥4 frames: no free ShipSim field; residual freeze covers hot enter; cold enter uses radial hysteresis only.
 * **C is the hop destination (`pathEnd`); V_C = 0 in production.**
 *
 * ## Legacy schedule path (integrateShipFlight) — deprecated
 * Ease-scheduled jump speed + settle τ. Kept for goldens only.
 *
 * flockForce reserved for L5d.
 */
import { ORBIT_CAPTURE_K, ORBIT_CAPTURE_OUT_K, ORBIT_ENTRANCE_EPS_TINY, ORBIT_ENTRANCE_REM_K, computeOrbitAimTarget, computeSphereOrbitAimTarget, integrateOrbitSeekStep, orbitFloorSpeed, orbitSideSign, ORBIT_DEFAULT_OMEGA_MAX, } from "./ship-orbit-ref.js";
import { forwardFromQuat, quatFromYaw, quatIsZero, quatRotateVec3, yawFromQuat, } from "./quat.js";
// Tune curves / ease / orbit here — not scattered through this file:
//   js/gpu/ship-motion-config.ts
export { SHIP_MAX_TURN_RAD_S, SHIP_MAX_ACCEL, SHIP_MAX_BRAKE, SHIP_MAX_SPEED, SHIP_ARRIVE_EPS, SHIP_SETTLE_TAU_S, SHIP_TRACK_TAU_S, SHIP_MIN_ALIGN, SHIP_AIM_BLEND_START, SHIP_SNAP_MS, SHIP_NOSE_OFFSET, SHIP_DEFAULT_BRAKE_DIST, SHIP_BRAKE_DIST_MARGIN, SHIP_APPROACH_BRAKE_POWER, SHIP_LAUNCH_ACCEL_MIN, SHIP_LAUNCH_SPEED_FRAC, SHIP_MID_CRUISE_BOOST, SHIP_HOP_ARRIVE_FRAC, SHIP_SETTLE_CRUISE_CAP, SHIP_AGENT_SETTLE_ENTER_DIST, SHIP_AGENT_ORBIT_ENTER_DIST, SHIP_AGENT_ORBIT_ENTER_SPEED, CRUISE_ACCEL_SCALE, CRUISE_BRAKE_MULT, JUMP_BRAKE_MULT, V_OPEN_UNCAP, hopOpenSpeedFromDuration, HOP_OPEN_SPEED_MUL, HOP_OPEN_SPEED_MIN, ORBIT_ENTRANCE_EPS_TINY, RESIDUAL_HIGH_MUL, RESIDUAL_CLEAR_MUL, RESIDUAL_FREEZE_OUT_K, } from "./ship-motion-config.js";
import { SHIP_MAX_TURN_RAD_S, SHIP_MAX_ACCEL, SHIP_MAX_SPEED, SHIP_ARRIVE_EPS, SHIP_SETTLE_TAU_S, SHIP_TRACK_TAU_S, SHIP_MIN_ALIGN, SHIP_AIM_BLEND_START, SHIP_NOSE_OFFSET, SHIP_DEFAULT_BRAKE_DIST, SHIP_BRAKE_DIST_MARGIN, SHIP_APPROACH_BRAKE_POWER, SHIP_LAUNCH_ACCEL_MIN, SHIP_LAUNCH_SPEED_FRAC, SHIP_MID_CRUISE_BOOST, CRUISE_ACCEL_SCALE, CRUISE_BRAKE_MULT, JUMP_BRAKE_MULT, V_OPEN_UNCAP, hopOpenSpeedFromDuration, RESIDUAL_CLEAR_MUL, RESIDUAL_FREEZE_OUT_K, } from "./ship-motion-config.js";
// hopOpenSpeedFromDuration used by integrateShipAgent (domain hop clock).
// --- Ship modes (ShipSim.mode) — geometric band, NOT domain warp ---
/** Hold pose; speed forced to 0. Impostor / icon. */
export const SHIP_MODE_PAUSED = 0;
/**
 * SEEK far band (and pack init default). Geometric phase only —
 * not “fleet is jumping”. Mode flips to CIRCULATE/ORBIT at entrance.
 */
export const SHIP_MODE_JUMP = 1;
/** @deprecated SETTLE collapsed into continuous seek; value kept for layout compat. */
export const SHIP_MODE_SETTLE = 2;
/** CIRCULATE near / capture band. Trail append off. */
export const SHIP_MODE_ORBIT = 3;
/** Alias: continuous SEEK (same storage as JUMP for far). */
export const SHIP_MODE_SEEK = SHIP_MODE_JUMP;
/** Alias: CIRCULATE on ring (same storage as ORBIT). */
export const SHIP_MODE_CIRCULATE = SHIP_MODE_ORBIT;
// ---------------------------------------------------------------------------
// Orientation helpers (heading cache ↔ quaternion)
// ---------------------------------------------------------------------------
/** Sync cached heading from quaternion (body +Z → world). */
export function syncHeadingFromQuat(ship) {
    const qx = ship.qx ?? 0;
    const qy = ship.qy ?? 0;
    const qz = ship.qz ?? 0;
    const qw = ship.qw ?? 0;
    if (quatIsZero(qx, qy, qz, qw)) {
        ship.heading = ship.heading ?? 0;
        return;
    }
    ship.heading = yawFromQuat(qx, qy, qz, qw);
}
/** Build yaw-only quaternion from heading cache. */
export function syncQuatFromHeading(ship) {
    const h = ship.heading ?? 0;
    const q = quatFromYaw(h);
    ship.qx = q.x;
    ship.qy = q.y;
    ship.qz = q.z;
    ship.qw = q.w;
    ship.heading = h;
}
/**
 * Ensure posY/slotY and orientation are present and consistent.
 * Missing/zero quat → from heading; missing heading with valid quat → from quat.
 * Always leaves heading and quat in sync for the planar (yaw-only) case when
 * rebuilding from heading.
 */
export function ensureShipOrientation(ship) {
    if (ship.posY === undefined || !Number.isFinite(ship.posY))
        ship.posY = 0;
    if (ship.slotY === undefined || !Number.isFinite(ship.slotY))
        ship.slotY = 0;
    const qx = ship.qx ?? 0;
    const qy = ship.qy ?? 0;
    const qz = ship.qz ?? 0;
    const qw = ship.qw ?? 0;
    const hasQuat = !quatIsZero(qx, qy, qz, qw);
    const hasHeading = ship.heading !== undefined && Number.isFinite(ship.heading);
    if (!hasQuat && hasHeading) {
        syncQuatFromHeading(ship);
    }
    else if (hasQuat && !hasHeading) {
        ship.qx = qx;
        ship.qy = qy;
        ship.qz = qz;
        ship.qw = qw;
        syncHeadingFromQuat(ship);
    }
    else if (!hasQuat && !hasHeading) {
        ship.heading = 0;
        syncQuatFromHeading(ship);
    }
    else {
        // Both present — keep as-is (planar integrate uses heading then re-syncs quat).
        ship.qx = qx;
        ship.qy = qy;
        ship.qz = qz;
        ship.qw = qw;
    }
}
/** Clamp to [0, 1]. */
export function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}
/**
 * Quintic ease-in-out on [0,1] — more pronounced than smoothstep:
 * long slow start/end, sharp mid cruise.
 *   u < 0.5:  16 u^5
 *   u ≥ 0.5:  1 − (−2u+2)^5 / 2
 * s(0)=0, s(1)=1, s'(0)=s'(1)=0, s(0.5)=0.5.
 * Kept for fleet center / impostor / analytic orbit center velocity.
 */
export function ease01(u) {
    const x = clamp01(u);
    if (x < 0.5) {
        return 16 * x * x * x * x * x;
    }
    const t = -2 * x + 2;
    return 1 - (t * t * t * t * t) / 2;
}
/**
 * Derivative of ease01 (quintic): 80 u^4 on [0,0.5), 80 (1−u)^4 on (0.5,1]; 0 outside.
 * Peak 5.0 at u=0.5 (vs smoothstep 1.5) — clearly faster mid-hop.
 */
export function easeDeriv(u) {
    if (u <= 0 || u >= 1)
        return 0;
    if (u < 0.5) {
        const u2 = u * u;
        return 80 * u2 * u2;
    }
    const v = 1 - u;
    const v2 = v * v;
    return 80 * v2 * v2;
}
/** Wrap angle to (-π, π]. */
export function wrapPi(a) {
    let x = a;
    const twoPi = Math.PI * 2;
    while (x > Math.PI)
        x -= twoPi;
    while (x <= -Math.PI)
        x += twoPi;
    return x;
}
/**
 * Shortest signed turn from `from` to `to` in (-π, π].
 * Prefer this over wrapPi(to-from) for steering — stable at ±π.
 */
export function shortestAngleDelta(from, to) {
    return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}
/**
 * Draw rotation for the unit triangle mesh (tip at +X).
 * Shader maps tip → (cos θ, sin θ) in XZ. Motion forward is (sin h, cos h)
 * with heading 0 = +Z, so we need cos θ = sin h, sin θ = cos h → θ = π/2 − h.
 * (heading + π/2 was wrong: matches +Z only, faces opposite when moving ±X.)
 */
export function shipDrawRotation(heading) {
    return wrapPi(SHIP_NOSE_OFFSET - heading);
}
/**
 * Rotate a local formation slot (right=slotX, forward=slotZ[, up=slotY]) into world.
 * Planar: forward = (sin h, 0, cos h), right = (cos h, 0, -sin h); slotY stays 0.
 * With non-zero slotY and optional quat, uses full quaternion rotation.
 */
export function rotateLocalSlot(slotX, slotZ, heading, slotY = 0, quat) {
    if (quat && !quatIsZero(quat.x, quat.y, quat.z, quat.w)) {
        return quatRotateVec3(quat.x, quat.y, quat.z, quat.w, slotX, slotY, slotZ);
    }
    const cosH = Math.cos(heading);
    const sinH = Math.sin(heading);
    return {
        x: cosH * slotX + sinH * slotZ,
        y: slotY,
        z: -sinH * slotX + cosH * slotZ,
    };
}
/**
 * Formation heading for target slots.
 * Always use `formationHeading` (FleetGpu.heading). Path direction is **not**
 * used — swapping formH to path dir on jump edge reorients every slot in one frame.
 */
export function formationHeadingFromPath(_jumping, _pathStartX, _pathStartZ, _pathEndX, _pathEndZ, formationHeading = 0) {
    void _jumping;
    void _pathStartX;
    void _pathStartZ;
    void _pathEndX;
    void _pathEndZ;
    return formationHeading;
}
// ---------------------------------------------------------------------------
// R0 accel helpers
// ---------------------------------------------------------------------------
/**
 * Normative SEEK desire (F4 + F1): min(open, continuous energy env, one-step CFL).
 *
 *   env = √(max(0, v_f² + 2·a_down·ρ / m))
 *   cfl = max(v_f, ρ / max(dt, 1e-6))
 *   return min(v_open, env, cfl)
 *
 * Discrete safety requires CFL + post-speed clamp (in integrateOrbitSeekStep);
 * continuous root alone is not sufficient under Euler.
 */
export function desiredSpeedSeek(rho, vFloor, aDown, m, vOpen, dt) {
    const rhoP = rho > 1e-6 ? rho : 1e-6;
    const vf = vFloor > 0 ? vFloor : 0;
    const a = aDown > 1e-6 ? aDown : 1e-6;
    const margin = m > 1e-6 ? m : 1;
    const env = Math.sqrt(Math.max(0, vf * vf + (2 * a * rhoP) / margin));
    const cfl = Math.max(vf, rhoP / (dt > 1e-6 ? dt : 1e-6));
    const open = Number.isFinite(vOpen) && vOpen > 0 ? vOpen : V_OPEN_UNCAP;
    let out = open;
    if (env < out)
        out = env;
    if (cfl < out)
        out = cfl;
    return out;
}
/** @deprecated Alias of desiredSpeedSeek (import-stable name). */
export const desiredSpeedStoppable = desiredSpeedSeek;
/**
 * Desired speed given remaining distance: cruise until brakeDist, then
 * (rem/brake)^power · cruise. Legacy / aesthetic only — agent path uses
 * {@link desiredSpeedSeek}.
 */
export function approachSpeed(remDist, cruiseV, brakeDist, power = SHIP_APPROACH_BRAKE_POWER) {
    if (remDist <= 1e-9 || cruiseV <= 0)
        return 0;
    if (brakeDist <= 1e-9)
        return cruiseV;
    if (remDist >= brakeDist)
        return cruiseV;
    const t = remDist / brakeDist;
    const p = power > 0 ? power : SHIP_APPROACH_BRAKE_POWER;
    return cruiseV * Math.pow(t, p);
}
/**
 * Approach profile with a floor: brakes toward vFloor instead of 0.
 * Kept for legacy goldens; agent path uses desiredSpeedSeek.
 */
export function approachSpeedFloor(remDist, cruiseV, brakeDist, vFloor, power = SHIP_APPROACH_BRAKE_POWER) {
    const floor = vFloor > 0 ? vFloor : 0;
    if (cruiseV <= floor)
        return floor;
    if (remDist <= 1e-9)
        return floor;
    if (brakeDist <= 1e-9)
        return cruiseV;
    if (remDist >= brakeDist)
        return cruiseV;
    const t = remDist / brakeDist;
    const p = power > 0 ? power : SHIP_APPROACH_BRAKE_POWER;
    return floor + (cruiseV - floor) * Math.pow(t, p);
}
/**
 * Soft-launch accel scale ∈ [SHIP_LAUNCH_ACCEL_MIN, 1].
 * Slow while speed is low (time to rotate), then punch open to full accel.
 * smoothstep over [0, SHIP_LAUNCH_SPEED_FRAC · cruise], then u² so the open-up
 * is sharper just after the crawl (slow start → hard accel).
 */
export function launchAccelScale(speed, cruiseV) {
    const c = cruiseV > 1e-6 ? cruiseV : 1;
    const span = c * SHIP_LAUNCH_SPEED_FRAC;
    let s = span > 1e-9 ? speed / span : 1;
    if (s < 0)
        s = 0;
    else if (s > 1)
        s = 1;
    const u = s * s * (3 - 2 * s);
    // Square the blend: stays near min longer, then rises faster into full.
    const punch = u * u;
    return SHIP_LAUNCH_ACCEL_MIN + (1 - SHIP_LAUNCH_ACCEL_MIN) * punch;
}
/**
 * Mid-path peak desired speed (outside brake zone). Brake curves should use
 * this same peak so deceleration still matches the top of the hop.
 */
export function peakCruiseSpeed(cruiseV) {
    if (!(cruiseV > 0))
        return 0;
    return cruiseV * SHIP_MID_CRUISE_BOOST;
}
/**
 * Physics-based brake distance to a full stop: max(floor, margin · v² / (2a)).
 * Starts braking early so accel-limited ships don't overshoot the √ profile.
 */
export function brakeDistanceFor(cruiseV, accel, floor = SHIP_DEFAULT_BRAKE_DIST, margin = SHIP_BRAKE_DIST_MARGIN) {
    const a = accel > 1e-6 ? accel : SHIP_MAX_ACCEL;
    const v = cruiseV > 0 ? cruiseV : 0;
    const physics = (margin * v * v) / (2 * a);
    return Math.max(floor, physics);
}
/**
 * Physics distance to shed speed from `v` down to `vFloor` (not to 0):
 *   margin · (v² − vFloor²) / (2a)
 * Used for orbit entrance: hard dump just before contact into orbital speed.
 * No large world floor — zone scales with excess speed only.
 */
export function brakeDistanceToFloor(v, vFloor, accel, margin = SHIP_BRAKE_DIST_MARGIN) {
    const a = accel > 1e-6 ? accel : SHIP_MAX_ACCEL;
    const v0 = v > 0 ? v : 0;
    const vf = vFloor > 0 ? vFloor : 0;
    if (v0 <= vf + 1e-6)
        return 0;
    return (margin * (v0 * v0 - vf * vf)) / (2 * a);
}
/**
 * Non-holonomic step toward a world target: turn (rate-limited) then thrust
 * along heading toward approachSpeed(rem, cruiseV, brakeDist), accel-limited.
 * Mutates `ship` in place.
 */
export function integrateThrustTurn(ship, targetX, targetZ, dtSec, opts) {
    let dt = dtSec;
    if (dt < 0)
        dt = 0;
    else if (dt > 0.05)
        dt = 0.05;
    const arriveEps = opts.arriveEps ?? SHIP_ARRIVE_EPS;
    const toX = targetX - ship.posX;
    const toZ = targetZ - ship.posZ;
    const rem = Math.hypot(toX, toZ);
    if (rem <= arriveEps) {
        ship.posX = targetX;
        ship.posZ = targetZ;
        ship.speed = 0;
        return ship;
    }
    const psiStar = Math.atan2(toX, toZ);
    const e = shortestAngleDelta(ship.heading, psiStar);
    const maxTurn = opts.omegaMax * dt;
    let turn = e;
    if (turn > maxTurn)
        turn = maxTurn;
    else if (turn < -maxTurn)
        turn = -maxTurn;
    ship.heading = wrapPi(ship.heading + turn);
    const brakeDist = opts.brakeDist ?? SHIP_DEFAULT_BRAKE_DIST;
    // Soft align so mis-pointed ships don't full-throttle sideways.
    const align = Math.max(SHIP_MIN_ALIGN, Math.cos(e));
    const vTarget = approachSpeed(rem, opts.cruiseV, brakeDist) * align;
    const accel = opts.accel > 0 ? opts.accel : SHIP_MAX_ACCEL;
    const dv = vTarget - ship.speed;
    // Soft launch (slow while rotating) + hard brake.
    const maxDvUp = accel * launchAccelScale(ship.speed, opts.cruiseV) * dt;
    const maxDvDown = accel * 3 * dt;
    if (dv > maxDvUp)
        ship.speed += maxDvUp;
    else if (dv < -maxDvDown)
        ship.speed -= maxDvDown;
    else
        ship.speed = vTarget;
    if (ship.speed < 0)
        ship.speed = 0;
    const step = ship.speed * dt;
    ship.posX += Math.sin(ship.heading) * step;
    ship.posZ += Math.cos(ship.heading) * step;
    const afterRem = Math.hypot(targetX - ship.posX, targetZ - ship.posZ);
    if (afterRem <= arriveEps) {
        ship.posX = targetX;
        ship.posZ = targetZ;
        ship.speed = 0;
    }
    return ship;
}
/**
 * Select Jump vs Cruise (F3). Residual recomputed from v vs v_orb each frame
 * (residualActive ≈ v > 1.2·v_orb). Hot residual always uses Jump dump — even
 * on SEEK after a sling past the ring (Cruise was too weak to kill hop speed).
 * Calm CIRCULATE while domain mid-hop stays Cruise.
 */
export function selectMotionProfile(phaseCirculate, domainWarpActive, residualActive, baseAccel, cruiseV, 
/**
 * When domain hop duration is known, Jump open is this (pathLen-scaled)
 * instead of V_OPEN_UNCAP so ships share the fleet hop clock.
 */
hopOpenSpeed) {
    const base = baseAccel > 0 ? baseAccel : SHIP_MAX_ACCEL;
    const useJump = residualActive || (!phaseCirculate && domainWarpActive);
    if (useJump) {
        // Residual dump still wants strong open if uncapped; domain hop SEEK uses hop open.
        const jumpOpen = residualActive && !(domainWarpActive && hopOpenSpeed !== undefined)
            ? V_OPEN_UNCAP
            : hopOpenSpeed !== undefined && hopOpenSpeed > 0
                ? hopOpenSpeed
                : domainWarpActive
                    ? peakCruiseSpeed(cruiseV > 0 ? cruiseV : SHIP_MAX_SPEED)
                    : V_OPEN_UNCAP;
        return {
            aUp: base,
            aDown: base * JUMP_BRAKE_MULT,
            vOpen: jumpOpen,
            brakeMargin: SHIP_BRAKE_DIST_MARGIN,
            // Soft launch only on SEEK; residual dump needs full a_down immediately.
            softLaunch: !phaseCirculate,
        };
    }
    const aUp = base * CRUISE_ACCEL_SCALE;
    return {
        aUp,
        aDown: aUp * CRUISE_BRAKE_MULT,
        vOpen: peakCruiseSpeed(cruiseV > 0 ? cruiseV : SHIP_MAX_SPEED),
        brakeMargin: SHIP_BRAKE_DIST_MARGIN,
        softLaunch: !phaseCirculate,
    };
}
/**
 * Continuous unified orbit-seek agent. Mutates `ship` in place.
 *
 * SEEK (mode JUMP=1): external-tangent entrance + desiredSpeedSeek.
 * CIRCULATE (mode ORBIT=3): polar ring velocity.
 * Profiles: Jump when domainWarpActive∧SEEK, or residual CIRCULATE dump;
 * Cruise default on ring (even while fleet mid-hop).
 *
 * Callers should pass center = pathEnd. centerVel is Galilean when non-zero;
 * production uses 0.
 *
 * `domainWarpActive`: explicit fleet JUMPING mirror. If omitted, inferred from
 * hop timing mid-interval when nowRel/t0/durationMs are present, else false.
 */
export function integrateShipAgent(ship, params) {
    void params.flockForceX;
    void params.flockForceZ;
    void params.pathStartY;
    void params.formationHeading;
    ensureShipOrientation(ship);
    let dt = params.dtMs;
    if (dt < 0)
        dt = 0;
    else if (dt > 50)
        dt = 50;
    const dtSec = dt / 1000;
    if (ship.mode === SHIP_MODE_PAUSED) {
        ship.speed = 0;
        return ship;
    }
    if (!(ship.accel > 0))
        ship.accel = SHIP_MAX_ACCEL;
    if (!(ship.cruiseV > 0))
        ship.cruiseV = SHIP_MAX_SPEED;
    if (!(ship.omegaMax !== undefined && ship.omegaMax > 0)) {
        ship.omegaMax = SHIP_MAX_TURN_RAD_S;
    }
    const centerY = params.centerY ?? params.pathEndY ?? 0;
    const pathEndY = params.pathEndY ?? centerY;
    const posY = ship.posY ?? 0;
    // Do not key off ship.posY: planar CIRCULATE personal height is non-zero by design.
    const space3d = params.space3d === true ||
        Math.abs(centerY) > 1e-9 ||
        Math.abs(pathEndY) > 1e-9 ||
        Math.abs(params.centerVelY ?? 0) > 1e-9 ||
        Math.abs(params.pathStartY ?? 0) > 1e-9;
    // Domain warp: explicit flag, else mid-hop timing inference (no schedule use).
    let domainWarpActive = params.domainWarpActive;
    if (domainWarpActive === undefined) {
        if (params.nowRel !== undefined &&
            params.t0 !== undefined &&
            params.durationMs !== undefined &&
            params.durationMs > 0) {
            const u = clamp01((params.nowRel - params.t0) / params.durationMs);
            domainWarpActive = u < 1;
        }
        else {
            domainWarpActive = false;
        }
    }
    // Hop open from domain duration so formation ships share the fleet ease clock.
    let hopOpen;
    if (domainWarpActive &&
        params.durationMs !== undefined &&
        params.durationMs > 0 &&
        params.pathStartX !== undefined &&
        params.pathStartZ !== undefined) {
        const pLen = Math.hypot(params.pathEndX - params.pathStartX, params.pathEndZ - params.pathStartZ);
        hopOpen = hopOpenSpeedFromDuration(pLen, params.durationMs);
        // Also soft-cap personal cruise so Cruise profile mid-hop isn't uncapped.
        if (ship.cruiseV > hopOpen)
            ship.cruiseV = hopOpen;
    }
    // Phase (F5): ρ_enter = max(ε_tiny, 0.2R) — NOT ARRIVE_EPS=2.
    // Planar: XZ distance. Sphere 3D: full |P−C| + rem to sphere tangent aim.
    const R = ship.orbitR > 1e-6 ? ship.orbitR : 1;
    const dx = ship.posX - params.centerX;
    const dz = ship.posZ - params.centerZ;
    const dy = posY - centerY;
    const r = space3d
        ? Math.hypot(dx, dy, dz)
        : Math.hypot(dx, dz);
    const captureIn = ORBIT_CAPTURE_K * R;
    const captureOut = ORBIT_CAPTURE_OUT_K * R;
    const side = orbitSideSign(ship.orbitOmega);
    let remEntrance;
    if (space3d) {
        const fwd = forwardFromQuat(ship.qx ?? 0, ship.qy ?? 0, ship.qz ?? 0, ship.qw ?? 1);
        const farAim = computeSphereOrbitAimTarget(ship.posX, posY, ship.posZ, params.centerX, centerY, params.centerZ, R, side, false, fwd.x, fwd.y, fwd.z);
        remEntrance = Math.hypot(farAim.x - ship.posX, farAim.y - posY, farAim.z - ship.posZ);
    }
    else {
        const farAim = computeOrbitAimTarget(ship.posX, ship.posZ, params.centerX, params.centerZ, R, side, false, ship.heading);
        remEntrance = Math.hypot(farAim.x - ship.posX, farAim.z - ship.posZ);
    }
    const entranceCap = Math.max(ORBIT_ENTRANCE_EPS_TINY, ORBIT_ENTRANCE_REM_K * R);
    const omegaMax = ship.omegaMax !== undefined && ship.omegaMax > 0
        ? ship.omegaMax
        : ORBIT_DEFAULT_OMEGA_MAX;
    const vOrb = orbitFloorSpeed(ship.orbitOmega, R, omegaMax);
    // Residual recompute (no stride bit). residualActive = v > 1.2·v_orb:
    // Jump dump always; soft EXIT freeze only inside RESIDUAL_FREEZE_OUT_K·R.
    // Past that band force SEEK so hop-speed slings cannot stay CIRCULATE and
    // carve huge fast arcs far from the personal ring (screenshot outliers).
    const residualActive = ship.speed > RESIDUAL_CLEAR_MUL * vOrb;
    const residualFreezeOut = RESIDUAL_FREEZE_OUT_K * R;
    // Band radius: planar XZ; sphere full 3D |P−C|.
    const rBand = r;
    let near = ship.mode === SHIP_MODE_ORBIT || ship.mode === SHIP_MODE_SETTLE;
    if (near) {
        if (rBand > residualFreezeOut) {
            // Too far for residual freeze — re-SEEK entrance (hard dump still on).
            near = false;
        }
        else if (rBand > captureOut && !residualActive) {
            near = false;
        }
    }
    else {
        if (remEntrance <= entranceCap || rBand <= captureIn)
            near = true;
    }
    ship.mode = near ? SHIP_MODE_ORBIT : SHIP_MODE_JUMP;
    const profile = selectMotionProfile(near, domainWarpActive, residualActive, ship.accel, ship.cruiseV, hopOpen);
    integrateOrbitSeekStep(ship, params.centerX, params.centerZ, params.centerVelX ?? 0, params.centerVelZ ?? 0, dtSec, near, profile, {
        centerY,
        centerVelY: params.centerVelY ?? 0,
        space3d,
    });
    return ship;
}
/**
 * @deprecated Prefer integrateShipAgent. Legacy ease-scheduled jump + settle τ.
 *
 * One integration step. Mutates `ship` in place and returns it (zero-alloc / GPU-like).
 * Integrates until remDist ≤ ARRIVE_EPS even when `!jumping` (post-land settle).
 */
export function integrateShipFlight(ship, params) {
    // flockForce reserved for L5d — intentionally unused
    void params.flockForceX;
    void params.flockForceZ;
    const formH = formationHeadingFromPath(params.jumping, params.pathStartX, params.pathStartZ, params.pathEndX, params.pathEndZ, params.formationHeading ?? 0);
    const worldSlot = rotateLocalSlot(ship.slotX, ship.slotZ, formH);
    const finalX = params.pathEndX + worldSlot.x;
    const finalZ = params.pathEndZ + worldSlot.z;
    let dt = params.dtMs;
    if (dt < 0)
        dt = 0;
    else if (dt > 50)
        dt = 50;
    dt = dt / 1000;
    const toFinalX = finalX - ship.posX;
    const toFinalZ = finalZ - ship.posZ;
    const remFinal = Math.hypot(toFinalX, toFinalZ);
    // Only snap onto the **final** formation slot — never mid-path rail lock.
    if (remFinal <= SHIP_ARRIVE_EPS) {
        ship.posX = finalX;
        ship.posZ = finalZ;
        ship.speed = 0;
        return ship;
    }
    const pathDx = params.pathEndX - params.pathStartX;
    const pathDz = params.pathEndZ - params.pathStartZ;
    const pathLen = Math.hypot(pathDx, pathDz);
    const pathH = pathLen > 1e-6 ? Math.atan2(pathDx, pathDz) : ship.heading;
    const u = params.durationMs <= 0
        ? 1
        : clamp01((params.nowRel - params.t0) / params.durationMs);
    const jumpingActive = params.jumping && u < 1;
    // Aim: travel direction mid-hop (visible turn when path changes); blend to
    // final-slot bearing near arrival so formation closes without a last snap-turn.
    let psiStar;
    if (jumpingActive) {
        psiStar = pathH;
        if (u >= SHIP_AIM_BLEND_START) {
            const blend = clamp01((u - SHIP_AIM_BLEND_START) / (1 - SHIP_AIM_BLEND_START));
            const toFinalH = Math.atan2(toFinalX, toFinalZ);
            psiStar = wrapPi(pathH + shortestAngleDelta(pathH, toFinalH) * blend);
        }
    }
    else {
        psiStar = Math.atan2(toFinalX, toFinalZ);
    }
    // Turn first (rate-limited) — this is the visible rotation.
    const e = shortestAngleDelta(ship.heading, psiStar);
    const eBefore = e;
    const maxTurn = SHIP_MAX_TURN_RAD_S * dt;
    let turn = e;
    if (turn > maxTurn)
        turn = maxTurn;
    else if (turn < -maxTurn)
        turn = -maxTurn;
    ship.heading = wrapPi(ship.heading + turn);
    // Thrust only along nose; scale by alignment so mis-pointed ships turn more
    // than they slide (non-holonomic feel).
    const align = Math.max(SHIP_MIN_ALIGN, Math.cos(eBefore));
    let vSched;
    if (jumpingActive) {
        const durationS = Math.max(1e-6, params.durationMs / 1000);
        const vEase = (pathLen * easeDeriv(u)) / durationS;
        // Along-path lag only (projected), not holonomic remDist-to-point.
        let lagAlong = 0;
        if (pathLen > 1e-6) {
            const invLen = 1 / pathLen;
            const dirX = pathDx * invLen;
            const dirZ = pathDz * invLen;
            const along = (ship.posX - params.pathStartX) * dirX +
                (ship.posZ - params.pathStartZ) * dirZ;
            const desiredAlong = pathLen * ease01(u);
            lagAlong = Math.max(0, desiredAlong - along);
        }
        vSched = (vEase + lagAlong / SHIP_TRACK_TAU_S) * align;
    }
    else {
        vSched = (remFinal / SHIP_SETTLE_TAU_S) * align;
    }
    if (vSched < 0)
        vSched = 0;
    ship.speed = vSched;
    // Forward-only thrust — never teleport sideways to the target.
    const step = ship.speed * dt;
    ship.posX += Math.sin(ship.heading) * step;
    ship.posZ += Math.cos(ship.heading) * step;
    // Soft capture: if we crossed into the final slot this frame, park.
    const afterDx = finalX - ship.posX;
    const afterDz = finalZ - ship.posZ;
    if (Math.hypot(afterDx, afterDz) <= SHIP_ARRIVE_EPS) {
        ship.posX = finalX;
        ship.posZ = finalZ;
        ship.speed = 0;
    }
    return ship;
}
/**
 * Spawn ship at jump start: pos = pathStart + rotate(slot, pathH), heading along path, speed 0.
 * Slots are **local** (right/forward). Live jump edge keeps prev pose (no re-spawn).
 */
export function initShipAtJumpStart(slotX, slotZ, pathStartX, pathStartZ, pathEndX, pathEndZ) {
    const dx = pathEndX - pathStartX;
    const dz = pathEndZ - pathStartZ;
    const pathH = Math.atan2(dx, dz);
    const world = rotateLocalSlot(slotX, slotZ, pathH, 0);
    const q = quatFromYaw(pathH);
    return {
        posX: pathStartX + world.x,
        posY: 0,
        posZ: pathStartZ + world.z,
        heading: pathH,
        speed: 0,
        slotX,
        slotY: 0,
        slotZ,
        qx: q.x,
        qy: q.y,
        qz: q.z,
        qw: q.w,
    };
}
/**
 * Park ship at a node: pos = node + rotate(slot, heading), speed 0.
 * Default heading 0 → local slot = world offset.
 */
export function initShipParked(slotX, slotZ, nodeX, nodeZ, heading = 0) {
    const world = rotateLocalSlot(slotX, slotZ, heading, 0);
    const q = quatFromYaw(heading);
    return {
        posX: nodeX + world.x,
        posY: 0,
        posZ: nodeZ + world.z,
        heading,
        speed: 0,
        slotX,
        slotY: 0,
        slotZ,
        qx: q.x,
        qy: q.y,
        qz: q.z,
        qw: q.w,
    };
}
//# sourceMappingURL=ship-flight-ref.js.map