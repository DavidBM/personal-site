import {OBSTACLE_PADDING,OBSTACLE_SOFT_REACH} from './force-clearance.mjs';

/** Bounded fleet-level geometric guidance. Physical ships still own safety and
 * their poses. A committed passing plane prevents successive ticks/members from
 * choosing opposite sides of the same planet. This is not a global route solver. */
export const FLEET_DETOUR_WGSL=/* wgsl */`
fn pilotBodyShell(s:Ship,sphere:vec4<f32>)->f32{
  let adapt=sceneAdapt(max(sphere.w,.02));
  let hull=sphere.w+sceneHull(shipType(s),sphere.w)+${OBSTACLE_PADDING}*adapt;
  return select(hull,max(sphere.w*3.0,hull),adapt<.99);
}
fn pilotSegmentDistance(p:vec3<f32>,goal:vec3<f32>,center:vec3<f32>)->f32{
  let delta=goal-p;let along=clamp(dot(center-p,delta)/max(dot(delta,delta),.000001),0.0,1.0);
  return length(p+delta*along-center);
}
fn pilotDetourBlocks(position:vec3<f32>,goal:vec3<f32>,sphere:vec4<f32>,hysteresis:f32)->bool{
  let radial=position-sphere.xyz;
  let outside=length(radial)>=sphere.w-max(.0001,sphere.w*.00001);
  // A tangent/outward ray on the bypass boundary has its nearest point at the
  // ray's origin. Testing only an inflated radius retains that obstacle forever
  // and turns the bypass into an endless orbit. Release at the forward exit.
  if(outside&&dot(goal-position,radial)>=0.0){return false;}
  return pilotSegmentDistance(position,goal,sphere.xyz)<sphere.w*hysteresis;
}
fn pilotDetourPlane(s:Ship,center:vec3<f32>,goal:vec3<f32>)->vec3<f32>{
  let radial=unit(s.p.xyz-center);let desired=unit(goal-s.p.xyz);
  var plane=cross(radial,desired);
  // Collinear approaches have two equal routes. Choose once by fleet lifetime;
  // the fallback is not a frame-dependent noise or individual ship decision.
  if(length(plane)<.001){
    plane=cross(radial,vec3<f32>(0.0,1.0,0.0));
    if(length(plane)<.001){plane=cross(radial,vec3<f32>(1.0,0.0,0.0));}
    if(((s.identity.w-sceneOrdinal(s.identity.x))&8192u)!=0u){plane=-plane;}
  }
  return unit(plane);
}
fn pilotDetourPoint(position:vec3<f32>,center:vec3<f32>,radius:f32,plane:vec3<f32>)->vec3<f32>{
  let delta=position-center;let distance=length(delta);
  let radial=select(vec3<f32>(1.0,0.0,0.0),unit(delta),distance>.00001);
  var tangent=unit(cross(plane,radial));
  if(length(tangent)<.001){tangent=unit(cross(vec3<f32>(0.0,0.0,1.0),radial));}
  let cosine=min(.955,clamp(radius/max(distance,radius),0.0,1.0));
  return center+radius*(radial*cosine+tangent*sqrt(max(0.0,1.0-cosine*cosine)));
}
fn pilotDetourRadius(s:Ship,sphere:vec4<f32>,index:u32)->f32{
  let shell=pilotBodyShell(s,sphere);let spread=director.forms[s.identity.y].origin.w;
  // A bounded corridor allowance, not the entire admission sphere. Individual
  // contacts handle compression; enormous fleets cannot exclude a whole system.
  // The destination's ring already supplies the holding clearance. Inflating
  // it by a fleet cloud can otherwise make that very ring unreachable forever.
  let destination=s.flight.w==-1.0&&journeyFor(s).range.z==f32(index+1u);
  let corridor=select(min(max(0.0,spread)*.25,shell*.5),0.0,destination);
  return shell+max(.05,${OBSTACLE_SOFT_REACH}*sceneAdapt(sphere.w)+corridor);
}
fn pilotDetourEnvelope(s:Ship,index:u32,now:f32)->vec4<f32>{
  let first=body(index,now,u.control.x);
  var envelope=vec4<f32>(first.xyz,pilotDetourRadius(s,first,index));
  let slots=director.nearby[s.identity.y];var included=0u;
  for(var round=0u;round<3u;round++){
    for(var slot=0u;slot<4u;slot++){
      let other=slots[slot];if(other==0xffffffffu||other==index||(included&(1u<<slot))!=0u){continue;}
      let sphere=body(other,now,u.control.x);if(sphere.w<=0.0){continue;}
      let radius=pilotDetourRadius(s,sphere,other);let delta=sphere.xyz-envelope.xyz;let distance=length(delta);
      if(distance>envelope.w+radius){continue;}
      included|=1u<<slot;
      if(distance+radius<=envelope.w){continue;}
      if(distance+envelope.w<=radius){envelope=vec4<f32>(sphere.xyz,radius);continue;}
      let expanded=(distance+envelope.w+radius)*.5;
      envelope=vec4<f32>(envelope.xyz+unit(delta)*(expanded-envelope.w),expanded);
    }
  }
  // At most three passes close a four-body chain in any slot order. The
  // tangent cannot thread straight through a second planet's inflated shell.
  return envelope;
}
fn pilotBodyRayClear(s:Ship,goal:vec3<f32>,index:u32,now:f32)->bool{
  let sphere=body(index,now,u.control.x);if(sphere.w<=0.0){return true;}
  let safety=pilotBodyShell(s,sphere)+max(.01,${OBSTACLE_SOFT_REACH}*sceneAdapt(sphere.w)*.5);
  return pilotSegmentDistance(s.p.xyz,goal,sphere.xyz)>=safety;
}
fn pilotCanLeaveDetour(s:Ship,goal:vec3<f32>,envelope:vec4<f32>,primary:u32,now:f32)->bool{
  if(dot(goal-s.p.xyz,s.p.xyz-envelope.xyz)<0.0){return false;}
  // The merged envelope is advisory. A lagging controller may be just inside
  // it, so release depends on real constituent clearances, not equality with
  // an ideal circle. Recheck the retained primary even if its CPU slot changed.
  if(!pilotBodyRayClear(s,goal,primary,now)){return false;}
  let slots=director.nearby[s.identity.y];
  for(var slot=0u;slot<4u;slot++){
    let index=slots[slot];if(index==0xffffffffu||index==primary){continue;}
    if(!pilotBodyRayClear(s,goal,index,now)){return false;}
  }
  return true;
}
fn pilotDetour(s:Ship,intent:vec4<f32>,limits:vec4<f32>,now:f32)->Ship{
  var result=s;result.aim=intent;
  if(u.warp.z<.5||length(intent.xyz)<.00001){result.tactic=vec4<f32>(0.0);result.fx=vec4<f32>(0.0);return result;}
  let goal=s.p.xyz+unit(intent.xyz)*max(intent.w,.02);
  // Evaluate all members of the bounded obstacle set at the same future time.
  // Moving only the primary body's envelope would miss relative planet drift.
  let at=now+clamp(intent.w/max(length(intent.xyz),.02),0.0,8.0);
  let slots=director.nearby[s.identity.y];var chosen=0xffffffffu;var best=1e20;
  // Prefer the committed obstacle while its inflated shell blocks the direct
  // future segment. Hysteresis stops grazing configurations changing sides.
  if(s.tactic.w>0.0){
    let index=u32(s.tactic.w)-1u;let sphere=body(index,at,u.control.x);
    let envelope=pilotDetourEnvelope(s,index,at);
    if(pilotCanLeaveDetour(s,goal,envelope,index,at)){
      result.tactic=vec4<f32>(0.0);result.fx=vec4<f32>(0.0);return result;
    }
    if(sphere.w>0.0&&pilotDetourBlocks(s.p.xyz,goal,envelope,1.08)){chosen=index;}
  }
  if(chosen==0xffffffffu){
    for(var slot=0u;slot<4u;slot++){
      let index=slots[slot];if(index==0xffffffffu){continue;}
      let sphere=body(index,at,u.control.x);if(sphere.w<=0.0){continue;}
      // Enter for a real safety obstruction, then use the wider envelope to
      // pass it. A just-released clear ray must not immediately reacquire only
      // because it remains inside that advisory envelope's extra cloud margin.
      if(pilotBodyRayClear(s,goal,index,at)){continue;}
      let radius=pilotDetourRadius(s,sphere,index);let distance=length(s.p.xyz-sphere.xyz);
      if(pilotDetourBlocks(s.p.xyz,goal,vec4<f32>(sphere.xyz,radius),1.0)&&distance-radius<best){chosen=index;best=distance-radius;}
    }
  }
  if(chosen==0xffffffffu){result.tactic=vec4<f32>(0.0);result.fx=vec4<f32>(0.0);return result;}
  let sphere=pilotDetourEnvelope(s,chosen,at);let radius=sphere.w;
  var plane=s.fx.xyz;
  if(s.tactic.w!=f32(chosen+1u)||length(plane)<.5){plane=pilotDetourPlane(s,sphere.xyz,goal);}
  // Predict bounded body drift while approaching the tangent. No absolute
  // deadline is stored, so an epoch rebase cannot invalidate this geometry.
  let future=sphere.xyz;
  let point=pilotDetourPoint(s.p.xyz,future,radius,plane);
  let delta=point-s.p.xyz;let speed=min(length(intent.xyz),min(radius*limits.w*.65,sqrt(radius*limits.y*.65)));
  // Cruise towards a distant tangent; slow only for the actual nearby bend.
  let approach=smoothstep(radius*1.2,radius*2.5,length(s.p.xyz-future));
  result.aim=vec4<f32>(unit(delta)*mix(speed,length(intent.xyz),approach),length(delta));
  result.tactic=vec4<f32>(future,f32(chosen+1u));result.fx=vec4<f32>(plane,radius);
  return result;
}
fn pilotMemberDetour(s:Ship,goal:vec3<f32>)->vec3<f32>{
  let reference=director.fleetGuides[s.identity.y].ship;
  if(reference.tactic.w<=0.0){return goal;}
  let center=reference.tactic.xyz;let radius=reference.fx.w;
  if(radius<=0.0||!pilotDetourBlocks(s.p.xyz,goal,vec4<f32>(center,radius),1.0)){return goal;}
  return pilotDetourPoint(s.p.xyz,center,radius,reference.fx.xyz);
}
`;
