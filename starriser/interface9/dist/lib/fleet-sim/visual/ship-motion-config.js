/**
 * Ship motion **tuning panel** — the only file you should edit to feel out
 * hop / orbit curves.
 *
 * TS helpers (`ship-flight-ref`, `ship-orbit-ref`) and WGSL (`fleet-integrate`)
 * all inject these numbers. Prefer dials here over multi-file edits.
 *
 * ## Unified controller (Rev 2)
 * One non-holonomic step, two profiles (Jump / Cruise):
 *   - SEEK: external-tangent entrance; desiredSpeedSeek = min(open, env, CFL)
 *   - CIRCULATE: polar v_θ = v_orb, v_r = clamp(k_r·(R−r))
 * Soft launch scales **a_up only** — never a_down.
 *
 * Jump: high a_up + JUMP_BRAKE_MULT·a_up, uncapped open (still env+CFL).
 * Cruise: CRUISE_ACCEL_SCALE·accel, CRUISE_BRAKE_MULT·a_up, soft peak.
 */
// ---------------------------------------------------------------------------
// Core scales (personal defaults before hash scatter)
// ---------------------------------------------------------------------------
/** Default personal linear accel (world/s²). Scales with hop cruise. */
export const SHIP_MAX_ACCEL = 14400;
/** @deprecated not a hard clamp on the agent path; kept for import stability. */
export const SHIP_MAX_BRAKE = 28800;
/**
 * Soft cruise (world/s). Keep in lockstep with fleet
 * {@code SPEED_UNITS_PER_SEC} so agents match hop clocks.
 * Peak mid-path CruiseProfile is this × {@link SHIP_MID_CRUISE_BOOST}.
 * Independent of orbit |ω| (ring speed is ORBIT_OMEGA_* · R only).
 */
export const SHIP_MAX_SPEED = 12000;
/** Turn rate cap (rad/s) for all ship types — flat, not cruise-scaled. ~720°/s. */
export const SHIP_MAX_TURN_RAD_S = Math.PI * 4;
/** Min thrust scale while mis-pointed (avoid frozen ships). Only when cos(e)>0. */
export const SHIP_MIN_ALIGN = 0.12;
/** Snap only onto final formation slot (world units). Legacy settle / formation. */
export const SHIP_ARRIVE_EPS = 2;
/**
 * Triangle tip is mesh +X. Draw angle θ = NOSE_OFFSET − heading so tip aligns
 * with motion forward (sin h, cos h); heading 0 = +Z ⇒ θ = π/2.
 */
export const SHIP_NOSE_OFFSET = Math.PI / 2;
// ---------------------------------------------------------------------------
// Launch (soft a_up scale) + mid peak
// ---------------------------------------------------------------------------
/**
 * Accel fraction at speed ≈ 0. Lower → crawl at hop start (time to turn).
 * Soft launch scales **a_up only** — never a_down.
 */
export const SHIP_LAUNCH_ACCEL_MIN = 0.022;
/**
 * Reach full a_up once speed ≥ this · launch_ref (smoothstep + punch curve).
 * SEEK uses cruiseV; CIRCULATE soft-launch is off.
 */
export const SHIP_LAUNCH_SPEED_FRAC = 0.16;
/**
 * CruiseProfile soft peak = cruise × this (v_open when not uncapped).
 * JumpProfile uses {@link V_OPEN_UNCAP} instead.
 */
export const SHIP_MID_CRUISE_BOOST = 1.25;
/**
 * @deprecated Hop schedule rem/tRem deleted from agent path.
 * Kept for import stability only — do not wire into desire law.
 */
export const SHIP_HOP_ARRIVE_FRAC = 0.7;
// ---------------------------------------------------------------------------
// Profiles: Jump (warp SEEK / residual dump) vs Cruise (local / settled ring)
// ---------------------------------------------------------------------------
/** Cruise a_up = CRUISE_ACCEL_SCALE · personal accel. */
export const CRUISE_ACCEL_SCALE = 0.25;
/** Cruise a_down = CRUISE_BRAKE_MULT · cruise a_up. */
export const CRUISE_BRAKE_MULT = 6.0;
/**
 * Jump a_down = JUMP_BRAKE_MULT · a_up (personal accel when Jump).
 * Same as historic ORBIT_BRAKE_MULT.
 */
