import {SCHEDULE_WGSL} from '../demo-ship-battle-poc/spatial-schedule.mjs';
import {contactCacheWgsl} from '../demo-ship-battle-poc/contact-cache.mjs';
import {SEPARATION_QUERY_WGSL} from '../demo-ship-battle-poc/contact-queries.mjs';
import {SOLAR_WGSL} from '../demo-ship-flight-poc/solar-layout.mjs';
import {densitySimulation,densityDrawing} from './density.mjs';
import {CLASS_WGSL} from '../demo-ship-battle-poc/classes.mjs';
import {FLIGHT_GUIDANCE_WGSL,FLIGHT_GRID_SIDE,FLIGHT_CELL_SIZE} from './flight-layout.mjs';
// Standalone experimental controller. No production imports or hidden orbit pose writer.
export const RING = 16;
export const STRIDE = 96;
const common = /* wgsl */`
struct Ship { p: vec4<f32>, v: vec4<f32>, a: vec4<f32>, q: vec4<f32>, aux: vec4<f32>, identity: vec4<u32> }
const PI: f32 = 3.14159265359;
const RING: u32 = 16u;
fn capped(v: vec3<f32>, maximum: f32) -> vec3<f32> { return v * min(1.0, maximum / max(length(v), 0.000001)); }
fn unit(v: vec3<f32>) -> vec3<f32> { return v / max(length(v), 0.000001); }
fn rotate(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
fn qmul(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(a.w*b.xyz + b.w*a.xyz + cross(a.xyz,b.xyz), a.w*b.w-dot(a.xyz,b.xyz));
}
${SOLAR_WGSL}
${CLASS_WGSL}
fn sceneAdapt(bodyRadius:f32)->f32 {return clamp(bodyRadius/45.0,0.02,1.0);}
fn sceneHull(typeId:u32,bodyRadius:f32)->f32 {return dimensions(typeId).w*sceneAdapt(bodyRadius);}
fn journeyBodyRadius(s:Ship)->f32 {return 45.0;}
fn emitter(s: Ship, e: u32) -> vec3<f32> {
  let local = vec3<f32>((f32(e)-1.0)*0.5,select(-0.2,0.15,e==1u),-1.0)*dimensions(shipType(s)).xyz;
  return s.p.xyz + rotate(s.q,local);
}
`;

export const SIM = common + /* wgsl */`
struct Input { clock: vec4<f32>, control: vec4<f32>, warp: vec4<f32> }
@group(0) @binding(0) var<uniform> u: Input;
@group(0) @binding(1) var<storage,read> old: array<Ship>;
@group(0) @binding(2) var<storage,read_write> next: array<Ship>;
@group(0) @binding(3) var<storage,read_write> history: array<vec4<f32>>;

fn contributes(s:Ship)->bool{return true;}
fn clearSpatial(index:u32){clearSchedule(index);}
fn insertContact(i:u32,s:Ship,bucket:u32){links[i]=atomicAdd(&heads[bucket],1u);}
fn pressureMix()->f32{return 1.0;}
fn pressureEnabled()->f32{return u.control.w;}
fn fieldOrigin()->vec3<f32>{return body(1u,u.clock.x,u.control.x).xyz;}
${densitySimulation(FLIGHT_GRID_SIDE,FLIGHT_CELL_SIZE)}
${FLIGHT_GUIDANCE_WGSL}
${SCHEDULE_WGSL}
${contactCacheWgsl(`
  let query=flightPose(s,u.clock.x,u.clock.y);
  let enabled=flightLocalDt(u.clock.x,u.clock.y)>0.0&&pressureEnabled()!=0.0;
  typedGeometry[count+index]=FilterGeometry(query.p.xyz,dimensions(shipType(query)).w,query.v.xyz,u32(enabled)*QUERY_PRESSURE);
