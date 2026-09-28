/** Production scene fleet pilot. One GPU reference per fleet, never a CPU pose.
 * The reference has its own continuous forward motion; measured dispersion
 * cannot throttle it. Physical ships intercept persistent, world-oriented homes.
 * Kept separate from the legacy lab director and its quorum/progress controller.
 */
import {FORM_ORBIT_RATIO} from './formation.mjs';
import {FLEET_ORBIT_WGSL} from './fleet-orbit.mjs';
import {FLEET_DETOUR_WGSL} from './fleet-detour.mjs';
export const FLEET_PILOT_WGSL = /* wgsl */ `
${FLEET_ORBIT_WGSL}
${FLEET_DETOUR_WGSL}
var<workgroup> pilotSums:array<vec4<f32>,64>;
var<workgroup> pilotVelocity:array<vec4<f32>,64>;
var<workgroup> pilotLimits:array<vec4<f32>,64>;
var<workgroup> pilotFirst:array<u32,64>;
var<workgroup> pilotCenter:vec3<f32>;
var<workgroup> pilotToken:f32;
fn pilotMember(fleet:u32,ordinal:u32)->Ship {
  var s:Ship;let form=director.forms[fleet];let index=form.head.z+ordinal;
  if(index>=u32(u.clock.z)){return s;}
  s=old[index];
  if(s.identity.z==0u||s.identity.y!=fleet||sceneOrdinal(s.identity.x)!=ordinal||!admitted(s)||inWarp(s,u.clock.x)){
    s.identity.z=0u;return s;
  }
  // Resolve just this directive, including the warp exit. No pose is written.
  return applyJourney(s,u.clock.x,0.0);
}
fn fleetPilotActive(s:Ship)->bool {
  if(s.identity.y>=FORM_FLEETS||s.flight.w>=0.0||s.flight.w< -3.0){return false;}
  let guide=director.fleetGuides[s.identity.y];
  return guide.status.z>0.0 && guide.ship.flight.w==s.flight.w;
}
fn pilotOffset(s:Ship)->vec3<f32>{
  let form=director.forms[s.identity.y];
  if(s.flight.w==-3.0){
    let head=director.sceneRoutes[s.identity.y].head;
    if(head.x>=2.0){return sceneRouteOffset(s,form,head.y);}
    // Pending/expired caches have width and token zero. Keep the last accepted
    // home instead of collapsing every member onto the center while CPU plans.
    let token=director.fleetGuides[s.identity.y].status.x;
    let captured=director.warpOffsets[sceneTravelIndex(s)];
    if(token>0.0&&captured.w==token){return captured.xyz;}
  }
  return warpOffset(s)-form.origin.xyz;
}
fn pilotReferenceIntent(initial:Ship,limits:vec4<f32>,now:f32)->Ship {
  var s=initial;let fleet=s.identity.y;let journey=journeyFor(s);
  var intent=vec4<f32>(0.0);
  if(s.flight.w==-3.0){
    // Route geometry is shared. Only the reference performs the segment search;
    // members receive a future home instead of projecting independently onto it.
    if(director.sceneRoutes[fleet].head.x>=2.0){
      var query=s;query.p=vec4<f32>(s.p.xyz+sceneRouteOffset(s,director.forms[fleet],director.sceneRoutes[fleet].head.y),s.p.w);
      let guide=sceneRouteGuidance(query,limits);
      s.memory=vec4<f32>(guide.arc,director.sceneRoutes[fleet].info.w,-1.0,0.0);
      intent=vec4<f32>(guide.velocity,guide.reach);
    }
  }else if(s.flight.w==-2.0){
    let delta=journey.exit.xyz-s.p.xyz;
    intent=vec4<f32>(unit(delta)*min(limits.x,brakingSpeedAt(s,limits,length(delta),0.0)),length(delta));
  }else if(journey.range.z>0.0){s=pilotOrbitFrame(s,now);intent=pilotOrbit(s,limits,now);}
  // Retain an explicit aim even from rest so every member starts turning on
  // the same tick. The virtual reference has the same turn/thrust constraints.
  // The reference follows one committed geometric bypass. Its target distance
  // and bend speed now enter the same turn budget as ordinary travel guidance.
  s=pilotDetour(s,intent,limits,now);
  return transportMotion(s,unit(s.aim.xyz)*max(s.aim.w,.02),length(s.aim.xyz),limits,limits.w,u.clock.y,u.clock.y);
}
fn updateFleetPilot(fleet:u32,representative:Ship,center:vec3<f32>,velocity:vec3<f32>,capability:vec4<f32>,count:f32){
  let previous=director.fleetGuides[fleet];var s=previous.ship;
  let head=director.sceneRoutes[fleet].head;
  // Production serials are fleet-lifetime base + logical ordinal. A newly
  // admitted heavier representative must not reset the same fleet's reference.
  let lifetime=s.identity.w-sceneOrdinal(s.identity.x);
  let nextLifetime=representative.identity.w-sceneOrdinal(representative.identity.x);
  let fresh=previous.status.z==0.0||lifetime!=nextLifetime;
  let ordered=representative.flight.w==-3.0;
  let newOrder=ordered && head.x>=2.0 && (previous.status.x!=head.w||s.flight.w!=-3.0);
  let changedJourney=s.flight.x!=representative.flight.x||s.flight.w!=representative.flight.w;
  if(fresh){s=representative;s.p=vec4<f32>(center,0.0);s.positionLow=vec4<f32>(0.0);s.v=vec4<f32>(velocity,0.0);s.a=vec4<f32>(0.0);s.origin=vec4<f32>(0.0);s.memory=vec4<f32>(0.0);}
  if(newOrder){s.p=vec4<f32>(center,0.0);s.positionLow=vec4<f32>(0.0);s.memory=vec4<f32>(0.0);}
  if(fresh||newOrder||changedJourney){s.aux=vec4<f32>(0.0);s.tactic=vec4<f32>(0.0);s.fx=vec4<f32>(0.0);}
  s.identity=representative.identity;s.flight=representative.flight;
  // Explicit nominal cruise leaves reserve for recovery. Neither readiness nor
  // spread nor a delayed CPU observation enters this value.
  let limits=vec4<f32>(capability.x*.8,capability.yz*.8,capability.w*.8);
  s=pilotReferenceIntent(s,limits,u.clock.x);
  let token=select(select(previous.status.x,0.0,fresh),head.w,head.x>=2.0);
  director.fleetGuides[fleet]=FleetGuide(s,limits,vec4<f32>(token,0.0,1.0,0.0));
  // Observation only: preserve the public 64-byte diagnostic record.
  director.fleetTravel[fleet]=FleetTravel(vec4<f32>(s.p.xyz,count),vec4<f32>(unit(s.aim.xyz),length(s.v.xyz)),
    vec4<f32>(s.memory.x,s.memory.x,limits.x,1.0),vec4<f32>(head.w,2.0,0.0,s.memory.y));
}
@compute @workgroup_size(64)
fn clearFormation(@builtin(workgroup_id) wid:vec3<u32>,@builtin(local_invocation_index) lane:u32){
  let fleet=wid.x;if(fleet>=FORM_FLEETS){return;}
  let form=director.forms[fleet];let page=u32(u.trail.z)&1u;
  if(lane<FORM_ANCHORS){let at=formPoseIndex(page,fleet,lane);director.formPoses[at].w=0u;}
  let available=u32(u.clock.z)-min(form.head.z,u32(u.clock.z));let span=min(form.head.w,available);
  var sum=vec4<f32>(0.0);var velocity=vec4<f32>(0.0);var limits=vec4<f32>(1e20);var first=0xffffffffu;
  for(var ordinal=lane;ordinal<span;ordinal+=64u){
    let s=pilotMember(fleet,ordinal);if(s.identity.z==0u){continue;}
    // Timed LocalRoute approaches (mode 1) retain their authored plan/deadline.
    if(s.flight.w>=0.0||s.flight.w< -3.0){continue;}
    let order=groupOrder(groupOf(s));if(order.w==1u&&order.y<2u){continue;}
    sum+=vec4<f32>(s.p.xyz,1.0);velocity+=vec4<f32>(s.v.xyz,0.0);
    let mine=sceneLimits(shipType(s),journeyBodyRadius(s));
    limits=min(limits,vec4<f32>(mine.xyz,dynamics(shipType(s)).w));
    first=min(first,(5u-classIndex(shipType(s)))*65536u+ordinal);
  }
  pilotSums[lane]=sum;pilotVelocity[lane]=velocity;pilotLimits[lane]=limits;pilotFirst[lane]=first;workgroupBarrier();
  for(var stride=32u;stride>0u;stride/=2u){
    if(lane<stride){pilotSums[lane]+=pilotSums[lane+stride];pilotVelocity[lane]+=pilotVelocity[lane+stride];pilotLimits[lane]=min(pilotLimits[lane],pilotLimits[lane+stride]);pilotFirst[lane]=min(pilotFirst[lane],pilotFirst[lane+stride]);}workgroupBarrier();
  }
  if(lane==0u){
    pilotCenter=pilotSums[0].xyz/max(1.0,pilotSums[0].w);pilotToken=director.sceneRoutes[fleet].head.w;
    if(pilotFirst[0]==0xffffffffu){director.fleetGuides[fleet].status.z=0.0;director.fleetTravel[fleet].center.w=0.0;}
  }workgroupBarrier();
  // Capture once per accepted order. Append/revalidation retains the token;
  // packing preserves these fleet-local offsets independently of GPU indices.
  for(var ordinal=lane;ordinal<span;ordinal+=64u){
    let s=pilotMember(fleet,ordinal);if(s.identity.z==0u){continue;}
    capturePilotRing(s);
    if(s.flight.w!=-3.0||pilotToken==0.0){continue;}
    let at=sceneTravelIndex(s);
    if(director.warpOffsets[at].w!=pilotToken){director.warpOffsets[at]=vec4<f32>(s.p.xyz-pilotCenter,pilotToken);}
  }
  storageBarrier();workgroupBarrier();
  if(lane==0u&&pilotFirst[0]!=0xffffffffu){
    let representative=pilotMember(fleet,pilotFirst[0]&65535u);
    updateFleetPilot(fleet,representative,pilotCenter,pilotVelocity[0].xyz/pilotSums[0].w,pilotLimits[0],pilotSums[0].w);
  }
}
fn pilotTransitGuidance(initial:Ship,limits:vec4<f32>)->NavigationResult {
  var s=initial;let fleet=s.identity.y;let form=director.forms[fleet];let guide=director.fleetGuides[fleet];let reference=guide.ship;
  s.memory=vec4<f32>(reference.memory.xyz,s.memory.w);
  let home=reference.p.xyz+pilotOffset(s);let error=home-s.p.xyz;
  let velocity=reference.v.xyz;let pace=length(velocity);
  let quiet=max(.02,repelScale(shipType(s))*.5);
  // Arrival (or a temporarily empty route) stops the reference, not recovery.
  // Without a travel axis, use a braking-aware local home approach instead of
  // multiplying every straggler's speed by a zero along-track error.
  if(pace<.0001&&length(reference.aim.xyz)<.00001){
    let remaining=max(0.0,length(error)-quiet);
    let recover=min(limits.x,min(brakingSpeedAt(s,limits,remaining,0.0),remaining/4.0));
    return NavigationResult(s,unit(error)*recover,max(remaining,.02));
  }
  let forward=select(unit(reference.aim.xyz),unit(velocity),pace>.0001);
  let along=dot(error,forward);let lateral=error-forward*along;
  // At departure the reference can be turning at rest. Keep a heading cue for
  // peers now, so they turn alongside it instead of waiting then turning again.
  let headingCue=select(0.0,min(.004,limits.x),length(reference.aim.xyz)>.00001);
  let speed=clamp(pace+along/8.0,headingCue,limits.x);
  let lead=clamp(length(s.v.xyz)/max(dynamics(shipType(s)).w,.001)*.2,2.0,12.0);
  var future=home+velocity*lead-capped(lateral,quiet);
  let reach=max(pace*lead,repelScale(shipType(s))*4.0);
  // Ahead ships slow down without turning back towards a slot behind them.
  if(length(reference.aim.xyz)>.00001){future+=forward*max(0.0,reach-dot(future-s.p.xyz,forward));}
  future=pilotMemberDetour(s,future);
  // Preserve the familiar small-escort orbit, but acquire the translated home
  // while far away. A distant/stopped representative cannot strand an escort.
  let mine=classIndex(shipType(s));let small=mine<form.head.x&&repelOfClass(form.head.x)>=repelScale(shipType(s))*${FORM_ORBIT_RATIO}.0;
  if(small&&s.flight.w!=-3.0){
    let orbital=formationSteer(s,vec3<f32>(0.0),limits);
    let arrival=select(0.0,reference.aux.z,s.flight.w==-1.0);
    let acquisition=max(arrival,1.0-smoothstep(max(.2,form.origin.w),max(.4,form.origin.w*2.0),length(error)));
    let desired=mix(unit(future-s.p.xyz)*speed,orbital,acquisition);
    return NavigationResult(s,desired,max(length(future-s.p.xyz),.02));
  }
  return NavigationResult(s,unit(future-s.p.xyz)*speed,max(length(future-s.p.xyz),.02));
}
fn fleetPilotGuidance(initial:Ship,limits:vec4<f32>)->NavigationResult {
  var s=initial;
  let form=director.forms[s.identity.y];let reference=director.fleetGuides[s.identity.y].ship;
  let small=classIndex(shipType(s))<form.head.x&&repelOfClass(form.head.x)>=repelScale(shipType(s))*${FORM_ORBIT_RATIO}.0;
  // Transit is one coherent cloud. Holding is deliberately a different shape:
  // independent planetary rings for the core, anchor orbits for small escorts.
  if(s.flight.w!=-1.0||reference.aux.z<=0.0||small){return pilotTransitGuidance(s,limits);}
  s.memory=vec4<f32>(reference.memory.xyz,s.memory.w);
  let blend=smoothstep(0.0,1.0,reference.aux.z);let ring=pilotIndividualOrbit(s,limits,blend);
  let point=pilotMemberDetour(s,s.p.xyz+unit(ring.xyz)*ring.w);
  let velocity=unit(point-s.p.xyz)*length(ring.xyz);
  if(blend>=1.0){return NavigationResult(s,velocity,ring.w);}
  let transit=pilotTransitGuidance(s,limits);
  return NavigationResult(s,mix(transit.velocity,velocity,blend),mix(transit.reach,ring.w,blend));
}
`;
