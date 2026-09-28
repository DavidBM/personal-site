import {SHIP_BYTES} from './ship-layout.mjs';
// JavaScript describes membership; GPU state owns references and anchor poses.
import { CLASS_BY_TYPE, ORBIT_SPEED_FRACTION } from "./classes.mjs";
import { fleetComposition, visualParts } from "./fleet-mix.mjs";
import { SCENE_ROUTE_DECL } from "./scene-route.mjs";
import { CONTACT_PADDING, OBSTACLE_PADDING, OBSTACLE_SOFT_REACH } from "./force-clearance.mjs";
import {PILOT_ADVICE_DECL,PILOT_ADVICE_FIELD} from './pilot-advice-layout.mjs';

export const FORM_FLEETS = 128;
export const FORM_ANCHORS = 8;
/** Orbit when the anchor bubble is at least this many times the escort bubble. */
export const FORM_ORBIT_RATIO = 2;
/** Registered anchors pull back together past this many of their own radii. */
export const FORM_LEASH_RADII = 4;
/** Head, two ordinal vec4s and the admission-cloud origin/radius. */
export const FORM_RECORD_WORDS = 16;
/** Two pages, eight anchors, position vec4 and velocity vec4. */
export const FORM_POSE_VEC4S_PER_FLEET = 2 * FORM_ANCHORS * 2;
/** Persistent GPU navigation reference, physical state and fleet capabilities. */
export const FLEET_GUIDE_BYTES = SHIP_BYTES+32;

export function formationRecordBytes(fleetCount) {
  return (fleetCount | 0) * FORM_RECORD_WORDS * 4;
}
export function formationPoseBytes(fleetCount) {
  return (fleetCount | 0) * FORM_POSE_VEC4S_PER_FLEET * 16;
}
export function formationTailBytes(fleetCount) {
  return formationRecordBytes(fleetCount) + formationPoseBytes(fleetCount) + fleetCount * (FLEET_GUIDE_BYTES + 64);
}
/** Byte offset of the record. It sits after the event frame, on a 16-byte boundary. */
export function formationByteOffset(controlBytes, eventBytes) {
  return (controlBytes | 0) + (eventBytes | 0);
}

export function formationMode(anchorRadius, escortRadius) {
  const anchor = Number(anchorRadius);
  const escort = Number(escortRadius);
  if (!(anchor > 0) || !(escort > 0)) return "follow";
  return anchor >= escort * FORM_ORBIT_RATIO ? "orbit" : "follow";
}

function formationRuns(total, explicitType, id) {
  if (explicitType != null) return { kinds: [CLASS_BY_TYPE[explicitType & 31] ?? 0], parts: [total] };
  const mix = fleetComposition(id);
  return { kinds: mix.classes.map(entry => entry.kind), parts: visualParts(mix, total) };
}

function retainAdmittedParts(parts, admittedCount) {
  let remaining = Math.max(0, admittedCount | 0);
  for (let i = 0; i < parts.length; i++) {
    const admitted = Math.min(parts[i], remaining);
    parts[i] = admitted; remaining -= admitted;
  }
}

function classRunOrdinals(kinds, parts, anchorClass) {
  const ordinals = [];
  let index = 0;
  for (let typeIndex = 0; typeIndex < kinds.length; typeIndex++) {
    if (kinds[typeIndex] === anchorClass) {
      const count = Math.min(parts[typeIndex], FORM_ANCHORS - ordinals.length);
      for (let part = 0; part < count; part++) ordinals.push(index + part);
    }
    index += parts[typeIndex];
  }
  return ordinals;
}

/**
 * Anchor ordinals for one fleet. `explicitType` is a single-class fleet.
 * Ordinals match `writeFleetSeed`'s fleet-local index.
 */
export function formationAnchors(shipCount, explicitType = null, id = 0, admittedCount = shipCount) {
  const empty = { anchorClass: 0, ordinals: [] };
  const total = Math.max(0, shipCount | 0);
  if (total <= 1) return empty;
  const { kinds, parts } = formationRuns(total, explicitType, id);
  retainAdmittedParts(parts, admittedCount);
  let anchorClass = -1;
  for (let i = 0; i < kinds.length; i++) {
    if (parts[i] > 0) anchorClass = Math.max(anchorClass, kinds[i]);
  }
  if (anchorClass < 0) return empty;
  const ordinals = classRunOrdinals(kinds, parts, anchorClass);
  return { anchorClass, ordinals };
}

