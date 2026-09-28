import {SHIP_WGSL} from '../ship-runtime/shaders.mjs';
import {CLASS_LIMITS,RADII,GRID_BUCKETS,CELL_SLOTS,CELL_SIZE} from './model.mjs';
export const COMMON=/*wgsl*/`
${SHIP_WGSL}
const PI=3.14159265359;
const BUCKETS=${GRID_BUCKETS}u;const SLOTS=${CELL_SLOTS}u;const CELL=${CELL_SIZE}.0;
const LIMITS=array<vec4<f32>,6>(${CLASS_LIMITS.map(v=>`vec4<f32>(${v.map(x=>Number(x).toFixed(4)).join(',')})`).join(',')});
const RADII=array<f32,6>(${RADII.map(x=>x.toFixed(4)).join(',')});
struct Input {clock:vec4<f32>,view:vec4<f32>,camera:vec4<f32>,settings:vec4<f32>,control:vec4<f32>}
struct Fleet {position:vec4<f32>,velocity:vec4<f32>,path:vec4<f32>,config:vec4<f32>,info:vec4<u32>,goal:vec4<f32>,direction:vec4<f32>}
struct Intent {aimPoint:vec4<f32>,motion:vec4<f32>,state:vec4<u32>,avoid:vec4<f32>}
struct Grid {counts:array<atomic<u32>,${GRID_BUCKETS}>,slots:array<u32,${GRID_BUCKETS*CELL_SLOTS}>}
struct Diagnostics {values:array<atomic<u32>,16>}
@group(0) @binding(0) var<uniform> u:Input;
@group(0) @binding(1) var<storage,read> old:array<Ship>;
@group(0) @binding(2) var<storage,read_write> next:array<Ship>;
@group(0) @binding(3) var<storage,read_write> intents:array<Intent>;
@group(0) @binding(4) var<storage,read_write> fleets:array<Fleet>;
@group(0) @binding(5) var<storage,read> homes:array<vec4<f32>>;
@group(0) @binding(6) var<storage,read_write> grid:Grid;
@group(0) @binding(7) var<storage,read_write> stats:Diagnostics;
fn unit(v:vec3<f32>)->vec3<f32>{return v/max(length(v),.000001);}
fn capped(v:vec3<f32>,m:f32)->vec3<f32>{return v*min(1.0,m/max(length(v),.000001));}
fn rotate(q:vec4<f32>,v:vec3<f32>)->vec3<f32>{return v+2.0*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
fn qmul(a:vec4<f32>,b:vec4<f32>)->vec4<f32>{return vec4<f32>(a.w*b.xyz+b.w*a.xyz+cross(a.xyz,b.xyz),a.w*b.w-dot(a.xyz,b.xyz));}
fn shipType(s:Ship)->u32{return s.identity.x;}
fn repelScale(kind:u32)->f32{return RADII[min(kind,5u)];}
fn hashCell(c:vec3<i32>)->u32{return ((bitcast<u32>(c.x)*73856093u)^(bitcast<u32>(c.y)*19349663u)^(bitcast<u32>(c.z)*83492791u))%BUCKETS;}
fn cell(p:vec3<f32>)->vec3<i32>{return vec3<i32>(floor(p/CELL));}
fn cameraCenter()->vec3<f32>{
  let selected=i32(u.settings.z);
  if(selected>=0 && selected<i32(u.clock.z)){return old[u32(selected)].p.xyz;}
  return u.view.xyz;
}
fn cameraRight()->vec3<f32>{return vec3<f32>(cos(u.camera.x),0.0,-sin(u.camera.x));}
fn cameraUp()->vec3<f32>{return vec3<f32>(sin(u.camera.x)*sin(u.camera.y),cos(u.camera.y),cos(u.camera.x)*sin(u.camera.y));}
fn screenPoint(p:vec3<f32>)->vec2<f32>{let d=p-cameraCenter();return vec2<f32>(dot(d,cameraRight())/u.camera.z,dot(d,cameraUp()))/u.view.w;}
fn pixelDiameter(s:Ship)->f32{return s.p.w*u.camera.w/u.view.w;}
fn pilotPeriod(s:Ship,index:u32)->u32 {
  if(u.settings.x>.5 || i32(index)==i32(u.settings.z)){return 1u;}
  let screen=screenPoint(s.p.xyz);let visible=all(abs(screen)<vec2<f32>(1.05));let px=pixelDiameter(s);
  if(visible&&px>=8.0){return 1u;}
  if(visible&&px>=3.0){return 3u;}
  return 15u;
}
fn page(tick:u32,index:u32)->u32{return (tick&1u)*u32(u.clock.z)+index;}
`;
