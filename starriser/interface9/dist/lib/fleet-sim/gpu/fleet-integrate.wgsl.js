/**
 * R2/R3 + GPU LOD — dual compute: fleet center ease + per-ship continuous agent.
 *
 * Two entry points (same module):
 *   cs_fleets — one thread / fleet: FleetGpu.pos via ease01;
 *               GPU LOD band from cameraY + distXZ(target):
 *                 NEAR: multi-ship draw owned by cs_ships (no fleet write)
 *                 MID:  write instance base as world impostor; zero rest
 *                 FAR:  write instance base as screen icon; zero rest
 *   cs_ships  — one thread / ship: integrateShipAgent + draw scatter + trails;
 *               seek center = pathEnd (hop destination), centerVel = 0
 *               MID/FAR: size 0 (non-base) + skip agent (cs_fleets owns draw)
 *               NEAR: agent + trails for localIndex < shipBudget
 *               mode==PAUSED early-returns (tombstone ships)
 *               FLEET_FLAG_WARM → still sim, write draw size=0 (no pop)
 *
 * Host dispatches fleets first, then ships (same encoder; storage barrier auto).
 * Ship physics matches ship-flight-ref / ship-orbit-ref EXACTLY.
 *
 * Time base: relative ms (`nowRel` / `t0` = wallMs - timeOriginMs) so values
 * fit in f32. Unix epoch must never be stored as f32.
 *
 * FleetGpu field reuse (stride 64 unchanged):
 *   shipBudget    @44 := loaded visual ship count (all ships stay loaded)
 *   instanceStart @52 := draw + ShipSim + trail ring base index
 *   countsPacked      := domain TRUE ship counts
 *
 * Bindings:
 *   0 uniforms · 1 fleets · 2 instances · 3 shipSims · 4 trails · 5 trailLines
 */
import { RENDER_PLANE_Y } from "../../../contracts/render-constants.js";
import { FLEET_GPU_STRIDE } from "../visual/fleet-layout.js";
import { BASE_SHIP_SIZE, BLUE_SCALE, GREEN_SCALE, ICON_SCREEN_PX, RED_SCALE, } from "../visual/fleet-lod.js";
import { DEFAULT_TRAIL_LAYOUT, TRAIL_ALPHA_POWER, TRAIL_ALONG_POWER, TRAIL_LINE_FLOATS_PER_VERT, TRAIL_SAMPLE_FLOATS, resolveTrailLayout, } from "../visual/fleet-trail-ref.js";
import { TRAIL_TEMPLATE_INDEX_COUNT } from "./fleet-trails.wgsl.js";
import { MODEL_TRAIL_EMITTER_COUNT, MODEL_TRAIL_EMITTERS, } from "../visual/model-trail-config.js";
import { SHIP_APPROACH_BRAKE_POWER, SHIP_BRAKE_DIST_MARGIN, SHIP_DEFAULT_BRAKE_DIST, SHIP_LAUNCH_ACCEL_MIN, SHIP_LAUNCH_SPEED_FRAC, SHIP_MAX_ACCEL, SHIP_MAX_SPEED, SHIP_MID_CRUISE_BOOST, SHIP_MIN_ALIGN, SHIP_MODE_JUMP, SHIP_MODE_ORBIT, SHIP_MODE_PAUSED, SHIP_MODE_SETTLE, SHIP_NOSE_OFFSET, CRUISE_ACCEL_SCALE, CRUISE_BRAKE_MULT, JUMP_BRAKE_MULT, V_OPEN_UNCAP, HOP_OPEN_SPEED_MUL, HOP_OPEN_SPEED_MIN, RESIDUAL_HIGH_MUL, RESIDUAL_CLEAR_MUL, RESIDUAL_FREEZE_OUT_K, } from "../visual/ship-flight-ref.js";
import { ORBIT_CAPTURE_K, ORBIT_CAPTURE_OUT_K, ORBIT_DEFAULT_ACCEL, ORBIT_DEFAULT_OMEGA_MAX, ORBIT_ENTRANCE_EPS_TINY, ORBIT_ENTRANCE_REM_K, ORBIT_LEAD_RAD, ORBIT_NEAR_SPEED_SCALE, ORBIT_OMEGA_TURN_FRAC, ORBIT_R_EPS, ORBIT_R_MIN, ORBIT_SPRING_K, ORBIT_V_RAD_MAX_FRAC, ORBIT_V_RAD_MAX_R_MUL, ORBIT_RESIDUAL_V_MUL, ORBIT_RESIDUAL_V_ADD, ORBIT_SINGULARITY_R_MUL, ORBIT_ESCAPE_V_RAD, V_TURN_ALLOW_R_FRAC, } from "../visual/ship-orbit-ref.js";
import { SHIP_SIM_STRIDE } from "../visual/ship-sim-layout.js";
import { FLEET_SHIP_DRAW_STRIDE } from "./fleet-ships.wgsl.js";
/**
 * Uniforms (80 bytes, 16-byte aligned):
 *   nowRel f32, fleetCount u32, dtMs f32, shipCount u32,
 *   cameraY f32, targetX f32, targetZ f32, viewportH f32,
 *   tanHalfFov f32, lodNearY f32, lodFarY f32, lodMidDist f32,
 *   expandTrails u32, appendTrails u32, lodNearDist f32, viewCullScale f32,
 *   originX f32, originY f32, originZ f32, _pad f32
 *
 * `origin` = frame floating origin (same as model/trail draw). Expand writes
 * **origin-relative** trail endpoints so pot offsets stay mesh-scale at large |world|.
 *
 * `expandTrails`:
 *   0 = skip ribbon expand
 *   1 = expand all NEAR/MID-lead ships (default game path) — 1 center ribbon
 *   2 = **model-only**: append+expand only when modelHide[simIdx]!=0
 *       (same sparse ownership as model triangle hide). Dense pack still
 *       used so trail draw = drawIndexedIndirect(nDense * segs).
 *       Each model ship expands the triangular pot (1 large + 2 small).
 * Age runs always. Pure sim benches may set 0.
 */
export const FLEET_INTEGRATE_UNIFORM_SIZE = 80;
/**
 * Compute workgroup size for cs_fleets / cs_ships.
 * 128 balances occupancy vs register pressure on the heavy cs_ships agent
 * (256 spilled on some drivers; 64 under-hid memory latency). Feature-neutral.
 */
export const FLEET_INTEGRATE_WORKGROUP = 256;
/** Documented for host code; WGSL embeds the same numbers (game defaults). */
export const FLEET_INTEGRATE_FLEET_STRIDE = FLEET_GPU_STRIDE;
export const FLEET_INTEGRATE_INSTANCE_FLOATS = FLEET_SHIP_DRAW_STRIDE / 4;
export const FLEET_INTEGRATE_SHIP_SIM_STRIDE = SHIP_SIM_STRIDE;
/** Game default ring — tests bake their own via {@link buildFleetIntegrateWgsl}. */
export const FLEET_INTEGRATE_TRAIL_RING_SIZE = DEFAULT_TRAIL_LAYOUT.ringSize;
export const FLEET_INTEGRATE_TRAIL_SAMPLE_FLOATS = TRAIL_SAMPLE_FLOATS;
export const FLEET_INTEGRATE_TRAIL_LINE_FLOATS_PER_SHIP = DEFAULT_TRAIL_LAYOUT.lineFloatsPerShip;
/** Speed threshold for trail append during settle (match small ε). */
const TRAIL_APPEND_SPEED_EPS = 1e-3;
/**
 * Build fleet-integrate WGSL with a concrete trail layout.
 * Game map uses {@link DEFAULT_TRAIL_LAYOUT}; tests pass long-ring layouts.
 */
