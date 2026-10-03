// @ts-nocheck
import { SHIP_WGSL } from '../../../lib/ship-runtime/ship-layout.mjs';
/** GPU present copy: directed split-position poses → map draw instances (48 B) + ShipSim. */
import { DEFAULT_TRAIL_LAYOUT } from "../../../lib/fleet-sim/visual/fleet-trail-ref.js";
import { BASE_SHIP_SIZE, TRIANGLE_SCREEN_PX } from "../../../lib/fleet-sim/visual/fleet-lod.js";
import { SCENE_AGENT_SCALE, SCENE_SHIP_VISUAL_MUL } from "../../../lib/fleet-sim/visual/ship-motion-config.js";
import { CLASS_BY_TYPE } from "../../../lib/ship-runtime/classes.mjs";
import { MAX_SCENE_FLEETS } from "./directed-map.mjs";
import { PRODUCTION_TRAIL_RING, TRAIL_BREAK_COMPACT, } from "./directed-map.mjs";
export { DIRECTED_PRESENT_WORKGROUP, MAX_SCENE_FLEETS, MAX_GROUP_VISUAL, SCENE_KERNEL_COUNT, SCENE_VISUAL_CAP, WARP_ENTER_SEC, WARP_PLANET_ARRIVAL_SECONDS, WARP_FAR_SPAN_MUL, WARP_OUT_SEC, sceneOutboundDurationMs, STAGE_LEAD_MS, SCENE_RIM_SPAN_MUL, sceneMotionPlan, mixCompact, PRESENTATION_FREEZE, DIRECTED_SHIP_STRIDE, DIRECTED_SHIP_FLOATS, directedTickDecision, sceneFleetFingerprint, buildInstanceMap, seedDirectedShips, drainDirectedEncodeTick, labToCompact, compactToLab, compactOrbitPad, occupancyForScene, allocateSceneVisuals, occupancyVisuals, SCENE_HULL_ZOOM, sceneMembershipKey, sceneHullsOn, sceneDrawBand, fleetModelLodHigh, fleetModelLodBits, hullDrawRanges, FLEET_MODEL_LOD_LOW, FLEET_MODEL_LOD_HIGH, labOrbitExit, labApproach, labClassRing, labWarpOrigin, labWarpGate, warpEnterCommand, stageCommand, orbitCommand, pressurePlanetCommand, sceneFleetCentroid, densityFieldReach, densityFieldCovers, pickDensityFields, allocateKernelRanges, droppedInstanceIndices, holesFromRanges, lowestHole, pickCompactMove, rangesOverlap, SCENE_SHIP_CHUNK, SCENE_CHUNK_BUDGET_MS, SCENE_CLASS_TYPES, SCENE_LAB_SCALE, COMPACT_SYSTEM_SPAN, JEWEL_RADIUS, trailRadialBrightness, kernelSlotForId, resolveLocalShowAttack, presentKernelHistoryToTrailRing, KERNEL_TRAIL_RING, KERNEL_TRAIL_EMITTERS, KERNEL_TRAIL_CENTER, PRODUCTION_TRAIL_RING, TRAIL_COPY_SAMPLES, TRAIL_LAB_LIMIT, TRAIL_BREAK_COMPACT, trailViewIntensity, } from "./directed-map.mjs";
export const SCENE_HULL_SIZE = BASE_SHIP_SIZE * SCENE_AGENT_SCALE * SCENE_SHIP_VISUAL_MUL;
/** 3D mesh vs triangle: user-facing hulls were overlapping planets. */
export const SCENE_MODEL_SIZE_MUL = 0.1;
/** Map mesh origin-radius onto the triangle world size, then 1/10 for SCENE. */
export function sceneModelScale(meshRadius, hull = SCENE_HULL_SIZE) {
    const r = Number.isFinite(meshRadius) && meshRadius > 0 ? meshRadius : 1;
    return (hull * SCENE_MODEL_SIZE_MUL) / Math.max(r, 1e-6);
}
export const DIRECTED_PRESENT_WGSL = /* wgsl */ `
${SHIP_WGSL}
struct ShipHeader {
  posX: f32, posY: f32, posZ: f32, speed: f32,
  qx: f32, qy: f32, qz: f32, qw: f32,
  slotX: f32, slotY: f32, slotZ: f32, heading: f32,
  trailWrite: u32, sinceSample: f32, mode: u32, fleetIndex: u32,
  targetKind: u32, orbitPhase: f32, accel: f32, cruiseV: f32,
  orbitR: f32, orbitOmega: f32, omegaMax: f32, trailOwner: u32,
}
struct ShipSim {
  header: ShipHeader,
  knots: array<vec4<f32>, 8>,
  knotAnchors: array<vec4<f32>, 8>,
}
struct Uniforms { count: u32, presentationFlags: u32, nowMs: f32, poseScale: f32, selected: u32, alpha: f32, hovered: u32, projectionY: f32, viewProj: mat4x4<f32>, origin: vec3<f32>, viewportH: f32, highEnterPx: f32, highExitPx: f32, warpTime: f32, tickTime: f32 }
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> ships: array<Ship>;
@group(0) @binding(2) var<storage, read_write> instances: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> map: array<u32>;
@group(0) @binding(4) var<storage, read_write> shipSims: array<ShipSim>;
@group(0) @binding(6) var<storage, read> previousShips: array<Ship>;
struct FleetTints { rows: array<vec4<f32>, ${MAX_SCENE_FLEETS}> }
@group(0) @binding(9) var<uniform> fleetTints: FleetTints;
@group(0) @binding(8) var<storage, read> controls: array<vec4<u32>>;
@group(0) @binding(7) var<storage, read> kernelFleet: array<u32>;
struct ClassTuning { rows: array<vec4<f32>, 12> }
@group(0) @binding(5) var<uniform> classTuning: ClassTuning;
const LAYOUT_RING: u32 = ${PRODUCTION_TRAIL_RING}u;
fn sceneClassScale(typeId: u32) -> f32 {
  let kinds = array<u32, 32>(${CLASS_BY_TYPE.map((x) => `${x}u`).join(",")});
  return max(0.05, classTuning.rows[kinds[min(typeId, 31u)] * 2u + 1u].y);
}
fn forwardOf(q: vec4<f32>) -> vec3<f32> {
  let v = vec3<f32>(0.0, 0.0, 1.0);
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}
fn yawOf(q: vec4<f32>) -> f32 {
  let f = forwardOf(q);
  return atan2(f.x, f.z);
}
fn writeKnot(i:u32,idx: u32, anchor: vec3<f32>, local: vec3<f32>, birth: f32) {
  // Preserve small lab coordinates, never reconstruct the global f32 cache.
  shipSims[i].knots[idx] = vec4<f32>(local.x, local.z, birth, local.y);
  shipSims[i].knotAnchors[idx] = vec4<f32>(anchor, 0.0);
}
fn killTrailRing(i:u32) {
  for (var z = 0u; z < LAYOUT_RING; z++) { shipSims[i].knots[z].z = -1.0; }
}
fn resetCompactTrail(i:u32,sim: ptr<function, ShipHeader>, p: vec3<f32>) {
  killTrailRing(i);
  let anchor=vec3<f32>((*sim).orbitPhase,(*sim).orbitOmega,(*sim).omegaMax);
  let local=vec3<f32>((*sim).accel,(*sim).cruiseV,(*sim).orbitR);
  writeKnot(i, 0u, anchor, local, u.nowMs);
  writeKnot(i, 1u, anchor, local, u.nowMs);
  (*sim).trailWrite = 2u;
  (*sim).sinceSample = 0.0;
}
/** Frozen cadence samples plus a live head. Late frames interpolate at most one
 * ringful; differences stay in lab cells, never rounded global positions. */
fn appendCompactTrail(i:u32,p: vec3<f32>, warpSpeed: f32, sim: ptr<function, ShipHeader>) {
  let mask = LAYOUT_RING - 1u;
  let cadence = ${DEFAULT_TRAIL_LAYOUT.maxIntervalMs.toFixed(8)};
  var head = ((*sim).trailWrite - 1u) & mask;
  let last = shipSims[i].knots[head];
  let lastBirth = last.z;
  let lastP = vec3<f32>(last.x, last.w, last.y);
  let anchor=vec3<f32>((*sim).orbitPhase,(*sim).orbitOmega,(*sim).omegaMax);
  let local=vec3<f32>((*sim).accel,(*sim).cruiseV,(*sim).orbitR);
  let step=length((anchor-shipSims[i].knotAnchors[head].xyz)+(local-lastP))*u.poseScale;
  let elapsed = u.nowMs - lastBirth;
  // Warp has an exact velocity, including the last sample across its exit.
  // Keep local teleport rejection tight; do not give every ship the warp bound.
  let breakAt = max(${TRAIL_BREAK_COMPACT}, warpSpeed * max(0.0, elapsed) * 0.001 * 1.25);
  if (lastBirth < 0.0 || elapsed < 0.0 || elapsed >= 1400.0 || step > breakAt) {
    resetCompactTrail(i,sim, p);
    return;
  }
  let total=max((*sim).sinceSample,0.0)+elapsed;
  let count=u32(floor((total+0.001)/cadence));
  let skip=count-min(count,LAYOUT_RING-1u);
  let previousAnchor=shipSims[i].knotAnchors[head].xyz;
  let delta=(anchor-previousAnchor)+(local-lastP);
  head=(head+skip)&mask;
  for(var sample=skip;sample<count;sample++){
    let offset=min((f32(sample)+1.0)*cadence-(*sim).sinceSample,elapsed);
    let fraction=clamp(offset/max(elapsed,0.000001),0.0,1.0);
    let point=lastP+delta*fraction;
    let cell=floor(point);
    writeKnot(i,head,previousAnchor+cell,point-cell,lastBirth+offset);
    head=(head+1u)&mask;
  }
  writeKnot(i,head,anchor,local,u.nowMs);
  (*sim).trailWrite=(head+1u)&mask;
  (*sim).sinceSample=max(total-f32(count)*cadence,0.0);
}
fn inWarp(s: Ship) -> bool { return s.flight.w >= 2.0 && s.origin.w != -2.0 && s.flight.z > s.flight.y; }
fn mixAttitude(a: vec4<f32>, b: vec4<f32>, alpha: f32) -> vec4<f32> {
  return normalize(mix(a, select(b, -b, dot(a, b) < 0.0), alpha));
}
// Scene-only spare anchor .w values: smoothed effort and displayed lifetime.
// Keep duration rather than a timestamp so epoch rebasing needs no extra work.
fn turboTrail(s:Ship,sim:ShipHeader,i:u32,sameOwner:bool)->vec2<f32> {
  let normal=${((DEFAULT_TRAIL_LAYOUT.segsPerShip - 1) * DEFAULT_TRAIL_LAYOUT.maxIntervalMs).toFixed(8)};
  let head=(sim.trailWrite-1u)&(LAYOUT_RING-1u);
  let elapsed=clamp(u.nowMs-shipSims[i].knots[head].z,0.0,1000.0);
  let effort=select(0.0,clamp(s.a.w,0.0,1.0),s.tactic.x<0.0&&s.flight.w<0.0);
  let previous=select(0.0,shipSims[i].knotAnchors[0].w,sameOwner);
  let strength=mix(previous,effort,elapsed/(150.0+elapsed));
  let before=select(normal,shipSims[i].knotAnchors[1].w,sameOwner&&shipSims[i].knotAnchors[1].w>0.0);
  let wanted=normal*(1.0-.6*strength);
  // The tail can shrink, but never resurrect history when turbo fades away.
  let span=min(mix(before,wanted,elapsed/(150.0+elapsed)),before+elapsed);
  return vec2<f32>(strength,span);
}
/** Warp is already an authoritative affine segment. Display and chase evaluate it
 * at the same delayed instant, advancing from a nearby integrated tick. */
fn presentedShip(current: Ship, old: Ship) -> Ship {
  var s = initializeShipPosition(current);
  if (inWarp(s)) { s = warpShipPosition(s, clamp(u.warpTime, s.flight.y, s.flight.z)); return s; }
  if (s.identity.w != 0u && old.identity.w == s.identity.w && old.identity.z != 0u
      && inWarp(old) && old.flight.x == s.flight.x) {
    if (u.warpTime < old.flight.z) {
      let p = warpShipPosition(old, clamp(u.warpTime, old.flight.y, old.flight.z)); s.p = p.p; s.positionLow = p.positionLow; s.positionAnchor = p.positionAnchor; s.q = old.q;
    } else {
      let alpha = clamp((u.warpTime - old.flight.z) / max(1e-6, u.tickTime - old.flight.z), 0.0, 1.0);
      s = mixShipPosition(warpShipPosition(old, old.flight.z), s, alpha);
      s.q = mixAttitude(old.q, s.q, alpha);
    }
    return s;
  }
  if (s.identity.w != 0u && old.identity.w == s.identity.w && old.identity.z != 0u
      && distance(old.p.xyz, s.p.xyz) * u.poseScale < ${TRAIL_BREAK_COMPACT}) {
    s = mixShipPosition(old, s, u.alpha);
    s.q = mixAttitude(old.q, s.q, u.alpha);
  }
  return s;
}
@compute @workgroup_size(64)
fn presentDirected(@builtin(global_invocation_id) gid: vec3<u32>) {
  // Upper flag bits are a retained transit range start; bit zero remains camera correction.
  let i = gid.x + (u.presentationFlags >> 1u);
  if (i >= u.count) { return; }
  let inst = map[i];
  let previous = previousShips[i];
  let s = presentedShip(ships[i], previous);
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
      var dead = shipSims[i].header;
      if (dead.trailOwner != 0u || dead.mode != 0u) {
        killTrailRing(i);
        dead.trailOwner = 0u;
        dead.trailWrite = 0u;
        dead.sinceSample = 0.0;
        dead.mode = 0u;
        shipSims[i].header = dead;
      }
    }
    return;
  }
  let o = inst * 3u;
  let stored = fleetTints.rows[min(s.identity.y, ${MAX_SCENE_FLEETS - 1}u)].xyz;
  // Base tint is immutable across presentation frames, so selection can be removed.
  let tint = select(stored, vec3<f32>(0.45, 0.78, 1.0), dot(stored, stored) < 0.02);
  let picked = u.selected < ${MAX_SCENE_FLEETS}u && s.identity.y == u.selected;
  let hovered = u.hovered < ${MAX_SCENE_FLEETS}u && s.identity.y == u.hovered;
  let hoverTint = mix(tint, vec3<f32>(0.9, 0.97, 1.0), select(0.0, 0.35, hovered));
  let show = mix(hoverTint, vec3<f32>(0.0, 1.0, 1.0), select(0.0, 0.75, picked));
  let yaw = yawOf(s.q);
  let world = s.p.xyz * u.poseScale;
  let vscale = sceneClassScale((s.identity.x >> 8u) & 31u);
  // Directed draw tag 2: the unused center fields carry the full hull forward
  // vector. The vertex shader projects it using the current draw camera.
  let forward = forwardOf(s.q);
  instances[o] = vec4<f32>(world, forward.x);
  // Screen triangles stay a fixed pixel size. Class scale is hull-only.
  // The selected fleet's triangles grow so the group reads as chosen.
  instances[o + 1u] = vec4<f32>(forward.y, forward.z, yaw, ${TRIANGLE_SCREEN_PX}.0 * 1.2 * select(1.0, 2.0, picked));
  instances[o + 2u] = vec4<f32>(show, 2.0);
  if (i < arrayLength(&shipSims)) {
    var sim = shipSims[i].header;
    sim.posX = world.x;
    sim.posY = world.y;
    sim.posZ = world.z;
    // Scene-only position pair. posXYZ remains the sun-local observation cache.
    // These six scalar slots otherwise belong to legacy orbital integration.
    let anchor=s.positionAnchor.xyz;
    let local=s.positionLow.xyz;
    sim.orbitPhase=anchor.x;sim.orbitOmega=anchor.y;sim.omegaMax=anchor.z;
    sim.accel=local.x;sim.cruiseV=local.y;sim.orbitR=local.z;
    sim.speed = length(s.v.xyz) * u.poseScale;
    sim.qx = s.q.x;
    sim.qy = s.q.y;
    sim.qz = s.q.z;
    sim.qw = s.q.w;
    sim.heading = yaw;
    // High half of targetKind carries the draw scale in tenths (4 = 0.4, 200 = 20).
    let tag = u32(vscale * 10.0 + 0.5);
    let sameOwner = sim.trailOwner == owner;
    let turbo=turboTrail(s,sim,i,sameOwner);
    var high = (sim.targetKind & 1024u) != 0u && sameOwner;
    var tiny = (sim.targetKind & 8192u) != 0u && sameOwner;
    // Bit 0 defers automatic LOD until the same-frame GPU follow camera is
    // available. Keep hysteresis from the last drawn frame, not a stale camera.
    if ((u.presentationFlags & 1u) == 0u) {
      let clip = u.viewProj * vec4<f32>(world - u.origin, 1.0);
      let diameterPx = u.projectionY * ${SCENE_HULL_SIZE * SCENE_MODEL_SIZE_MUL} * vscale * u.viewportH / max(abs(clip.w), 1e-6);
      high = diameterPx >= select(u.highEnterPx, u.highExitPx, high);
      tiny = diameterPx < select(3.0, 3.5, tiny);
    }
    let control = controls[i];
    if (control.x == owner && control.y != 0u) { high = control.y == 2u; tiny = false; }
    let meshClasses = array<u32, 32>(${CLASS_BY_TYPE.map(kind => `${kind}u`).join(",")});
    let meshClass = meshClasses[(s.identity.x >> 8u) & 31u];
    sim.targetKind = meshClass | 4096u | select(select(512u, 1024u, high), 8192u, tiny) | select(0u, 256u, picked) | select(0u, 2048u, hovered) | (tag << 16u);

    // Scene ribbons read slot as RGB. Formation lives on the directed ship.
    let burn=mix(show,vec3<f32>(1.0,.78,.3),turbo.x*.85);
    sim.slotX = burn.x;
    sim.slotY = burn.y;
    sim.slotZ = burn.z;
    if (sim.mode == 0u) { sim.mode = 3u; }
    if (i < arrayLength(&kernelFleet) && kernelFleet[i] != 0xffffffffu) {
      sim.fleetIndex = kernelFleet[i];
    }
    if (sim.trailOwner != owner) {
      resetCompactTrail(i,&sim, world);
      sim.trailOwner = owner;
    } else {
      var warpSpeed = select(0.0, sim.speed, inWarp(s));
      if(turbo.x>.001){warpSpeed=max(warpSpeed,sim.speed);}
      if (previous.identity.w == s.identity.w && inWarp(previous)) {
        warpSpeed = max(warpSpeed, length(previous.v.xyz) * u.poseScale);
      }
      appendCompactTrail(i,world, warpSpeed, &sim);
    }
    // Knot append owns xyz and clears w; restore metadata only after it finishes.
    shipSims[i].knotAnchors[0].w=turbo.x;
    shipSims[i].knotAnchors[1].w=turbo.y;
    shipSims[i].header = sim;
  }
}
`;
//# sourceMappingURL=directed-present.wgsl.js.map