function writeFleetFormation(words, fleet, slot, warpRanges) {
  const record = formationAnchors(fleet.seedShipCount ?? fleet.shipCount | 0, fleet.type ?? null, fleet.id ?? fleet.slot ?? 0, fleet.shipCount);
  const at = slot * FORM_RECORD_WORDS;
  words[at] = record.anchorClass >>> 0;
  words[at + 1] = record.ordinals.length >>> 0;
  const range = warpRanges?.get(slot);
  if (range) { words[at + 2] = range.start; words[at + 3] = Math.min(range.cap, fleet.shipCount); }
  for (let i = 0; i < record.ordinals.length; i++) words[at + 4 + i] = record.ordinals[i] >>> 0;
  if (fleet.formationOrigin && fleet.formationRadius > 0) {
    new Float32Array(words.buffer).set([...fleet.formationOrigin, fleet.formationRadius], at + 12);
  }
}

/** One table for every fleet slot. Missing slots stay at count 0. */
export function packFleetFormation(fleets, fleetCount = FORM_FLEETS, warpRanges = null) {
  const words = new Uint32Array(fleetCount * FORM_RECORD_WORDS);
  for (const fleet of fleets ?? []) {
    const slot = (fleet.slot ?? 0) | 0;
    if (slot >= 0 && slot < fleetCount) writeFleetFormation(words, fleet, slot, warpRanges);
  }
  return words;
}

export function formationStruct(fleetCount, pilot = false) {
  const n = fleetCount | 0;
  const poses = n * FORM_POSE_VEC4S_PER_FLEET;
  return {
    decl: `${pilot ? PILOT_ADVICE_DECL : ""}\n${SCENE_ROUTE_DECL}\nstruct FleetForm { head: vec4<u32>, ordinals0: vec4<u32>, ordinals1: vec4<u32>, origin:vec4<f32> }\nstruct FleetTravel { center:vec4<f32>, direction:vec4<f32>, progress:vec4<f32>, state:vec4<f32> }\nstruct FleetGuide { ship:Ship, limits:vec4<f32>, status:vec4<f32> }`,
    fields: `,forms:array<FleetForm,${n}>,formPoses:array<vec4<u32>,${poses}>,fleetGuides:array<FleetGuide,${n}>,fleetTravel:array<FleetTravel,${n}>,sceneRoutes:array<SceneRoute,${n}>${pilot ? PILOT_ADVICE_FIELD : ""},warpOffsets:array<vec4<f32>>`,
  };
}