export function buildFleetIntegrateWgsl(trail = DEFAULT_TRAIL_LAYOUT) {
    const layout = trail ?? resolveTrailLayout();
    // Bake pot emitters into WGSL (fixed 3; host config is source of truth).
    const e0 = MODEL_TRAIL_EMITTERS[0];
    const e1 = MODEL_TRAIL_EMITTERS[1];
    const e2 = MODEL_TRAIL_EMITTERS[2];
    return /* wgsl */ `
// Flag bits — match fleet-layout.ts
const FLEET_FLAG_ALIVE: u32 = 1u;
const FLEET_FLAG_JUMPING: u32 = 2u;
// FLEET_FLAG_COOLDOWN = 4u (not used for pose)
const FLEET_FLAG_NO_TRAIL: u32 = 8u; // W4 icon — skip trail age/append/expand
// Model-LOD thruster pot (triangular) — match model-trail-config.ts
const MODEL_TRAIL_EMITTERS: u32 = ${MODEL_TRAIL_EMITTER_COUNT}u;
const MODEL_TRAIL_E0_LOCAL: vec3<f32> = vec3<f32>(${e0.local.x}, ${e0.local.y}, ${e0.local.z});
const MODEL_TRAIL_E0_ALPHA: f32 = ${e0.intensity};
const MODEL_TRAIL_E1_LOCAL: vec3<f32> = vec3<f32>(${e1.local.x}, ${e1.local.y}, ${e1.local.z});
const MODEL_TRAIL_E1_ALPHA: f32 = ${e1.intensity};
const MODEL_TRAIL_E2_LOCAL: vec3<f32> = vec3<f32>(${e2.local.x}, ${e2.local.y}, ${e2.local.z});
const MODEL_TRAIL_E2_ALPHA: f32 = ${e2.intensity};
const FLEET_FLAG_SIM_PAUSED: u32 = 16u; // R3: host may still set; GPU LOD ignores for band
const FLEET_FLAG_WARM: u32 = 32u; // R5: formation promote warm-up (sim + size 0)
const FLEET_FLAG_SPACE3D: u32 = 64u; // bit6: sphere agent; _pad0 = pathEndY

// GPU LOD bands — match fleet-lod.ts classifyFleetLodBandRaw
const LOD_BAND_NEAR: u32 = 0u;
const LOD_BAND_MID: u32 = 1u;
const LOD_BAND_FAR: u32 = 2u;

// Ship modes — match ship-flight-ref.ts
const SHIP_MODE_PAUSED: u32 = ${SHIP_MODE_PAUSED}u;
const SHIP_MODE_JUMP: u32 = ${SHIP_MODE_JUMP}u;
const SHIP_MODE_SETTLE: u32 = ${SHIP_MODE_SETTLE}u;
const SHIP_MODE_ORBIT: u32 = ${SHIP_MODE_ORBIT}u;

// Ship flight constants — match ship-flight-ref.ts / ship-motion-config.ts
const SHIP_MAX_ACCEL: f32 = ${SHIP_MAX_ACCEL};
const SHIP_MAX_SPEED: f32 = ${SHIP_MAX_SPEED};
const SHIP_MIN_ALIGN: f32 = ${SHIP_MIN_ALIGN};
const SHIP_NOSE_OFFSET: f32 = ${SHIP_NOSE_OFFSET};
const SHIP_DEFAULT_BRAKE_DIST: f32 = ${SHIP_DEFAULT_BRAKE_DIST};
const SHIP_BRAKE_DIST_MARGIN: f32 = ${SHIP_BRAKE_DIST_MARGIN};
const SHIP_APPROACH_BRAKE_POWER: f32 = ${SHIP_APPROACH_BRAKE_POWER};
const SHIP_LAUNCH_ACCEL_MIN: f32 = ${SHIP_LAUNCH_ACCEL_MIN};
const SHIP_LAUNCH_SPEED_FRAC: f32 = ${SHIP_LAUNCH_SPEED_FRAC};
const SHIP_MID_CRUISE_BOOST: f32 = ${SHIP_MID_CRUISE_BOOST};
const CRUISE_ACCEL_SCALE: f32 = ${CRUISE_ACCEL_SCALE};
const CRUISE_BRAKE_MULT: f32 = ${CRUISE_BRAKE_MULT};
const JUMP_BRAKE_MULT: f32 = ${JUMP_BRAKE_MULT};
const V_OPEN_UNCAP: f32 = ${V_OPEN_UNCAP};
const HOP_OPEN_SPEED_MUL: f32 = ${HOP_OPEN_SPEED_MUL};
const HOP_OPEN_SPEED_MIN: f32 = ${HOP_OPEN_SPEED_MIN};
const RESIDUAL_HIGH_MUL: f32 = ${RESIDUAL_HIGH_MUL};
const RESIDUAL_CLEAR_MUL: f32 = ${RESIDUAL_CLEAR_MUL};
const RESIDUAL_FREEZE_OUT_K: f32 = ${RESIDUAL_FREEZE_OUT_K};
const TRAIL_APPEND_SPEED_EPS: f32 = ${TRAIL_APPEND_SPEED_EPS};
const PI: f32 = 3.141592653589793;
const TWO_PI: f32 = 6.283185307179586;

// Impostor / icon draw — match fleet-lod.ts
const BASE_SHIP_SIZE: f32 = ${BASE_SHIP_SIZE};
const RED_SCALE: f32 = ${RED_SCALE};
const BLUE_SCALE: f32 = ${BLUE_SCALE};
const GREEN_SCALE: f32 = ${GREEN_SCALE};
const ICON_SCREEN_PX: f32 = ${ICON_SCREEN_PX};

// Orbit constants — match ship-orbit-ref.ts (unified controller)
const ORBIT_R_MIN: f32 = ${ORBIT_R_MIN};
const ORBIT_SPRING_K: f32 = ${ORBIT_SPRING_K};
const ORBIT_DEFAULT_OMEGA_MAX: f32 = ${ORBIT_DEFAULT_OMEGA_MAX};
const ORBIT_DEFAULT_ACCEL: f32 = ${ORBIT_DEFAULT_ACCEL};
const ORBIT_LEAD_RAD: f32 = ${ORBIT_LEAD_RAD};
const ORBIT_ENTRANCE_REM_K: f32 = ${ORBIT_ENTRANCE_REM_K};
const ORBIT_ENTRANCE_EPS_TINY: f32 = ${ORBIT_ENTRANCE_EPS_TINY};
const ORBIT_CAPTURE_K: f32 = ${ORBIT_CAPTURE_K};
const ORBIT_CAPTURE_OUT_K: f32 = ${ORBIT_CAPTURE_OUT_K};
const ORBIT_NEAR_SPEED_SCALE: f32 = ${ORBIT_NEAR_SPEED_SCALE};
const ORBIT_OMEGA_TURN_FRAC: f32 = ${ORBIT_OMEGA_TURN_FRAC};
const ORBIT_R_EPS: f32 = ${ORBIT_R_EPS};
const V_TURN_ALLOW_R_FRAC: f32 = ${V_TURN_ALLOW_R_FRAC};
const ORBIT_V_RAD_MAX_FRAC: f32 = ${ORBIT_V_RAD_MAX_FRAC};
const ORBIT_V_RAD_MAX_R_MUL: f32 = ${ORBIT_V_RAD_MAX_R_MUL};
const ORBIT_RESIDUAL_V_MUL: f32 = ${ORBIT_RESIDUAL_V_MUL};
const ORBIT_RESIDUAL_V_ADD: f32 = ${ORBIT_RESIDUAL_V_ADD};
const ORBIT_SINGULARITY_R_MUL: f32 = ${ORBIT_SINGULARITY_R_MUL};
const ORBIT_ESCAPE_V_RAD: f32 = ${ORBIT_ESCAPE_V_RAD};

// Trail constants — from TrailLayout (game or test override at layer init)
const TRAIL_RING_SIZE: u32 = ${layout.ringSize}u;
const TRAIL_SAMPLE_FLOATS: u32 = ${TRAIL_SAMPLE_FLOATS}u;
const TRAIL_LIFETIME_MS: f32 = ${layout.lifetimeMs}.0;
const TRAIL_MIN_DIST: f32 = ${layout.minDist};
const TRAIL_MAX_INTERVAL_MS: f32 = ${layout.maxIntervalMs}.0;
const TRAIL_SEGS: u32 = ${layout.segsPerShip}u;
const TRAIL_LINE_FLOATS_PER_VERT: u32 = ${TRAIL_LINE_FLOATS_PER_VERT}u;
const TRAIL_LINE_FLOATS_PER_SHIP: u32 = ${layout.lineFloatsPerShip}u;
// Alpha: age factor × along-trail factor (see fleet-trail-ref TRAIL_*_POWER).
const TRAIL_ALPHA_POWER: f32 = ${Number(TRAIL_ALPHA_POWER)};
const TRAIL_ALONG_POWER: f32 = ${Number(TRAIL_ALONG_POWER)};

struct IntegrateUniforms {
  nowRel: f32,
  fleetCount: u32,
  dtMs: f32,
  shipCount: u32,
  cameraY: f32,
  targetX: f32,
  targetZ: f32,
  viewportH: f32,
  tanHalfFov: f32,
  lodNearY: f32,
  lodFarY: f32,
  lodMidDist: f32,
  /**
   * 0 = no expand; 1 = expand all; 2 = expand/append only modelHide[sim]!=0.
   * Dense pack always (trailDrawMeta atomic); draw uses indirect n*segs.
   */
  expandTrails: u32,
  /** 1 = distance/time-gated sample append (default). 0 = agent only (probe). */
  appendTrails: u32,
  /** Soft XZ demote NEAR→MID when dist ≥ this (match fleet-lod nearDist). */
  lodNearDist: f32,
  /**
   * View-cull radius scale: ground radius ≈ cameraY * tanHalfFov * this.
   * Fleets outside get MID-like agent budget (lead only) so off-screen
   * formations do not pay CAP_NEAR agent+trail every frame.
   */
  viewCullScale: f32,
  /**
   * Frame floating origin (match model/trail draw). Expand stores endpoints as
   * (sample − origin) + pot so thruster offsets stay precise at large |world|.
   */
  origin: vec3<f32>,
  _originPad: f32,
};

// Scalar fields match writeFleetGpu DataView packing (stride 64).
// _pad0: planar 0; SPACE3D → pathEndY (orbit/seek center height).
struct FleetGpu {
  posX: f32,
  posZ: f32,
  heading: f32,
  _pad0: f32,
  pathStartX: f32,
  pathStartZ: f32,
  pathEndX: f32,
  pathEndZ: f32,
  t0: f32,
  durationMs: f32,
  flags: u32,
  shipBudget: u32,     // loaded visual ship count (all ships stay loaded)
  countsPacked: u32,   // domain truth counts
  instanceStart: u32,  // draw + ShipSim + trail base index
  fleetIdHash: u32,
  _pad1: u32,
};

// Match ship-sim-layout.ts stride 96 (posY + quat + heading cache)
struct ShipSim {
  posX: f32,
  posY: f32,         // planar production always 0
  posZ: f32,
  speed: f32,
  qx: f32,           // orientation quaternion (yaw-only in planar)
  qy: f32,
  qz: f32,
  qw: f32,
  slotX: f32,
  slotY: f32,        // planar 0
  slotZ: f32,
  heading: f32,      // cached yaw from quat (heading 0 = +Z)
  trailWrite: u32,   // next ring index
  sinceSample: f32,  // distance since last trail append
  mode: u32,
  fleetIndex: u32,
  targetKind: u32,
  orbitPhase: f32,
  accel: f32,
  cruiseV: f32,
  orbitR: f32,
  orbitOmega: f32,
  omegaMax: f32,   // turn rate cap (rad/s); ≤0 → ORBIT_DEFAULT_OMEGA_MAX
  _pad1: f32,
};

@group(0) @binding(0) var<uniform> u: IntegrateUniforms;
@group(0) @binding(1) var<storage, read_write> fleets: array<FleetGpu>;
// L2 draw layout: 12 f32 per instance; base 0..2, center 3..5, rotation 6, size/color 7..10
@group(0) @binding(2) var<storage, read_write> instances: array<f32>;
@group(0) @binding(3) var<storage, read_write> shipSims: array<ShipSim>;
// Flat TrailSample f32s: shipIndex * RING * 4 + slot * 4 + {posX,posZ,age01,posY}
// 4th float = posY (default 0); expand ribbons stay XZ-only for this phase.
@group(0) @binding(4) var<storage, read_write> trails: array<f32>;
// Trail ribbons: **dense pack for draw** this frame (slot 0..trailDrawCount-1).
// Samples stay at simIdx; expand atomically claims a dense draw slot.
@group(0) @binding(5) var<storage, read_write> trailLines: array<f32>;
// trailDrawMeta[0] = atomic dense expand count (reset host-side each frame)
@group(0) @binding(6) var<storage, read_write> trailDrawMeta: array<atomic<u32>>;
// DrawIndexedIndirectArgs (20 B) written after cs_ships for trail pass
@group(0) @binding(7) var<storage, read_write> trailIndirect: array<u32>;
// Model-owned ship mask (1 = textured model draws this simIdx). Used when expandTrails==2.
@group(0) @binding(8) var<storage, read> modelHide: array<u32>;

/** True when this ship may append/expand trails under current expandTrails mode. */
fn trailAllowedForShip(simIdx: u32) -> bool {
  // Mode 2: only model-owned (same bit as triangle hide list).
  if (u.expandTrails == 2u) {
    return modelHide[simIdx] != 0u;
  }
  // Mode 0 still allows append when appendTrails is on (age path); expand gated elsewhere.
  return true;
}

/** Clamp to [0,1] — match ship-flight-ref clamp01. */
fn clamp01(v: f32) -> f32 {
  return clamp(v, 0.0, 1.0);
}

/** Quintic ease-in-out — match ease01 (pronounced bell vs smoothstep). */
fn ease01(uIn: f32) -> f32 {
  let x = clamp01(uIn);
  if (x < 0.5) {
    return 16.0 * x * x * x * x * x;
  }
  let t = -2.0 * x + 2.0;
  return 1.0 - (t * t * t * t * t) / 2.0;
}

/** Derivative of quintic ease01: peak 5.0 at u=0.5 — match easeDeriv. */
fn easeDeriv(uIn: f32) -> f32 {
  if (uIn <= 0.0 || uIn >= 1.0) {
    return 0.0;
  }
  if (uIn < 0.5) {
    let u2 = uIn * uIn;
    return 80.0 * u2 * u2;
  }
  let v = 1.0 - uIn;
  let v2 = v * v;
  return 80.0 * v2 * v2;
}

/** Wrap to (-π, π] — match ship-flight-ref wrapPi. */
fn wrapPi(a: f32) -> f32 {
  var x = a;
  // Bounded loop; angles stay near ±π after one step of turn limiting.
  for (var i = 0; i < 16; i++) {
    if (x > PI) {
      x = x - TWO_PI;
    } else if (x <= -PI) {
      x = x + TWO_PI;
    } else {
      break;
    }
  }
  return x;
}

/** Yaw-only quaternion from heading (about +Y; heading 0 faces +Z). */
fn quatFromYaw(yaw: f32) -> vec4<f32> {
  let half = yaw * 0.5;
  return vec4<f32>(0.0, sin(half), 0.0, cos(half));
}

/** Ensure non-zero quat; rebuild from heading when missing (host stamps heading only). */
fn ensureShipQuat(shipIn: ShipSim) -> ShipSim {
  var ship = shipIn;
  let qLenSq = ship.qx * ship.qx + ship.qy * ship.qy + ship.qz * ship.qz + ship.qw * ship.qw;
  if (qLenSq < 1e-12) {
    let q = quatFromYaw(ship.heading);
    ship.qx = q.x;
    ship.qy = q.y;
    ship.qz = q.z;
    ship.qw = q.w;
  }
  return ship;
}

/** Sync yaw-only quat from heading cache (planar path). */
fn syncQuatFromHeading(shipIn: ShipSim) -> ShipSim {
  var ship = shipIn;
  let q = quatFromYaw(ship.heading);
  ship.qx = q.x;
  ship.qy = q.y;
  ship.qz = q.z;
  ship.qw = q.w;
  return ship;
}

/** Body +Z forward from unit quaternion — match forwardFromQuat. */
fn forwardFromQuat(q: vec4<f32>) -> vec3<f32> {
  // q * (0,0,1) * q^{-1}
  let fx = 2.0 * (q.x * q.z + q.w * q.y);
  let fy = 2.0 * (q.y * q.z - q.w * q.x);
  let fz = 1.0 - 2.0 * (q.x * q.x + q.y * q.y);
  return vec3<f32>(fx, fy, fz);
}

/** Rotate local vector by unit quat — match quatRotateVec3 (trail pot offsets). */
fn quatRotateVec3(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let qv = vec3<f32>(q.x, q.y, q.z);
  let tx = 2.0 * (qv.y * v.z - qv.z * v.y);
  let ty = 2.0 * (qv.z * v.x - qv.x * v.z);
  let tz = 2.0 * (qv.x * v.y - qv.y * v.x);
  let t = vec3<f32>(tx, ty, tz);
  return v + q.w * t + cross(qv, t);
}

/** Yaw cache from quat — match yawFromQuat. */
fn yawFromQuat(q: vec4<f32>) -> f32 {
  let fx = 2.0 * (q.x * q.z + q.w * q.y);
  let fz = 1.0 - 2.0 * (q.x * q.x + q.y * q.y);
  return atan2(fx, fz);
}

fn quatNormalize4(q: vec4<f32>) -> vec4<f32> {
  let lenSq = dot(q, q);
  if (lenSq < 1e-20) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }
  return q * inverseSqrt(lenSq);
}

/** Look-rotation: body +Z → forward, +Y toward up — match quatLookRotation. */
fn quatLookRotation(forward: vec3<f32>, upIn: vec3<f32>) -> vec4<f32> {
  var f = forward;
  let fLen = length(f);
  if (fLen < 1e-12) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }
  f = f / fLen;
  var r = cross(upIn, f);
  var rLen = length(r);
  if (rLen < 1e-8) {
    var alt = vec3<f32>(0.0, 1.0, 0.0);
    if (abs(f.y) >= 0.9) {
      alt = vec3<f32>(1.0, 0.0, 0.0);
    }
    r = cross(alt, f);
    rLen = length(r);
    if (rLen < 1e-12) {
      return vec4<f32>(0.0, 0.0, 0.0, 1.0);
    }
  }
  r = r / rLen;
  let u = cross(f, r);
  // columns = right, up, forward
  let m00 = r.x; let m01 = u.x; let m02 = f.x;
  let m10 = r.y; let m11 = u.y; let m12 = f.y;
  let m20 = r.z; let m21 = u.z; let m22 = f.z;
  let trace = m00 + m11 + m22;
  var x: f32; var y: f32; var z: f32; var w: f32;
  if (trace > 0.0) {
    let s = sqrt(trace + 1.0) * 2.0;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    let s = sqrt(1.0 + m00 - m11 - m22) * 2.0;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    let s = sqrt(1.0 + m11 - m00 - m22) * 2.0;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    let s = sqrt(1.0 + m22 - m00 - m11) * 2.0;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return quatNormalize4(vec4<f32>(x, y, z, w));
}

/** Rate-limited slerp toward target quat by ≤ maxAngle — match quatRotateToward. */
fn quatRotateToward(c: vec4<f32>, tIn: vec4<f32>, maxAngle: f32) -> vec4<f32> {
  var t = tIn;
  var cosOmega = dot(c, t);
  if (cosOmega < 0.0) {
    t = -t;
    cosOmega = -cosOmega;
  }
  cosOmega = clamp(cosOmega, -1.0, 1.0);
  let omega = acos(cosOmega);
  if (omega < 1e-8 || maxAngle <= 0.0) {
    return quatNormalize4(c);
  }
  let tt = min(1.0, maxAngle / omega);
  // slerp
  var t0: f32;
  var t1: f32;
  if (cosOmega > 0.9995) {
    t0 = 1.0 - tt;
    t1 = tt;
  } else {
    let sinOmega = sin(omega);
    t0 = sin((1.0 - tt) * omega) / sinOmega;
    t1 = sin(tt * omega) / sinOmega;
  }
  return quatNormalize4(c * t0 + t * t1);
}

/** Preferred sphere orbit up — match preferredSphereOrbitUp. */
fn preferredSphereOrbitUp(rHat: vec3<f32>) -> vec3<f32> {
  if (abs(rHat.y) > 0.95) {
    return vec3<f32>(1.0, 0.0, 0.0);
  }
  return vec3<f32>(0.0, 1.0, 0.0);
}

/**
 * Sphere external-tangent / lead aim — match computeSphereOrbitAimTarget.
 * Returns (Tx, Ty, Tz); theta via atan2(tx,tz) stored by caller if needed.
 */
fn computeSphereOrbitAimTarget(
  pos: vec3<f32>,
  center: vec3<f32>,
  radius: f32,
  side: f32,
  near: bool,
  fallbackFwd: vec3<f32>,
) -> vec4<f32> {
  let R = select(ORBIT_R_MIN, radius, radius > 1e-6);
  let s = select(-1.0, 1.0, side >= 0.0);
  let v = pos - center;
  let r2 = dot(v, v);
  let rEps = max(ORBIT_R_EPS, 0.05 * R);
  let rEps2 = rEps * rEps;

  var rHat: vec3<f32>;
  if (r2 < rEps2) {
    var f = fallbackFwd;
    var fLen = length(f);
    if (fLen < 1e-6) {
      f = vec3<f32>(0.0, 0.0, 1.0);
      fLen = 1.0;
    }
    rHat = f / fLen;
  } else {
    rHat = v * inverseSqrt(r2);
  }

  let up = preferredSphereOrbitUp(rHat);
  var sideV = cross(up, rHat);
  var sideLen = length(sideV);
  if (sideLen < 1e-8) {
    var alt = vec3<f32>(0.0, 1.0, 0.0);
    if (abs(rHat.y) >= 0.9) {
      alt = vec3<f32>(1.0, 0.0, 0.0);
    }
    sideV = cross(alt, rHat);
    sideLen = length(sideV);
  }
  if (sideLen > 1e-12) {
    sideV = sideV * (s / sideLen);
  } else {
    sideV = vec3<f32>(s, 0.0, 0.0);
  }

  let useLead = near || (r2 <= R * R + 1e-6);
  if (useLead) {
    let cL = cos(ORBIT_LEAD_RAD);
    let sL = sin(ORBIT_LEAD_RAD);
    let tOff = R * (cL * rHat + sL * sideV);
    let theta = atan2(tOff.x, tOff.z);
    return vec4<f32>(center + tOff, theta);
  }

  let invD2 = 1.0 / r2;
  let a = (R * R) * invD2;
  let b = (R * sqrt(max(0.0, r2 - R * R))) * invD2;
  let d = sqrt(r2);
  let tOff2 = a * v + b * sideV * d;
  let theta2 = atan2(tOff2.x, tOff2.z);
  return vec4<f32>(center + tOff2, theta2);
}

/** Shortest signed turn fromAngle→toAngle in (-π, π] — match shortestAngleDelta. */
fn shortestAngleDelta(fromAngle: f32, toAngle: f32) -> f32 {
  return atan2(sin(toAngle - fromAngle), cos(toAngle - fromAngle));
}

/**
 * desiredSpeedSeek — normative SEEK desire (F4 + F1).
 * min(v_open, env=√(v_f² + 2·a_down·ρ/m), cfl=max(v_f, ρ/dt))
 */
fn desiredSpeedSeek(
  rho: f32,
  vFloor: f32,
  aDown: f32,
  m: f32,
  vOpen: f32,
  dt: f32,
) -> f32 {
  let rhoP = max(rho, 1e-6);
  let vf = max(vFloor, 0.0);
  let a = max(aDown, 1e-6);
  let margin = max(m, 1e-6);
  let env = sqrt(max(0.0, vf * vf + (2.0 * a * rhoP) / margin));
  let cfl = max(vf, rhoP / max(dt, 1e-6));
  let open = select(V_OPEN_UNCAP, vOpen, vOpen > 0.0);
  return min(open, min(env, cfl));
}

/** approachSpeedFloor — legacy goldens only (not agent path). */
fn approachSpeedFloor(remDist: f32, cruiseV: f32, brakeDist: f32, vFloor: f32) -> f32 {
  let floorV = max(vFloor, 0.0);
  if (cruiseV <= floorV) {
    return floorV;
  }
  if (remDist <= 1e-9) {
    return floorV;
  }
  if (brakeDist <= 1e-9) {
    return cruiseV;
  }
  if (remDist >= brakeDist) {
    return cruiseV;
  }
  let t = remDist / brakeDist;
  return floorV + (cruiseV - floorV) * pow(t, SHIP_APPROACH_BRAKE_POWER);
}

/** launchAccelScale — soft a_up scale only (match ship-flight-ref). */
fn launchAccelScale(speed: f32, cruiseV: f32) -> f32 {
  let c = select(1.0, cruiseV, cruiseV > 1e-6);
  let span = c * SHIP_LAUNCH_SPEED_FRAC;
  var s = select(1.0, speed / span, span > 1e-9);
  s = clamp(s, 0.0, 1.0);
  let u = s * s * (3.0 - 2.0 * s);
  let punch = u * u;
  return SHIP_LAUNCH_ACCEL_MIN + (1.0 - SHIP_LAUNCH_ACCEL_MIN) * punch;
}

/** peakCruiseSpeed — CruiseProfile soft open (match ship-flight-ref). */
fn peakCruiseSpeed(cruiseV: f32) -> f32 {
  if (cruiseV <= 0.0) {
    return 0.0;
  }
  return cruiseV * SHIP_MID_CRUISE_BOOST;
}

/** orbitPoint — match ship-orbit-ref. */
fn orbitPoint(centerX: f32, centerZ: f32, radius: f32, phase: f32) -> vec2<f32> {
  return vec2<f32>(
    centerX + radius * sin(phase),
    centerZ + radius * cos(phase),
  );
}

/** orbitTangentHeading — match ship-orbit-ref. */
fn orbitTangentHeading(phase: f32, omegaSign: f32) -> f32 {
  if (omegaSign >= 0.0) {
    return atan2(cos(phase), -sin(phase));
  }
  return atan2(-cos(phase), sin(phase));
}

/** orbitSideSign — match ship-orbit-ref. */
fn orbitSideSign(omega: f32) -> f32 {
  if (omega < 0.0) {
    return -1.0;
  }
  return 1.0;
}

/** rotPerpSide — s·π/2 rotation of unit (ux,uz). */
fn rotPerpSide(ux: f32, uz: f32, side: f32) -> vec2<f32> {
  let s = select(-1.0, 1.0, side >= 0.0);
  return vec2<f32>(s * uz, -s * ux);
}

/** orbitFloorSpeed — match ship-orbit-ref. */
fn orbitFloorSpeed(omega: f32, radius: f32, omegaMax: f32) -> f32 {
  let R = select(ORBIT_R_MIN, radius, radius > 1e-6);
  let vOmega = abs(omega) * R;
  let om = select(ORBIT_DEFAULT_OMEGA_MAX, omegaMax, omegaMax > 0.0);
  let turnCap = ORBIT_OMEGA_TURN_FRAC * om * R;
  return min(vOmega, turnCap);
}

/**
 * Far/near aim — match ship-orbit-ref computeOrbitAimTarget.
 * Far: external tangent on side s (no chord through disk).
 * Near: T = orbitPoint(C, R, θ + s·λ)
 * Returns (Tx, Tz, theta).
 */
fn computeOrbitAimTarget(
  posX: f32,
  posZ: f32,
  centerX: f32,
  centerZ: f32,
  radius: f32,
  side: f32,
  near: bool,
  fallbackHeading: f32,
) -> vec3<f32> {
  let R = select(ORBIT_R_MIN, radius, radius > 1e-6);
  let s = select(-1.0, 1.0, side >= 0.0);
  // d = P − C
  let dx = posX - centerX;
  let dz = posZ - centerZ;
  let r2 = dx * dx + dz * dz;
  let rEps = max(ORBIT_R_EPS, 0.05 * R);
  let rEps2 = rEps * rEps;

  if (near) {
    var theta: f32;
    if (r2 < rEps2) {
      theta = wrapPi(fallbackHeading + s * (PI * 0.5));
    } else {
      theta = atan2(dx, dz);
    }
    let phase = theta + s * ORBIT_LEAD_RAD;
    let pt = orbitPoint(centerX, centerZ, R, phase);
    return vec3<f32>(pt.x, pt.y, theta);
  }

  // On/inside ring: near-lead style.
  if (r2 <= R * R + 1e-6) {
    var theta2: f32;
    if (r2 < rEps2) {
      theta2 = wrapPi(fallbackHeading + s * (PI * 0.5));
    } else {
      theta2 = atan2(dx, dz);
    }
    let pt2 = orbitPoint(centerX, centerZ, R, theta2 + s * ORBIT_LEAD_RAD);
    return vec3<f32>(pt2.x, pt2.y, theta2);
  }
  // External tangent: T−C = a·v + s·b·CW90(v)
  let invD2 = 1.0 / r2;
  let a = (R * R) * invD2;
  let b = (R * sqrt(max(0.0, r2 - R * R))) * invD2;
  let tx = a * dx + s * b * dz;
  let tz = a * dz + s * b * (-dx);
  return vec3<f32>(centerX + tx, centerZ + tz, atan2(tx, tz));
}

/**
 * Analytic fleet-center velocity — match analyticFleetCenterVelocity.
 * Only non-zero while jumping with u in (0,1).
 */
fn analyticFleetCenterVelocity(
  pathStartX: f32,
  pathStartZ: f32,
  pathEndX: f32,
  pathEndZ: f32,
  t0: f32,
  durationMs: f32,
  nowRel: f32,
) -> vec2<f32> {
  if (durationMs <= 0.0) {
    return vec2<f32>(0.0, 0.0);
  }
  let uu = clamp01((nowRel - t0) / durationMs);
  if (uu <= 0.0 || uu >= 1.0) {
    return vec2<f32>(0.0, 0.0);
  }
  let durationS = durationMs / 1000.0;
  let sDot = easeDeriv(uu) / durationS;
  return vec2<f32>(
    (pathEndX - pathStartX) * sDot,
    (pathEndZ - pathStartZ) * sDot,
  );
}

/**
 * Unified orbit-seek step — match integrateOrbitSeekStep (TS).
 * Planar (!space3d): XZ ring + yaw — exact prior body.
 * Space3d: sphere external-tangent + sphere CIRCULATE + full quat look-at.
 */
fn integrateOrbitSeekStep(
  shipIn: ShipSim,
  centerX: f32,
  centerZ: f32,
  centerY: f32,
  centerVelX: f32,
  centerVelZ: f32,
  centerVelY: f32,
  dtSec: f32,
  near: bool,
  aUpIn: f32,
  aDownIn: f32,
  vOpenIn: f32,
  brakeMarginIn: f32,
  softLaunch: bool,
  space3d: bool,
) -> ShipSim {
  var ship = ensureShipQuat(shipIn);
  var dt = dtSec;
  if (dt < 0.0) {
    dt = 0.0;
  } else if (dt > 0.05) {
    dt = 0.05;
  }

  let R = select(ORBIT_R_MIN, ship.orbitR, ship.orbitR > 1e-6);
  let omega = ship.orbitOmega;
  let side = orbitSideSign(omega);
  let omegaMax = select(ORBIT_DEFAULT_OMEGA_MAX, ship.omegaMax, ship.omegaMax > 0.0);
  var cruiseV = ship.cruiseV;
  if (cruiseV <= 0.0) {
    cruiseV = SHIP_MAX_SPEED;
  }

  let aUp = select(ORBIT_DEFAULT_ACCEL, aUpIn, aUpIn > 0.0);
  let aDown = select(aUp * JUMP_BRAKE_MULT, aDownIn, aDownIn > 0.0);
  let vOpen = select(V_OPEN_UNCAP, vOpenIn, vOpenIn > 0.0);
  let brakeMargin = select(SHIP_BRAKE_DIST_MARGIN, brakeMarginIn, brakeMarginIn > 1e-6);

  let vOrbit = orbitFloorSpeed(omega, R, omegaMax);
  let vOrbitUse = select(vOrbit, vOrbit * ORBIT_NEAR_SPEED_SCALE, near);

  // -------- Planar path (production): bit-stable, no sphere cost --------
  if (!space3d) {
    let dx = ship.posX - centerX;
    let dz = ship.posZ - centerZ;
    let r = sqrt(dx * dx + dz * dz);
    let rEps = max(ORBIT_R_EPS, 0.05 * R);

    var vRelX: f32;
    var vRelZ: f32;
    var remAim: f32 = 0.0;
    let singularity = near && (r < max(rEps, ORBIT_SINGULARITY_R_MUL * R));

    if (near) {
      var rHatX: f32;
      var rHatZ: f32;
      if (r >= rEps) {
        let invR = 1.0 / r;
        rHatX = dx * invR;
        rHatZ = dz * invR;
        ship.orbitPhase = atan2(dx, dz);
      } else {
        ship.orbitPhase = wrapPi(ship.heading + side * (PI * 0.5));
        rHatX = sin(ship.heading + side * (PI * 0.5));
        rHatZ = cos(ship.heading + side * (PI * 0.5));
        let rH = sqrt(rHatX * rHatX + rHatZ * rHatZ);
        if (rH > 1e-6) {
          rHatX = rHatX / rH;
          rHatZ = rHatZ / rH;
        } else {
          rHatX = 1.0;
          rHatZ = 0.0;
        }
      }
      let tHatX = side * rHatZ;
      let tHatZ = side * (-rHatX);
      var vRadMax = min(ORBIT_V_RAD_MAX_FRAC * vOrbitUse, ORBIT_V_RAD_MAX_R_MUL * R);
      if (singularity) {
        vRadMax = max(vRadMax, max(ORBIT_ESCAPE_V_RAD, 4.0 * R));
      }
      var vR = ORBIT_SPRING_K * (R - r);
      if (singularity && vR < ORBIT_ESCAPE_V_RAD) {
        vR = ORBIT_ESCAPE_V_RAD;
      }
      vR = clamp(vR, -vRadMax, vRadMax);
      let vTh = select(vOrbitUse, 0.0, singularity);
      vRelX = vR * rHatX + vTh * tHatX;
      vRelZ = vR * rHatZ + vTh * tHatZ;
      if (!singularity) {
        var vRelMag = sqrt(vRelX * vRelX + vRelZ * vRelZ);
        let vNearCap = min(ORBIT_RESIDUAL_V_MUL * vOrbitUse, vOrbitUse + ORBIT_RESIDUAL_V_ADD);
        if (vRelMag > vNearCap && vRelMag > 1e-6) {
          let sc = vNearCap / vRelMag;
          vRelX = vRelX * sc;
          vRelZ = vRelZ * sc;
        }
      }
    } else {
      let aim = computeOrbitAimTarget(
        ship.posX, ship.posZ, centerX, centerZ, R, side, false, ship.heading,
      );
      ship.orbitPhase = aim.z;
      remAim = sqrt(
        (aim.x - ship.posX) * (aim.x - ship.posX) +
          (aim.y - ship.posZ) * (aim.y - ship.posZ),
      );
      let vDes = desiredSpeedSeek(remAim, vOrbit, aDown, brakeMargin, vOpen, dt);
      let toTx = aim.x - ship.posX;
      let toTz = aim.y - ship.posZ;
      let toTLen = sqrt(toTx * toTx + toTz * toTz);
      if (toTLen > 1e-6) {
        let inv = 1.0 / toTLen;
        vRelX = toTx * inv * vDes;
        vRelZ = toTz * inv * vDes;
      } else {
        let tangH = orbitTangentHeading(aim.z, side);
        vRelX = sin(tangH) * vOrbit;
        vRelZ = cos(tangH) * vOrbit;
      }
    }

    let vStarX = centerVelX + vRelX;
    let vStarZ = centerVelZ + vRelZ;
    let vStarLen = sqrt(vStarX * vStarX + vStarZ * vStarZ);

    var psiStar = ship.heading;
    if (vStarLen > 1e-6) {
      psiStar = atan2(vStarX, vStarZ);
    }

    let e = shortestAngleDelta(ship.heading, psiStar);
    let maxTurn = omegaMax * dt;
    var turn = e;
    if (turn > maxTurn) {
      turn = maxTurn;
    } else if (turn < -maxTurn) {
      turn = -maxTurn;
    }
    ship.heading = wrapPi(ship.heading + turn);
    ship = syncQuatFromHeading(ship);

    var cosE: f32;
    let ae = abs(e);
    if (ae < 0.25) {
      cosE = 1.0 - 0.5 * e * e;
    } else {
      cosE = cos(e);
    }
    var vTarget: f32;
    if (singularity) {
      let align = max(SHIP_MIN_ALIGN, cosE);
      vTarget = max(vStarLen * align, ORBIT_ESCAPE_V_RAD * 0.5);
    } else if (ae > (PI * 0.5) || cosE < 0.0) {
      let ell = V_TURN_ALLOW_R_FRAC * R;
      let vTurn = omegaMax * ell;
      vTarget = min(vStarLen, vTurn);
    } else {
      let align = max(SHIP_MIN_ALIGN, cosE);
      vTarget = vStarLen * align;
    }
    if (near && cosE > 0.85) {
      let cLen2 = centerVelX * centerVelX + centerVelZ * centerVelZ;
      let floorW = select(vOrbitUse * 0.85, sqrt(cLen2) + vOrbitUse * 0.85, cLen2 > 1e-12);
      if (vTarget < floorW) {
        vTarget = floorW;
      }
    }

    if (vTarget > ship.speed) {
      var maxDvUp = aUp * dt;
      if (softLaunch) {
        let launchRef = select(SHIP_MAX_SPEED, cruiseV, cruiseV > 0.0);
        maxDvUp = aUp * launchAccelScale(ship.speed, launchRef) * dt;
      }
      ship.speed = min(ship.speed + maxDvUp, vTarget);
    } else {
      ship.speed = max(ship.speed - aDown * dt, vTarget);
    }
    if (ship.speed < 0.0) {
      ship.speed = 0.0;
    }

    if (!near && cosE > 0.0) {
      let cfl = remAim / max(dt, 1e-6);
      let cap = max(vOrbit, cfl);
      if (ship.speed > cap) {
        ship.speed = cap;
      }
    }

    let step = ship.speed * dt;
    let sh = sin(ship.heading);
    let ch = cos(ship.heading);
    ship.posX = ship.posX + sh * step;
    ship.posY = 0.0;
    ship.posZ = ship.posZ + ch * step;
    return ship;
  }

  // -------- Sphere 3D path (SPACE3D) --------
  {
    let pos = vec3<f32>(ship.posX, ship.posY, ship.posZ);
    let center = vec3<f32>(centerX, centerY, centerZ);
    let dvec = pos - center;
    let r = length(dvec);
    let rEps = max(ORBIT_R_EPS, 0.05 * R);
    let qCur = vec4<f32>(ship.qx, ship.qy, ship.qz, ship.qw);
    let fwd0 = forwardFromQuat(qCur);

    let aim4 = computeSphereOrbitAimTarget(
      pos, center, R, side, near, fwd0,
    );
    let aim = aim4.xyz;
    ship.orbitPhase = aim4.w;

    var vRel = vec3<f32>(0.0, 0.0, 0.0);
    var remAim: f32 = 0.0;
    let singularity = near && (r < max(rEps, ORBIT_SINGULARITY_R_MUL * R));

    if (near) {
      var rHat: vec3<f32>;
      if (r >= rEps) {
        rHat = dvec / r;
      } else {
        let fLen = length(fwd0);
        if (fLen > 1e-6) {
          rHat = fwd0 / fLen;
        } else {
          rHat = vec3<f32>(1.0, 0.0, 0.0);
        }
      }
      let up = preferredSphereOrbitUp(rHat);
      var tHat = cross(up, rHat);
      var tLen = length(tHat);
      if (tLen < 1e-8) {
        tHat = vec3<f32>(1.0, 0.0, 0.0);
        tLen = 1.0;
      }
      tHat = tHat * (side / tLen);

      var vRadMax = min(ORBIT_V_RAD_MAX_FRAC * vOrbitUse, ORBIT_V_RAD_MAX_R_MUL * R);
      if (singularity) {
        vRadMax = max(vRadMax, max(ORBIT_ESCAPE_V_RAD, 4.0 * R));
      }
      var vR = ORBIT_SPRING_K * (R - r);
      if (singularity && vR < ORBIT_ESCAPE_V_RAD) {
        vR = ORBIT_ESCAPE_V_RAD;
      }
      vR = clamp(vR, -vRadMax, vRadMax);
      let vTh = select(vOrbitUse, 0.0, singularity);
      vRel = vR * rHat + vTh * tHat;
      if (!singularity) {
        let vRelMag = length(vRel);
        let vNearCap = min(ORBIT_RESIDUAL_V_MUL * vOrbitUse, vOrbitUse + ORBIT_RESIDUAL_V_ADD);
        if (vRelMag > vNearCap && vRelMag > 1e-6) {
          vRel = vRel * (vNearCap / vRelMag);
        }
      }
      remAim = length(aim - pos);
    } else {
      remAim = length(aim - pos);
      let vDes = desiredSpeedSeek(remAim, vOrbit, aDown, brakeMargin, vOpen, dt);
      let toT = aim - pos;
      let toTLen = length(toT);
      if (toTLen > 1e-6) {
        vRel = (toT / toTLen) * vDes;
      } else {
        let ar = aim - center;
        let arLen = length(ar);
        var rhx = vec3<f32>(1.0, 0.0, 0.0);
        if (arLen > 1e-6) {
          rhx = ar / arLen;
        }
        let up2 = preferredSphereOrbitUp(rhx);
        var tHat = cross(up2, rhx);
        var tLen = length(tHat);
        if (tLen < 1e-6) {
          tHat = vec3<f32>(1.0, 0.0, 0.0);
          tLen = 1.0;
        }
        vRel = tHat * ((side * vOrbit) / tLen);
      }
    }

    let vStar = vec3<f32>(centerVelX, centerVelY, centerVelZ) + vRel;
    let vStarLen = length(vStar);
    let curFwd = forwardFromQuat(qCur);
    var cosE: f32 = 1.0;
    if (vStarLen > 1e-6) {
      cosE = clamp(dot(curFwd, vStar / vStarLen), -1.0, 1.0);
    }
    let e = acos(cosE);
    let maxTurn = omegaMax * dt;

    var tq: vec4<f32>;
    if (vStarLen > 1e-6) {
      tq = quatLookRotation(vStar, vec3<f32>(0.0, 1.0, 0.0));
    } else {
      tq = quatLookRotation(curFwd, vec3<f32>(0.0, 1.0, 0.0));
    }
    let nextQ = quatRotateToward(qCur, tq, maxTurn);
    ship.qx = nextQ.x;
    ship.qy = nextQ.y;
    ship.qz = nextQ.z;
    ship.qw = nextQ.w;
    ship.heading = yawFromQuat(nextQ);

    var vTarget: f32;
    if (singularity) {
      let align = max(SHIP_MIN_ALIGN, cosE);
      vTarget = max(vStarLen * align, ORBIT_ESCAPE_V_RAD * 0.5);
    } else if (e > (PI * 0.5) || cosE < 0.0) {
      let ell = V_TURN_ALLOW_R_FRAC * R;
      let vTurn = omegaMax * ell;
      vTarget = min(vStarLen, vTurn);
    } else {
      let align = max(SHIP_MIN_ALIGN, cosE);
      vTarget = vStarLen * align;
    }
    if (near && cosE > 0.85) {
      let cLen = length(vec3<f32>(centerVelX, centerVelY, centerVelZ));
      let floorW = cLen + vOrbitUse * 0.85;
      if (vTarget < floorW) {
        vTarget = floorW;
      }
    }

    if (vTarget > ship.speed) {
      var maxDvUp = aUp * dt;
      if (softLaunch) {
        let launchRef = select(SHIP_MAX_SPEED, cruiseV, cruiseV > 0.0);
        maxDvUp = aUp * launchAccelScale(ship.speed, launchRef) * dt;
      }
      ship.speed = min(ship.speed + maxDvUp, vTarget);
    } else {
      ship.speed = max(ship.speed - aDown * dt, vTarget);
    }
    if (ship.speed < 0.0) {
      ship.speed = 0.0;
    }

    if (!near && cosE > 0.0) {
      let cfl = remAim / max(dt, 1e-6);
      let cap = max(vOrbit, cfl);
      if (ship.speed > cap) {
        ship.speed = cap;
      }
    }

    let step = ship.speed * dt;
    let fwd = forwardFromQuat(vec4<f32>(ship.qx, ship.qy, ship.qz, ship.qw));
    ship.posX = ship.posX + fwd.x * step;
    ship.posY = ship.posY + fwd.y * step;
    ship.posZ = ship.posZ + fwd.z * step;
    return ship;
  }
}

/**
 * Open speed for domain hop — match hopOpenSpeedFromDuration (TS).
 */
fn hopOpenSpeed(pathLen: f32, durationMs: f32) -> f32 {
  if (durationMs <= 0.0 || pathLen <= 1e-6) {
    return SHIP_MAX_SPEED;
  }
  let durS = max(durationMs / 1000.0, 1e-3);
  let mean = pathLen / durS;
  return max(HOP_OPEN_SPEED_MIN, mean * HOP_OPEN_SPEED_MUL);
}

/**
 * Unified agent — match integrateShipAgent (TS).
 * space3d: sphere band + rem to sphere tangent; centerY from pathEndY.
 * pathStart + durationMs scale Jump open to the fleet hop clock.
 */
fn integrateShipAgent(
  shipIn: ShipSim,
  centerX: f32,
  centerZ: f32,
  centerY: f32,
  centerVelX: f32,
  centerVelZ: f32,
  centerVelY: f32,
  dtMsIn: f32,
  domainWarpActive: bool,
  space3d: bool,
  pathStartX: f32,
  pathStartZ: f32,
  durationMs: f32,
) -> ShipSim {
  var ship = shipIn;

  var dt = dtMsIn;
  if (dt < 0.0) {
    dt = 0.0;
  } else if (dt > 50.0) {
    dt = 50.0;
  }
  let dtSec = dt / 1000.0;

  if (ship.mode == SHIP_MODE_PAUSED) {
    ship.speed = 0.0;
    return ship;
  }

  if (!(ship.accel > 0.0)) {
    ship.accel = SHIP_MAX_ACCEL;
  }
  if (!(ship.cruiseV > 0.0)) {
    ship.cruiseV = SHIP_MAX_SPEED;
  }

  // Hop open from path length / domain duration (formation ships share fleet clock).
  var hopOpen: f32 = 0.0;
  if (domainWarpActive && durationMs > 0.0) {
    let pdx = centerX - pathStartX;
    let pdz = centerZ - pathStartZ;
    let pLen = sqrt(pdx * pdx + pdz * pdz);
    hopOpen = hopOpenSpeed(pLen, durationMs);
    if (ship.cruiseV > hopOpen) {
      ship.cruiseV = hopOpen;
    }
  }

  let R = select(1.0, ship.orbitR, ship.orbitR > 1e-6);
  var r: f32;
  if (space3d) {
    let dx = ship.posX - centerX;
    let dy = ship.posY - centerY;
    let dz = ship.posZ - centerZ;
    r = sqrt(dx * dx + dy * dy + dz * dz);
  } else {
    r = sqrt(
      (ship.posX - centerX) * (ship.posX - centerX) +
        (ship.posZ - centerZ) * (ship.posZ - centerZ),
    );
  }
  let captureIn = ORBIT_CAPTURE_K * R;
  let captureOut = ORBIT_CAPTURE_OUT_K * R;

  let vOrb = orbitFloorSpeed(ship.orbitOmega, R, ORBIT_DEFAULT_OMEGA_MAX);
  let residualActive = ship.speed > (RESIDUAL_CLEAR_MUL * vOrb);
  let residualFreezeOut = RESIDUAL_FREEZE_OUT_K * R;

  var near = ship.mode == SHIP_MODE_ORBIT || ship.mode == SHIP_MODE_SETTLE;
  if (near) {
    if (r > residualFreezeOut) {
      near = false;
    } else if (r > captureOut && !residualActive) {
      near = false;
    }
  } else {
    let side = orbitSideSign(ship.orbitOmega);
    var remEntrance: f32;
    if (space3d) {
      ship = ensureShipQuat(ship);
      let fwd = forwardFromQuat(vec4<f32>(ship.qx, ship.qy, ship.qz, ship.qw));
      let farAim = computeSphereOrbitAimTarget(
        vec3<f32>(ship.posX, ship.posY, ship.posZ),
        vec3<f32>(centerX, centerY, centerZ),
        R,
        side,
        false,
        fwd,
      );
      let dpx = farAim.x - ship.posX;
      let dpy = farAim.y - ship.posY;
      let dpz = farAim.z - ship.posZ;
      remEntrance = sqrt(dpx * dpx + dpy * dpy + dpz * dpz);
    } else {
      let farAim = computeOrbitAimTarget(
        ship.posX, ship.posZ, centerX, centerZ, R, side, false, ship.heading,
      );
      remEntrance = sqrt(
        (farAim.x - ship.posX) * (farAim.x - ship.posX) +
          (farAim.y - ship.posZ) * (farAim.y - ship.posZ),
      );
    }
    let entranceCap = max(ORBIT_ENTRANCE_EPS_TINY, ORBIT_ENTRANCE_REM_K * R);
    if (remEntrance <= entranceCap || r <= captureIn) {
      near = true;
    }
  }
  if (near) {
    ship.mode = SHIP_MODE_ORBIT;
  } else {
    ship.mode = SHIP_MODE_JUMP;
  }

  let useJump = residualActive || (!near && domainWarpActive);
  var aUp: f32;
  var aDown: f32;
  var vOpen: f32;
  var softLaunch: bool;
  if (useJump) {
    aUp = ship.accel;
    aDown = ship.accel * JUMP_BRAKE_MULT;
    // Domain hop SEEK: hop-open (duration-coupled). Residual dump alone: uncap.
    if (residualActive && !(domainWarpActive && hopOpen > 0.0)) {
      vOpen = V_OPEN_UNCAP;
    } else if (hopOpen > 0.0) {
      vOpen = hopOpen;
    } else if (domainWarpActive) {
      vOpen = peakCruiseSpeed(ship.cruiseV);
    } else {
      vOpen = V_OPEN_UNCAP;
    }
    softLaunch = !near;
  } else {
    aUp = ship.accel * CRUISE_ACCEL_SCALE;
    aDown = aUp * CRUISE_BRAKE_MULT;
    vOpen = peakCruiseSpeed(ship.cruiseV);
    softLaunch = !near;
  }

  return integrateOrbitSeekStep(
    ship,
    centerX,
    centerZ,
    centerY,
    centerVelX,
    centerVelZ,
    centerVelY,
    dtSec,
    near,
    aUp,
    aDown,
    vOpen,
    SHIP_BRAKE_DIST_MARGIN,
    softLaunch,
    space3d,
  );
}

/**
 * Trail sample field [2] = **birth nowRel (ms)** for live samples, or **−1** dead.
 * age01 = saturate((nowRel − birth) / lifetime). Removes O(ring) age stores/frame.
 */
fn sampleAge01(birth: f32, nowRel: f32) -> f32 {
  if (birth < 0.0) {
    return 1.0;
  }
  if (TRAIL_LIFETIME_MS <= 0.0) {
    return 1.0;
  }
  let age = (nowRel - birth) / TRAIL_LIFETIME_MS;
  if (age <= 0.0) {
    return 0.0;
  }
  if (age >= 1.0) {
    return 1.0;
  }
  return age;
}

/** No-op: age is derived from birth at read (call sites kept for clarity). */
fn ageTrailRing(_ringBase: u32, _dtMsIn: f32) {}

/**
 * Distance + time gated append — match tryAppendTrailSample (birth-time GPU).
 * Returns ship with updated trailWrite / sinceSample.
 */
fn tryAppendTrail(
  shipIn: ShipSim,
  ringBase: u32,
  distMoved: f32,
  allowAppend: bool,
) -> ShipSim {
  var ship = shipIn;
  if (!allowAppend) {
    return ship;
  }
  let dist = ship.sinceSample + distMoved;
  let mask = TRAIL_RING_SIZE - 1u;
  // Fast path: minDist already satisfied → append without loading newest sample
  // (time gate only matters when still below minDist). Orbit ships almost always
  // take this path.
  if (dist < TRAIL_MIN_DIST) {
    let newestIdx = (ship.trailWrite - 1u) & mask;
    let newestBirth = trails[ringBase + newestIdx * TRAIL_SAMPLE_FLOATS + 2u];
    let newestAge = sampleAge01(newestBirth, u.nowRel);
    let timeOk =
      distMoved > 0.05 &&
      newestAge * TRAIL_LIFETIME_MS + 0.001 >= TRAIL_MAX_INTERVAL_MS;
    if (!timeOk) {
      ship.sinceSample = dist;
      return ship;
    }
  }
  let w = ship.trailWrite & mask;
  let base = ringBase + w * TRAIL_SAMPLE_FLOATS;
  trails[base] = ship.posX;
  trails[base + 1u] = ship.posZ;
  // Birth timestamp (ms). age01 derived in expand / gates via sampleAge01.
  trails[base + 2u] = u.nowRel;
  trails[base + 3u] = ship.posY; // posY (expand uses this for 3D ribbons)
  ship.trailWrite = (w + 1u) & mask;
  ship.sinceSample = 0.0;
  return ship;
}

/**
 * Draw alpha for one expand endpoint.
 * along01: 0 = ship/newest, 1 = oldest trail tip (forces gradient on short rings).
 * age01: sample age (kills dead samples; secondary dim).
 */
fn trailDrawAlpha(age01: f32, along01: f32) -> f32 {
  if (age01 >= 1.0) {
    return 0.0;
  }
  // Age power is 1 in production — skip general pow.
  let ageT = max(1.0 - age01, 0.0);
  var ageFade = ageT;
  if (TRAIL_ALPHA_POWER != 1.0) {
    ageFade = pow(ageT, TRAIL_ALPHA_POWER);
  }
  // Along power 1.25: t * sqrt(sqrt(t)) == t^1.25 (cheaper than pow on many GPUs).
  let alongT = max(1.0 - along01, 0.0);
  var alongFade = alongT;
  if (TRAIL_ALONG_POWER == 1.25) {
    alongFade = alongT * sqrt(sqrt(alongT));
  } else if (TRAIL_ALONG_POWER != 1.0) {
    alongFade = pow(alongT, TRAIL_ALONG_POWER);
  }
  return ageFade * alongFade;
}

/**
 * Fixed-slot line expand for one ribbon — walk ring backward like trailLiveSegments.
 * Dead / incomplete segments write degenerate alpha-0 verts (same pos).
 * Alpha: head opaque → tip transparent via along-trail index (not age alone).
 * worldOff is added to every sample (model thruster pot = R(quat)*local).
 * alphaMul scales endpoint alpha (small emitters dimmer/thinner).
 * maxDrawSlots caps dense pack (host sizes trailLines accordingly).
 */
fn expandTrailLines(
  simIdx: u32,
  ringBase: u32,
  write: u32,
  colorR: f32,
  colorG: f32,
  colorB: f32,
  baseY: f32,
  worldOff: vec3<f32>,
  alphaMul: f32,
  maxDrawSlots: u32,
) {
  // Dense pack for this frame's trail draw (no low-index bias).
  // maxDrawSlots from host (trailDrawMeta[1] = line slot capacity) or caller.
  let drawSlot = atomicAdd(&trailDrawMeta[0], 1u);
  if (drawSlot >= maxDrawSlots) {
    return;
  }
  let mask = TRAIL_RING_SIZE - 1u;
  let lineBase = drawSlot * TRAIL_LINE_FLOATS_PER_SHIP;
  // simIdx retained for future debug; samples already at ringBase.
  let _sim = simIdx;
  // Avoid /0 if TRAIL_SEGS ever 0 (layout always ≥ 3).
  let segsF = max(f32(TRAIL_SEGS), 1.0);
  let aMul = max(alphaMul, 0.0);
  // Walk newest→oldest. First dead pair ⇒ remaining older segs are dead too
  // (ring ages uniformly). Zero-fill the tail once and stop (big win when the
  // ring is not full yet; full rings still write all live segs).
  for (var seg = 0u; seg < TRAIL_SEGS; seg++) {
    let idxB = (write - 1u - seg) & mask; // newer
    let idxA = (write - 2u - seg) & mask; // older
    let baseA = ringBase + idxA * TRAIL_SAMPLE_FLOATS;
    let baseB = ringBase + idxB * TRAIL_SAMPLE_FLOATS;
    let ageA = sampleAge01(trails[baseA + 2u], u.nowRel);
    let ageB = sampleAge01(trails[baseB + 2u], u.nowRel);
    let vo = lineBase + seg * 2u * TRAIL_LINE_FLOATS_PER_VERT;

    if (ageA >= 1.0 || ageB >= 1.0) {
      // Degenerate this seg + all older segs (alpha 0). Positions irrelevant.
      for (var s2 = seg; s2 < TRAIL_SEGS; s2++) {
        let vo2 = lineBase + s2 * 2u * TRAIL_LINE_FLOATS_PER_VERT;
        // Only alphas are read for discard; zero both endpoints.
        trailLines[vo2 + 6u] = 0.0;
        trailLines[vo2 + 13u] = 0.0;
      }
      break;
    }

    // Origin-relative expand (match meshWorldRelative / trailExpandEndpointRelativeF32):
    //   f32(sample − origin) + pot   — pot must be applied AFTER origin subtract
    // so thruster offsets survive at large |world| (follow origin = ship).
    let ox = u.origin.x;
    let oy = u.origin.y;
    let oz = u.origin.z;
    let x0 = (trails[baseA] - ox) + worldOff.x;
    let z0 = (trails[baseA + 1u] - oz) + worldOff.z;
    // Sample slot 3 = posY (planar 0 → ribbons sit on baseY; space3d lifts trails).
    let y0 = (baseY + trails[baseA + 3u] - oy) + worldOff.y;
    let x1 = (trails[baseB] - ox) + worldOff.x;
    let z1 = (trails[baseB + 1u] - oz) + worldOff.z;
    let y1 = (baseY + trails[baseB + 3u] - oy) + worldOff.y;
    // along: 0 at newest sample, 1 at oldest expand tip
    let alongB = f32(seg) / segsF;
    let alongA = f32(seg + 1u) / segsF;
    let a0 = trailDrawAlpha(ageA, alongA) * aMul;
    let a1 = trailDrawAlpha(ageB, alongB) * aMul;

    trailLines[vo] = x0;
    trailLines[vo + 1u] = y0;
    trailLines[vo + 2u] = z0;
    trailLines[vo + 3u] = colorR;
    trailLines[vo + 4u] = colorG;
    trailLines[vo + 5u] = colorB;
    trailLines[vo + 6u] = a0;
    trailLines[vo + 7u] = x1;
    trailLines[vo + 8u] = y1;
    trailLines[vo + 9u] = z1;
    trailLines[vo + 10u] = colorR;
    trailLines[vo + 11u] = colorG;
    trailLines[vo + 12u] = colorB;
    trailLines[vo + 13u] = a1;
  }
}

/**
 * Expand center ribbon (mode 1) or triangular pot (mode 2) for one ship.
 * Mode 2: always 3 emitters with body-local offsets via ship quat.
 * Host grows trailLines for dense ≤ modelOwned*3 (and caps maxSlots).
 */
fn expandShipTrails(
  simIdx: u32,
  ringBase: u32,
  write: u32,
  colorR: f32,
  colorG: f32,
  colorB: f32,
  baseY: f32,
  ship: ShipSim,
) {
  // Capacity: host writes trailDrawMeta[1] = line slot capacity each frame.
  var maxSlots = atomicLoad(&trailDrawMeta[1]);
  if (maxSlots == 0u) {
    maxSlots = u.shipCount;
  }
  let zeroOff = vec3<f32>(0.0, 0.0, 0.0);
  if (u.expandTrails != 2u) {
    expandTrailLines(
      simIdx, ringBase, write, colorR, colorG, colorB, baseY,
      zeroOff, 1.0, maxSlots,
    );
    return;
  }
  var q = vec4<f32>(ship.qx, ship.qy, ship.qz, ship.qw);
  if (dot(q, q) < 1e-12) {
    q = quatFromYaw(ship.heading);
  } else {
    q = quatNormalize4(q);
  }
  let o0 = quatRotateVec3(q, MODEL_TRAIL_E0_LOCAL);
  let o1 = quatRotateVec3(q, MODEL_TRAIL_E1_LOCAL);
  let o2 = quatRotateVec3(q, MODEL_TRAIL_E2_LOCAL);
  expandTrailLines(
    simIdx, ringBase, write, colorR, colorG, colorB, baseY,
    o0, MODEL_TRAIL_E0_ALPHA, maxSlots,
  );
  expandTrailLines(
    simIdx, ringBase, write, colorR, colorG, colorB, baseY,
    o1, MODEL_TRAIL_E1_ALPHA, maxSlots,
  );
  expandTrailLines(
    simIdx, ringBase, write, colorR, colorG, colorB, baseY,
    o2, MODEL_TRAIL_E2_ALPHA, maxSlots,
  );
}

/**
 * Height-first LOD band — match fleet-lod classifyFleetLodBandRaw:
 *   cameraY >= FAR_Y → FAR
 *   cameraY >= NEAR_Y → MID
 *   distXZ >= MID_DIST → MID (extreme)
 *   distXZ >= NEAR_DIST → MID (soft demote; docs)
 *   else → NEAR
 *
 * Plus view-cull: if outside ground-view radius, demote NEAR→MID so off-screen
 * fleets do not run CAP_NEAR multi-ship agent (formation resumes when in view).
 */
fn classifyLodBand(cameraY: f32, posX: f32, posZ: f32) -> u32 {
  if (cameraY >= u.lodFarY) {
    return LOD_BAND_FAR;
  }
  let dx = posX - u.targetX;
  let dz = posZ - u.targetZ;
  let distXZ = sqrt(dx * dx + dz * dz);
  if (cameraY >= u.lodNearY) {
    return LOD_BAND_MID;
  }
  if (distXZ >= u.lodMidDist) {
    return LOD_BAND_MID;
  }
  // Soft XZ demotion (policy nearDist) — was missing in WGSL vs docs.
  if (u.lodNearDist > 0.0 && distXZ >= u.lodNearDist) {
    return LOD_BAND_MID;
  }
  // Off-screen formation: treat as MID (lead agent + icon) not full scatter.
  let viewScale = max(u.viewCullScale, 1.0);
  let viewR = max(u.cameraY * u.tanHalfFov * viewScale, u.lodNearDist * 0.5);
  if (viewR > 0.0 && distXZ > viewR) {
    return LOD_BAND_MID;
  }
  return LOD_BAND_NEAR;
}

/** Dominant type from countsPacked (red | blue<<10 | green<<20). */
fn dominantFromPacked(packed: u32) -> vec4<f32> {
  // returns (sizeScale, colorR, colorG, colorB)
  let red = packed & 0x3FFu;
  let blue = (packed >> 10u) & 0x3FFu;
  let green = (packed >> 20u) & 0x3FFu;
  if (red > 0u) {
    return vec4<f32>(RED_SCALE, 1.0, 0.2, 0.2);
  }
  if (blue > 0u) {
    return vec4<f32>(BLUE_SCALE, 0.2, 0.6, 1.0);
  }
  if (green > 0u) {
    return vec4<f32>(GREEN_SCALE, 0.2, 1.0, 0.4);
  }
  return vec4<f32>(1.0, 0.5, 0.5, 0.5);
}

/** World impostor size = BASE_SHIP_SIZE * dominant scale (match impostorSize). */
fn impostorWorldSize(packed: u32) -> f32 {
  let red = packed & 0x3FFu;
  let blue = (packed >> 10u) & 0x3FFu;
  let green = (packed >> 20u) & 0x3FFu;
  if (red == 0u && blue == 0u && green == 0u) {
    return 0.0;
  }
  return BASE_SHIP_SIZE * dominantFromPacked(packed).x;
}

/** Simple world size from draw color (restore after MID/FAR zero / FAR icon). */
fn sizeFromDrawColor(r: f32, g: f32, b: f32) -> f32 {
  // Pack colors: red (1,0.2,0.2), blue (0.2,0.6,1), green (0.2,1,0.4)
  if (r > 0.7 && g < 0.4) {
    return BASE_SHIP_SIZE * RED_SCALE;
  }
  if (b > 0.7 && r < 0.4) {
    return BASE_SHIP_SIZE * BLUE_SCALE;
  }
  if (g > 0.7 && r < 0.4) {
    return BASE_SHIP_SIZE * GREEN_SCALE;
  }
  return BASE_SHIP_SIZE;
}

/** Zero draw size at instance index (hide without free). */
fn zeroDrawSize(instIdx: u32) {
  let floatsPerInstance = ${FLEET_INTEGRATE_INSTANCE_FLOATS}u;
  let o = instIdx * floatsPerInstance;
  instances[o + 7u] = 0.0;
}

/**
 * trailLines are **dense-packed by expandTrailLines** (atomic drawSlot), not
 * simIdx-addressed. Never zero trailLines[simIdx * FLOATS] — that races with
 * expand writers and can wipe model-owned dense slots 0..n-1 when a low-index
 * MID ship runs clear while a high-index NEAR ship packs drawSlot.
 * Draw uses drawIndexedIndirect(denseCount * segs) so non-expanders need no wipe.
 */
fn clearTrailLineVerts(_simIdx: u32) {
  // Intentionally empty under dense expand layout.
}

/**
 * Kill trail **ring samples** only (simIdx-addressed). Line expand buffer is
 * dense-packed each frame — expand writers alone own trailLines.
 */
fn killShipTrails(simIdx: u32) {
  let ringBase = simIdx * TRAIL_RING_SIZE * TRAIL_SAMPLE_FLOATS;
  for (var si = 0u; si < TRAIL_RING_SIZE; si++) {
    let so = ringBase + si * TRAIL_SAMPLE_FLOATS;
    trails[so + 2u] = -1.0; // birth sentinel = dead
  }
}

/**
 * Write single impostor/icon at base; zero remaining slots base+1..base+N-1.
 * rotation 0; screenSpace pad 0 for world impostor, 1 for icon.
 */
fn writeLodProxy(
  base: u32,
  n: u32,
  posX: f32,
  posZ: f32,
  size: f32,
  colorR: f32,
  colorG: f32,
  colorB: f32,
  screenSpace: f32,
) {
  let floatsPerInstance = ${FLEET_INTEGRATE_INSTANCE_FLOATS}u;
  let baseY = ${Number(RENDER_PLANE_Y).toFixed(1)};
  let o = base * floatsPerInstance;
  instances[o] = posX;
  instances[o + 1u] = baseY;
  instances[o + 2u] = posZ;
  instances[o + 3u] = 0.0;
  instances[o + 4u] = 0.0;
  instances[o + 5u] = 0.0;
  instances[o + 6u] = 0.0; // rotation 0 — pure translate
  instances[o + 7u] = size;
  instances[o + 8u] = colorR;
  instances[o + 9u] = colorG;
  instances[o + 10u] = colorB;
  instances[o + 11u] = screenSpace;
  if (n > 1u) {
    for (var i = 1u; i < n; i++) {
      zeroDrawSize(base + i);
    }
  }
}

/**
 * Pass A — one thread per fleet: ease FleetGpu.pos + GPU LOD draw for MID/FAR.
 * Heading left untouched (formation formH).
 * NEAR: multi-ship draw owned by cs_ships.
 * MID/FAR: single impostor/icon at instanceStart; hide rest of shipBudget.
 */
@compute @workgroup_size(${FLEET_INTEGRATE_WORKGROUP})
fn cs_fleets(@builtin(global_invocation_id) gid3: vec3<u32>) {
  let gid = gid3.x;
  if (gid >= u.fleetCount) {
    return;
  }

  var f = fleets[gid];
  // Tombstone: skip (host zeros draw on free).
  if ((f.flags & FLEET_FLAG_ALIVE) == 0u) {
    return;
  }

  let jumping = (f.flags & FLEET_FLAG_JUMPING) != 0u;
  if (jumping) {
    var uJump = 1.0;
    if (f.durationMs > 0.0) {
      uJump = clamp01((u.nowRel - f.t0) / f.durationMs);
    }
    let s = ease01(uJump);
    f.posX = mix(f.pathStartX, f.pathEndX, s);
    f.posZ = mix(f.pathStartZ, f.pathEndZ, s);
  } else {
    f.posX = f.pathEndX;
    f.posZ = f.pathEndZ;
  }

  fleets[gid] = f;

  let N = f.shipBudget;
  if (N == 0u) {
    return;
  }
  let base = f.instanceStart;
  let band = classifyLodBand(u.cameraY, f.posX, f.posZ);

  // NEAR: cs_ships owns multi-ship draw.
  if (band == LOD_BAND_NEAR) {
    return;
  }

  let dom = dominantFromPacked(f.countsPacked);
  // MID and FAR share the same screen-space icon size (ICON_SCREEN_PX, pad=1).
  // Difference is trails (MID may keep a trace; FAR has no trail) — not scale.
  if (band == LOD_BAND_FAR || band == LOD_BAND_MID) {
    writeLodProxy(
      base,
      N,
      f.posX,
      f.posZ,
      ICON_SCREEN_PX,
      dom.y,
      dom.z,
      dom.w,
      1.0,
    );
    return;
  }
}

/**
 * Pass B — one thread per ship index 0..shipCount-1.
 * Fleet pass must run first. GPU LOD:
 *   NEAR — agent + multi-ship draw + trails
 *   MID  — lead-only agent + lead trail (non-leads freeze, size 0)
 *   FAR  — no agent; icon from cs_fleets
 * Off-screen / soft nearDist demote to MID via classifyLodBand.
 */
@compute @workgroup_size(${FLEET_INTEGRATE_WORKGROUP})
fn cs_ships(@builtin(global_invocation_id) gid3: vec3<u32>) {
  let simIdx = gid3.x;
  if (simIdx >= u.shipCount) {
    return;
  }

  var ship = shipSims[simIdx];
  let floatsPerInstance = ${FLEET_INTEGRATE_INSTANCE_FLOATS}u;
  let o = simIdx * floatsPerInstance;

  if (ship.mode == SHIP_MODE_PAUSED) {
    ship.speed = 0.0;
    shipSims[simIdx] = ship;
    return;
  }

  let fi = ship.fleetIndex;
  if (fi >= u.fleetCount) {
    zeroDrawSize(simIdx);
    return;
  }

  let f = fleets[fi];
  if ((f.flags & FLEET_FLAG_ALIVE) == 0u) {
    zeroDrawSize(simIdx);
    ship.speed = 0.0;
    shipSims[simIdx] = ship;
    return;
  }

  if (simIdx < f.instanceStart) {
    zeroDrawSize(simIdx);
    ship.speed = 0.0;
    shipSims[simIdx] = ship;
    return;
  }
  let localIndex = simIdx - f.instanceStart;
  let band = classifyLodBand(u.cameraY, f.posX, f.posZ);

  if (band == LOD_BAND_FAR) {
    if (localIndex != 0u) {
      zeroDrawSize(simIdx);
    }
    // Skip killShipTrails every frame — trails already dead after first FAR.
    ship.speed = 0.0;
    shipSims[simIdx] = ship;
    return;
  }

  if (localIndex >= f.shipBudget) {
    zeroDrawSize(simIdx);
    ship.speed = 0.0;
    shipSims[simIdx] = ship;
    return;
  }

  let noTrail = (f.flags & FLEET_FLAG_NO_TRAIL) != 0u;
  let simPaused = (f.flags & FLEET_FLAG_SIM_PAUSED) != 0u;
  let baseY = ${Number(RENDER_PLANE_Y).toFixed(1)};
  let ringBase = simIdx * TRAIL_RING_SIZE * TRAIL_SAMPLE_FLOATS;
  var domainWarpActive = (f.flags & FLEET_FLAG_JUMPING) != 0u;
  let space3d = (f.flags & FLEET_FLAG_SPACE3D) != 0u;
  // pathEndY lives in _pad0 when SPACE3D; else planar centerY = 0.
  let pathEndY = select(0.0, f._pad0, space3d);

  // Per-ship jump desync: hold agent until nowRel ≥ fleet.t0 + jumpStaggerMs
  // so members leave/arrive out of lockstep (≤ ~500 ms product).
  if (domainWarpActive && ship._pad1 > 0.0 && u.nowRel < f.t0 + ship._pad1) {
    ship.speed = 0.0;
    shipSims[simIdx] = ship;
    // Still write draw pose so hide/model paths see a valid base.
    instances[o] = ship.posX;
    instances[o + 1u] = ship.posY + baseY;
    instances[o + 2u] = ship.posZ;
    instances[o + 6u] = wrapPi(SHIP_NOSE_OFFSET - ship.heading);
    return;
  }

  // MID: lead-only agent.
  if (band == LOD_BAND_MID) {
    if (localIndex != 0u) {
      // Hide non-lead draw. Do **not** touch trailLines (dense pack owned by
      // expandTrailLines only — simIdx zero would race model dense slots).
      if (u.expandTrails != 0u) {
        zeroDrawSize(simIdx);
      }
      ship.speed = 0.0;
      shipSims[simIdx] = ship;
      return;
    }
    let oldX = ship.posX;
    let oldZ = ship.posZ;
    if (simPaused) {
      ship.speed = 0.0;
    } else {
      ship = integrateShipAgent(
        ship, f.pathEndX, f.pathEndZ, pathEndY,
        0.0, 0.0, 0.0, u.dtMs, domainWarpActive, space3d,
        f.pathStartX, f.pathStartZ, f.durationMs,
      );
    }
    if (noTrail) {
      shipSims[simIdx] = ship;
      return;
    }
    let trailOkMid = trailAllowedForShip(simIdx);
    if (u.appendTrails != 0u && trailOkMid) {
      // Append at **agent** pose (not fleet ease icon) — avoids ghost trails
      // where the impostor crawls while ships race to pathEnd.
      let iconX = ship.posX;
      let iconZ = ship.posZ;
      let maskM = TRAIL_RING_SIZE - 1u;
      let newestM = (ship.trailWrite - 1u) & maskM;
      let prevX = trails[ringBase + newestM * TRAIL_SAMPLE_FLOATS];
      let prevZ = trails[ringBase + newestM * TRAIL_SAMPLE_FLOATS + 1u];
      let ddxI = iconX - prevX;
      let ddzI = iconZ - prevZ;
      let distIcon = sqrt(ddxI * ddxI + ddzI * ddzI);
      let saveX = ship.posX;
      let saveZ = ship.posZ;
      ship.posX = iconX;
      ship.posZ = iconZ;
      ship = tryAppendTrail(ship, ringBase, distIcon, distIcon > 0.05);
      ship.posX = saveX;
      ship.posZ = saveZ;
    }
    shipSims[simIdx] = ship;
    // expandTrails 0=off, 1=all, 2=model-only pot (trailOkMid gates mode 2).
    if (u.expandTrails != 0u && trailOkMid) {
      expandShipTrails(
        simIdx, ringBase, ship.trailWrite,
        instances[o + 8u], instances[o + 9u], instances[o + 10u], baseY,
        ship,
      );
    }
    return;
  }

  // NEAR: multi-ship agent + draw + trails.
  let oldX = ship.posX;
  let oldZ = ship.posZ;
  if (simPaused) {
    ship.speed = 0.0;
  } else {
    ship = integrateShipAgent(
      ship, f.pathEndX, f.pathEndZ, pathEndY,
      0.0, 0.0, 0.0, u.dtMs, domainWarpActive, space3d,
      f.pathStartX, f.pathStartZ, f.durationMs,
    );
  }

  if (u.expandTrails != 0u) {
    instances[o] = ship.posX;
    // Draw base.y from sim posY (planar = 0; mesh remains XZ billboard).
    instances[o + 1u] = ship.posY + baseY;
    instances[o + 2u] = ship.posZ;
    instances[o + 6u] = wrapPi(SHIP_NOSE_OFFSET - ship.heading);
    let warm = (f.flags & FLEET_FLAG_WARM) != 0u;
    if (warm) {
      instances[o + 7u] = 0.0;
    } else {
      let pad = instances[o + 11u];
      let sz = instances[o + 7u];
      if (pad > 0.5 || sz <= 0.0) {
        instances[o + 7u] = sizeFromDrawColor(
          instances[o + 8u], instances[o + 9u], instances[o + 10u],
        );
        instances[o + 11u] = 0.0;
      }
    }
  }

  if (noTrail) {
    shipSims[simIdx] = ship;
    return;
  }
  let trailOkNear = trailAllowedForShip(simIdx);
  if (u.appendTrails != 0u && trailOkNear) {
    let ddx = ship.posX - oldX;
    let ddz = ship.posZ - oldZ;
    let distMoved = sqrt(ddx * ddx + ddz * ddz);
    let trailActive =
      ship.speed > TRAIL_APPEND_SPEED_EPS || distMoved > 0.05;
    ship = tryAppendTrail(ship, ringBase, distMoved, trailActive);
  }
  shipSims[simIdx] = ship;
  // NEAR: expand into dense trailLines slots (atomic drawSlot). Mode 2 = model pot.
  if (u.expandTrails != 0u && trailOkNear) {
    expandShipTrails(
      simIdx, ringBase, ship.trailWrite,
      instances[o + 8u], instances[o + 9u], instances[o + 10u], baseY,
      ship,
    );
  }
}

/**
 * After cs_ships: pack DrawIndexedIndirectArgs for trail ribbons.
 * indexCount = TRAIL_TEMPLATE_INDEX_COUNT (body quad: 2 tris), instanceCount = dense * TRAIL_SEGS.
 */
@compute @workgroup_size(1)
fn cs_trail_indirect(@builtin(global_invocation_id) gid3: vec3<u32>) {
  if (gid3.x != 0u) { return; }
  let n = atomicLoad(&trailDrawMeta[0]);
  let segs = TRAIL_SEGS;
  // GPUBuffer DrawIndexedIndirect:
  //   indexCount, instanceCount, firstIndex, baseVertex, firstInstance
  trailIndirect[0] = ${TRAIL_TEMPLATE_INDEX_COUNT}u; // body-only 2-tri quad
  trailIndirect[1] = n * segs;
  trailIndirect[2] = 0u;
  trailIndirect[3] = 0u; // baseVertex as u32 bitcast of i32 0
  trailIndirect[4] = 0u;
}

`;
}
/**
 * Slim scale-bench WGSL: CIRCULATE ring + sample append only (no SEEK/hop/LOD).
 * Same bind layout as full integrate (bindings 0–5). Host uses this only for
 * forceLodNear && expandTrails=0. Map never loads this module.
 */
