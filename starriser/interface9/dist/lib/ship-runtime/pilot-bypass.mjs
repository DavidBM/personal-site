/** Physical pilot owns aux.yz (octahedral passing-plane normal) and fx.z
 * (body index + 1) while tactic.x < 0. Combat handoff clears these fields;
 * clock rebasing excludes them. No Ship ABI, allocation or packing change. */
export const PILOT_BYPASS_WGSL=/* wgsl */`
fn pilotPlanePack(plane:vec3<f32>)->vec2<f32>{
  let n=plane/max(dot(abs(plane),vec3<f32>(1.0)),.000001);
  return select(n.xy,(vec2<f32>(1.0)-abs(n.yx))*select(vec2<f32>(-1.0),vec2<f32>(1.0),n.xy>=vec2<f32>(0.0)),n.z<0.0);
}
fn pilotPlaneUnpack(p:vec2<f32>)->vec3<f32>{
  var n=vec3<f32>(p,1.0-abs(p.x)-abs(p.y));
  let t=clamp(-n.z,0.0,1.0);
  n=vec3<f32>(n.xy+select(vec2<f32>(t),vec2<f32>(-t),n.xy>=vec2<f32>(0.0)),n.z);
  return unit(n);
}
fn pilotMemberObstacle(s:Ship,goal:vec3<f32>,now:f32)->u32{
  // A reference clearing a body cannot clear the trailing member's commitment.
  if(s.fx.z>0.0){
    let index=u32(s.fx.z)-1u;let sphere=body(index,now,u.control.x);
    let forward=s.p.xyz+s.v.xyz*.5;
    if(sphere.w>0.0&&(!pilotBodyRayClear(s,goal,index,now)||!pilotBodyRayClear(s,forward,index,now))){return index;}
  }
  let slots=director.nearby[s.identity.y];var chosen=0xffffffffu;var best=1e20;
  for(var slot=0u;slot<4u;slot++){
    let index=slots[slot];if(index==0xffffffffu){continue;}
    let sphere=body(index,now,u.control.x);if(sphere.w<=0.0){continue;}
    if(pilotBodyRayClear(s,goal,index,now)){continue;}
    let distance=length(s.p.xyz-sphere.xyz)-sphere.w;
    if(distance<best){chosen=index;best=distance;}
  }
  return chosen;
}
fn pilotMemberBypass(guidance:NavigationResult,goal:vec3<f32>,limits:vec4<f32>,now:f32)->NavigationResult{
  var s=guidance.ship;
  if(u.warp.z<.5){s.fx.z=0.0;return NavigationResult(s,guidance.velocity,guidance.reach);}
  let index=pilotMemberObstacle(s,goal,now);
  if(index==0xffffffffu){s.fx.z=0.0;return NavigationResult(s,guidance.velocity,guidance.reach);}
  let sphere=body(index,now,u.control.x);let radius=pilotDetourRadius(s,sphere,index);
  var plane=pilotPlaneUnpack(s.aux.yz);
  if(s.fx.z!=f32(index+1u)){
    let reference=director.fleetGuides[s.identity.y].ship;
    plane=pilotDetourPlane(s,sphere.xyz,goal);
    if(reference.tactic.w==f32(index+1u)){plane=reference.fx.xyz;}
    let packed=pilotPlanePack(plane);s.aux.y=packed.x;s.aux.z=packed.y;
  }
  s.fx.z=f32(index+1u);
  let delta=pilotDetourPoint(s.p.xyz,sphere.xyz,radius,plane)-s.p.xyz;
  let window=pilotArrivalWindow(s,now);
  if(window.x>0.0&&s.memory.w<1.0){
    let distance=pilotDetourDistance(s.p.xyz,goal,vec4<f32>(sphere.xyz,radius),plane);
    let base=vec4<f32>(limits.xyz,dynamics(shipType(s)).w);
    s.aim.w=max(s.aim.w,arrivalCapability(distance,headingError(s.q,delta).w,window.y,base));
  }
  // Extra authority may help turn/brake. A deadline never bypasses clearance.
  let factor=pilotRecoveryFactor(s);let gain=sqrt(factor);
  let bend=min(radius*dynamics(shipType(s)).w*gain*.65,sqrt(radius*limits.y*factor*.65));
  let approach=smoothstep(radius*1.2,radius*2.5,length(s.p.xyz-sphere.xyz));
  let pace=min(length(guidance.velocity),mix(bend,limits.x*gain,approach));
  return NavigationResult(s,unit(delta)*max(pace,min(.004,limits.x)),max(length(delta),.02));
}
`;