export const JUMP_BRAKE_MULT = 18.0;
/** Alias: brake mult used by Jump profile (import-stable name). */
export const ORBIT_BRAKE_MULT = JUMP_BRAKE_MULT;
/**
 * Jump open-speed ceiling (huge finite stand-in for uncapped).
 * Always still min'd with env + CFL in desiredSpeedSeek.
 */
export const V_OPEN_UNCAP = 1e9;
/** Hygiene hard ceiling (never a feel dial). */
export const V_HARD_CEIL = 1e6;
// ---------------------------------------------------------------------------
// Brake / continuous energy margin (discrete safety is F1 CFL, not this alone)
// ---------------------------------------------------------------------------
/** Floor on physics stop distance (world units) — legacy helpers only. */
export const SHIP_DEFAULT_BRAKE_DIST = 200;
/**
 * Continuous brake-distance margin m in env = √(v_f² + 2·a_down·ρ / m).
 * Does **not** replace one-step CFL (F1).
 */
export const SHIP_BRAKE_DIST_MARGIN = 1.55;
/**
 * @deprecated Power curve is no longer the primary desire law.
 * Kept for approachSpeedFloor goldens / optional aesthetic under envelope.
 */
export const SHIP_APPROACH_BRAKE_POWER = 3;
// ---------------------------------------------------------------------------
// Orbit geometry + capture (F5)
// ---------------------------------------------------------------------------
/** Personal orbit radius min (world units). */
export const ORBIT_R_MIN = 2;
/** Personal orbit radius max (world units). */
export const ORBIT_R_MAX = 7;
/** Default orbit R when pack omits it. */
export const SHIP_SIM_DEFAULT_ORBIT_R = 4;
/** Min |ω| (rad/s). v_orbit ≈ |ω|·R — ring only (independent of hop cruise). */
export const ORBIT_OMEGA_MIN = 0.45;
/** Max |ω| (rad/s). */
export const ORBIT_OMEGA_MAX = 1.4;
/** Default |ω| when pack omits it. */
export const SHIP_SIM_DEFAULT_ORBIT_OMEGA = 0.7;
/** Near-band lead (rad) — heading helper only; polar speed is normative. */
export const ORBIT_LEAD_RAD = 0.2;
/**
 * Enter CIRCULATE when rem to external-tangent ≤ this · R (primary).
 * Product “±20% of configured radius” = entrance rem band.
 */
export const ORBIT_ENTRANCE_REM_K = 0.2;
/**
 * Numerical floor for ρ_enter only (≪ R_min). **Not** ORBIT_ARRIVE_EPS=2.
 * ρ_enter = max(ORBIT_ENTRANCE_EPS_TINY, ORBIT_ENTRANCE_REM_K · R).
 */
export const ORBIT_ENTRANCE_EPS_TINY = 0.05;
/**
 * Radial safety enter when r ≤ κ · R — keep TIGHT so we don't flip mid-approach.
 * Primary enter is rem to external-tangent entrance.
 */
export const ORBIT_CAPTURE_K = 1.05;
/** Exit CIRCULATE only when r > κ_out · R (and not residual-high). */
export const ORBIT_CAPTURE_OUT_K = 1.35;
/**
 * Near-band desired-speed scale vs orbit floor (polar |v_θ| scale).
 * 1.0 → full orbital speed after capture.
 */
export const ORBIT_NEAR_SPEED_SCALE = 1.0;
/**
 * @deprecated Two-stage far gate (180) deleted from agent path.
 * Kept for import stability only.
 */
export const ORBIT_APPROACH_GATE_SPEED = 180;
/** Soft radial spring gain (1/s): v_r = clamp(k · (R − r), ±v_rad_max). */
export const ORBIT_SPRING_K = 3.0;
/** Cap v_orbit ≤ this · ω_max · R. */
export const ORBIT_OMEGA_TURN_FRAC = 0.9;
/** Center singularity guard (world units). */
export const ORBIT_R_EPS = 0.5;
/**
 * @deprecated Absolute rem=2 must NOT be used as CIRCULATE enter floor.
 * Agent uses ORBIT_ENTRANCE_EPS_TINY. Kept for legacy goldens only.
 */