export function buildFleetIntegrateFastWgsl(trail = DEFAULT_TRAIL_LAYOUT) {
    const layout = trail ?? resolveTrailLayout();
    return /* wgsl */ `
const FLEET_FLAG_ALIVE: u32 = 1u;
const FLEET_FLAG_JUMPING: u32 = 2u;
const FLEET_FLAG_SIM_PAUSED: u32 = 16u;
const SHIP_MODE_PAUSED: u32 = ${SHIP_MODE_PAUSED}u;
const SHIP_MODE_ORBIT: u32 = ${SHIP_MODE_ORBIT}u;
const TRAIL_APPEND_SPEED_EPS: f32 = ${TRAIL_APPEND_SPEED_EPS};
const PI: f32 = 3.141592653589793;
const CRUISE_ACCEL_SCALE: f32 = ${CRUISE_ACCEL_SCALE};
const CRUISE_BRAKE_MULT: f32 = ${CRUISE_BRAKE_MULT};
const ORBIT_R_MIN: f32 = ${ORBIT_R_MIN};
const ORBIT_SPRING_K: f32 = ${ORBIT_SPRING_K};
const ORBIT_DEFAULT_OMEGA_MAX: f32 = ${ORBIT_DEFAULT_OMEGA_MAX};
const ORBIT_NEAR_SPEED_SCALE: f32 = ${ORBIT_NEAR_SPEED_SCALE};
const ORBIT_OMEGA_TURN_FRAC: f32 = ${ORBIT_OMEGA_TURN_FRAC};
const ORBIT_R_EPS: f32 = ${ORBIT_R_EPS};
const ORBIT_V_RAD_MAX_FRAC: f32 = ${ORBIT_V_RAD_MAX_FRAC};
const ORBIT_V_RAD_MAX_R_MUL: f32 = ${ORBIT_V_RAD_MAX_R_MUL};
const TRAIL_RING_SIZE: u32 = ${layout.ringSize}u;
const TRAIL_SAMPLE_FLOATS: u32 = ${TRAIL_SAMPLE_FLOATS}u;
const TRAIL_LIFETIME_MS: f32 = ${layout.lifetimeMs}.0;
const TRAIL_MIN_DIST: f32 = ${layout.minDist};
const TRAIL_MAX_INTERVAL_MS: f32 = ${layout.maxIntervalMs}.0;

struct IntegrateUniforms {
  nowRel: f32,
  fleetCount: u32,
  dtMs: f32,
  shipCount: u32,
  cameraY: f32,
  targetX: f32,
  targetZ: f32,
  viewportH: f32,
  tanHalfFov: f32,
  lodNearY: f32,
  lodFarY: f32,
  lodMidDist: f32,
  expandTrails: u32,
  appendTrails: u32,
  lodNearDist: f32,
  viewCullScale: f32,
  origin: vec3<f32>,
  _originPad: f32,
};

struct FleetGpu {
  posX: f32, posZ: f32, heading: f32, _pad0: f32,
  pathStartX: f32, pathStartZ: f32, pathEndX: f32, pathEndZ: f32,
  t0: f32, durationMs: f32, flags: u32, shipBudget: u32,
  countsPacked: u32, instanceStart: u32, fleetIdHash: u32, _pad1: u32,
};

struct ShipSim {
  posX: f32, posY: f32, posZ: f32, speed: f32,
  qx: f32, qy: f32, qz: f32, qw: f32,
  slotX: f32, slotY: f32, slotZ: f32, heading: f32,
  trailWrite: u32, sinceSample: f32, mode: u32, fleetIndex: u32,
  targetKind: u32, orbitPhase: f32, accel: f32, cruiseV: f32,
  orbitR: f32, orbitOmega: f32, omegaMax: f32, _pad1: f32,
};

@group(0) @binding(0) var<uniform> u: IntegrateUniforms;
@group(0) @binding(1) var<storage, read_write> fleets: array<FleetGpu>;
@group(0) @binding(2) var<storage, read_write> instances: array<f32>;
@group(0) @binding(3) var<storage, read_write> shipSims: array<ShipSim>;
@group(0) @binding(4) var<storage, read_write> trails: array<f32>;
@group(0) @binding(5) var<storage, read_write> trailLines: array<f32>;

fn wrapPi(a: f32) -> f32 {
  var x = a;
  if (x > PI) { x = x - 2.0 * PI; }
  else if (x < -PI) { x = x + 2.0 * PI; }
  return x;
}

/**
 * On-ring CIRCULATE (scale packs start on ring with valid orbitPhase).
 * phase += ω·dt, pos = C + R·(sin,cos), heading = phase ± π/2, speed = |ω|R.
 * No atan2 / spring — pack ships stay on-ring.
 */
fn integrateOrbitRingOn(
  shipIn: ShipSim,
  centerX: f32,
  centerZ: f32,
  dtSec: f32,
) -> ShipSim {
  var ship = shipIn;
  let R = select(ORBIT_R_MIN, ship.orbitR, ship.orbitR > 1e-6);
  let omega = ship.orbitOmega;
  let side = select(-1.0, 1.0, omega >= 0.0);
  let phase = wrapPi(ship.orbitPhase + omega * dtSec);
  let sp = sin(phase);
  let cp = cos(phase);
  ship.posX = centerX + R * sp;
  ship.posY = 0.0;
  ship.posZ = centerZ + R * cp;
  ship.orbitPhase = phase;
  ship.heading = wrapPi(phase + side * (PI * 0.5));
  // Yaw-only quat from heading (fast path; no full look-at).
  let half = ship.heading * 0.5;
  ship.qx = 0.0;
  ship.qy = sin(half);
  ship.qz = 0.0;
  ship.qw = cos(half);
  ship.speed = abs(omega) * R * ORBIT_NEAR_SPEED_SCALE;
  ship.mode = SHIP_MODE_ORBIT;
  return ship;
}

@compute @workgroup_size(256)
fn cs_ships_fast(@builtin(global_invocation_id) gid3: vec3<u32>) {
  let simIdx = gid3.x;
  if (simIdx >= u.shipCount) { return; }

  // Keep bindings 2/5 alive for layout parity with full integrate.
  if (u.expandTrails == 0xFFFFFFFFu) {
    instances[simIdx] = instances[simIdx];
    trailLines[simIdx] = trailLines[simIdx];
  }

  var ship = shipSims[simIdx];
  if (ship.mode == SHIP_MODE_PAUSED) {
    ship.speed = 0.0;
    shipSims[simIdx] = ship;
    return;
  }
  let fi = ship.fleetIndex;
  if (fi >= u.fleetCount) { return; }
  let f = fleets[fi];
  if ((f.flags & FLEET_FLAG_ALIVE) == 0u) {
    ship.speed = 0.0;
    shipSims[simIdx] = ship;
    return;
  }
  if ((f.flags & FLEET_FLAG_SIM_PAUSED) != 0u) {
    ship.speed = 0.0;
    shipSims[simIdx] = ship;
    return;
  }

  let oldX = ship.posX;
  let oldZ = ship.posZ;
  var dt = u.dtMs;
  if (dt > 50.0) { dt = 50.0; }
  if (dt < 0.0) { dt = 0.0; }
  ship = integrateOrbitRingOn(ship, f.pathEndX, f.pathEndZ, dt * 0.001);

  // Distance-gated trail append; skip ring loads until acc ≥ minDist.
  if (u.appendTrails != 0u) {
    let ddx = ship.posX - oldX;
    let ddz = ship.posZ - oldZ;
    let distSq = ddx * ddx + ddz * ddz;
    let distMoved = sqrt(distSq);
    let acc = ship.sinceSample + distMoved;
    if (acc >= TRAIL_MIN_DIST && distSq > 0.0025) {
      let ringBase = simIdx * TRAIL_RING_SIZE * TRAIL_SAMPLE_FLOATS;
      let mask = TRAIL_RING_SIZE - 1u;
      let w = ship.trailWrite & mask;
      let baseT = ringBase + w * TRAIL_SAMPLE_FLOATS;
      trails[baseT] = ship.posX;
      trails[baseT + 1u] = ship.posZ;
      trails[baseT + 2u] = u.nowRel;
      trails[baseT + 3u] = ship.posY;
      ship.trailWrite = (w + 1u) & mask;
      ship.sinceSample = 0.0;
    } else {
      ship.sinceSample = acc;
    }
  }
  shipSims[simIdx] = ship;
}
`;
}
/** Game-default integrate shader (short trails). Tests build their own. */
export const FLEET_INTEGRATE_WGSL = buildFleetIntegrateWgsl();
//# sourceMappingURL=fleet-integrate.wgsl.js.map