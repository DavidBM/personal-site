import {SHIP_WGSL} from '../ship-runtime/shaders.mjs';
export const DRAW=/*wgsl*/`
${SHIP_WGSL}
struct Input {clock:vec4<f32>,view:vec4<f32>,camera:vec4<f32>,settings:vec4<f32>,control:vec4<f32>}
struct Pick {value:atomic<u32>}
@group(0) @binding(0) var<uniform> u:Input;
@group(0) @binding(1) var<storage,read> previous:array<Ship>;
@group(0) @binding(2) var<storage,read> current:array<Ship>;
@group(0) @binding(3) var<storage,read_write> pick:Pick;
fn rotate(q:vec4<f32>,v:vec3<f32>)->vec3<f32>{return v+2.0*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
fn position(index:u32)->vec3<f32>{return mix(previous[index].p.xyz,current[index].p.xyz,u.control.y);}
fn project(p:vec3<f32>)->vec2<f32>{
  var center=u.view.xyz;
  if(i32(u.settings.z)>=0){center=position(u32(u.settings.z));}
  let right=vec3<f32>(cos(u.camera.x),0.0,-sin(u.camera.x));
  let up=vec3<f32>(sin(u.camera.x)*sin(u.camera.y),cos(u.camera.y),cos(u.camera.x)*sin(u.camera.y));
  let d=p-center;
  return vec2<f32>(dot(d,right)/u.camera.z,dot(d,up))/u.view.w;
}
struct Vertex {@builtin(position) p:vec4<f32>,@location(0) color:vec3<f32>}
@vertex fn dart(@builtin(vertex_index) vertex:u32,@builtin(instance_index) index:u32)->Vertex{
  let s=current[index];let before=previous[index].q;
  let after=s.q*select(1.0,-1.0,dot(before,s.q)<0.0);
  let q=normalize(mix(before,after,u.control.y));
  let shape=array<vec3<f32>,3>(vec3<f32>(0.0,0.0,1.5),vec3<f32>(-.7,0.0,-1.0),vec3<f32>(.7,0.0,-1.0));
  let scale=max(s.p.w,u.view.w/u.camera.w*.9);
  let projected=project(position(index)+rotate(q,shape[vertex]*scale));
  var out:Vertex;out.p=vec4<f32>(projected,0.0,1.0);
  out.color=vec3<f32>(.55,.61,.65);
  if(i32(u.settings.z)>=0 && current[u32(u.settings.z)].identity.y==s.identity.y){out.color=vec3<f32>(.2,.85,.9);}
  if(i32(index)==i32(u.settings.z)){out.color=vec3<f32>(1.0,.9,.45);}
  return out;
}
@fragment fn shade(in:Vertex)->@location(0) vec4<f32>{return vec4<f32>(in.color,1.0);}
@compute @workgroup_size(128) fn selectShip(@builtin(global_invocation_id) id:vec3<u32>){
  if(id.x>=u32(u.clock.z)){return;}
  let d=(project(position(id.x))-u.control.zw)*vec2<f32>(u.camera.z,1.0)*u.camera.w*.5;
  let distance=length(d);if(distance>8.0){return;}
  atomicMin(&pick.value,(u32(distance*100.0)<<16u)|id.x);
}
`;
