/**
 * Continuous unified orbit seek (pathEnd center in production).
 *
 * SEEK: external-tangent entrance T on side s (true 90° contact);
 *       desiredSpeedSeek = min(open, env, CFL); F1 post-clamp + F2 wrong-way.
 * CIRCULATE: polar v_θ = v_orb, v_r = clamp(k_r·(R−r)) — not lead×speed+spring.
 * Capture thresholds live in integrateShipAgent (F5).
 *
 * No GPU / Bus imports. WGSL parity in fleet-integrate.wgsl.ts.
 */
import { clamp01, easeDeriv, shortestAngleDelta, wrapPi, SHIP_MIN_ALIGN, desiredSpeedSeek, launchAccelScale, } from "./ship-flight-ref.js";
import { forwardFromQuat, quatFromYaw, quatIsZero, quatLookRotation, quatRotateToward, yawFromQuat, } from "./quat.js";
// Tune orbit / brake mult here — not scattered through this file:
//   js/gpu/ship-motion-config.ts
export { ORBIT_R_MIN, ORBIT_R_MAX, ORBIT_OMEGA_MIN, ORBIT_OMEGA_MAX, ORBIT_ARRIVE_EPS, ORBIT_SPRING_K, ORBIT_DEFAULT_OMEGA_MAX, ORBIT_DEFAULT_ACCEL, ORBIT_BRAKE_MULT, JUMP_BRAKE_MULT, ORBIT_LEAD_RAD, ORBIT_ENTRANCE_REM_K, ORBIT_ENTRANCE_EPS_TINY, ORBIT_CAPTURE_K, ORBIT_CAPTURE_OUT_K, ORBIT_NEAR_SPEED_SCALE, ORBIT_APPROACH_GATE_SPEED, ORBIT_OMEGA_TURN_FRAC, ORBIT_R_EPS, CRUISE_ACCEL_SCALE, CRUISE_BRAKE_MULT, V_OPEN_UNCAP, RESIDUAL_HIGH_MUL, RESIDUAL_CLEAR_MUL, V_TURN_ALLOW_R_FRAC, ORBIT_V_RAD_MAX_FRAC, ORBIT_V_RAD_MAX_R_MUL, ORBIT_RESIDUAL_V_MUL, ORBIT_RESIDUAL_V_ADD, ORBIT_SINGULARITY_R_MUL, ORBIT_ESCAPE_V_RAD, } from "./ship-motion-config.js";
import { ORBIT_R_MIN, ORBIT_R_MAX, ORBIT_OMEGA_MIN, ORBIT_OMEGA_MAX, ORBIT_SPRING_K, ORBIT_DEFAULT_OMEGA_MAX, ORBIT_DEFAULT_ACCEL, JUMP_BRAKE_MULT, ORBIT_LEAD_RAD, ORBIT_NEAR_SPEED_SCALE, ORBIT_OMEGA_TURN_FRAC, ORBIT_R_EPS, SHIP_MAX_SPEED, SHIP_SPEED_VARIANCE, SHIP_TYPE_MUL_RED, SHIP_TYPE_MUL_BLUE, SHIP_TYPE_MUL_GREEN, SHIP_BRAKE_DIST_MARGIN, CRUISE_ACCEL_SCALE, CRUISE_BRAKE_MULT, V_OPEN_UNCAP, V_TURN_ALLOW_R_FRAC, ORBIT_V_RAD_MAX_FRAC, ORBIT_V_RAD_MAX_R_MUL, ORBIT_RESIDUAL_V_MUL, ORBIT_RESIDUAL_V_ADD, ORBIT_SINGULARITY_R_MUL, ORBIT_ESCAPE_V_RAD, } from "./ship-motion-config.js";
/** Deterministic 0..1 from seed (xorshift-ish mix). */
function hash01(seed) {
    let t = seed >>> 0;
    t = Math.imul(t ^ (t >>> 16), 2246822507);
    t = Math.imul(t ^ (t >>> 13), 3266489909);
    t ^= t >>> 16;
    return (t >>> 0) / 4294967296;
}
/** Type speed mul for typeId 0 red / 1 blue / 2 green (same as motion). */
export function shipTypeSpeedMul(typeId = 0) {
    const tid = typeId | 0;
    if (tid === 0)
        return SHIP_TYPE_MUL_RED;
    if (tid === 2)
        return SHIP_TYPE_MUL_GREEN;
    return SHIP_TYPE_MUL_BLUE;
}
/**
 * Deterministic personal speed factor ∈ [1−V, 1+V] (default V=0.1 → ±10%).
 * Same salt for motion + orbit so jump and orbit stay consistent per ship.
 */
