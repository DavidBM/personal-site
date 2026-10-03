/** Visual experiment: scene-clock seconds from warp exit to planet capture. */
export const WARP_PLANET_ARRIVAL_SECONDS=20;
export const OPEN_ORBIT_SECONDS=1e6;

/** Fleet-only scheduling math. No member scans, poses or new GPU resources. */
export const ARRIVAL_DEADLINE_WGSL=/* wgsl */`
fn pilotArrivalWindow(s:Ship,now:f32)->vec2<f32>{
  if(s.flight.w!=-1.0&&s.flight.w!=-2.0){return vec2<f32>(0.0);}
  let journey=journeyFor(s);
  if(journey.mode.x>=2.0){return vec2<f32>(1.0,journey.mode.w+${WARP_PLANET_ARRIVAL_SECONDS}.0-now);}
  // Leave a wide gap around the open-ended sentinel after f32 clock packing.
  if((journey.mode.x==-1.0||journey.mode.x==-2.0)&&journey.mode.w-journey.mode.z<${OPEN_ORBIT_SECONDS*.5}.0){
    return vec2<f32>(1.0,journey.mode.w-now);
  }
  return vec2<f32>(0.0);
}
fn arrivalCapability(distance:f32,angle:f32,remaining:f32,base:vec4<f32>)->f32{
  // A triangular speed profile leaves room to accelerate and brake. Overdue
  // ships keep correcting with a finite horizon; the deadline never resets.
  let time=max(2.0,remaining);
  let speed=2.0*max(0.0,distance)/time;
  let acceleration=4.0*max(0.0,distance)/(time*time);
  let turn=2.0*max(0.0,angle)/time;
  return max(1.0,max(acceleration/max(base.y,.0001),
    max(pow(speed/max(base.x,.0001),2.0),pow(turn/max(base.w,.0001),2.0))));
}
fn pilotRingDemand(s:Ship,ringGoal:PilotRingTarget,base:vec4<f32>,window:vec2<f32>)->f32{
  if(window.x==0.0||s.memory.w>=1.0){return 1.0;}
  let distance=length(ringGoal.error);let residual=s.v.xyz-ringGoal.velocity;
  let angle=headingError(s.q,ringGoal.error+ringGoal.velocity*.5).w;
  // A fast crossing still needs brakes even when remaining geometric distance
  // is zero. Use the same finite horizon after the original deadline expires.
  let stopping=dot(residual,residual)/(3.0*max(base.y,.0001)*max(.02,max(distance,ringGoal.radius*.08)));
  return max(stopping,arrivalCapability(distance,angle,window.y,base));
}
fn pilotArrivalDemand(s:Ship,base:vec4<f32>,window:vec2<f32>,now:f32)->f32{
  if(window.x==0.0){return 1.0;}
  if(pilotUsesRoute(s)){
    let fleet=s.identity.y;let head=director.sceneRoutes[fleet].head;
    if(head.x<2.0){return 1.0;}
    let arc=select(0.0,s.memory.x,s.memory.y==director.sceneRoutes[fleet].info.w);
    let entry=length(sceneRouteAt(fleet,arc).xyz-s.p.xyz);
    let remaining=max(0.0,director.sceneRoutes[fleet].info.x-arc)+entry;
    return arrivalCapability(remaining,headingError(s.q,s.aim.xyz).w,window.y,base);
  }
  if(s.flight.w==-2.0){return arrivalCapability(length(journeyFor(s).exit.xyz-s.p.xyz),0.0,window.y,base);}
  if(s.memory.w>=1.0){return 1.0;}
  let journey=journeyFor(s);let index=u32(journey.range.z)-1u;
  let planet=body(index,now,u.control.x);let tilt=orbitTilt(shipType(s))+journey.range.w;
  let ringGoal=pilotRingTarget(s,planet.xyz,bodyVelocity(index,now,u.control.x),vec3<f32>(s.aux.y,0.0,tilt),base);
  var demand=pilotRingDemand(s,ringGoal,base,window);
  if(s.tactic.w>0.0&&s.fx.w>0.0){
    let distance=pilotDetourDistance(s.p.xyz,s.p.xyz+ringGoal.error,vec4<f32>(s.tactic.xyz,s.fx.w),s.fx.xyz);
    demand=max(demand,arrivalCapability(distance,headingError(s.q,s.aim.xyz).w,window.y,base));
  }
  return demand;
}
`;