`)}
${SEPARATION_QUERY_WGSL}

fn attitude(q: vec4<f32>, velocity: vec3<f32>, dt: f32, rate:f32) -> vec4<f32> {
  if (length(velocity)<0.01) { return q; }
  let forward = rotate(q,vec3<f32>(0.0,0.0,1.0));
  let desired = unit(velocity);
  let angle = min(acos(clamp(dot(forward,desired),-1.0,1.0)),rate*dt);
  var axis = cross(forward,desired);
  if (length(axis)<0.00001) { axis=cross(forward,vec3<f32>(0.0,1.0,0.0)); }
  if (length(axis)<0.00001) { axis=vec3<f32>(1.0,0.0,0.0); }
  return normalize(qmul(vec4<f32>(unit(axis)*sin(angle*0.5),cos(angle*0.5)),q));
}

fn localStep(initial: Ship, i: u32, now: f32, dt: f32) -> Ship {
  var s=initial;
  let scenario=u32(u.clock.w);
  let typeId=shipType(s);let limits=dynamics(typeId);
  var center=body(1u,now,u.control.x).xyz;
  if(scenario==2u){center=encounter(now,u.control.x);}
  let centerV=bodyVelocity(1u,now,u.control.x);
  let ordinal=s.identity.x&255u;
  let branch=f32(ordinal%4u);
  let radius=orbitRadius(typeId,body(1u,now,u.control.x).w);
  let rate=min(.38/PLANET_SCALE,limits.x*.6/radius);
  let tilt=orbitTilt(typeId)+.12*sin(u.control.y);
  let delta=s.p.xyz-center;
  // Follow the ring from the current position, not a distant assigned phase.
  // Density deflections can change phase without forcing ships back into a queue.
  let phase=atan2(dot(delta,vec3<f32>(0.0,sin(tilt),cos(tilt))),delta.x);
  let relative=radius*vec3<f32>(cos(phase),sin(phase)*sin(tilt),sin(phase)*cos(tilt));
  let relativeV=radius*rate*vec3<f32>(-sin(phase),cos(phase)*sin(tilt),cos(phase)*cos(tilt));
  var goal=center+relative;
  var goalV=centerV+relativeV;
  if (scenario==1u || scenario==3u) {
    // Broad corridor planes preserve forward progress after density deflection.
    let lane=flightLane(s);
    if (s.identity.z==0u && s.p.x>=-8.0) { s.identity.z=1u; }
    if (s.identity.z==1u && s.p.x>=4.0) { s.identity.z=2u; }
    if (s.identity.z==0u) { goal=vec3<f32>(-4.0,5.0,5.0)+lane; goalV=vec3<f32>(0.0); }
    if (s.identity.z==1u) { goal=vec3<f32>(8.0,4.0,5.0)+lane; goalV=vec3<f32>(0.0); }
  }
  if (scenario==2u) {
    let side=select(-1.0,1.0,s.identity.y==1u);
    let passPhase=now*0.34*side+s.p.w+u.control.y;
    goal=center+vec3<f32>(5.0*cos(passPhase),2.6*sin(passPhase+branch),4.0*sin(passPhase));
    goalV=centerV+0.34*side*vec3<f32>(-5.0*sin(passPhase),2.6*cos(passPhase+branch),4.0*cos(passPhase));
    // POC contact set is explicitly paired, not a general spatial search.
    if (now>=s.aux.y) {
      let count=u32(u.clock.z);
      let half=count/2u;
      let opponent=(i+half)%count;
      let dp=old[opponent].p.xyz-s.p.xyz;
      let dv=old[opponent].v.xyz-s.v.xyz;
      let horizon=clamp(-dot(dp,dv)/max(dot(dv,dv),0.01),0.0,1.5);
      s.a.w=select(0.0,1.0,length(dp+dv*horizon)<2.0 && dot(dp,dv)<0.0);
      s.aux.y=now+0.20+f32(ordinal%4u)*0.015;
    }
  }
  let desiredV=goalV+capped((goal-s.p.xyz)*1.4,s.v.w);
  var desiredA=(desiredV-s.v.xyz)*2.0;
  if (scenario==2u && s.a.w==1.0) {
    desiredA+=vec3<f32>(0.0,select(-6.0,6.0,(ordinal&1u)==0u),0.0);
  }
  // Bounded predictive soft avoidance. This is not a certified collision solver.
  for(var b=0u;b<3u;b++) {
    let sphere=body(b,now,u.control.x);
    let d=s.p.xyz-sphere.xyz;
    let v=s.v.xyz-bodyVelocity(b,now,u.control.x);
    let tau=clamp(-dot(d,v)/max(dot(v,v),0.01),0.0,clamp(length(v)/limits.y,1.2,6.0));
    let predicted=d+v*tau;
    let clearance=length(predicted)-sphere.w-dimensions(typeId).w-.4;
    if(clearance<1.0) {
      let normal=unit(d);
      let tangent=unit(cross(normal,vec3<f32>(0.0,1.0,0.2)));
      desiredA+=normal*max(0.0,1.0-clearance)*limits.y+tangent*limits.y*.3;
    }
  }
  let spacing=neighborSeparation(s,i);
  desiredA=mix(desiredA+pressure(s)+capitalAvoidance(s,i)+spacing.xyz,spacing.xyz,spacing.w*.95);
  let newA=s.a.xyz+capped(capped(desiredA,limits.y)-s.a.xyz,limits.z*dt);
  s.a=vec4<f32>(newA,s.a.w);
  s.v=vec4<f32>(s.v.xyz+newA*dt,s.v.w);
  s.p=vec4<f32>(s.p.xyz+s.v.xyz*dt,s.p.w);
  s.q=attitude(s.q,s.v.xyz,dt,limits.w);
  return s;
}

fn flightLocalDt(now:f32,dt:f32)->f32 {
  if(u.clock.w==3.0){return min(dt,max(0.0,now-u.warp.y));}return dt;
}
fn flightPose(original:Ship,now:f32,dt:f32)->Ship {
  var s=original;
  if(dt>0.0 && u.clock.w==3.0 && now-dt<u.warp.y) {
    let progress=clamp((min(now,u.warp.y)-u.warp.x)/(u.warp.y-u.warp.x),0.0,1.0);
    // Canonical kinematic warp stays entirely outside the system envelope.
    s.p.x=mix(u.warp.z,u.warp.w,progress)+s.aux.x;
    s.v=vec4<f32>((u.warp.w-u.warp.z)/(u.warp.y-u.warp.x),0.0,0.0,s.v.w);
    s.a=vec4<f32>(0.0);
    if(now>=u.warp.y) { s.v=vec4<f32>(min(2.0,s.v.w),0.0,0.0,s.v.w); }
  }
  return s;
}

@compute @workgroup_size(128) fn advance(@builtin(global_invocation_id) gid: vec3<u32>) {
  if(gid.x>=u32(u.clock.z)) { return; }
  let i=links[u32(u.clock.z)+gid.x];
  let original=old[i];
  let now=u.clock.x;let dt=u.clock.y;
  var s=flightPose(original,now,dt);let localDt=flightLocalDt(now,dt);
  if(localDt>0.0 && (u.clock.w!=3.0 || now>u.warp.y)) { s=localStep(s,i,now,localDt); }
  let emitting=u.control.z>0.5;
  let base=i*3u*RING;
  if(emitting && original.aux.w<0.5) {
    for(var j=0u;j<3u*RING;j++) { history[base+j]=vec4<f32>(0.0,0.0,0.0,-1.0); }
    s.aux.z+=1.0;
    for(var e=0u;e<3u;e++) { history[base+e*RING+u32(floor(now*60.0))%RING]=vec4<f32>(emitter(s,e),now); }
  } else if(emitting && dt>0.0) {
    let first=u32(floor(max(0.0,now-dt)*60.0))+1u;
    let last=u32(floor(now*60.0));
    let begin=max(first,select(0u,last-(RING-1u),last>=RING));
    for(var k=begin;k<=last;k++) {
      let birth=f32(k)/60.0;
      let f=clamp((birth-(now-dt))/dt,0.0,1.0);
      for(var e=0u;e<3u;e++) {
        history[base+e*RING+k%RING]=vec4<f32>(mix(emitter(original,e),emitter(s,e),f),birth);
      }
    }
  }
  s.aux.w=select(0.0,1.0,emitting);
  next[i]=s;
}
`;

