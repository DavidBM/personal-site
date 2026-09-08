/** Stable GPU compaction of the selected hull list; simulation and trails are unchanged. */
import { MODEL_SHIP_TYPES_WGSL, MODEL_SHIP_POSE_WGSL } from './model-ship-pose.wgsl.js';
import { MODEL_VISIBILITY_EPSILON } from '../visual/model-visibility.js';
export const MODEL_VISIBILITY_GROUP_SIZE = 64;
export const MODEL_VISIBILITY_UNIFORM_BYTES = 128;
export function buildModelVisibilityWgsl(capacity, indirectOffsetWords) {
    return /* wgsl */ `
${MODEL_SHIP_TYPES_WGSL}
struct VisibilityUniforms {
  planes: array<vec4<f32>, 6>,
  origin: vec3<f32>, modelScale: f32,
  meshRadius: f32, candidateCount: u32, indexCount: u32, groupCount: u32,
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
var<workgroup> prefix: array<u32, 64>;
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
  let ship = ships[candidates[index]];
  if (ship.mode == SHIP_MODE_PAUSED) { return false; }
  let pose = modelShipPose(ship, u.origin, u.modelScale);
  return sphereVisible(pose.centerRel, u.meshRadius * abs(pose.hullScale));
}
@compute @workgroup_size(64)
fn classify(@builtin(global_invocation_id) global: vec3<u32>, @builtin(local_invocation_id) local: vec3<u32>, @builtin(workgroup_id) group: vec3<u32>) {
  let keep = candidateVisible(global.x);
  prefix[local.x] = select(0u, 1u, keep);
  workgroupBarrier();
  for (var offset = 1u; offset < 64u; offset *= 2u) {
    var add = 0u;
    if (local.x >= offset) { add = prefix[local.x - offset]; }
    workgroupBarrier();
    prefix[local.x] += add;
    workgroupBarrier();
  }
  if (global.x < u.candidateCount) { workspace[global.x] = select(0u, prefix[local.x], keep); }
  if (local.x == 63u) { workspace[CAPACITY + group.x] = prefix[63]; }
}
@compute @workgroup_size(1)
fn scanGroups() {
  var count = 0u;
  for (var group = 0u; group < u.groupCount; group++) {
    let amount = workspace[CAPACITY + group];
    workspace[CAPACITY + group] = count;
    count += amount;
  }
  visible[INDIRECT] = u.indexCount;
  visible[INDIRECT + 1u] = count;
  visible[INDIRECT + 2u] = 0u;
  visible[INDIRECT + 3u] = 0u;
  visible[INDIRECT + 4u] = 0u;
}
@compute @workgroup_size(64)
fn scatter(@builtin(global_invocation_id) global: vec3<u32>, @builtin(workgroup_id) group: vec3<u32>) {
  if (global.x >= u.candidateCount) { return; }
  let rank = workspace[global.x];
  if (rank == 0u) { return; }
  let offset = workspace[CAPACITY + group.x];
  visible[offset + rank - 1u] = candidates[global.x];
}
`;
}
//# sourceMappingURL=model-visibility.wgsl.js.map