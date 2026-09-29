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
// All held intervals share one call site. Stages retain the original ordering:
// admission at start, deadline integration/correction, optional remaining motion.
// Capture journey before admission: the deadline predicate uses that same record.
struct ShipIntegration { ship:Ship, dt:f32, first:u32 }
fn prepareShipIntegration(original:Ship,i:u32,now:f32,dt:f32,first:u32,last:u32,finishHeld:bool)->ShipIntegration {
  let start=now-dt;let journey=journeyFor(original);
  var s=original;var remaining=dt;var nextFirst=first;var stage=0u;
  loop {
    var at=now;var stepDt=remaining;var begin=nextFirst;var end=last;
    if(stage==0u) {
      stage=1u;
      // Fresh production seeds keep their exact admission time.
      if(!(s.origin.w != -2.0 && journey.mode.y>s.flight.x && start>=journey.mode.z)){continue;}
      at=start;stepDt=0.0;begin=first;end=u32(floor(max(0.0,start)*60.0));
    } else if(stage==1u) {
      stage=2u;
      if(!(admitted(s)&&journey.mode.x==1.0&&now>=journey.mode.w&&(s.origin.w<1.0||s.flight.x!=journey.mode.y))){continue;}
      at=max(start,journey.mode.w);stepDt=at-start;begin=first;end=u32(floor(max(0.0,at)*60.0));
    } else {
      if(!finishHeld){break;}
      stage=3u;
    }
    s=integrateHeldMotion(s,i,at,stepDt,begin,end);
    if(stage==2u){s=completeArrival(s,i,at,end);remaining=now-at;nextFirst=end+1u;}
    if(stage==3u){break;}
  }
  return ShipIntegration(s,remaining,nextFirst);
}
fn integrateHeldShip(original:Ship,i:u32,now:f32,dt:f32,first:u32,last:u32)->Ship {
  return prepareShipIntegration(original,i,now,dt,first,last,true).ship;
}
fn integrateShip(original:Ship,i:u32,now:f32,dt:f32,first:u32,last:u32)->Ship {
  let interval=prepareShipIntegration(original,i,now,dt,first,last,false);
  return integrateMotion(interval.ship,i,now,interval.dt,interval.first,last);
}
`;
