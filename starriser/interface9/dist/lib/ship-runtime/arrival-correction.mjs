// Exceptional local arrival is presentation recovery, never a combat result.
// Keep the original deadline and record both sides before resetting emitters.
export const ARRIVAL_CORRECTION_WGSL=/* wgsl */`
fn resetEmitterHistory(s:Ship,i:u32,now:f32,last:u32) {
  let base=i*3u*RING;
  for(var j=0u;j<3u*RING;j++){history[base+j]=vec4<f32>(0.0,0.0,0.0,-1.0);}
  if(u.control.z>0.5){for(var e=0u;e<3u;e++){history[base+e*RING+last%RING]=vec4<f32>(emitter(s,e),now);}}
}
fn arrivalPoint(s:Ship,journey:Journey,now:f32)->vec3<f32> {
  if(journey.range.z==0.0){return encounterFrame(s)+journey.exit.xyz+formationOffset(s)*select(.45,1.0,classIndex(shipType(s))>=4u);}
  let planet=body(u32(journey.range.z)-1u,now,u.control.x);
  let route=groupRoute(groupOf(s),navigationCohort(s));
  if(route.header.x==journey.mode.y&&route.header.y>=2.0&&route.header.w>=0.0){return planet.xyz+route.points[u32(route.header.y)-1u].xyz;}
  let tilt=orbitTilt(shipType(s))+journey.range.w;let axis=vec3<f32>(0.0,sin(tilt),cos(tilt));
  let delta=s.p.xyz-planet.xyz;let phase=atan2(dot(delta,axis),delta.x);
  return planet.xyz+orbitRadius(shipType(s),planet.w)*(vec3<f32>(cos(phase),0.0,0.0)+axis*sin(phase));
}
fn completeArrival(initial:Ship,i:u32,now:f32,last:u32)->Ship {
  var s=initial;let journey=journeyFor(s);let point=arrivalPoint(s,journey,now);
  s.origin.w=1.0;
  if(length(s.p.xyz-point)<=max(3.0,dimensions(shipType(s)).w*1.5)){return s;}
  // Spread exceptional ring recoveries by stable identity, without changing
  // ordinary arrival or prescribing trajectories during normal local flight.
  var destination=point;var velocity=vec3<f32>(0.0);
  if(journey.range.z>0.0) {
  let planetId=u32(journey.range.z)-1u;let planet=body(planetId,now,u.control.x);
  let route=groupRoute(groupOf(s),navigationCohort(s));
  if(route.header.x!=journey.mode.y||route.header.w<0.0||route.header.y<2.0) {
    let phase=variation(s.identity.w)*2.0*PI;let tilt=orbitTilt(shipType(s))+journey.range.w;
    destination=planet.xyz+orbitRadius(shipType(s),planet.w)*vec3<f32>(cos(phase),sin(phase)*sin(tilt),sin(phase)*cos(tilt));
  }
  s.positionLow=vec4<f32>(0.0);s.p=vec4<f32>(destination,s.p.w);velocity=ringVelocity(s,planetId,now,journey.range.w);
  }
  if(u.warp.z>0.5){destination=recoveryClear(destination,dimensions(shipType(s)).w,now);}
  s.positionLow=vec4<f32>(0.0);s.p=vec4<f32>(destination,s.p.w);
  s.v=vec4<f32>(velocity,s.v.w);s.a=vec4<f32>(0.0);s.aux.x=0.0;s.memory=vec4<f32>(0.0);
  s.origin=vec4<f32>(0.0,0.0,0.0,2.0);s.tactic.w=now+1.0;s.q=attitude(s.q,s.v.xyz,1.0,PI);
  recordCorrection(initial,s,i,now);resetEmitterHistory(s,i,now,last);return s;
}
// Exact event/deadline handling is shared, but never calls a controller. Carry
// the remaining interval to one final integration, including its history range.
struct ShipIntegration { ship:Ship, dt:f32, first:u32 }
fn prepareShipIntegration(original:Ship,i:u32,now:f32,dt:f32,first:u32)->ShipIntegration {
  let start=now-dt;
  var s=original;let journey=journeyFor(s);
  // Fresh production seeds carry an exact admission date, not the prior tick boundary.
  if(s.origin.w != -2.0 && journey.mode.y>s.flight.x&&start>=journey.mode.z){s=integrateHeldMotion(s,i,start,0.0,first,u32(floor(max(0.0,start)*60.0)));}
  if(admitted(s)&&journey.mode.x==1.0&&now>=journey.mode.w&&(s.origin.w<1.0||s.flight.x!=journey.mode.y)) {
    let at=max(start,journey.mode.w);let tick=u32(floor(max(0.0,at)*60.0));
    s=integrateHeldMotion(s,i,at,at-start,first,tick);
    s=completeArrival(s,i,at,tick);
    return ShipIntegration(s,now-at,tick+1u);
  }
  return ShipIntegration(s,dt,first);
}
fn integrateHeldShip(original:Ship,i:u32,now:f32,dt:f32,first:u32,last:u32)->Ship {
  let interval=prepareShipIntegration(original,i,now,dt,first);
  return integrateHeldMotion(interval.ship,i,now,interval.dt,interval.first,last);
}
fn integrateShip(original:Ship,i:u32,now:f32,dt:f32,first:u32,last:u32)->Ship {
  let interval=prepareShipIntegration(original,i,now,dt,first);
  return integrateMotion(interval.ship,i,now,interval.dt,interval.first,last);
}
`;