export const ORBIT_ARRIVE_EPS = 2;
// ---------------------------------------------------------------------------
// Residual latch + wrong-way (F2 / F3)
// ---------------------------------------------------------------------------
/**
 * Design residual **set** threshold (v > this · v_orb). Sticky latch would
 * arm at HIGH and clear at CLEAR; without a ShipSim bit the agent approximates
 * sticky-until-CLEAR by treating residualActive = v > CLEAR for both Jump dump
 * and EXIT freeze (closes thrash window CLEAR &lt; v/v_orb ≤ HIGH).
 */
export const RESIDUAL_HIGH_MUL = 1.5;
/**
 * Residual **clear** / recompute-active threshold. While v > CLEAR·v_orb:
 * Jump dump a_down + soft EXIT freeze (see RESIDUAL_FREEZE_OUT_K).
 * Clear when v ≤ CLEAR·v_orb.
 */
export const RESIDUAL_CLEAR_MUL = 1.2;
/**
 * Residual freezes EXIT only while r ≤ this · R (band around the ring).
 * Beyond it, force SEEK even if still hot — otherwise hop-speed ships that
 * sling past the ring stay CIRCULATE and carve huge fast “orbits” far away
 * (real-game screenshot: normal clump + few ships racing on wide arcs).
 */
export const RESIDUAL_FREEZE_OUT_K = 2.5;
/**
 * CIRCULATE residual speed ceiling on desire:
 * min(2·v_orb, v_orb + ORBIT_RESIDUAL_V_ADD).
 */
export const ORBIT_RESIDUAL_V_MUL = 2.0;
export const ORBIT_RESIDUAL_V_ADD = 12;
/**
 * Wrong-way turn-speed allow: v_turn = ω_max · (V_TURN_ALLOW_R_FRAC · R).
 * When |e| > π/2 or cos(e) < 0, v_tgt ≤ v_turn.
 */
export const V_TURN_ALLOW_R_FRAC = 0.25;
/** Max radial speed fraction of v_orb while circulating (on-ring). */
export const ORBIT_V_RAD_MAX_FRAC = 0.5;
/** Max radial speed absolute floor scale on-ring: also min with 2R. */
export const ORBIT_V_RAD_MAX_R_MUL = 2.0;
/**
 * Deep-inside band r < this · R: singularity escape — stronger radial out,
 * no residual desire crush, wrong-way cap relaxed so ships leave r≈0.
 */
export const ORBIT_SINGULARITY_R_MUL = 0.35;
/**
 * Min outward radial speed while in singularity band (world/s).
 * Clears ~R in under a second even when v_orb is tiny.
 */
export const ORBIT_ESCAPE_V_RAD = 40;
// ---------------------------------------------------------------------------
// Defaults aliased for pack / orbit (same numbers as core scales)
// ---------------------------------------------------------------------------
export const ORBIT_DEFAULT_ACCEL = SHIP_MAX_ACCEL;
export const ORBIT_DEFAULT_OMEGA_MAX = SHIP_MAX_TURN_RAD_S;
export const SHIP_SIM_DEFAULT_ACCEL = SHIP_MAX_ACCEL;
export const SHIP_SIM_DEFAULT_CRUISE_V = SHIP_MAX_SPEED;
// ---------------------------------------------------------------------------
// Personal hash scatter (type + seed) around defaults
// ---------------------------------------------------------------------------
/**
 * Red / blue / green multipliers on accel+cruise (typeId 0/1/2).
 * Relative fleet hop scale: red baseline, blue mid, green fast/small.
 * Orbit |ω| is **type-mul free**.
 */
export const SHIP_TYPE_MUL_RED = 1;
export const SHIP_TYPE_MUL_BLUE = 2;
export const SHIP_TYPE_MUL_GREEN = 10;
/**
 * Per-ship speed variance (±fraction). Applied to hop cruise/accel.
 * Orbit |ω| uses its own personal scatter only (not type mul) so green ships
 * hop fast without orbiting 10× faster / wider-looking.
 * Personal mul ∈ [1−V, 1+V] from seed.
 */
