/** Stable GPU compaction of the selected hull list; simulation and trails are unchanged. */
import { MODEL_SHIP_TYPES_WGSL, MODEL_SHIP_POSE_WGSL } from './model-ship-pose.wgsl.js';
import { MODEL_CATALOG_MAX_BATCHES } from '../visual/ship-model-catalog.js';
import { MODEL_VISIBILITY_EPSILON } from '../visual/model-visibility.js';
export const MODEL_VISIBILITY_GROUP_SIZE = 64;
export const MODEL_VISIBILITY_MAX_BATCHES = MODEL_CATALOG_MAX_BATCHES * 3;
export const MODEL_VISIBILITY_UNIFORM_BYTES = 144 + MODEL_VISIBILITY_MAX_BATCHES * 16 + 3 * 32;
export function buildModelVisibilityWgsl(capacity, indirectOffsetWords, batchCount = 1, partitions = false) {
    const packs = Array.from({ length: Math.ceil(batchCount / 8) }, (_, i) => i);
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
  ranges: array<vec4<u32>, ${MODEL_VISIBILITY_MAX_BATCHES}>,
  partitions: array<vec4<u32>,3>,
  bounds: array<vec4<f32>,3>,
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
${packs.map(i => `var<workgroup> prefix${i}:array<vec2<u32>,64>;`).join("\n")}
fn prefixCount(lane:u32,batch:u32)->u32{
  ${packs.map(i => `if(batch<${(i + 1) * 8}u){return (prefix${i}[lane][(batch>>2u)&1u]>>((batch&3u)*8u))&255u;}`).join("\n")}
  return 0u;
}
var<workgroup> batchTotals: array<u32, ${MODEL_VISIBILITY_MAX_BATCHES}>;
fn sphereVisible(center: vec3<f32>, radius: f32) -> bool {
  for (var i = 0u; i < 6u; i++) {
    let plane = u.planes[i];
    let scale = max(1.0, dot(abs(plane.xyz), abs(center)) + abs(plane.w) + radius);
    // Strict rejection keeps grazing, near-plane crossings and camera-inside spheres.
    if (dot(plane.xyz, center) + plane.w < -radius - EPSILON * scale) { return false; }
  }
  return true;
}
// Return a bin or sentinel; scatter reuses this decision, not another ship read.
fn candidateBin(index:u32)->u32 {
  if(index>=u.candidateCount){return 0xffffffffu;}
  let shipIdx=candidates[index];
  if(shipIdx==0xffffffffu){return 0xffffffffu;}
  let ship=ships[shipIdx];
  if(ship.mode==SHIP_MODE_PAUSED){return 0xffffffffu;}
  var bin=0u;var scale=u.modelScale;var radius=u.meshRadius;
  ${partitions ? `
  var found=false;
  for(var p=0u;p<3u;p++){
    let part=u.partitions[p];
    if(part.y>0u && modelShipLodMatches(ship,part.z)){
      bin=part.x+min(ship.targetKind&255u,part.y-1u);
      scale=u.bounds[p].x;radius=u.bounds[p].y;found=true;break;
    }
  }
  if(!found){return 0xffffffffu;}
  ` : `
  if(!modelShipLodMatches(ship,u.lodMask)){return 0xffffffffu;}
  bin=min(ship.targetKind&255u,BATCHES-1u);
  `}
  let pose=modelShipPose(ship,u.origin,scale);
  if(!sphereVisible(pose.centerRel,radius*abs(pose.hullScale))){return 0xffffffffu;}
  return bin;
}
@compute @workgroup_size(64)
fn classify(@builtin(global_invocation_id) global: vec3<u32>, @builtin(local_invocation_id) local: vec3<u32>, @builtin(workgroup_id) group: vec3<u32>) {
  let bin = candidateBin(global.x);
  let keep = bin != 0xffffffffu;
  let batch = select(0u,bin,keep);
  let component = batch >> 2u;
  let shift = (batch & 3u) * 8u;
  ${packs.map(i => `var packed${i}=vec2<u32>(0u);
  if(keep && batch/8u==${i}u){packed${i}[component&1u]=1u<<shift;}
  prefix${i}[local.x]=packed${i};`).join("\n")}
  workgroupBarrier();
  for (var offset = 1u; offset < 64u; offset *= 2u) {
    ${packs.map(i => `var add${i}=vec2<u32>(0u);
    if(local.x>=offset){add${i}=prefix${i}[local.x-offset];}`).join("\n")}
    workgroupBarrier();
    ${packs.map(i => `prefix${i}[local.x]+=add${i};`).join("\n")}
    workgroupBarrier();
  }
  let rank=prefixCount(local.x,batch);
  if (global.x < u.candidateCount) { workspace[global.x] = select(0u, rank | (batch << 8u), keep); }
  if (local.x == 63u) {
    for (var b = 0u; b < BATCHES; b++) {
      workspace[CAPACITY + b * GROUPS + group.x] = prefixCount(63u,b);
    }
  }
}
// Scan each mesh bin independently. Lanes first scan small contiguous chunks,
// then share only their totals; no lane walks every candidate workgroup.
var<workgroup> groupTotals: array<u32,128>;
var<workgroup> batchOffsets: array<u32,${MODEL_VISIBILITY_MAX_BATCHES}>;
@compute @workgroup_size(128)
fn scanGroups(@builtin(local_invocation_id) local: vec3<u32>, @builtin(workgroup_id) workgroup: vec3<u32>) {
  let b=workgroup.x;
  let chunk=(u.groupCount+127u)/128u;
  let start=local.x*chunk;
  let end=min(start+chunk,u.groupCount);
  var count=0u;
  for(var group=start;group<end;group++){
    let at=CAPACITY+b*GROUPS+group;
    let amount=workspace[at];workspace[at]=count;count+=amount;
  }
  groupTotals[local.x]=count;
  workgroupBarrier();
  for(var distance=1u;distance<128u;distance*=2u){
    var add=0u;
    if(local.x>=distance){add=groupTotals[local.x-distance];}
    workgroupBarrier();groupTotals[local.x]+=add;workgroupBarrier();
  }
  let first=groupTotals[local.x]-count;
  for(var group=start;group<end;group++){workspace[CAPACITY+b*GROUPS+group]+=first;}
  if(local.x==127u){
    let args=INDIRECT+b*8u;
    visible[args]=select(u.indexCount,u.ranges[b].x,BATCHES>1u);
    visible[args+1u]=groupTotals[127u];
    visible[args+2u]=select(0u,u.ranges[b].y,BATCHES>1u);
    visible[args+3u]=0u;visible[args+4u]=0u;
  }
}
@compute @workgroup_size(64)
fn scatter(@builtin(global_invocation_id) global: vec3<u32>, @builtin(local_invocation_id) local: vec3<u32>, @builtin(workgroup_id) group: vec3<u32>) {
  // The preceding dispatch published all bin totals. Resolve their small prefix
  // here, keeping three passes and the same buffers/indirect argument ABI.
  if(local.x<BATCHES){batchTotals[local.x]=visible[INDIRECT+local.x*8u+1u];}
  workgroupBarrier();
  if(local.x<BATCHES){
    var first=0u;
    for(var b=0u;b<local.x;b++){first+=batchTotals[b];}
    batchOffsets[local.x]=first;
    if(group.x==0u && BATCHES>1u){visible[INDIRECT+local.x*8u+5u]=first;}
  }
  if(group.x==0u && local.x==0u){
    var high=0u;
    for(var b=0u;b<${partitions ? 'u.partitions[0].y' : 'BATCHES'};b++){high+=batchTotals[b];}
    let composite=INDIRECT+BATCHES*8u;
    visible[composite]=3u;visible[composite+1u]=select(0u,1u,high>0u);
    visible[composite+2u]=0u;visible[composite+3u]=0u;
  }
  workgroupBarrier();
  if(global.x>=u.candidateCount){return;}
  let packed=workspace[global.x];
  let rank=packed&255u;
  if(rank==0u){return;}
  let batch=packed>>8u;
  let offset=workspace[CAPACITY+batch*GROUPS+group.x]+batchOffsets[batch];
  visible[offset+rank-1u]=candidates[global.x];
}
`;
}
//# sourceMappingURL=model-visibility.wgsl.js.map