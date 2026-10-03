import {SCENE_TRAVEL_ADAPT} from './flight-layout.mjs';
import {TURN_ACCEL_SHARE,STEERING_RESPONSE_SECONDS} from './forward-motion.mjs';
import {ANGULAR_RAMP_SECONDS} from './angular-motion.mjs';
import {CONTACT_PADDING} from './force-clearance.mjs';

// Broad occupancy and short-range contacts have different jobs. Hash contacts
// cover unbounded fixture coordinates; collisions in the hash are filtered by
// actual cell coordinates. Work is capped even for completely coincident fleets.
export const GRID_SIDE=64;
export const GRID_CELLS=GRID_SIDE**3;
export const HASH_BUCKETS=32768;
export const CONTACT_CELL_SIZE=4;
// A compact Colossus needs about six seconds to brake from authored cruise.
// The spatial stencil still clamps each pair's horizon to its covered distance;
// this extends anticipation without increasing buckets, storage or query work.
export const CONTACT_HORIZON_SECONDS=8;
export const SPACING_WGSL=/* wgsl */`
struct Contact {p:vec3<f32>,radius:f32,v:vec3<f32>,fleet:u32,cell:vec3<i32>,kind:u32,serial:u32,targetHandle:f32,slot:u32,nextHandle:u32}
@group(0) @binding(6) var<storage,read_write> heads:array<atomic<u32>>;
@group(0) @binding(7) var<storage,read_write> links:array<u32>;
const CONTACT_CELL_SIZE:f32=${CONTACT_CELL_SIZE}.0;
const CONTACT_HORIZON_SECONDS:f32=${CONTACT_HORIZON_SECONDS};
fn contactCell(p:vec3<f32>)->vec3<i32>{return vec3<i32>(floor(p/CONTACT_CELL_SIZE));}
fn contactBucket(c:vec3<i32>)->u32 {
  return hash((bitcast<u32>(c.x)*73856093u)^(bitcast<u32>(c.y)*19349663u)^(bitcast<u32>(c.z)*83492791u))%32768u;
}
fn pairDirection(a:u32,b:u32)->vec3<f32> {
  let key=hash((min(a,b)*1664525u)^(max(a,b)*1013904223u));
  let direction=unit(vec3<f32>(variation(key)-.5,variation(key+1u)-.5,variation(key+2u)-.5));
  return direction*select(-1.0,1.0,a>b);
}
// The search stencil covers one cell width. Bounded sampling is best effort;
// prediction must not pretend it observed contacts beyond that distance.
fn contactHorizon(relativeSpeed:f32,clearance:f32,requested:f32)->f32 {
  return min(requested,max(0.0,CONTACT_CELL_SIZE-clearance)/max(relativeSpeed,.00001));
}
fn contactClosest(gap:vec3<f32>,relative:vec3<f32>,horizon:f32)->vec4<f32> {
  let seconds=clamp(-dot(gap,relative)/max(dot(relative,relative),.00000001),0.0,horizon);
  return vec4<f32>(gap+relative*seconds,seconds);
}
fn contactPassingSide(a:u32,b:u32,relative:vec3<f32>)->vec3<f32> {
  let axis=unit(relative);let chosen=pairDirection(a,b);
  var side=chosen-axis*dot(chosen,axis);
  if(dot(side,side)<.00001){
    let basis=select(vec3<f32>(1.0,0.0,0.0),vec3<f32>(0.0,1.0,0.0),abs(axis.x)>.8);
    side=(basis-axis*dot(basis,axis))*select(-1.0,1.0,a>b);
  }
  return unit(side);
}
fn contactLateral(gap:vec3<f32>,relative:vec3<f32>,clearance:f32,a:u32,b:u32)->vec3<f32> {
  let axis=unit(relative);let miss=gap-axis*dot(gap,axis);
  let stable=contactPassingSide(a,b,relative);
  // Tiny signed misses must not make a head-on pair switch sides every tick.
  let blend=smoothstep(clearance*.25,clearance*.75,length(miss));
  let direction=mix(stable,unit(miss),blend);
  return select(stable,unit(direction),dot(direction,direction)>.00001);
}
fn contactLinearAcceleration(s:Ship)->f32 {
  // Same linear scale as sceneLimits; the legacy flight laboratory shares the
  // contact module but has no sceneLimits function (its body radius is 45).
  let adapt=sceneAdapt(journeyBodyRadius(s));
  return dynamics(shipType(s)).y*select(${SCENE_TRAVEL_ADAPT},adapt,adapt>=.99);
}
struct ContactContext {radius:f32,padding:f32,acceleration:f32,lateral:f32,speed:f32,forward:vec3<f32>}
fn contactContext(s:Ship)->ContactContext {
  let typeId=shipType(s);let bodyRadius=journeyBodyRadius(s);
  let acceleration=contactLinearAcceleration(s);let speed=length(s.v.xyz);
  let lateral=max(.0001,min(${TURN_ACCEL_SHARE}*acceleration,max(speed,.1)*dynamics(typeId).w));
  return ContactContext(repelRadius(typeId,bodyRadius),${CONTACT_PADDING}*sceneAdapt(bodyRadius),acceleration,lateral,speed,s.v.xyz/max(speed,1e-20));
}
fn contactPredictiveShare(s:Ship,t:Contact,mineRadius:f32)->f32 {
  // Cooperative local traffic: small escorts yield to a heavy moving anchor.
  // Equal peers retain their reciprocal response. This is steering priority,
  // not physical mass, and never discounts an already overlapping pair.
  if(s.flight.w>=0.0||s.identity.y!=t.fleet){return 1.0;}
  let mine=max(mineRadius,.0001);
  let other=max(t.radius,.0001);
  let mineVolume=mine*mine*mine;let otherVolume=other*other*other;
  return min(1.0,2.0*otherVolume/(mineVolume+otherVolume));
}
fn contactPush(s:Ship,t:Contact)->vec4<f32> {return contactPushWith(s,t,contactContext(s));}
fn contactPushWith(s:Ship,t:Contact,context:ContactContext)->vec4<f32> {
  let gap=s.p.xyz-t.p;let distance=length(gap);let relative=s.v.xyz-t.v;
  let clearance=context.radius+t.radius+context.padding;
  let acceleration=context.acceleration;let lateral=context.lateral;
  let response=clamp(${ANGULAR_RAMP_SECONDS}+sqrt(2.0*clearance/lateral),.4,CONTACT_HORIZON_SECONDS);
  let closest=contactClosest(gap,relative,contactHorizon(length(relative),clearance,response));
  // Existing overlap already has a radial response below. Only additional
  // predicted penetration asks for anticipatory acceleration; otherwise tiny
  // inward drift inside soft padding turns its existing overlap into urgency 1.
  let missing=max(0.0,min(clearance,distance)-length(closest.xyz));
  let overlap=clamp((clearance-distance)/max(clearance*.6,.01),0.0,1.0);
  if(missing<=0.0&&overlap<=0.0){return vec4<f32>(0.0);}
  // Reciprocal peers each take half the displacement. Caps remain best effort:
  // fast ships/slow hulls can need more distance than this local stencil owns.
  let required=missing/max(closest.w*closest.w,.01);
  let predicted=clamp(required/lateral,0.0,1.0)*f32(dot(gap,relative)<0.0)*contactPredictiveShare(s,t,context.radius);
  let radial=select(pairDirection(s.identity.w,t.serial),gap/max(distance,.00001),distance>.00001);
  let side=contactLateral(gap,relative,clearance,s.identity.w,t.serial);
  let brake=clamp((required-lateral)/max(acceleration,.0001),0.0,1.0)*predicted;
  let push=side*predicted+radial*overlap-context.forward*brake;
  return vec4<f32>(capped(push,1.0),max(predicted,overlap));
}
fn contactAcceleration(s:Ship,push:vec3<f32>)->vec3<f32> {return contactAccelerationWith(push,contactContext(s));}
fn contactAccelerationWith(push:vec3<f32>,context:ContactContext)->vec3<f32> {
  let force=capped(push,1.0)*context.acceleration;
  // The locomotion steering target is v + force * .5. Multiple contacts may
  // brake to zero, but may not request reverse thrust through their sum.
  let speed=context.speed;let forward=context.forward;
  let longitudinal=dot(force,forward);
  return (force-forward*longitudinal)+forward*max(longitudinal,-speed/${STEERING_RESPONSE_SECONDS});
}
fn serialSeparation(s:Ship,i:u32)->vec4<f32> {
  if(pressureEnabled()==0.0){return vec4<f32>(0.0);}
  let center=contactCell(s.p.xyz);var push=vec3<f32>(0.0);var urgency=0.0;
  for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
    let c=center+vec3<i32>(x,y,z);var handle=firstContact(contactBucket(c));
    for(var visit=0u;visit<64u&&handle>0u;visit++) {
      let other=loadContact(handle-1u);handle=other.nextHandle;if(other.slot==i){continue;}
      if(any(other.cell!=c)){continue;}
      let response=contactPush(s,other);push+=response.xyz;urgency=max(urgency,response.w);
    }
  }}}
  return vec4<f32>(contactAcceleration(s,push),urgency);
}
`;