export const SHIP_SPEED_VARIANCE = 0.1;
/** @deprecated use SHIP_SPEED_VARIANCE; kept for import stability. */
export const SHIP_ACCEL_SCATTER_MIN = 1 - SHIP_SPEED_VARIANCE;
/** @deprecated */
export const SHIP_ACCEL_SCATTER_SPAN = 2 * SHIP_SPEED_VARIANCE;
/** @deprecated */
export const SHIP_CRUISE_SCATTER_MIN = 1 - SHIP_SPEED_VARIANCE;
/** @deprecated */
export const SHIP_CRUISE_SCATTER_SPAN = 2 * SHIP_SPEED_VARIANCE;
// ---------------------------------------------------------------------------
// Legacy / rarely touched (kept so imports and old paths stay stable)
// ---------------------------------------------------------------------------
export const SHIP_SETTLE_TAU_S = 0.4;
export const SHIP_TRACK_TAU_S = 0.25;
export const SHIP_AIM_BLEND_START = 0.72;
export const SHIP_SNAP_MS = 0;
export const SHIP_SETTLE_CRUISE_CAP = 180;
export const SHIP_AGENT_SETTLE_ENTER_DIST = 100;
export const SHIP_AGENT_ORBIT_ENTER_DIST = 10;
export const SHIP_AGENT_ORBIT_ENTER_SPEED = 35;
/**
 * Nested view of the same knobs (handy for docs / future UI).
 * Mutating this object does **not** rewrite the const exports — edit the
 * named exports above for live effect after rebuild.
 */
export const ShipMotionTune = {
    accel: SHIP_MAX_ACCEL,
    cruise: SHIP_MAX_SPEED,
    turn: SHIP_MAX_TURN_RAD_S,
    minAlign: SHIP_MIN_ALIGN,
    launch: {
        accelMin: SHIP_LAUNCH_ACCEL_MIN,
        speedFrac: SHIP_LAUNCH_SPEED_FRAC,
    },
    mid: {
        cruiseBoost: SHIP_MID_CRUISE_BOOST,
        /** @deprecated schedule deleted */
        hopArriveFrac: SHIP_HOP_ARRIVE_FRAC,
    },
    profiles: {
        cruiseAccelScale: CRUISE_ACCEL_SCALE,
        cruiseBrakeMult: CRUISE_BRAKE_MULT,
        jumpBrakeMult: JUMP_BRAKE_MULT,
        vOpenUncap: V_OPEN_UNCAP,
    },
    brake: {
        distFloor: SHIP_DEFAULT_BRAKE_DIST,
        distMargin: SHIP_BRAKE_DIST_MARGIN,
        power: SHIP_APPROACH_BRAKE_POWER,
        mult: ORBIT_BRAKE_MULT,
    },
    orbit: {
        rMin: ORBIT_R_MIN,
        rMax: ORBIT_R_MAX,
        rDefault: SHIP_SIM_DEFAULT_ORBIT_R,
        omegaMin: ORBIT_OMEGA_MIN,
        omegaMax: ORBIT_OMEGA_MAX,
        omegaDefault: SHIP_SIM_DEFAULT_ORBIT_OMEGA,
        leadRad: ORBIT_LEAD_RAD,
        entranceRemK: ORBIT_ENTRANCE_REM_K,
        entranceEpsTiny: ORBIT_ENTRANCE_EPS_TINY,
        captureK: ORBIT_CAPTURE_K,
        captureOutK: ORBIT_CAPTURE_OUT_K,
        nearSpeedScale: ORBIT_NEAR_SPEED_SCALE,
        /** @deprecated gate deleted */
        approachGateSpeed: ORBIT_APPROACH_GATE_SPEED,
        springK: ORBIT_SPRING_K,
        omegaTurnFrac: ORBIT_OMEGA_TURN_FRAC,
        residualHighMul: RESIDUAL_HIGH_MUL,
        residualClearMul: RESIDUAL_CLEAR_MUL,
        vTurnAllowRFrac: V_TURN_ALLOW_R_FRAC,
    },
};
//# sourceMappingURL=ship-motion-config.js.map