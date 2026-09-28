import {PERCEPTION_POLICY_WGSL} from './perception-policy.mjs';
/** GPU perception runs at 30/10/1 Hz, staggered by persistent ship identity.
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
  if(!pilotManaged(s)){return true;}
  let previous=director.pilotAdvice[i];let period=pilotPeriod(s,i);let tick=selectionTick(u.clock.x);
  if(previous.state.x!=s.identity.w||previous.state.y!=bitcast<u32>(s.flight.x)||any(previous.stamp!=pilotStamp(s))){return true;}
  if(period<previous.state.w){return true;}
  if(tick==previous.state.z){return false;}
  if(tick-previous.state.z>=period){return true;}
  return (tick+s.identity.w)%period==0u;
}
@compute @workgroup_size(128)
fn predictPilots(@builtin(global_invocation_id) gid:vec3<u32>){
  let i=gid.x;if(i>=u32(u.clock.z)){return;}
  let s=applyJourney(old[i],u.clock.x,u.clock.y);
  if(!admitted(s)||s.identity.z==0u||inWarp(s,u.clock.x)||!pilotManaged(s)||!pilotDue(s,i)){return;}
  let limits=sceneLimits(shipType(s),journeyBodyRadius(s));
  let guidance=fleetPilotGuidance(s,limits);
  let spacing=neighborSeparation(s,i);
  let chosen=pilotChooseVelocity(s,i,guidance.velocity,limits,spacing.w);
  var advice:PilotAdvice;
  advice.state=vec4<u32>(s.identity.w,bitcast<u32>(s.flight.x),selectionTick(u.clock.x),pilotPeriod(s,i));
  advice.stamp=pilotStamp(s);
  advice.correction=vec4<f32>(chosen-guidance.velocity,1.0);
  advice.spacing=spacing;
  // Fine capital avoidance uses the same indexed contact radii as other ships.
  // The former all-capital scan was N ships x every capital in the scene.
  // Hull-volume density supplies the coarse pressure beyond that neighbourhood.
  advice.broad=vec4<f32>(pressure(s),0.0);
  director.pilotAdvice[i]=advice;
}
struct PilotSteering {velocity:vec3<f32>,force:vec3<f32>,spacing:vec4<f32>,avoid:vec3<f32>,broad:vec3<f32>}
fn pilotSteering(s:Ship,i:u32,now:f32,limits:vec4<f32>,guidance:NavigationResult)->PilotSteering {
  let advice=director.pilotAdvice[i];
  let valid=advice.state.x==s.identity.w&&advice.state.y==bitcast<u32>(s.flight.x)&&all(advice.stamp==pilotStamp(s));
  let spacing=select(vec4<f32>(0.0),advice.spacing,valid);
  let correction=select(vec3<f32>(0.0),advice.correction.xyz,valid);
  let desired=capped(guidance.velocity+correction,limits.x);
  // Planet safety is inexpensive (four fleet-sticky bodies) and remains at
  // physical frequency even when subpixel ship contacts run at 1 Hz.
  let avoid=avoidBodies(s,now);
  let broad=select(vec3<f32>(0.0),advice.broad.xyz,valid);
  var force=(desired-s.v.xyz)*2.0+broad;
  force=mix(force+spacing.xyz,spacing.xyz,spacing.w*.95);
  let priority=clamp(length(avoid)/max(limits.y,.0001),0.0,1.0);
  force=mix(force+avoid,avoid,priority);
  return PilotSteering(desired,force,spacing,avoid,broad);
}
fn pilotPhysical(initial:Ship,i:u32,now:f32,dt:f32,controlDt:f32,limits:vec4<f32>)->Ship {
  let guidance=fleetPilotGuidance(initial,limits);var s=guidance.ship;
  s.aux.x=0.0;s.a.w=0.0;
  let intent=pilotSteering(s,i,now,limits,guidance);
  s=localFlightMotion(s,intent.velocity,intent.force,guidance.reach,false,intent.spacing,intent.avoid,limits,dynamics(shipType(s)).w,dt,controlDt);
  s=correctShipPosition(s,separateFromBodies(s,now));
  return combatPresentation(s,now,dt);
}
`;