export function formationWgsl(fleetCount, coordinated = false, fleetPilot = false) {
  const fleets = fleetCount | 0;
  return /* wgsl */ `
const FORM_FLEETS: u32 = ${fleets}u;
const FORM_ANCHORS: u32 = ${FORM_ANCHORS}u;
struct FormPose { p: vec4<f32>, v: vec4<f32> }
fn formOrdinal(form: FleetForm, k: u32) -> u32 {
  let v = select(form.ordinals0, form.ordinals1, k >= 4u);
  let i = k % 4u;
  if (i == 0u) { return v.x; }
  if (i == 1u) { return v.y; }
  if (i == 2u) { return v.z; }
  return v.w;
}
// The host reserves a range per fleet. Logical ordinals survive packing moves.
fn ordinalWarpOffset(fleet: u32, ordinal: u32) -> vec3<f32> {
  if (fleet >= FORM_FLEETS) { return vec3<f32>(0.0); }
  let head = director.forms[fleet].head;
  let index = head.z + ordinal;
  if (ordinal >= head.w || index >= arrayLength(&director.warpOffsets)) { return vec3<f32>(0.0); }
  if(index>=arrayLength(&director.warpOffsets)/2u){return vec3<f32>(0.0);}
  return director.warpOffsets[index].xyz;
}
fn warpOffset(s: Ship) -> vec3<f32> {
  return ordinalWarpOffset(s.identity.y, sceneOrdinal(s.identity.x));
}
// World-oriented, soft goals. Subtract the anchor's admission offset so a
// translated cloud keeps the same shape. Cohort depth grows with volume rather
// than putting every escort on one standoff shell; the goal never reassigns.
fn escortOffset(s: Ship, form: FleetForm, pick: u32, standoff: f32) -> vec3<f32> {
  let ordinal = sceneOrdinal(s.identity.x);
  var relative = warpOffset(s) - ordinalWarpOffset(s.identity.y, formOrdinal(form, pick));
  if (dot(relative, relative) < 0.00000001) {
    // Legacy/lab records need no extra buffer. Serial identity survives packing.
    let seed = s.identity.w * 1664525u + 1013904223u;
    relative = vec3<f32>(f32(seed & 1023u), f32((seed >> 10u) & 1023u), f32((seed >> 20u) & 1023u)) / 511.5 - vec3<f32>(1.0);
  }
  let cohort = ordinal / max(form.head.y, 1u);
  let reach = standoff * (1.25 + pow(f32(cohort + 1u), 1.0 / 3.0));
  return unit(relative) * clamp(length(relative), standoff * 1.25, reach);
}
fn repelOfClass(kind: u32) -> f32 { return classTuning.rows[min(kind, 5u) * 2u + 1u].x; }
fn formationStandoff(s: Ship, anchorClass: u32, mineR: f32, anchorR: f32) -> f32 {
  let pair = mineR + anchorR;
  let adapt = sceneAdapt(journeyBodyRadius(s));
  if (adapt >= 0.99) { return pair; }
  // A preferred place must lie beyond the forces which would push it away.
  // Contacts add .15a; compact capital avoidance adds .3a hull padding and
  // another 1.5a soft reach. Keep these radii independent of the mesh scale.
  let padding = select(${CONTACT_PADDING}, ${OBSTACLE_PADDING + OBSTACLE_SOFT_REACH}, max(classIndex(shipType(s)), anchorClass) >= 4u) * adapt;
  let seed = s.identity.w * 1664525u + 1013904223u;
  let margin = 1.12 + 0.12 * f32(seed & 1023u) / 1023.0;
  return (pair + padding) * margin;
}
fn formPoseIndex(page: u32, fleet: u32, slot: u32) -> u32 {
  return ((page * FORM_FLEETS + fleet) * FORM_ANCHORS + slot) * 2u;
}
fn loadFormPose(page: u32, fleet: u32, slot: u32) -> FormPose {
  let at = formPoseIndex(page, fleet, slot);
  let p = director.formPoses[at];
  let v = director.formPoses[at + 1u];
  var pose: FormPose;
  pose.p = vec4<f32>(bitcast<f32>(p.x), bitcast<f32>(p.y), bitcast<f32>(p.z), bitcast<f32>(p.w));
  pose.v = vec4<f32>(bitcast<f32>(v.x), bitcast<f32>(v.y), bitcast<f32>(v.z), bitcast<f32>(v.w));
  return pose;
}
fn recordFormationPose(s: Ship) {
  if (s.identity.z == 0u) { return; }
  let fleet = s.identity.y;
  if (fleet >= FORM_FLEETS) { return; }
  let form = director.forms[fleet];
  if (form.head.y == 0u || classIndex(shipType(s)) != form.head.x) { return; }
  let ordinal = sceneOrdinal(s.identity.x);
  var slot: i32 = -1;
  for (var k = 0u; k < form.head.y; k++) {
    if (formOrdinal(form, k) == ordinal) { slot = i32(k); }
  }
  if (slot < 0) { return; }
  let at = formPoseIndex(u32(u.trail.z) & 1u, fleet, u32(slot));
  let p = s.p.xyz;
  let v = s.v.xyz;
  director.formPoses[at] = vec4<u32>(bitcast<u32>(p.x), bitcast<u32>(p.y), bitcast<u32>(p.z), bitcast<u32>(1.0));
  director.formPoses[at + 1u] = vec4<u32>(bitcast<u32>(v.x), bitcast<u32>(v.y), bitcast<u32>(v.z), 0u);
}
fn formationSteer(s: Ship, desired: vec3<f32>, limits: vec4<f32>) -> vec3<f32> {
  if (s.flight.w >= 2.0) { return desired; }
  // An order belongs to every member. Chasing a leader's current location
  // makes peers turn sideways and deprives equal-speed ships of a travel cue.
  if (s.flight.w == -3.0) { return desired; }
  let fleet = s.identity.y;
  if (fleet >= FORM_FLEETS) { return desired; }
  let form = director.forms[fleet];
  let n = form.head.y;
  if (n == 0u) { return desired; }
  let page = 1u - (u32(u.trail.z) & 1u);
  let ordinal = sceneOrdinal(s.identity.x);
  let mine = classIndex(shipType(s));
  var mean = vec3<f32>(0.0);
  var admissionMean = vec3<f32>(0.0);
  var live = 0u;
  var chosenPos = vec3<f32>(0.0);
  var chosenVel = vec3<f32>(0.0);
  var chosenOk = false;
  let pick = ordinal % n;
  for (var k = 0u; k < n; k++) {
    let pose = loadFormPose(page, fleet, k);
    if (pose.p.w < 0.5) { continue; }
    mean += pose.p.xyz;
    admissionMean += ordinalWarpOffset(fleet,formOrdinal(form,k));
    live++;
    if (k == pick) {
      chosenPos = pose.p.xyz;
      chosenVel = pose.v.xyz;
      chosenOk = true;
    }
  }
  if (live == 0u) { return desired; }
  mean /= f32(live);
  admissionMean /= f32(live);
  let mineR = max(repelOfClass(mine), 0.001);
  let anchorR = max(repelOfClass(form.head.x), 0.001);
  if (mine == form.head.x) {
    // Every peer in the heaviest class owns the same travel task. Selecting
    // eight pose representatives must not turn the other peers into followers
    // of possibly stopped representatives. Keep their irregular admission
    // offsets as a weak preference; never replace travel with centroid pursuit.
    let error = mean + warpOffset(s) - admissionMean - s.p.xyz;
    return capped(desired+capped(error*.1,limits.x*.15),limits.x);
  }
  if (!chosenOk) { return desired; }
  let minimumStandoff = formationStandoff(s, form.head.x, mineR, anchorR);
  // The live pilot preserves distributed escort shells from admission. A
  // single minimum-radius shell funnels hundreds of escorts through anchors.
  let standoff = ${fleetPilot ? 'max(minimumStandoff,min(length(escortOffset(s,form,pick,minimumStandoff)),form.origin.w))' : 'minimumStandoff'};
  let offset = chosenPos - s.p.xyz;
  let dist = length(offset);
  let inward = unit(offset);
  let travel = length(chosenVel);
  if (anchorR >= mineR * ${FORM_ORBIT_RATIO}.0) {
    var tangent = s.v.xyz - chosenVel - inward * dot(s.v.xyz - chosenVel, inward);
    if (length(tangent) < 0.05) {
      tangent = cross(inward, vec3<f32>(0.0, 1.0, 0.0));
      if (length(tangent) < 0.001) { tangent = cross(inward, vec3<f32>(1.0, 0.0, 0.0)); }
    }
    // Circle with the anchor. An escort's own cruise would outrun a slow brake.
    let requested = min(max(travel, 0.05) * 0.35, max(standoff * 2.0, 0.05));
    // Forward flight needs v/r angular speed and v²/r acceleration. Use the
    // authored hull rate, not the legacy compact-scene turn multiplier.
    let turnCap = max(0.0, dynamics(shipType(s)).w) * standoff * 0.65;
    let spin = min(min(requested, limits.x * ${ORBIT_SPEED_FRACTION}), min(turnCap, sqrt(0.65 * max(0.0, limits.y) * standoff)));
    let hold = max(travel, spin);
    // A stopped anchor must remain reachable by distant escorts. Orbit spin is
    // only a near-goal pace; use weak, braking-aware inward acquisition outside
    // that band. Locomotion still owns acceleration and the authored turn cap.
    let acquisition = min(max(0.0, limits.x) * 0.15,
      brakingSpeedAt(s,limits,max(0.0,dist-standoff),0.0));
    let radial = clamp(dist - standoff, -hold, max(hold, acquisition));
    return chosenVel + unit(tangent) * spin + inward * radial;
  }
  let error = chosenPos + escortOffset(s, form, pick, standoff) - s.p.xyz;
  // Feedforward keeps a satisfied escort alongside its anchor. A stopped anchor
  // has zero feedforward, so waiting/arrival cannot inherit a stale route heading.
  let correction = capped(error * 0.35, max(0.0, limits.x) * 0.15);
  return capped(chosenVel + correction, max(0.0, limits.x));
}
${coordinated ? '' : `@compute @workgroup_size(64)
fn clearFormation(@builtin(global_invocation_id) gid: vec3<u32>) {
  let fleet = gid.x;
  if (fleet >= FORM_FLEETS) { return; }
  let page = u32(u.trail.z) & 1u;
  for (var slot = 0u; slot < FORM_ANCHORS; slot++) {
    let at = formPoseIndex(page, fleet, slot);
    var flag = director.formPoses[at];
    flag.w = 0u;
    director.formPoses[at] = flag;
  }
}`}
`;
}
