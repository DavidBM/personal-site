import {SHIP_WGSL} from './shaders.mjs';
import {eventPoseAddress,EVENT_POSE_WORDS} from './event-gpu.mjs';
import {correctionAddress,MAX_SHIP_CORRECTIONS} from './correction-gpu.mjs';
// Disjoint swaps need no whole-population staging allocation. Separate passes
// ensure every pose has moved before references are translated into new slots.
export const PACKING_WGSL=/* wgsl */`
${SHIP_WGSL}
@group(0) @binding(0) var<storage,read_write> a:array<Ship>;
@group(0) @binding(1) var<storage,read_write> b:array<Ship>;
@group(0) @binding(2) var<storage,read_write> history:array<vec4<f32>>;
@group(0) @binding(3) var<storage,read_write> links:array<u32>;
@group(0) @binding(4) var<storage,read> remap:array<u32>;
@group(0) @binding(5) var<storage,read> pairs:array<vec2<u32>>;
@group(0) @binding(6) var<uniform> config:vec4<u32>;
${eventPoseAddress}
${correctionAddress}
fn swapWord(left:u32,right:u32){let value=links[left];links[left]=links[right];links[right]=value;}
@compute @workgroup_size(64) fn swapSlots(@builtin(global_invocation_id) gid:vec3<u32>) {
  if(gid.x>=config.y){return;}
  let left=pairs[gid.x].x;let right=pairs[gid.x].y;
  let first=a[left];a[left]=a[right];a[right]=first;
  let second=b[left];b[left]=b[right];b[right]=second;
  for(var j=0u;j<48u;j++){let value=history[left*48u+j];history[left*48u+j]=history[right*48u+j];history[right*48u+j]=value;}
  let base=eventPoseBase(config.x);
  for(var j=0u;j<${EVENT_POSE_WORDS}u;j++){swapWord(base+left*${EVENT_POSE_WORDS}u+j,base+right*${EVENT_POSE_WORDS}u+j);}
  swapWord(correctionDirectory(config.x)+left,correctionDirectory(config.x)+right);
}
fn movedHandle(handle:f32)->f32 {
  if(handle<1.0||handle>f32(config.x)){return 0.0;}
  return f32(remap[u32(handle)-1u]+1u);
}
fn remapPose(base:u32) {
  for(var k=0u;k<2u;k++){let at=base+16u+k*8u;links[at]=bitcast<u32>(movedHandle(bitcast<f32>(links[at])));}
}
@compute @workgroup_size(128) fn remapReferences(@builtin(global_invocation_id) gid:vec3<u32>) {
  let i=gid.x;if(i>=config.x){return;}
  a[i].aux.x=movedHandle(a[i].aux.x);a[i].memory.x=movedHandle(a[i].memory.x);
  b[i].aux.x=movedHandle(b[i].aux.x);b[i].memory.x=movedHandle(b[i].memory.x);
  if(config.z>0u){for(var row=0u;row<8u;row++){remapPose(eventPoseBase(config.x)+i*${EVENT_POSE_WORDS}u+row*48u);}}
  var record=links[correctionDirectory(config.x)+i];
  for(var n=0u;n<${MAX_SHIP_CORRECTIONS}u&&record>0u;n++) {
    let at=correctionAt(config.x,record-1u);remapPose(at+4u);remapPose(at+52u);record=links[at+1u];
  }
}
`;