export function personalSpeedVarianceMul(seed) {
    const u = hash01((seed >>> 0) ^ 0x3c6ef372);
    const v = SHIP_SPEED_VARIANCE > 0 ? SHIP_SPEED_VARIANCE : 0;
    return 1 - v + u * (2 * v);
}
/**
 * Deterministic personal orbit parameters from a seed (instance / ship id).
 * radius ∈ [ORBIT_R_MIN, ORBIT_R_MAX], phase0 ∈ [0, 2π).
 * |ω| = base band × personal ±10% only — **not** type hop mul (green stays calm).
 */
export function hashOrbitParams(seed, typeId = 0) {
    void typeId; // hop type mul must not inflate ring rate
    const u0 = hash01(seed);
    const u1 = hash01((seed >>> 0) ^ 0x9e3779b9);
    const u2 = hash01((seed >>> 0) ^ 0x85ebca6b);
    const radius = ORBIT_R_MIN + u0 * (ORBIT_R_MAX - ORBIT_R_MIN);
    const omegaMag = (ORBIT_OMEGA_MIN + u1 * (ORBIT_OMEGA_MAX - ORBIT_OMEGA_MIN)) *
        personalSpeedVarianceMul(seed);
    const omega = (u2 < 0.5 ? -1 : 1) * omegaMag;
    const phase0 = hash01((seed >>> 0) ^ 0xc2b2ae35) * Math.PI * 2;
    return { radius, omega, phase0 };
}
/**
 * Personal linear accel + soft cruise from seed and ship typeId (0 red / 1 blue / 2 green).
 * Both use the same type mul × personal ±10% variance (all flight states).
 */
export function hashShipMotionParams(seed, typeId = 0) {
    const speedMul = shipTypeSpeedMul(typeId) * personalSpeedVarianceMul(seed);
    const accel = ORBIT_DEFAULT_ACCEL * speedMul;
    const cruiseV = SHIP_MAX_SPEED * speedMul;
    return { accel, cruiseV };
}
/**
 * Point on the horizontal ring around (centerX, centerZ).
 * phase 0 → +Z relative to center (matches heading 0 = +Z forward).
 *   x = cx + R·sin(phase)
 *   z = cz + R·cos(phase)
 */
export function orbitPoint(centerX, centerZ, radius, phase) {
    return {
        x: centerX + radius * Math.sin(phase),
        z: centerZ + radius * Math.cos(phase),
    };
}
/**
 * Heading along the circle tangent at `phase`.
 * omegaSign ≥ 0 → phase increasing (CCW from +Z toward +X).
 * omegaSign < 0 → opposite tangent.
 */
export function orbitTangentHeading(phase, omegaSign) {
    // d/dφ (sin φ, cos φ) = (cos φ, −sin φ) for +ω
    if (omegaSign >= 0) {
        return Math.atan2(Math.cos(phase), -Math.sin(phase));
    }
    return Math.atan2(-Math.cos(phase), Math.sin(phase));
}
/** Side sign from ω: +1 CCW, −1 CW. Zero ω → +1. */
export function orbitSideSign(omega) {
    return omega < 0 ? -1 : 1;
}
/**
 * Rotate unit (ux, uz) by s·π/2 in the XZ plane.
 * s=+1 → (uz, −ux); s=−1 → (−uz, ux).
 * +Z unit (0,1) → s=+1 → (1,0) = +X (matches +ω tangent at θ=0).
 */
