/** Stable GPU compaction of the selected hull list; simulation and trails are unchanged. */
import { MODEL_SHIP_TYPES_WGSL, MODEL_SHIP_POSE_WGSL } from './model-ship-pose.wgsl.js';
import { MODEL_CATALOG_MAX_BATCHES } from '../visual/ship-model-catalog.js';
import { MODEL_VISIBILITY_EPSILON } from '../visual/model-visibility.js';
export const MODEL_VISIBILITY_GROUP_SIZE = 64;
export const MODEL_VISIBILITY_UNIFORM_BYTES = 144 + MODEL_CATALOG_MAX_BATCHES * 16;
export function buildModelVisibilityWgsl(capacity, indirectOffsetWords, batchCount = 1) {
    return /* wgsl */ `
${MODEL_SHIP_TYPES_WGSL}
struct VisibilityUniforms {
  planes: array<vec4<f32>, 6>,
  origin: vec3<f32>, modelScale: f32,
  meshRadius: f32, candidateCount: u32, indexCount: u32, groupCount: u32,
  lodMask: u32,
  _padA: u32,
  _padB: u32,
  _padC: u32,
  ranges: array<vec4<u32>, ${MODEL_CATALOG_MAX_BATCHES}>,
};
@group(0) @binding(0) var<uniform> u: VisibilityUniforms;
@group(0) @binding(1) var<storage, read> ships: array<ShipSim>;
@group(0) @binding(2) var<storage, read> fleets: array<FleetGpu>;
@group(0) @binding(3) var<storage, read> candidates: array<u32>;
@group(0) @binding(4) var<storage, read_write> workspace: array<u32>;
@group(0) @binding(5) var<storage, read_write> visible: array<u32>;
${MODEL_SHIP_POSE_WGSL}
const CAPACITY: u32 = ${capacity}u;
const INDIRECT: u32 = ${indirectOffsetWords}u;
const EPSILON: f32 = ${MODEL_VISIBILITY_EPSILON};
const BATCHES: u32 = ${batchCount}u;
const GROUPS: u32 = ${Math.ceil(capacity / MODEL_VISIBILITY_GROUP_SIZE)}u;
// Four 8-bit class counts fit in each word. A group has at most 64 ships,
// so additions cannot carry between adjacent counters (including full groups).
var<workgroup> prefix: array<vec2<u32>, 64>;
var<workgroup> batchTotals: array<u32, ${MODEL_CATALOG_MAX_BATCHES}>;
fn candidateBatch(index: u32) -> u32 {
  if (BATCHES == 1u || index >= u.candidateCount) { return 0u; }
  let ship = candidates[index];
  if (ship == 0xffffffffu) { return 0u; }
  return min(ships[ship].targetKind & 255u, BATCHES - 1u);
}
fn sphereVisible(center: vec3<f32>, radius: f32) -> bool {
  for (var i = 0u; i < 6u; i++) {
    let plane = u.planes[i];
    let scale = max(1.0, dot(abs(plane.xyz), abs(center)) + abs(plane.w) + radius);
    // Strict rejection keeps grazing, near-plane crossings and camera-inside spheres.
    if (dot(plane.xyz, center) + plane.w < -radius - EPSILON * scale) { return false; }
  }
  return true;
}
fn candidateVisible(index: u32) -> bool {
  if (index >= u.candidateCount) { return false; }
  let shipIdx = candidates[index];
  if (shipIdx == 0xffffffffu) { return false; }
  let ship = ships[shipIdx];
  if (!modelShipLodMatches(ship, u.lodMask)) { return false; }
  if (ship.mode == SHIP_MODE_PAUSED) { return false; }
  let pose = modelShipPose(ship, u.origin, u.modelScale);
  return sphereVisible(pose.centerRel, u.meshRadius * abs(pose.hullScale));
}
@compute @workgroup_size(64)
fn classify(@builtin(global_invocation_id) global: vec3<u32>, @builtin(local_invocation_id) local: vec3<u32>, @builtin(workgroup_id) group: vec3<u32>) {
  let keep = candidateVisible(global.x);
  let batch = candidateBatch(global.x);
  let component = batch >> 2u;
  let shift = (batch & 3u) * 8u;
  var packed = vec2<u32>(0u);
  if (keep) { packed[component] = 1u << shift; }
  prefix[local.x] = packed;
  workgroupBarrier();
  for (var offset = 1u; offset < 64u; offset *= 2u) {
    var add = vec2<u32>(0u);
    if (local.x >= offset) { add = prefix[local.x - offset]; }
    workgroupBarrier();
    prefix[local.x] += add;
    workgroupBarrier();
  }
  let rank = (prefix[local.x][component] >> shift) & 255u;
  if (global.x < u.candidateCount) { workspace[global.x] = select(0u, rank, keep); }
  if (local.x == 63u) {
    for (var b = 0u; b < BATCHES; b++) {
      workspace[CAPACITY + b * GROUPS + group.x] = (prefix[63][b >> 2u] >> ((b & 3u) * 8u)) & 255u;
    }
  }
}
@compute @workgroup_size(${MODEL_CATALOG_MAX_BATCHES})
fn scanGroups(@builtin(local_invocation_id) local: vec3<u32>) {
  let b = local.x;
  var count = 0u;
  if (b < BATCHES) {
    for (var group = 0u; group < u.groupCount; group++) {
      let at = CAPACITY + b * GROUPS + group;
      let amount = workspace[at];
      workspace[at] = count;
      count += amount;
    }
  }
  batchTotals[b] = count;
  workgroupBarrier();
  if (b >= BATCHES) { return; }
  var first = 0u;
  for (var previous = 0u; previous < b; previous++) { first += batchTotals[previous]; }
  for (var group = 0u; group < u.groupCount; group++) { workspace[CAPACITY + b * GROUPS + group] += first; }
  let args = INDIRECT + b * 8u;
  visible[args] = select(u.indexCount, u.ranges[b].x, BATCHES > 1u);
  visible[args + 1u] = count;
  visible[args + 2u] = select(0u, u.ranges[b].y, BATCHES > 1u);
  visible[args + 3u] = 0u;
  visible[args + 4u] = 0u;
  if (BATCHES > 1u) { visible[args + 5u] = first; }
}
@compute @workgroup_size(64)
fn scatter(@builtin(global_invocation_id) global: vec3<u32>, @builtin(workgroup_id) group: vec3<u32>) {
  if (global.x >= u.candidateCount) { return; }
  let rank = workspace[global.x];
  if (rank == 0u) { return; }
  let batch = candidateBatch(global.x);
  let offset = workspace[CAPACITY + batch * GROUPS + group.x];
  visible[offset + rank - 1u] = candidates[global.x];
}
`;
}
//# sourceMappingURL=model-visibility.wgsl.js.map