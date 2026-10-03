import {PILOT_WORK_BUDGET} from './bounded-pilot.mjs';
import {PERCEPTION_POLICY_WGSL} from './perception-policy.mjs';
/** GPU perception runs every 1/2/8 simulation ticks, staggered by persistent ship identity.
 * The physical controller still runs each tick. Advice contains forces and a
 * velocity preference, never a pose, route progress or a CPU observation.
 */
export const PILOT_PREDICTION_WGSL = /* wgsl */ `
${PERCEPTION_POLICY_WGSL}
fn pilotManaged(s:Ship)->bool {
  let order=groupOrder(groupOf(s));
  return fleetPilotActive(s)&&!(order.w==1u&&order.y<2u);
}
fn pilotPeriod(s:Ship,i:u32)->u32 {
  // Missing projection (standalone fixtures) conservatively uses full quality.
  if(u.pilotView.x<=0.0||i32(i)==i32(u.pilotView.z)){return 1u;}
  let clip=u.pilotMatrix*vec4<f32>(s.p.xyz*u.pilotView.y-u.pilotOrigin.xyz,1.0);
  let visible=clip.w>0.0&&all(abs(clip.xy)<vec2<f32>(clip.w*1.1));
  let pixels=u.pilotView.x*classVisual(shipType(s))/max(abs(clip.w),.000001);
  let previous=director.pilotAdvice[i];
  let valid=previous.state.x==s.identity.w&&previous.state.y==bitcast<u32>(s.flight.x)&&all(previous.stamp==pilotStamp(s));
  return perceptionPeriod(select(0.0,pixels,visible),select(0u,previous.state.w,valid));
}
fn pilotStamp(s:Ship)->vec4<f32>{
  return vec4<f32>(s.flight.w,director.sceneRoutes[s.identity.y].info.w,u.pilotOrigin.w,
    f32(shipType(s))+u.warp.y*32.0+u.warp.z*64.0);
}
fn pilotDue(s:Ship,i:u32)->bool {
  let previous=director.pilotAdvice[i];let period=pilotPeriod(s,i);let tick=pilotTick();
  if(previous.state.x!=s.identity.w||previous.state.y!=bitcast<u32>(s.flight.x)||any(previous.stamp!=pilotStamp(s))){return true;}
  if(period<previous.state.w){return true;}
  if(tick==previous.state.z){return false;}
  if(tick-previous.state.z>=period){return true;}
  return (tick+s.identity.w)%period==0u;
}
@compute @workgroup_size(128)
fn predictPilots(@builtin(global_invocation_id) gid:vec3<u32>){
  if(gid.x>=min(atomicLoad(&director.pilotDispatch[3]),${PILOT_WORK_BUDGET}u)){return;}
  let i=director.pilotWork[gid.x];let s=applyJourney(old[i],u.clock.x,u.clock.y);
  var advice=director.pilotAdvice[i];
  if(advice.state.x!=s.identity.w||advice.state.y!=bitcast<u32>(s.flight.x)||any(advice.stamp!=pilotStamp(s))){advice=PilotAdvice();}
  let period=pilotPeriod(s,i);let limits=sceneLimits(shipType(s),journeyBodyRadius(s));
  var desired=s.v.xyz;
  if(pilotManaged(s)){desired=fleetPilotGuidance(s,limits).velocity;}
  let context=contactContext(s);var contacts:PilotContacts;
  if(pressureEnabled()!=0.0){contacts=collectPilotContacts(s,i,&advice,period,context);}
  var push=vec3<f32>(0.0);var urgency=0.0;
  for(var k=0u;k<contacts.count;k++){push+=contacts.responses[k].xyz;urgency=max(urgency,contacts.responses[k].w);}
  let factor=pilotRecoveryFactor(s);let gain=sqrt(factor);
  let prediction=vec4<f32>(limits.x*gain,limits.y*factor,limits.z*factor*gain,limits.w);
  choosePilotManeuver(s,desired,prediction,contacts,&advice,period);
  advice.state=vec4<u32>(s.identity.w,bitcast<u32>(s.flight.x),pilotTick(),period);
  advice.stamp=pilotStamp(s);advice.spacing=vec4<f32>(contactAccelerationWith(push,context),urgency);
  advice.broad=vec4<f32>(pressure(s),advice.broad.w);
  director.pilotAdvice[i]=advice;
}
struct PilotSteering {velocity:vec3<f32>,force:vec3<f32>,spacing:vec4<f32>,avoid:vec3<f32>,broad:vec3<f32>,clearance:f32}
fn pilotSteering(s:Ship,i:u32,now:f32,limits:vec4<f32>,guidance:NavigationResult)->PilotSteering {
  let advice=director.pilotAdvice[i];
  let valid=advice.state.x==s.identity.w&&advice.state.y==bitcast<u32>(s.flight.x)&&all(advice.stamp==pilotStamp(s));
  let spacing=select(vec4<f32>(0.0),advice.spacing,valid);
  let choice=select(1u,u32(advice.correction.w),valid);
  let desired=capped(pilotManeuver(guidance.velocity,choice,advice.correction.x),limits.x*sqrt(pilotRecoveryFactor(s)));
  // Planet safety is inexpensive (four fleet-sticky bodies) and remains at
  // physical frequency even when subpixel ship contacts run every eight ticks.
  let obstacle=bodyAvoidance(s,now);let avoid=obstacle.xyz;
  let broad=select(vec3<f32>(0.0),advice.broad.xyz,valid);
  var force=(desired-s.v.xyz)*2.0+broad;
  force=mix(force+spacing.xyz,spacing.xyz,spacing.w*.95);
  let priority=clamp(length(avoid)/max(limits.y,.0001),0.0,1.0);
  force=mix(force+avoid,avoid,priority);
  return PilotSteering(desired,force,spacing,avoid,broad,obstacle.w);
}
struct PilotExpectation {ship:Ship,error:vec3<f32>,velocity:vec3<f32>,orbit:bool}
fn pilotExpectation(initial:Ship,limits:vec4<f32>,now:f32,dt:f32)->PilotExpectation {
  var s=initial;let guide=director.fleetGuides[s.identity.y];let reference=guide.ship;
  // memory.w is a duration fraction, never an epoch timestamp. Its owner is
  // this local pilot; a new command/combat handoff must not inherit capture.
  if(s.tactic.x>=0.0||s.aim.x!=s.flight.x||s.aim.y!=guide.status.x||(s.aim.z!=0.0&&s.aim.z!=s.flight.w)){
    s.memory.w=0.0;s.fx.z=0.0;s.aux.y=0.0;s.aux.z=0.0;
  }
  s.aim.w=1.0;
  if(!pilotCoreOrbit(s)){
    s.memory.w=0.0;
    return PilotExpectation(s,pilotRelativePosition(s,reference)+pilotOffset(s),reference.v.xyz,false);
  }
  let index=u32(journeyFor(s).range.z)-1u;let planet=body(index,now,u.control.x);
  let ring=pilotRingCapture(s);
  let ringGoal=pilotRingTarget(s,planet.xyz,bodyVelocity(index,now,u.control.x),ring.xyz,vec4<f32>(limits.xyz,dynamics(shipType(s)).w));
  s.memory.w=pilotCaptureProgress(s,ringGoal,limits,s.memory.w,dt);
  s.aim.w=pilotRingDemand(s,ringGoal,limits,pilotArrivalWindow(s,now));
  return PilotExpectation(s,ringGoal.error,ringGoal.velocity,true);
}
fn pilotPhysical(initial:Ship,i:u32,now:f32,dt:f32,controlDt:f32,limits:vec4<f32>)->Ship {
  capturePilotRing(initial);
  if(initial.flight.w==-3.0){
    let capture=director.pilotFleetCache[initial.identity.y].capture;let at=sceneTravelIndex(initial);
    if(capture.w>0.0&&director.warpOffsets[at].w!=capture.w){director.warpOffsets[at]=vec4<f32>(initial.p.xyz-capture.xyz,capture.w);}
  }
  let expectation=pilotExpectation(initial,limits,now,dt);
  let tracking=fleetPilotGuidance(expectation.ship,limits);
  // Test the moving home/ring, not a short local probe that cannot yet see the
  // obstructed leg. Guidance supplies the motor cue; bypass has safety priority.
  let goal=expectation.ship.p.xyz+expectation.error+expectation.velocity*.5;
  let guidance=pilotMemberBypass(tracking,goal,limits,now);var s=guidance.ship;
  s.aux.x=0.0;s.a.w=0.0;
  let intent=pilotSteering(s,i,now,limits,guidance);
  let reference=director.fleetGuides[s.identity.y].ship;
  let error=expectation.error;
  let enabled=pilotRecoveryEnabled(s,error);
  // Danger uses normal capability; turbo must never weaken obstacle priority.
  let bodyDanger=clamp(length(intent.avoid)/max(limits.y,.0001),0.0,1.0);
  let danger=max(intent.spacing.w,bodyDanger);
  let steering=s.v.xyz+intent.force*.5;
  let blocked=danger>.25||s.fx.z>0.0;
  s=pilotAssessRecovery(s,error,expectation.velocity-s.v.xyz,steering,blocked,enabled,now);
  let forward=rotate(s.q,vec3<f32>(0.0,0.0,1.0));
  let braking=max(0.0,-dot(intent.spacing.xyz+intent.avoid,forward));
  let cruise=length(intent.velocity);
  let wanted=mix(cruise,min(cruise,max(0.0,length(s.v.xyz)-braking*.5)),danger*f32(braking>0.0));
  // Predictive danger is not an immediate contact. Use actual shell clearance
  // for turn/brake reach, not the peer contact radius.
  let reach=min(guidance.reach,intent.clearance);
  let acceleration=select(vec3<f32>(0.0),reference.a.xyz,enabled&&!blocked&&!expectation.orbit);
  s=pilotRecoveryMotion(s,steering,wanted,reach,limits,dynamics(shipType(s)).w,acceleration,enabled,dt,controlDt);
  s=correctShipPosition(s,separateFromBodies(s,now));
  // Combat presentation reuses aim.w for braking glow. The local pilot owns
  // this lane as cached arrival capability until its explicit combat handoff.
  let reserve=s.aim.w;s=combatPresentation(s,now,dt);s.aim.w=reserve;
  return s;
}
`;