export function rotPerpSide(ux, uz, side) {
    const s = side < 0 ? -1 : 1;
    return { x: s * uz, z: -s * ux };
}
/**
 * Captured orbit floor speed: min(|ω|R, frac·ω_max·R).
 * Turn-limited so the non-holonomic ship can track the ring.
 */
export function orbitFloorSpeed(omega, radius, omegaMax = ORBIT_DEFAULT_OMEGA_MAX) {
    const R = radius > 1e-6 ? radius : ORBIT_R_MIN;
    const vOmega = Math.abs(omega) * R;
    const turnCap = ORBIT_OMEGA_TURN_FRAC * (omegaMax > 0 ? omegaMax : ORBIT_DEFAULT_OMEGA_MAX) * R;
    return Math.min(vOmega, turnCap);
}
/**
 * Far or near aim target on the orbit ring around destination C.
 *
 * ## Far — external tangent on side s (true 90° contact)
 * Straight line to the old “radial limb” cuts a chord **inside** the circle
 * (looks like aiming a smaller orbit). External tangent from P to (C,R) is the
 * natural entrance: path stays outside the disk and arrives tangent-ready.
 *   v = P−C, d²=|v|², a=R²/d², b=R·√(d²−R²)/d²
 *   T = C + a·v ± b·CW90(v)   (sign = side s)
 *
 * ## Near (after entrance capture)
 * θ = atan2(P−C); T = orbitPoint(C, R, θ + s·λ) — lead on same side.
 * Enter near primarily when rem to far T is small (not early radial bubble).
 *
 * Side s is a stable ship property (sign of orbitOmega): left/right forever.
 */
export function computeOrbitAimTarget(posX, posZ, centerX, centerZ, radius, side, near, fallbackHeading = 0) {
    const R = radius > 1e-6 ? radius : ORBIT_R_MIN;
    const s = side < 0 ? -1 : 1;
    // d = P − C (outward from destination)
    const dx = posX - centerX;
    const dz = posZ - centerZ;
    const r2 = dx * dx + dz * dz;
    const rEps = Math.max(ORBIT_R_EPS, 0.05 * R);
    const rEps2 = rEps * rEps;
    if (near) {
        let theta;
        if (r2 < rEps2) {
            // At center: invent a phase from heading so we push out along a ring lead.
            theta = wrapPi(fallbackHeading + s * (Math.PI / 2));
        }
        else {
            theta = Math.atan2(dx, dz);
        }
        const phase = theta + s * ORBIT_LEAD_RAD;
        const pt = orbitPoint(centerX, centerZ, R, phase);
        return { x: pt.x, z: pt.z, theta };
    }
    // Far: external tangent on side s (or near-lead if already on/inside ring).
    if (r2 <= R * R + 1e-6) {
        const theta = r2 < rEps2
            ? wrapPi(fallbackHeading + s * (Math.PI / 2))
            : Math.atan2(dx, dz);
        const pt = orbitPoint(centerX, centerZ, R, theta + s * ORBIT_LEAD_RAD);
        return { x: pt.x, z: pt.z, theta };
    }
    // T − C = a·v + s·b·CW90(v), |T−C| = R, (T−C) ⟂ (P−T).
    const invD2 = 1 / r2;
    const a = (R * R) * invD2;
    const b = (R * Math.sqrt(Math.max(0, r2 - R * R))) * invD2;
    // CW90(v) = (dz, −dx)
    const tx = a * dx + s * b * dz;
    const tz = a * dz + s * b * -dx;
    return {
        x: centerX + tx,
        z: centerZ + tz,
        theta: Math.atan2(tx, tz),
    };
}
/**
 * Analytic fleet-center velocity for an eased path (clock A, GPU-relative ms).
 * pos = mix(start, end, ease01(u)); vel = (end−start)·easeDeriv(u)/durationS.
 * Zero outside the open interval (0,1) or when durationMs ≤ 0.
 */
