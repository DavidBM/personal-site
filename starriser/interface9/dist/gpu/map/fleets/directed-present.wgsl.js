// @ts-nocheck
/** GPU present copy: directed 192-byte poses → map draw instances (48 B) + ShipSim. */
import { BASE_SHIP_SIZE, TRIANGLE_SCREEN_PX } from "../../../lib/fleet-sim/visual/fleet-lod.js";
import { SCENE_AGENT_SCALE, SCENE_SHIP_VISUAL_MUL } from "../../../lib/fleet-sim/visual/ship-motion-config.js";
import { PRODUCTION_TRAIL_RING, TRAIL_BREAK_COMPACT, } from "./directed-map.mjs";
export { DIRECTED_PRESENT_WORKGROUP, MAX_SCENE_FLEETS, MAX_GROUP_VISUAL, SCENE_KERNEL_COUNT, SCENE_VISUAL_CAP, WARP_ENTER_SEC, WARP_FAR_SPAN_MUL, WARP_OUT_SEC, STAGE_LEAD_MS, SCENE_RIM_SPAN_MUL, sceneMotionPlan, mixCompact, PRESENTATION_FREEZE, DIRECTED_SHIP_STRIDE, DIRECTED_SHIP_FLOATS, directedTickDecision, sceneFleetFingerprint, buildInstanceMap, seedDirectedShips, drainDirectedEncodeTick, labToCompact, compactToLab, compactOrbitPad, occupancyForScene, allocateSceneVisuals, occupancyVisuals, SCENE_HULL_ZOOM, sceneMembershipKey, sceneHullsOn, sceneDrawBand, fleetModelLodHigh, fleetModelLodBits, hullDrawRanges, FLEET_MODEL_LOD_LOW, FLEET_MODEL_LOD_HIGH, labOrbitExit, labApproach, labClassRing, labWarpOrigin, labWarpGate, warpEnterCommand, stageCommand, orbitCommand, pressurePlanetCommand, sceneFleetCentroid, densityFieldReach, densityFieldCovers, pickDensityFields, allocateKernelRanges, holesFromRanges, lowestHole, pickCompactMove, rangesOverlap, SCENE_SHIP_CHUNK, SCENE_CHUNK_BUDGET_MS, SCENE_CLASS_TYPES, SCENE_LAB_SCALE, COMPACT_SYSTEM_SPAN, kernelSlotForId, resolveLocalShowAttack, presentKernelHistoryToTrailRing, KERNEL_TRAIL_RING, KERNEL_TRAIL_EMITTERS, KERNEL_TRAIL_CENTER, PRODUCTION_TRAIL_RING, TRAIL_COPY_SAMPLES, TRAIL_LAB_LIMIT, TRAIL_BREAK_COMPACT, trailViewIntensity, } from "./directed-map.mjs";
export const SCENE_HULL_SIZE = BASE_SHIP_SIZE * SCENE_AGENT_SCALE * SCENE_SHIP_VISUAL_MUL;
/** 3D mesh vs triangle: user-facing hulls were overlapping planets. */
export const SCENE_MODEL_SIZE_MUL = 0.1;
/** Map mesh origin-radius onto the triangle world size, then 1/10 for SCENE. */
export function sceneModelScale(meshRadius, hull = SCENE_HULL_SIZE) {
    const r = Number.isFinite(meshRadius) && meshRadius > 0 ? meshRadius : 1;
    return (hull * SCENE_MODEL_SIZE_MUL) / Math.max(r, 1e-6);
}
export const DIRECTED_PRESENT_WGSL = /* wgsl */ `
struct Ship { p: vec4<f32>, v: vec4<f32>, a: vec4<f32>, q: vec4<f32>, aux: vec4<f32>, identity: vec4<u32>, memory: vec4<f32>, flight: vec4<f32>, origin: vec4<f32>, tactic: vec4<f32>, fx: vec4<f32>, aim: vec4<f32> }
struct ShipSim {
  posX: f32, posY: f32, posZ: f32, speed: f32,
  qx: f32, qy: f32, qz: f32, qw: f32,
  slotX: f32, slotY: f32, slotZ: f32, heading: f32,
  trailWrite: u32, sinceSample: f32, mode: u32, fleetIndex: u32,
  targetKind: u32, orbitPhase: f32, accel: f32, cruiseV: f32,
  orbitR: f32, orbitOmega: f32, omegaMax: f32, trailOwner: u32,
  knots: array<vec4<f32>, 8>,
}
struct Uniforms { count: u32, prodRing: u32, nowMs: f32, poseScale: f32 }
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> ships: array<Ship>;
@group(0) @binding(2) var<storage, read_write> instances: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> map: array<u32>;
@group(0) @binding(4) var<storage, read_write> shipSims: array<ShipSim>;
@group(0) @binding(7) var<storage, read> kernelFleet: array<u32>;
const LAYOUT_RING: u32 = ${PRODUCTION_TRAIL_RING}u;
fn yawOf(q: vec4<f32>) -> f32 {
  let v = vec3<f32>(0.0, 0.0, 1.0);
  let f = v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
  return atan2(f.x, f.z);
}
fn writeKnot(sim: ptr<function, ShipSim>, idx: u32, p: vec3<f32>, birth: f32) {
  (*sim).knots[idx] = vec4<f32>(p.x, p.z, birth, p.y);
}
fn killTrailRing(sim: ptr<function, ShipSim>) {
  for (var z = 0u; z < LAYOUT_RING; z++) { (*sim).knots[z].z = -1.0; }
}
fn resetCompactTrail(sim: ptr<function, ShipSim>, p: vec3<f32>) {
  killTrailRing(sim);
  writeKnot(sim, 0u, p, u.nowMs);
  (*sim).trailWrite = 1u;
  (*sim).sinceSample = 0.0;
}
/** One new knot per frame. A jump starts a new ribbon; no catch-up interpolation. */
fn appendCompactTrail(p: vec3<f32>, sim: ptr<function, ShipSim>) {
  let mask = LAYOUT_RING - 1u;
  let breakAt = ${TRAIL_BREAK_COMPACT};
  let cadence = 1000.0 / 60.0;
  let head = ((*sim).trailWrite - 1u) & mask;
  let last = (*sim).knots[head];
  let lastBirth = last.z;
  let lastP = vec3<f32>(last.x, last.w, last.y);
  let step = length(p - lastP);
  let elapsed = u.nowMs - lastBirth;
  if (lastBirth < 0.0 || elapsed < 0.0 || elapsed >= 1400.0 || step > breakAt) {
    resetCompactTrail(sim, p);
    return;
  }
  if (elapsed >= cadence && step > 1e-7) {
    let nxt = (head + 1u) & mask;
    writeKnot(sim, nxt, p, u.nowMs);
    (*sim).trailWrite = (nxt + 1u) & mask;
    (*sim).sinceSample = 0.0;
    return;
  }
  writeKnot(sim, head, p, lastBirth);
}
@compute @workgroup_size(64)
fn presentDirected(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.count) { return; }
  let inst = map[i];
  let s = ships[i];
  var owner = s.identity.w;
  if (owner == 0u) { owner = s.identity.x; }
  if (owner == 0u) { owner = i + 1u; }
  if (inst == 0xffffffffu || s.identity.z == 0u) {
    if (inst != 0xffffffffu && inst * 3u + 2u < arrayLength(&instances)) {
      let oDead = inst * 3u;
      let colorDead = instances[oDead + 2u];
      instances[oDead + 1u] = vec4<f32>(0.0, 0.0, 0.0, 0.0);
      instances[oDead + 2u] = vec4<f32>(colorDead.xyz, 1.0);
    }
    if (i < arrayLength(&shipSims)) {
      var dead = shipSims[i];
      if (dead.trailOwner != 0u || dead.mode != 0u) {
        killTrailRing(&dead);
        dead.trailOwner = 0u;
        dead.trailWrite = 0u;
        dead.sinceSample = 0.0;
        dead.mode = 0u;
        shipSims[i] = dead;
      }
    }
    return;
  }
  let o = inst * 3u;
  let color = instances[o + 2u];
  let yaw = yawOf(s.q);
  let world = s.p.xyz * u.poseScale;
  instances[o] = vec4<f32>(world, 0.0);
  instances[o + 1u] = vec4<f32>(0.0, 0.0, yaw, ${TRIANGLE_SCREEN_PX}.0);
  instances[o + 2u] = vec4<f32>(color.xyz, 1.0);
  if (i < arrayLength(&shipSims)) {
    var sim = shipSims[i];
    sim.posX = world.x;
    sim.posY = world.y;
    sim.posZ = world.z;
    sim.speed = length(s.v.xyz) * u.poseScale;
    sim.qx = s.q.x;
    sim.qy = s.q.y;
    sim.qz = s.q.z;
    sim.qw = s.q.w;
    sim.heading = yaw;
    sim.slotX = color.x;
    sim.slotY = color.y;
    sim.slotZ = color.z;
    if (sim.mode == 0u) { sim.mode = 3u; }
    if (i < arrayLength(&kernelFleet) && kernelFleet[i] != 0xffffffffu) {
      sim.fleetIndex = kernelFleet[i];
    }
    if (sim.trailOwner != owner) {
      resetCompactTrail(&sim, world);
      sim.trailOwner = owner;
    } else {
      appendCompactTrail(world, &sim);
    }
    shipSims[i] = sim;
  }
}
`;
//# sourceMappingURL=directed-present.wgsl.js.map