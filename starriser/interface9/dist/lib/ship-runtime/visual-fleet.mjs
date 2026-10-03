import {VISUAL_BATTLE_WGSL} from './visual-battle.mjs';
import {WARP_PLANET_ARRIVAL_SECONDS,OPEN_ORBIT_SECONDS} from './arrival-deadline.mjs';

/** Shared route animation for the production scene. No spatial query or member
 * reduction: one guide per fleet, stable slots and a damped per-ship residual.
 * Warp/event integration remains outside this controller. All distances are lab
 * units. Tags protect non-time state from the existing physical clock rebaser. */
export const VISUAL_FLEET_WGSL = /* wgsl */ `
const VISUAL_TAG:f32=-20.0;
${VISUAL_BATTLE_WGSL}
fn visualDelta(a:Ship,b:Ship)->vec3<f32>{
  let x=initializeShipPosition(a);let y=initializeShipPosition(b);
  return (x.positionAnchor.xyz-y.positionAnchor.xyz)+(x.positionLow.xyz-y.positionLow.xyz);
}
fn visualPoint(base:vec3<f32>,offset:vec3<f32>)->Ship{
  var p:Ship;p.p=vec4<f32>(base,0.0);return moveShipPosition(p,offset);
}
// Transport the lateral frame instead of crossing a fixed up axis: vertical
// user-authored legs keep their width and crossing the pole cannot flip rows.
fn visualSide(tangent:vec3<f32>,previous:vec3<f32>)->vec3<f32>{
  let projected=previous-tangent*dot(previous,tangent);
  let axis=select(vec3<f32>(0.0,1.0,0.0),vec3<f32>(1.0,0.0,0.0),abs(tangent.y)>.9);
  return unit(select(cross(axis,tangent),projected,dot(projected,projected)>.0001));
}
struct VisualSample {point:Ship,tangent:vec3<f32>}
fn visualRouteSample(fleet:u32,unwrapped:f32)->VisualSample{
  let count=u32(director.sceneRoutes[fleet].head.x);
  let arc=sceneRouteWrappedArc(fleet,unwrapped);
  var lo=0u;var hi=count-1u;
  for(var step=0u;step<7u&&hi-lo>1u;step++){
    let mid=(lo+hi)/2u;
    if(director.sceneRoutes[fleet].points[mid].w<=arc){lo=mid;}else{hi=mid;}
  }
  let a=director.sceneRoutes[fleet].points[lo];let b=director.sceneRoutes[fleet].points[hi];
  let t=clamp((arc-a.w)/max(b.w-a.w,.000001),0.0,1.0);
  // Keep base and interpolation offset separate, including at large positions.
  return VisualSample(visualPoint(a.xyz,(b.xyz-a.xyz)*t),unit(b.xyz-a.xyz));
}
fn visualMember(fleet:u32,ordinal:u32)->Ship{
  var s:Ship;let form=director.forms[fleet];let i=form.head.z+ordinal;
  if(ordinal>=form.head.w||i>=u32(u.clock.z)){return s;}
  s=old[i];
  if(s.identity.z==0u||s.identity.y!=fleet||sceneOrdinal(s.identity.x)!=ordinal||!admitted(s)||inWarp(s,u.clock.x)){
    s.identity.z=0u;return s;
  }
  return applyJourney(s,u.clock.x,0.0);
}
fn visualSlot(s:Ship)->vec3<f32>{
  let form=director.forms[s.identity.y];
  let anchor=ordinalWarpOffset(s.identity.y,select(0u,formOrdinal(form,0u),form.head.y>0u));
  return capped(warpOffset(s)-anchor,max(.02,form.origin.w));
}
fn visualWindow(s:Ship,now:f32)->f32{
  let j=journeyFor(s);
  if(s.flight.w==-1.0&&j.mode.x>=2.0){return j.mode.w+${WARP_PLANET_ARRIVAL_SECONDS}.0-now;}
  if((s.flight.w==-1.0||s.flight.w==-2.0)&&j.mode.w-j.mode.z<${OPEN_ORBIT_SECONDS*.5}.0){return j.mode.w-now;}
  return -1e6;
}
@compute @workgroup_size(64)
fn prepareVisualFleets(@builtin(global_invocation_id) gid:vec3<u32>){
  let fleet=gid.x;if(fleet>=FORM_FLEETS){return;}
  let form=director.forms[fleet];var member:Ship;
  // At most eight admission anchors, independent of population. A late heavier
  // admission changes capability, never the lifetime or the existing arc.
  for(var k=0u;k<form.head.y;k++){
    member=visualMember(fleet,formOrdinal(form,k));if(member.identity.z>0u){break;}
  }
  if(member.identity.z==0u){member=visualMember(fleet,0u);}
  if(member.identity.z==0u){director.fleetGuides[fleet].status.z=0.0;director.fleetTravel[fleet].center.w=0.0;return;}
  let prior=director.fleetGuides[fleet];
  let entryDone=prior.ship.memory.z==-1.0&&prior.ship.memory.w>0.5&&prior.status.x==director.sceneRoutes[fleet].head.w&&prior.ship.flight.x==member.flight.x;
  if(visualBattleConfigured(member)&&(visualInBattle(member)||entryDone)){
    director.fleetGuides[fleet]=prepareBattleFleet(member,prior,u.clock.y);return;
  }
  var g=prior.ship;
  let fresh=prior.status.z==0.0||g.identity.w-sceneOrdinal(g.identity.x)!=member.identity.w-sceneOrdinal(member.identity.x);
  let head=director.sceneRoutes[fleet].head;let info=director.sceneRoutes[fleet].info;
  let changed=fresh||g.flight.x!=member.flight.x||g.flight.w!=member.flight.w||prior.status.x!=head.w;
  let radius=journeyBodyRadius(member);let limits=sceneLimits(shipType(member),radius);
  let nominal=max(.001,limits.x*.8);let dt=u.clock.y;
  // Reset only the guide on new intent/lifetime. Ships retain their own poses
  // and recover toward the new target through visualTrack.
  if(changed){g=moveShipPosition(member,-visualSlot(member));g.v=vec4<f32>(member.v.xyz,length(member.v.xyz));g.memory=vec4<f32>(0.0,info.w,-1.0,0.0);g.aux=vec4<f32>(0.0);}
  g.identity=member.identity;g.flight=member.flight;
  let holding=g.memory.z==-2.0&&member.flight.w==-1.0;
  var factor=1.0;
  if(head.x>=2.0&&!holding){
    if(!changed&&g.memory.y!=info.w){
      // Route revisions preserve correspondence when possible. Only the fleet
      // guide searches geometry; ships never race to a nearest segment.
      g.memory.x=sceneRoutePrevious(g);
    }
    let looped=info.y<0.0;let remaining=max(0.0,info.x-g.memory.x);
    let window=visualWindow(member,u.clock.x);
    let reserve=select(2.0,4.0,member.flight.w==-1.0);
    let timed=window> -100000.0;
    var desired=select(nominal,max(nominal,remaining/max(.5,window-reserve)*1.5),timed&&!looped);
    let battle=director.battleOrders[fleet];
    if(battle.own.y>0u&&battle.reserve.z==0u&&battle.own.x==member.identity.w-sceneOrdinal(member.identity.x)){
      desired=max(desired,battle.clock.z*1.3+remaining/2.0);
    }
    let brake=select(min(desired,sqrt(max(0.0,remaining)*max(nominal,desired)*4.0)),desired,looped);
    let speed=mix(max(0.0,g.v.w),brake,1.0-exp(-dt*3.0));
    var nextArc=select(min(info.x,g.memory.x+speed*dt),g.memory.x+speed*dt,looped);
    let cycle=max(.000001,info.x+info.y+1.0);
    if(looped&&nextArc>=info.x+cycle){nextArc=info.x+(nextArc-info.x)-floor((nextArc-info.x)/cycle)*cycle;}
    let sample=visualRouteSample(fleet,nextArc);
    let delta=visualDelta(sample.point,g);let velocity=sample.tangent*speed;
    g=moveShipPosition(g,delta);g.v=vec4<f32>(velocity,select(speed,0.0,!looped&&nextArc>=info.x));
    g.origin=vec4<f32>(visualSide(sample.tangent,g.origin.xyz),0.0);
    g.aim=vec4<f32>(sample.tangent,speed);g.memory=vec4<f32>(nextArc,info.w,-1.0,0.0);
    factor=max(1.0,speed/nominal);
    if(!looped&&remaining<.002){g.v=vec4<f32>(0.0);g.memory.w=1.0;if(member.flight.w==-1.0){g.memory.z=-2.0;g.aux.z=1.0;}}
  }else{
    g.v=vec4<f32>(0.0);
    // A pending route is a hold, never permission to steer through the sun.
    if(member.flight.w==-1.0&&head.w!=-1.0&&head.x<2.0){g.memory.z=-2.0;g.aux.z=1.0;}
  }
  if(g.memory.z==-2.0&&member.flight.w==-1.0&&journeyFor(member).range.z>0.0){
    // One wrapped clock for the whole fleet. Slot offsets do not depend on
    // admission count, storage location or the runtime's rebased wall clock.
    let ring=destinationRing(shipType(member),radius);
    g.aux.y=pilotRingSpeed(ring,limits,dynamics(shipType(member)).w)/max(ring,.001);
    g.aux.x=fract((g.aux.x+g.aux.y*dt)/(2.0*PI))*(2.0*PI);
  }
  g.tactic.x=VISUAL_TAG;
  director.fleetGuides[fleet]=FleetGuide(g,limits,vec4<f32>(head.w,factor,1.0,0.0));
  director.fleetTravel[fleet]=FleetTravel(vec4<f32>(g.p.xyz,f32(form.head.w)),vec4<f32>(g.aim.xyz,g.v.w),
    vec4<f32>(g.memory.x,g.memory.x,nominal,1.0),vec4<f32>(head.w,select(2.0,4.0,g.memory.z==-2.0),0.0,info.w));
}
// Exact critically damped tracking of a target with constant velocity over this
// tick. goal is the END-of-tick target: velocity*dt reconstructs its starting
// error. Omitting that term makes the follower lag even a constant-speed target.
fn visualTrack(initial:Ship,goal:Ship,velocity:vec3<f32>,frequency:f32,dt:f32)->Ship{
  var s=initial;
  let e=-visualDelta(goal,s)+velocity*dt;
  let relative=s.v.xyz-velocity;let b=relative+frequency*e;let decay=exp(-frequency*dt);
  let nextError=(e+b*dt)*decay;
  s=moveShipPosition(s,velocity*dt+nextError-e);
  s.v=vec4<f32>(velocity+(relative-frequency*b*dt)*decay,s.v.w);
  return s;
}
fn visualRouteHome(s:Ship,guide:FleetGuide)->Ship{
  let fleet=s.identity.y;let slot=visualSlot(s);let head=director.sceneRoutes[fleet].head;
  if(head.x<2.0){return moveShipPosition(guide.ship,slot);}
  // Rows traverse bends in order. Beyond an open end, extend its tangent by
  // the unused offset: clamping every row to the end cap flattens the cloud.
  // The primary anchor has slot zero and still stops exactly at the gate.
  let length=director.sceneRoutes[fleet].info.x;let arc=guide.ship.memory.x;
  let looped=director.sceneRoutes[fleet].info.y<0.0;
  let requested=arc+slot.z;
  let extension=select(requested-clamp(requested,0.0,length),0.0,looped);
  let sample=visualRouteSample(fleet,requested);
  let side=visualSide(sample.tangent,guide.ship.origin.xyz);
  let up=unit(cross(sample.tangent,side));
  return moveShipPosition(sample.point,side*slot.x+up*slot.y+sample.tangent*extension);
}
fn visualOrbit(initial:Ship,center:Ship,drift:vec3<f32>,ring:vec3<f32>,clock:vec2<f32>,floorRadius:f32,dt:f32)->Ship{
  var s=initial;let axis=vec3<f32>(0.0,sin(ring.z),cos(ring.z));let normal=vec3<f32>(0.0,cos(ring.z),-sin(ring.z));
  let d=visualDelta(s,center);
  let level=dot(d,normal);let planar=vec2<f32>(d.x,dot(d,axis));let radius=length(planar);
  let bearing=select(vec2<f32>(1.0,0.0),planar/max(radius,.000001),radius>.000001);
  let outward=vec3<f32>(bearing.x,0.0,0.0)+axis*bearing.y;let tangent=vec3<f32>(-bearing.y,0.0,0.0)+axis*bearing.x;
  let relative=s.v.xyz-drift;let errors=vec2<f32>(radius-ring.x,level-ring.y);
  let velocities=vec2<f32>(dot(relative,outward),dot(relative,normal));
  let frequency=3.0;let b=velocities+frequency*errors;let decay=exp(-frequency*dt);
  let nextErrors=(errors+b*dt)*decay;let nextV=(velocities-frequency*b*dt)*decay;
  // Interpolate radius/height, never a Cartesian chord through the planet.
  let nextRadius=max(min(radius,floorRadius),ring.x+nextErrors.x);
  let error=clock.x-clock.y*dt-atan2(planar.y,planar.x);
  let phaseError=error-floor((error+PI)/(2.0*PI))*(2.0*PI);
  // Change pace, never position: catch up or slow down without reversing orbit.
  let pace=clock.y+clamp(phaseError*.5,-clock.y*.75,clock.y*.75);
  let angular=mix(dot(relative,tangent)/max(radius,.001),pace,1.0-exp(-dt*2.0));
  let angle=angular*dt;let c=cos(angle);let sn=sin(angle);
  let nextBearing=vec2<f32>(bearing.x*c-bearing.y*sn,bearing.x*sn+bearing.y*c);
  let radial=vec3<f32>(nextBearing.x,0.0,0.0)+axis*nextBearing.y;
  let tangential=vec3<f32>(-nextBearing.y,0.0,0.0)+axis*nextBearing.x;
  let delta=drift*dt+radial*nextRadius+normal*(ring.y+nextErrors.y)-d;
  s=moveShipPosition(s,delta);s.v=vec4<f32>(drift+radial*nextV.x+normal*nextV.y+tangential*(angular*nextRadius),s.v.w);
  s.memory=vec4<f32>(0.0,0.0,-2.0,select(0.0,1.0,length(nextErrors)<max(.02,ring.x*.08)));
  return s;
}
fn visualRing(s:Ship,clock:vec2<f32>,dt:f32)->Ship{
  let form=director.forms[s.identity.y];
  let escort=form.head.y>0u&&classIndex(shipType(s))<form.head.x&&repelOfClass(form.head.x)>=repelScale(shipType(s))*2.0;
  if(escort){
    let ordinal=formOrdinal(form,sceneOrdinal(s.identity.x)%max(1u,form.head.y));
    let index=form.head.z+ordinal;
    if(index<u32(u.clock.z)){
      let anchor=old[index];
      if(anchor.identity.z>0u&&anchor.identity.y==s.identity.y&&anchor.flight.w==-1.0){
        let radius=max(.04,repelScale(shipType(anchor))*2.0+repelScale(shipType(s))*2.0);
        let speed=min(sceneLimits(shipType(s),journeyBodyRadius(s)).x*.2,radius*.5);
        let tilt=orbitTilt(shipType(s));let axis=vec3<f32>(0.0,sin(tilt),cos(tilt));let normal=vec3<f32>(0.0,cos(tilt),-sin(tilt));
        let delta=visualDelta(s,anchor);let seat=f32(ordinal+1u);
        let angle=select(atan2(dot(delta,axis),delta.x),s.memory.y,s.memory.z==-2.0&&s.memory.x==seat)+speed/radius*dt;
        let phase=angle-floor(angle/(2.0*PI))*(2.0*PI);
        let radial=vec3<f32>(cos(phase),0.0,0.0)+axis*sin(phase);
        let tangent=vec3<f32>(-sin(phase),0.0,0.0)+axis*cos(phase);
        let goal=moveShipPosition(anchor,anchor.v.xyz*dt+radial*radius+normal*visualSlot(s).y*.1);
        var result=visualTrack(s,goal,anchor.v.xyz+tangent*speed,3.0,dt);
        result.memory=vec4<f32>(seat,phase,-2.0,select(0.0,1.0,length(visualDelta(goal,result))<max(.02,radius*.15)));
        return result;
      }
    }
  }
  let j=journeyFor(s);let index=u32(j.range.z)-1u;
  let planet=body(index,u.clock.x,u.control.x);let drift=bodyVelocity(index,u.clock.x,u.control.x);
  let ring=pilotRingParameters(s,planet.w);let floorRadius=planet.w+sceneHull(shipType(s),planet.w);
  // Integer low-discrepancy slots retain precision for large logical serials.
  // Existing ships keep their seats when membership or GPU ranges change.
  let slot=vec3<f32>((vec3<u32>(s.identity.w)*vec3<u32>(2654435769u,2246822519u,3266489917u))>>vec3<u32>(8u))/16777216.0;
  let shell=vec3<f32>(max(floorRadius,ring.x*(.94+.12*slot.y)),ring.y+ring.x*(slot.z-.5)*.12,ring.z);
  return visualOrbit(s,visualPoint(planet.xyz,-drift*dt),drift,shell,
    vec2<f32>(clock.x+slot.x*(2.0*PI),clock.y),floorRadius,dt);
}
fn visualShipStep(initial:Ship,dt:f32)->Ship{
  var s=initial;let fleet=s.identity.y;
  if(dt<=0.0||fleet>=FORM_FLEETS){return s;}
  let guide=director.fleetGuides[fleet];
  let before=s;let matching=guide.status.z>0.0&&guide.ship.flight.x==s.flight.x&&guide.ship.flight.w==s.flight.w;
  if(visualInBattle(s)){s=visualBattleStep(s,dt);}
  else if(matching&&guide.ship.memory.z==-2.0&&s.flight.w==-1.0&&journeyFor(s).range.z>0.0){
    s=visualRing(s,guide.ship.aux.xy,dt);
  }else if(matching){
    let goal=visualRouteHome(s,guide);
    // Guidance is shared; local residual recovery has one owner. Speed/turn/
    // braking limits are visual cues, not competing hard arrival constraints.
    var velocity=guide.ship.v.xyz;
    let revision=director.sceneRoutes[fleet].info.w;
    if(s.tactic.x==VISUAL_TAG&&s.memory.z==-1.0&&s.aim.w==revision&&s.fx.z==s.flight.x){
      velocity=((goal.positionAnchor.xyz-s.aim.xyz)+(goal.positionLow.xyz-s.aux.xyz))/dt;
    }
    s=visualTrack(s,goal,velocity,2.5,dt);
    s.aim=vec4<f32>(goal.positionAnchor.xyz,revision);s.aux=vec4<f32>(goal.positionLow.xyz,s.aux.w);s.fx.z=s.flight.x;
    s.memory=vec4<f32>(guide.ship.memory.xyz,0.0);
  }else{
    let decay=exp(-dt*3.0);s=moveShipPosition(s,s.v.xyz*(1.0-decay)/3.0);s.v=vec4<f32>(s.v.xyz*decay,s.v.w);
  }
  let radius=journeyBodyRadius(s);let nominal=max(.001,sceneLimits(shipType(s),radius).x);
  let speed=length(s.v.xyz);let acceleration=(s.v.xyz-before.v.xyz)/dt;
  s.a=vec4<f32>(acceleration,clamp((speed/nominal-1.0)*.5,0.0,1.0));
  // Motion owns the heading. Transport the hull's up vector onto the actual
  // tangent; a second turn-rate limit lets an orbit outrun its visible hull.
  if(speed>.000001){let turn=headingError(s.q,s.v.xyz);s.q=angularRotation(s.q,turn.xyz*turn.w);}
  s.tactic.x=VISUAL_TAG;s.origin=vec4<f32>(0.0);
  s.fx.w=clamp(speed/nominal,0.0,1.0);s.v.w=nominal;
  return s;
}
`;

/** Same event boundaries as the runtime; no legacy deadline teleport branch.
 * Physical warp placement is still owned by applyJourney/held integration. */
export const VISUAL_EVENT_INTEGRATION_WGSL=/* wgsl */`
struct ShipIntegration { ship:Ship, dt:f32, first:u32 }
fn prepareShipIntegration(original:Ship,i:u32,now:f32,dt:f32,first:u32,last:u32,finishHeld:bool)->ShipIntegration{
  var s=original;let start=now-dt;let j=journeyFor(s);
  if(s.origin.w != -2.0&&j.mode.y>s.flight.x&&start>=j.mode.z){
    s=integrateHeldMotion(s,i,start,0.0,first,u32(floor(max(0.0,start)*60.0)));
  }
  if(finishHeld){s=integrateHeldMotion(s,i,now,dt,first,last);}
  return ShipIntegration(s,dt,first);
}
fn integrateHeldShip(original:Ship,i:u32,now:f32,dt:f32,first:u32,last:u32)->Ship{
  return prepareShipIntegration(original,i,now,dt,first,last,true).ship;
}
`;