export function analyticFleetCenterVelocity(pathStart, pathEnd, t0, durationMs, nowRel) {
    if (durationMs <= 0) {
        return { vx: 0, vz: 0 };
    }
    const u = clamp01((nowRel - t0) / durationMs);
    if (u <= 0 || u >= 1) {
        return { vx: 0, vz: 0 };
    }
    const durationS = durationMs / 1000;
    const sDot = easeDeriv(u) / durationS;
    return {
        vx: (pathEnd.x - pathStart.x) * sDot,
        vz: (pathEnd.z - pathStart.z) * sDot,
    };
}
/**
 * Default Cruise-like profile when caller omits one (legacy integrateOrbitStep).
 */
function defaultCruiseProfile(ship, circulate) {
    const base = ship.accel !== undefined && ship.accel > 0
        ? ship.accel
        : ORBIT_DEFAULT_ACCEL;
    const aUp = base * CRUISE_ACCEL_SCALE;
    return {
        aUp,
        aDown: aUp * CRUISE_BRAKE_MULT,
        vOpen: V_OPEN_UNCAP,
        brakeMargin: SHIP_BRAKE_DIST_MARGIN,
        softLaunch: !circulate,
    };
}
/**
 * One unified orbit-seek step around destination C (usually pathEnd).
 * Mutates `ship` in place and returns it (zero-alloc / GPU-like).
 *
 * SEEK (!near): external-tangent T; desiredSpeedSeek(ρ, v_orb, a_down, m, open, dt).
 * CIRCULATE (near): polar v_θ / v_r — not lead×speed + spring fight.
 * F2 wrong-way: |e|>π/2 → v_tgt ≤ v_turn. Soft launch scales a_up only.
 * F1 post-clamp SEEK when cos(e)>0: v ≤ max(v_orb, ρ/dt).
 *
 * @param near — CIRCULATE band (caller applies rem+radial hysteresis + residual)
 * @param profile — Jump/Cruise accel envelope from selectMotionProfile
 */