export const DRAW = common + /* wgsl */`
struct View { eye: vec4<f32>, aim: vec4<f32>, clock: vec4<f32>, config: vec4<f32>, interpolation: vec4<f32> }
@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage,read> ships: array<Ship>;
@group(0) @binding(2) var<storage,read> history: array<vec4<f32>>;
@group(0) @binding(3) var<storage,read> previous: array<Ship>;
struct Vertex { @builtin(position) clip: vec4<f32>, @location(0) color: vec4<f32> }
fn displayShip(i: u32) -> Ship {
  var s=ships[i]; let p=previous[i]; let fraction=view.interpolation.x;
  s.p=vec4<f32>(mix(p.p.xyz,s.p.xyz,fraction),s.p.w);
  let sign=select(-1.0,1.0,dot(p.q,s.q)>=0.0);
  s.q=normalize(mix(p.q,s.q*sign,fraction));
  return s;
}
fn project(p: vec3<f32>) -> vec4<f32> {
  let selected=displayShip(min(u32(view.config.w),u32(view.clock.y)-1u)).p.xyz;
  let cameraRange=max(4.5,dimensions(shipType(displayShip(min(u32(view.config.w),u32(view.clock.y)-1u)))).w*3.0);
  let rig=vec3<f32>(cameraRange*cos(view.clock.x*0.10),cameraRange*.6,cameraRange*sin(view.clock.x*0.10));
  let eye=mix(view.eye.xyz,selected+rig,view.aim.w);
  let aim=mix(view.aim.xyz,selected,view.aim.w);
  let f=unit(aim-eye); let right=unit(cross(f,vec3<f32>(0.0,1.0,0.0))); let up=cross(right,f);
  let d=p-eye; let z=dot(d,f);
  return vec4<f32>(dot(d,right)*1.7/view.eye.w,dot(d,up)*1.7,z*4000.0/3999.95-200.0/3999.95,z);
}
fn color(s: Ship) -> vec3<f32> { return select(vec3<f32>(0.1,0.75,1.0),vec3<f32>(1.0,0.38,0.12),s.identity.y==1u); }
@vertex fn hull(@builtin(vertex_index) v: u32,@builtin(instance_index) i: u32) -> Vertex {
  let corners=array<vec3<f32>,8>(vec3<f32>(-1,-1,-1),vec3<f32>(1,-1,-1),vec3<f32>(1,1,-1),vec3<f32>(-1,1,-1),vec3<f32>(-1,-1,1),vec3<f32>(1,-1,1),vec3<f32>(1,1,1),vec3<f32>(-1,1,1));
  let indices=array<u32,36>(0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5);
  let s=displayShip(i);let kind=classIndex(shipType(s));let extent=dimensions(shipType(s)).xyz;
  var local=corners[indices[v]];
  if(local.z>0.0){local.x*=select(.05,.78,kind>=3u);local.y*=select(.15,.65,kind>=3u);}
  local*=extent;
  if(view.clock.z==3.0 && view.clock.x<view.config.z) {
    let duration=view.config.z-view.config.y;
    let beat=min(2.0,duration*0.25);
    let stretch=smoothstep(0.0,beat,view.clock.x-view.config.y)*smoothstep(0.0,beat,view.config.z-view.clock.x);
    // Scale forward from the exhaust plane, keeping physical emitter attachment.
    let back=-extent.z;
    local.z=back+(local.z-back)*(1.0+6.0*stretch*(1.0-view.aim.w));
  }
  var out: Vertex; out.clip=project(s.p.xyz+rotate(s.q,local));
  out.color=vec4<f32>(mix(color(s),vec3<f32>(.48,.55,.62),select(0.0,.55,kind>=3u))*(.35+.09*f32(v/6u)),1.0); return out;
}
@vertex fn trail(@builtin(vertex_index) vertex: u32,@builtin(instance_index) instance: u32) -> Vertex {
  let i=instance/3u; let e=instance%3u; let s=displayShip(i);
  let segment=vertex/2u; let end=vertex%2u;
  let tick=u32(floor(view.clock.x*60.0));
  let age=segment+end;
  let safeTick=max(tick,age);
  let sample=history[(i*3u+e)*RING+(safeTick-age)%RING];
  var p=sample.xyz; var born=sample.w;
  if(age==0u && view.clock.w>0.5) { p=emitter(s,e); born=view.clock.x; }
  var alpha=max(0.0,1.0-(view.clock.x-born)/0.27)*0.7;
  if(born<0.0 || tick<age) { alpha=0.0; }
  // Validity applies to the WHOLE segment, including a missing newer endpoint.
  let newer=history[(i*3u+e)*RING+(max(tick,segment)-segment)%RING];
  let older=history[(i*3u+e)*RING+(max(tick,segment+1u)-segment-1u)%RING];
  let newerBirth=select(newer.w,view.clock.x,segment==0u && view.clock.w>0.5);
  if(older.w<0.0 || newerBirth<0.0 || tick<segment+1u || newerBirth<older.w || newerBirth-older.w>0.034) { alpha=0.0; }
  var out: Vertex; out.clip=project(p); out.color=vec4<f32>(color(s)*alpha,alpha); return out;
}
fn fieldViewOrigin()->vec3<f32>{return body(1u,view.clock.x,view.config.x).xyz;}
${densityDrawing(FLIGHT_GRID_SIDE,FLIGHT_CELL_SIZE)}
@vertex fn planet(@builtin(vertex_index) v: u32,@builtin(instance_index) i: u32) -> Vertex {
  let corner=array<vec2<u32>,6>(vec2<u32>(0,0),vec2<u32>(1,0),vec2<u32>(0,1),vec2<u32>(1,0),vec2<u32>(1,1),vec2<u32>(0,1));
  let cell=v/6u; let uv=(vec2<f32>(f32(cell%64u),f32(cell/64u))+vec2<f32>(corner[v%6u]))/vec2<f32>(64.0,32.0);
  let n=vec3<f32>(sin(uv.y*PI)*cos(uv.x*2.0*PI),cos(uv.y*PI),sin(uv.y*PI)*sin(uv.x*2.0*PI));
  let b=body(i,view.clock.x,view.config.x);
  let colors=array<vec3<f32>,3>(vec3<f32>(1.0,0.65,0.15),vec3<f32>(0.12,0.4,0.5),vec3<f32>(0.4,0.24,0.36));
  let light=select(0.22+0.78*max(0.0,dot(n,unit(SOLAR_ORIGIN-b.xyz))),1.0,i==0u);
  var out:Vertex; out.clip=project(b.xyz+n*b.w);out.color=vec4<f32>(colors[i]*light,1.0);return out;
}
@fragment fn fragment(input: Vertex) -> @location(0) vec4<f32> { return input.color; }
`;
