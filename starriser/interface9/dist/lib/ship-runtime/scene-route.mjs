/** Cached fleet curves in the director tail. Positions, arc and speed use lab units. */
import { TURN_ACCEL_SHARE } from './forward-motion.mjs';
import { SCENE_ROUTE_WORDS } from './route-cache.mjs';
export { packSceneRoute, SCENE_ROUTE_POINTS, SCENE_ROUTE_WORDS } from './route-cache.mjs';
export const sceneRouteBytes = fleets => fleets * SCENE_ROUTE_WORDS * 4;
export const SCENE_ROUTE_DECL = `struct SceneRoute { head:vec4<f32>, info:vec4<f32>, points:array<vec4<f32>,128>, speeds:array<vec2<f32>,128>, bounds:array<vec4<f32>,32>, edits:vec4<f32>, correspondence:array<vec4<f32>,32> }`;

export const SCENE_ROUTE_WGSL = /* wgsl */ `
fn sceneTravelIndex(s:Ship)->u32 {
  return arrayLength(&director.warpOffsets)/2u+director.forms[s.identity.y].head.z+sceneOrdinal(s.identity.x);
}
fn sceneRouteOffset(s:Ship,form:FleetForm,width:f32)->vec3<f32> {
  let head=director.sceneRoutes[s.identity.y].head;let token=u32(head.w);
  if(token!=0u){
    let index=sceneTravelIndex(s);
    if(index<arrayLength(&director.warpOffsets)){
      let captured=director.warpOffsets[index];
      if(u32(captured.w)==token){return captured.xyz;}
    }
    return vec3<f32>(0.0);
  }
  if(form.origin.w>0.0){return capped(warpOffset(s)-form.origin.xyz,width*.5);}
  // The planner starts at the first live heavy representative, not at the
  // original admission-cloud origin. Applying its absolute admission offset
  // again makes every refresh ask that leader to chase a displaced corridor.
  let page=1u-(u32(u.trail.z)&1u);
  for(var k=0u;k<form.head.y;k++){
    if(loadFormPose(page,s.identity.y,k).p.w<.5){continue;}
    let reference=ordinalWarpOffset(s.identity.y,formOrdinal(form,k));
    return capped(warpOffset(s)-reference,width*.5);
  }
  return vec3<f32>(0.0);
}
fn fleetTravelSpeed(s:Ship,limits:vec4<f32>)->f32 {
  if(s.flight.w!=-3.0||s.identity.y>=FORM_FLEETS){return limits.x;}
  if(director.sceneRoutes[s.identity.y].head.x<2.0){return limits.x;}
  let travel=director.fleetTravel[s.identity.y];
  if(travel.center.w<1.0){return min(limits.x,director.sceneRoutes[s.identity.y].head.z);}
  let info=director.sceneRoutes[s.identity.y].info;
  // Progress is computed once by navigation and consumed on the next tick by
  // the fleet reduction. A refreshed route cannot reuse an old arc coordinate.
  if(s.memory.z!=-1.0 || s.memory.y!=info.w || travel.state.w!=info.w){return min(limits.x,travel.direction.w);}
  let lead=s.memory.x-(travel.progress.x+travel.progress.y)*.5;
  let correction=clamp(-lead*.12,-travel.direction.w*.5,max(limits.x*.35,travel.progress.z*.35));
  return clamp(travel.direction.w+correction,min(max(0.0,travel.progress.z*.005),limits.x),limits.x);
}
fn fleetTravelLimits(s:Ship,limits:vec4<f32>)->vec4<f32> {
  return vec4<f32>(fleetTravelSpeed(s,limits),limits.yzw);
}
fn fleetAligning(s:Ship)->bool {
  return s.flight.w==-3.0 && director.sceneRoutes[s.identity.y].head.x>=2.0 && director.fleetTravel[s.identity.y].state.y<.5;
}

// Two-level nearest-segment query: 16 cheap block bounds, then only blocks
// closer than the current best. No spline evaluation or planet search per ship.
fn sceneRouteClosest(fleet:u32,p:vec3<f32>)->f32 {
  let count=u32(director.sceneRoutes[fleet].head.x);
  var best=1e30;var arc=0.0;
  for(var block=0u;block*8u+1u<count;block++){
    let lo=director.sceneRoutes[fleet].bounds[block*2u].xyz;
    let hi=director.sceneRoutes[fleet].bounds[block*2u+1u].xyz;
    let error=p-clamp(p,lo,hi);if(dot(error,error)>best){continue;}
    for(var i=block*8u;i<min(block*8u+8u,count-1u);i++){
      let a=director.sceneRoutes[fleet].points[i];let b=director.sceneRoutes[fleet].points[i+1u];
      let delta=b.xyz-a.xyz;let t=clamp(dot(p-a.xyz,delta)/max(dot(delta,delta),1e-10),0.0,1.0);
      let e=p-mix(a.xyz,b.xyz,t);let d=dot(e,e);
      if(d<best){best=d;arc=mix(a.w,b.w,t);}
    }
  }
  return arc;
}
fn sceneRouteWrappedArc(fleet:u32,arc:f32)->f32 {
  let info=director.sceneRoutes[fleet].info;
  if(info.y>=0.0||arc<info.x){return arc;}
  let start=-info.y-1.0;let period=max(.000001,info.x-start);
  return start+(arc-start)-floor((arc-start)/period)*period;
}
fn sceneRouteNearArc(fleet:u32,arc:f32,previous:f32)->f32 {
  let info=director.sceneRoutes[fleet].info;let start=-info.y-1.0;
  if(info.y>=0.0||arc<start||previous<start){return arc;}
  let period=max(.000001,info.x-start);
  return arc+max(0.0,round((previous-arc)/period))*period;
}
fn sceneRoutePrevious(s:Ship)->f32 {
  let fleet=s.identity.y;
  if(s.memory.z!=-1.0){return 0.0;}
  if(s.memory.y==director.sceneRoutes[fleet].info.w){return s.memory.x;}
  var found=false;var arc=s.memory.x;
  let count=min(32u,u32(director.sceneRoutes[fleet].edits.x));
  for(var editIndex=0u;editIndex<count;editIndex++){
    let edit=director.sceneRoutes[fleet].correspondence[editIndex];
    found=found||edit.x==s.memory.y;
    if(!found||arc<=edit.y){continue;}
    let fraction=clamp((arc-edit.y)/(edit.z-edit.y),0.0,1.0);
    arc=mix(edit.y,edit.w,fraction)+max(0.0,arc-edit.z);
  }
  return select(0.0,arc,found);
}
fn sceneRouteProgress(s:Ship,p:vec3<f32>,speed:f32)->f32 {
  let fleet=s.identity.y;let head=director.sceneRoutes[fleet].head;let info=director.sceneRoutes[fleet].info;
  if(info.y>0.0){return sceneRouteClosest(fleet,p);}
  let previous=sceneRoutePrevious(s);
  if(s.memory.z!=-1.0||(s.memory.y!=info.w&&previous==0.0)){return 0.0;}
  // Reacquire only a reachable arc neighborhood. A crossing elsewhere in the
  // authored path cannot become the next leg just because it is spatially near.
  let reach=max(.025,speed*max(.1,u.clock.y*4.0));
  let low=max(0.0,previous-reach*.25);let high=previous+reach;
  var best=1e30;var progress=previous;
  let count=u32(head.x);
  for(var block=0u;block*8u+1u<count;block++){
    let lo=director.sceneRoutes[fleet].bounds[block*2u].xyz;
    let hi=director.sceneRoutes[fleet].bounds[block*2u+1u].xyz;
    let error=p-clamp(p,lo,hi);if(dot(error,error)>best){continue;}
    for(var i=block*8u;i<min(block*8u+8u,count-1u);i++){
      let a=director.sceneRoutes[fleet].points[i];let b=director.sceneRoutes[fleet].points[i+1u];
      let mid=(a.w+b.w)*.5;let lap=sceneRouteNearArc(fleet,mid,previous)-mid;
      let begin=a.w+lap;let end=b.w+lap;
      if(end<low||begin>high){continue;}
      let delta=b.xyz-a.xyz;
      let t=clamp(dot(p-a.xyz,delta)/max(dot(delta,delta),1e-10),0.0,1.0);
      let arc=clamp(mix(begin,end,t),max(begin,low),min(end,high));
      let q=mix(a.xyz,b.xyz,(arc-begin)/max(.000001,end-begin));let e=p-q;let d=dot(e,e);
      if(d<best){best=d;progress=arc;}
    }
  }
  return progress;
}
struct SceneRouteSample { point:vec4<f32>, bend:f32 }
fn sceneRouteSampleAt(fleet:u32,unwrappedArc:f32)->SceneRouteSample {
  let arc=sceneRouteWrappedArc(fleet,unwrappedArc);
  let count=u32(director.sceneRoutes[fleet].head.x);
  var lo=0u;var hi=count-1u;
  // At most seven binary steps for 128 cached samples.
  for(var step=0u;step<7u && hi>lo+1u;step++){
    let mid=(lo+hi)/2u;
    if(director.sceneRoutes[fleet].points[mid].w<arc){lo=mid;}else{hi=mid;}
  }
  let a=director.sceneRoutes[fleet].points[lo];let b=director.sceneRoutes[fleet].points[hi];
  let t=clamp((arc-a.w)/max(b.w-a.w,1e-10),0.0,1.0);
  let profileA=director.sceneRoutes[fleet].speeds[lo];let speedA=profileA.x;
  let profileB=director.sceneRoutes[fleet].speeds[hi];let speedB=profileB.x;
  // Interpolate squared speeds: v² changes linearly with braking distance.
  return SceneRouteSample(vec4<f32>(mix(a.xyz,b.xyz,t),sqrt(mix(speedA*speedA,speedB*speedB,t))),select(profileA.y,profileB.y,profileA.y<arc)+unwrappedArc-arc);
}
fn sceneRouteAt(fleet:u32,arc:f32)->vec4<f32>{return sceneRouteSampleAt(fleet,arc).point;}
struct SceneGuidance { velocity:vec3<f32>, arc:f32, reach:f32 }
fn sceneRouteGuidance(s:Ship,limits:vec4<f32>)->SceneGuidance {
  let fleet=s.identity.y;let head=director.sceneRoutes[fleet].head;
  if(head.x<2.0){return SceneGuidance(vec3<f32>(0.0),0.0,0.0);}
  let offset=sceneRouteOffset(s,director.forms[fleet],head.y);
  let p=s.p.xyz-offset;let arc=sceneRouteProgress(s,p,limits.x);
  let sample=sceneRouteSampleAt(fleet,arc);let here=sample.point;
  // Retain the gentle straight-run rejoin for slow capitals, even from rest.
  // Cached next-bend arc bounds that radius-sized probe before obstacle corners.
  let speed=min(limits.x,here.w);
  let turnReach=speed/max(dynamics(shipType(s)).w*${TURN_ACCEL_SHARE},.00001);
  let accelerationReach=speed*speed/max(limits.y*${TURN_ACCEL_SHARE},.00001);
  let reach=max(head.y*.2,max(turnReach,accelerationReach));
  let bounded=max(.04,sample.bend-arc+min(head.y,1.5)*.4);
  let probe=sceneRouteAt(fleet,arc+min(reach,bounded));
  let goal=director.sceneRoutes[fleet].points[u32(head.x)-1u].xyz;
  let info=director.sceneRoutes[fleet].info;
  // Ordered paths can pass their final position on an earlier leg. Arrival
  // braking must wait for authored progress, not just spatial proximity.
  let remaining=max(length(goal-p),select(0.0,info.x-arc,info.y==0.0));let arrival=max(.02,repelScale(shipType(s))*.3);
  let continues=info.y<0.0;
  let stopping=brakingSpeedAt(s,limits,max(0.0,remaining-arrival),0.0);
  let closing=min(min(limits.x,here.w),select(stopping,limits.x,continues));
  return SceneGuidance(unit(probe.xyz-p)*closing,arc,length(probe.xyz-p));
}
fn sceneRouteVelocity(s:Ship,limits:vec4<f32>)->vec3<f32>{return sceneRouteGuidance(s,limits).velocity;}
`;