export function integrateOrbitSeekStep(ship, centerX, centerZ, centerVelX, centerVelZ, dtSec, near, profile, spaceOpts) {
    let dt = dtSec;
    if (dt < 0)
        dt = 0;
    else if (dt > 0.05)
        dt = 0.05;
    // Local orientation defaults (avoid circular import with ship-flight-ref helpers).
    if (ship.posY === undefined || !Number.isFinite(ship.posY))
        ship.posY = 0;
    {
        const qx = ship.qx ?? 0;
        const qy = ship.qy ?? 0;
        const qz = ship.qz ?? 0;
        const qw = ship.qw ?? 0;
        if (quatIsZero(qx, qy, qz, qw)) {
            const q = quatFromYaw(ship.heading);
            ship.qx = q.x;
            ship.qy = q.y;
            ship.qz = q.z;
            ship.qw = q.w;
        }
    }
    const centerY = spaceOpts?.centerY ?? 0;
    const centerVelY = spaceOpts?.centerVelY ?? 0;
    const space3d = spaceOpts?.space3d === true;
    const R = ship.orbitR > 1e-6 ? ship.orbitR : ORBIT_R_MIN;
    const omega = ship.orbitOmega;
    const side = orbitSideSign(omega);
    const cruiseV = ship.cruiseV !== undefined && ship.cruiseV > 0
        ? ship.cruiseV
        : SHIP_MAX_SPEED;
    const omegaMax = ship.omegaMax !== undefined && ship.omegaMax > 0
        ? ship.omegaMax
        : ORBIT_DEFAULT_OMEGA_MAX;
    const prof = profile ?? defaultCruiseProfile(ship, near);
    const aUp = prof.aUp > 0 ? prof.aUp : ORBIT_DEFAULT_ACCEL;
    const aDown = prof.aDown > 0 ? prof.aDown : aUp * JUMP_BRAKE_MULT;
    const vOpen = prof.vOpen > 0 ? prof.vOpen : V_OPEN_UNCAP;
    const brakeMargin = prof.brakeMargin > 1e-6 ? prof.brakeMargin : SHIP_BRAKE_DIST_MARGIN;
    const dx = ship.posX - centerX;
    const dz = ship.posZ - centerZ;
    // CIRCULATE geometry is always horizontal XZ polar at centerY.
    const r = Math.hypot(dx, dz);
    const rEps = Math.max(ORBIT_R_EPS, 0.05 * R);
    const posY = ship.posY ?? 0;
    // Diagnostic azimuth + SEEK aim (external tangent). CIRCULATE uses polar.
    const aim = computeOrbitAimTarget(ship.posX, ship.posZ, centerX, centerZ, R, side, near, ship.heading);
    ship.orbitPhase = aim.theta;
    const vOrbit = orbitFloorSpeed(omega, R, omegaMax);
    const vOrbitUse = near ? vOrbit * ORBIT_NEAR_SPEED_SCALE : vOrbit;
    let vRelX;
    let vRelZ;
    let vRelY = 0;
    let remAim;
    // Deep inside the disk: force escape before calm polar (real-game stuck).
    const singularity = near && r < Math.max(rEps, ORBIT_SINGULARITY_R_MUL * R);
    if (near) {
        // F6 polar CIRCULATE — not lead-unit * speed + spring.
        let rHatX;
        let rHatZ;
        if (r >= rEps) {
            const invR = 1 / r;
            rHatX = dx * invR;
            rHatZ = dz * invR;
        }
        else {
            // At exact center: push along a stable outward axis (not pure heading —
            // heading-as-radial + tangential thrash can pin r≈0).
            rHatX = Math.sin(ship.heading + side * (Math.PI / 2));
            rHatZ = Math.cos(ship.heading + side * (Math.PI / 2));
            const rH = Math.hypot(rHatX, rHatZ);
            if (rH > 1e-6) {
                rHatX /= rH;
                rHatZ /= rH;
            }
            else {
                rHatX = 1;
                rHatZ = 0;
            }
        }
        // τ̂ for +ω (s=+1): d/dφ (sinφ,cosφ) = (cosφ,−sinφ) = (r̂_z, −r̂_x).
        // Must match external-tangent arrival (approach is already this tangent);
        // the old s·(−r̂_z, r̂_x) was the opposite sense → ships spun around at capture.
        const tHatX = side * rHatZ;
        const tHatZ = side * -rHatX;
        let vRadMax = Math.min(ORBIT_V_RAD_MAX_FRAC * vOrbitUse, ORBIT_V_RAD_MAX_R_MUL * R);
        if (singularity) {
            // Escape floor: leave r≈0 in well under a second even when v_orb is tiny.
            vRadMax = Math.max(vRadMax, ORBIT_ESCAPE_V_RAD, 4 * R);
        }
        let vR = ORBIT_SPRING_K * (R - r);
        if (singularity && vR < ORBIT_ESCAPE_V_RAD)
            vR = ORBIT_ESCAPE_V_RAD;
        if (vR > vRadMax)
            vR = vRadMax;
        else if (vR < -vRadMax)
            vR = -vRadMax;
        // Deep inside: pure radial out first (tangential thrash keeps r≈0).
        const vTh = singularity ? 0 : vOrbitUse;
        vRelX = vR * rHatX + vTh * tHatX;
        vRelZ = vR * rHatZ + vTh * tHatZ;
        // Residual desire ceiling — skip while escaping singularity so dump
        // authority does not zero the outward push.
        if (!singularity) {
            let vRelMag = Math.hypot(vRelX, vRelZ);
            const vNearCap = Math.min(ORBIT_RESIDUAL_V_MUL * vOrbitUse, vOrbitUse + ORBIT_RESIDUAL_V_ADD);
            if (vRelMag > vNearCap && vRelMag > 1e-6) {
                const sc = vNearCap / vRelMag;
                vRelX *= sc;
                vRelZ *= sc;
            }
        }
        // 3D: ease height toward centerY while circulating in horizontal plane.
        if (space3d) {
            const dy = centerY - posY;
            vRelY = Math.max(-vOrbitUse, Math.min(vOrbitUse, dy * ORBIT_SPRING_K));
        }
        remAim = space3d
            ? Math.hypot(aim.x - ship.posX, centerY - posY, aim.z - ship.posZ)
            : Math.hypot(aim.x - ship.posX, aim.z - ship.posZ);
    }
    else {
        // SEEK: external-tangent entrance; one normative desire.
        remAim = space3d
            ? Math.hypot(aim.x - ship.posX, centerY - posY, aim.z - ship.posZ)
            : Math.hypot(aim.x - ship.posX, aim.z - ship.posZ);
        const vDes = desiredSpeedSeek(remAim, vOrbit, aDown, brakeMargin, vOpen, dt);
        if (space3d) {
            const toTx = aim.x - ship.posX;
            const toTy = centerY - posY;
            const toTz = aim.z - ship.posZ;
            const toTLen = Math.hypot(toTx, toTy, toTz);
            if (toTLen > 1e-6) {
                const inv = 1 / toTLen;
                vRelX = toTx * inv * vDes;
                vRelY = toTy * inv * vDes;
                vRelZ = toTz * inv * vDes;
            }
            else {
                const tangH = orbitTangentHeading(aim.theta, side);
                vRelX = Math.sin(tangH) * vOrbit;
                vRelY = 0;
                vRelZ = Math.cos(tangH) * vOrbit;
            }
        }
        else {
            const toTx = aim.x - ship.posX;
            const toTz = aim.z - ship.posZ;
            const toTLen = Math.hypot(toTx, toTz);
            if (toTLen > 1e-6) {
                const inv = 1 / toTLen;
                vRelX = toTx * inv * vDes;
                vRelZ = toTz * inv * vDes;
            }
            else {
                const tangH = orbitTangentHeading(aim.theta, side);
                vRelX = Math.sin(tangH) * vOrbit;
                vRelZ = Math.cos(tangH) * vOrbit;
            }
        }
    }
    // Galilean: world desired = centerVel + relative.
    const vStarX = centerVelX + vRelX;
    const vStarY = centerVelY + vRelY;
    const vStarZ = centerVelZ + vRelZ;
    const vStarLen = space3d
        ? Math.hypot(vStarX, vStarY, vStarZ)
        : Math.hypot(vStarX, vStarZ);
    let psiStar;
    if (Math.hypot(vStarX, vStarZ) > 1e-6) {
        psiStar = Math.atan2(vStarX, vStarZ);
    }
    else {
        psiStar = ship.heading;
    }
    // Planar turn: heading primary (bit-compatible with pre-quat agent).
    // 3D SEEK: rate-limited look-at along v*; CIRCULATE stays yaw-primary + Y ease.
    const e = shortestAngleDelta(ship.heading, psiStar);
    const maxTurn = omegaMax * dt;
    let turn = e;
    if (turn > maxTurn)
        turn = maxTurn;
    else if (turn < -maxTurn)
        turn = -maxTurn;
    if (!space3d || near) {
        ship.heading = wrapPi(ship.heading + turn);
        const q = quatFromYaw(ship.heading);
        ship.qx = q.x;
        ship.qy = q.y;
        ship.qz = q.z;
        ship.qw = q.w;
    }
    else {
        let tq;
        if (vStarLen > 1e-6) {
            tq = quatLookRotation(vStarX, vStarY, vStarZ, 0, 1, 0);
        }
        else {
            tq = quatLookRotation(Math.sin(psiStar), 0, Math.cos(psiStar), 0, 1, 0);
        }
        const next = quatRotateToward(ship.qx ?? 0, ship.qy ?? 0, ship.qz ?? 0, ship.qw ?? 1, tq.x, tq.y, tq.z, tq.w, maxTurn);
        ship.qx = next.x;
        ship.qy = next.y;
        ship.qz = next.z;
        ship.qw = next.w;
        ship.heading = yawFromQuat(next.x, next.y, next.z, next.w);
    }
    // F2 wrong-way: when reverse / away from aim, cap to v_turn (not α_min·huge).
    // Singularity escape: allow full |v*| so radial push is not crushed by v_turn.
    const cosE = Math.cos(e);
    let vTarget;
    if (singularity) {
        const align = cosE > SHIP_MIN_ALIGN ? cosE : SHIP_MIN_ALIGN;
        vTarget = Math.max(vStarLen * align, ORBIT_ESCAPE_V_RAD * 0.5);
    }
    else if (Math.abs(e) > Math.PI * 0.5 || cosE < 0) {
        const ell = V_TURN_ALLOW_R_FRAC * R;
        const vTurn = omegaMax * ell;
        vTarget = vStarLen < vTurn ? vStarLen : vTurn;
    }
    else {
        const align = cosE > SHIP_MIN_ALIGN ? cosE : SHIP_MIN_ALIGN;
        vTarget = vStarLen * align;
    }
    // CIRCULATE floor when well aligned.
    if (near && cosE > 0.85) {
        const floorW = Math.hypot(centerVelX, centerVelZ) + vOrbitUse * 0.85;
        if (vTarget < floorW)
            vTarget = floorW;
    }
    // Asymmetric accel: soft launch on a_up only; full a_down always.
    if (vTarget > ship.speed) {
        const launchRef = cruiseV > 0 ? cruiseV : SHIP_MAX_SPEED;
        const scale = prof.softLaunch
            ? launchAccelScale(ship.speed, launchRef)
            : 1;
        const maxDvUp = aUp * scale * dt;
        const next = ship.speed + maxDvUp;
        ship.speed = next < vTarget ? next : vTarget;
    }
    else {
        const maxDvDown = aDown * dt;
        const next = ship.speed - maxDvDown;
        ship.speed = next > vTarget ? next : vTarget;
    }
    if (ship.speed < 0)
        ship.speed = 0;
    // F1 post-speed CFL clamp (SEEK, heading toward T).
    if (!near && cosE > 0) {
        const cfl = remAim / (dt > 1e-6 ? dt : 1e-6);
        const cap = vOrbit > cfl ? vOrbit : cfl;
        if (ship.speed > cap)
            ship.speed = cap;
    }
    const step = ship.speed * dt;
    if (!space3d) {
        // Planar: identical forward step to pre-quat agent; force y=0.
        ship.posX += Math.sin(ship.heading) * step;
        ship.posY = 0;
        ship.posZ += Math.cos(ship.heading) * step;
    }
    else if (near) {
        // CIRCULATE: polar XZ + ease Y (heading/yaw primary).
        ship.posX += Math.sin(ship.heading) * step;
        ship.posZ += Math.cos(ship.heading) * step;
        const dy = centerY - (ship.posY ?? 0);
        const yStep = Math.max(-step, Math.min(step, dy));
        ship.posY = (ship.posY ?? 0) + yStep;
    }
    else {
        // 3D SEEK: advance along body +Z.
        const fwd = forwardFromQuat(ship.qx ?? 0, ship.qy ?? 0, ship.qz ?? 0, ship.qw ?? 1);
        ship.posX += fwd.x * step;
        ship.posY = (ship.posY ?? 0) + fwd.y * step;
        ship.posZ += fwd.z * step;
    }
    return ship;
}
/**
 * @deprecated Prefer integrateOrbitSeekStep. Phase-locked chase kept as a
 * thin wrapper for older goldens that call integrateOrbitStep by name.
 * Uses CIRCULATE polar band around a fixed center.
 */
export function integrateOrbitStep(ship, centerX, centerZ, centerVelX, centerVelZ, dtSec) {
    return integrateOrbitSeekStep(ship, centerX, centerZ, centerVelX, centerVelZ, dtSec, true);
}
//# sourceMappingURL=ship-orbit-ref.js.map