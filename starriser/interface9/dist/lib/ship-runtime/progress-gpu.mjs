import {slotLookupWgsl} from './slot-layout.mjs';
import {SHIP_WGSL} from './shaders.mjs';
export const PROGRESS_WORDS=24;
export const progressWgsl=capacity=>/* wgsl */`
${SHIP_WGSL}
struct OrbitRegion {center:vec4<f32>,plane:vec4<f32>}
struct GroupSource {range:vec4<u32>,journey:vec4<f32>,live:array<vec4<u32>,2>,orbits:array<OrbitRegion,2>}
struct Progress {minimum:vec4<f32>,maximum:vec4<f32>,position:vec4<f32>,velocity:vec4<f32>,anchor:vec4<f32>,counts:vec4<u32>}
@group(0) @binding(0) var<storage,read> ships:array<Ship>;
@group(0) @binding(1) var<storage,read> groups:array<GroupSource>;
@group(0) @binding(2) var<storage,read_write> summaries:array<Progress>;
@group(0) @binding(3) var<storage,read> slotWords:array<u32>;
${slotLookupWgsl(capacity,'slotWords[word]','arrayLength(&ships)')}
var<workgroup> partial:array<Progress,128>;
fn onOrbit(ship:Ship,region:OrbitRegion)->bool {
  if(region.plane.w==0.0){return false;}
  let p=ship.p.xyz-region.center.xyz;let phase=atan2(p.y*region.plane.x+p.z*region.plane.y,p.x);
  let nearest=region.center.w*vec3<f32>(cos(phase),sin(phase)*region.plane.x,sin(phase)*region.plane.y);
  return length(p-nearest)<=region.plane.z;
}
@compute @workgroup_size(128) fn summarize(@builtin(workgroup_id) wid:vec3<u32>,@builtin(local_invocation_index) lane:u32) {
  let row=wid.x;let cohort=row%2u;let source=groups[row/2u];
  let begin=0u;let end=source.range.z;
  var value:Progress;value.minimum=vec4<f32>(vec3<f32>(1e30),0.0);value.maximum=vec4<f32>(vec3<f32>(-1e30),0.0);value.anchor.w=1e30;
  for(var ordinal=begin+lane;ordinal<end;ordinal+=128u) {
    let live=(source.live[ordinal/128u][(ordinal/32u)%4u]&(1u<<(ordinal%32u)))!=0u;
    if(!live){continue;}
    let ship=ships[groupSlot(row/2u,ordinal)];if(((ship.identity.x>>16u)&1u)!=cohort){continue;}let matched=ship.flight.x==source.journey[cohort]&&ship.identity.z==1u;
    let arrived=matched&&((ship.flight.w==-1.0&&onOrbit(ship,source.orbits[cohort]))||(ship.flight.w==1.0&&ship.origin.w>=1.0));
    value.minimum=vec4<f32>(min(value.minimum.xyz,ship.p.xyz),max(value.minimum.w,length(ship.v.xyz)));
    value.maximum=vec4<f32>(max(value.maximum.xyz,ship.p.xyz),max(value.maximum.w,length(ship.a.xyz)));
    value.position+=vec4<f32>(ship.p.xyz,select(0.0,1.0,matched&&ship.flight.w==1.0&&ship.origin.w==2.0));value.velocity+=vec4<f32>(ship.v.xyz,0.0);
    if(f32(ordinal)<value.anchor.w){value.anchor=vec4<f32>(ship.p.xyz,f32(ordinal));}
    value.counts+=vec4<u32>(1u,select(0u,1u,arrived),select(0u,1u,ship.flight.w>=2.0),select(0u,1u,!matched));
  }
  partial[lane]=value;workgroupBarrier();
  for(var stride=64u;stride>0u;stride/=2u) {
    if(lane<stride) {
      let a=partial[lane];let b=partial[lane+stride];
      partial[lane].minimum=vec4<f32>(min(a.minimum.xyz,b.minimum.xyz),max(a.minimum.w,b.minimum.w));
      partial[lane].maximum=vec4<f32>(max(a.maximum.xyz,b.maximum.xyz),max(a.maximum.w,b.maximum.w));
      partial[lane].position=a.position+b.position;partial[lane].velocity=a.velocity+b.velocity;
      partial[lane].anchor=select(a.anchor,b.anchor,b.anchor.w<a.anchor.w);partial[lane].counts=a.counts+b.counts;
    }
    workgroupBarrier();
  }
  if(lane==0u){summaries[row]=partial[0];}
}
`;
