export function lifecycleWgsl(solar = false) {
  const warpPlace = solar
    ? `let exit=journey.exit.xyz+warpOffset(s);
    let duration=max(.000001,s.flight.z-s.flight.y);
    let direction=unit(exit-s.origin.xyz);
    var velocity=(exit-s.origin.xyz)/duration;
    if(s.flight.w==4.0){
      // Receding endpoint solve spreads f32 chord error over remaining time.
      // Position remains continuously integrated, including the last warp tick.
      velocity=((exit-s.positionAnchor.xyz)-s.positionLow.xyz)/max(.000001,s.flight.z-s.positionAnchor.w);
    }
    s.v=vec4<f32>(velocity,s.v.w);s.a=vec4<f32>(0.0);
    s=warpShipPosition(s,min(now,s.flight.z));
    s.positionAnchor.w=min(now,s.flight.z);
    if(now>=s.flight.z&&s.flight.w!=4.0){s.p=vec4<f32>(exit,s.p.w);s.positionLow=vec4<f32>(0.0);s=initializeShipPosition(s);}
    s.q=flightAttitude(s.q,s.v.xyz);s.aux.x=0.0;`
    : `let exit=journey.exit.xyz+formationOffset(s);
    let duration=max(.000001,s.flight.z-s.flight.y);
    let direction=unit(exit-s.origin.xyz);
    var velocity=(exit-s.origin.xyz)/duration;
    if(s.flight.w==4.0){
      // Receding endpoint solve spreads f32 chord error over remaining time.
      // Position remains continuously integrated, including the last warp tick.
      velocity=((exit-s.positionAnchor.xyz)-s.positionLow.xyz)/max(.000001,s.flight.z-s.positionAnchor.w);
    }
    s.v=vec4<f32>(velocity,s.v.w);s.a=vec4<f32>(0.0);
    s=warpShipPosition(s,min(now,s.flight.z));
    s.positionAnchor.w=min(now,s.flight.z);
    if(now>=s.flight.z&&s.flight.w!=4.0){s.p=vec4<f32>(exit,s.p.w);s.positionLow=vec4<f32>(0.0);s=initializeShipPosition(s);}
    s.q=flightAttitude(s.q,direction);s.aux.x=0.0;`;
  return /* wgsl */`
fn navigationCohort(s:Ship)->u32 {
  return select(0u,(s.identity.x>>16u)&1u,groupIntent(groupOf(s)).journeys[1].mode.y>0.0);
}
fn journeyFor(s:Ship)->Journey {return groupIntent(groupOf(s)).journeys[navigationCohort(s)];}
fn inWarp(s:Ship,now:f32)->bool {
  let journey=journeyFor(s);
  return journey.mode.x>=2.0&&now>=journey.mode.z&&now<journey.mode.w;
}
fn formationOffset(s:Ship)->vec3<f32> {
  let a=sceneAdapt(journeyBodyRadius(s));
  if(classIndex(shipType(s))==5u){return vec3<f32>(0.0,50.0,0.0)*a;}
  if(classIndex(shipType(s))==4u){let ordinal=s.identity.x&255u;return vec3<f32>(select(-25.0,25.0,(ordinal&1u)==1u),-12.0,select(-25.0,25.0,(ordinal&2u)==2u))*a;}
  let axis=unit(vec3<f32>(variation(s.identity.w+61u)-.5,variation(s.identity.w+62u)-.5,variation(s.identity.w+63u)-.5));
  return axis*(2.0+5.0*pow(variation(s.identity.w+64u),.333333))*a;
}
fn applyJourney(initial:Ship,now:f32,dt:f32)->Ship {
  var s=initial;let journey=journeyFor(s);
  if(journey.mode.y>s.flight.x&&now>=journey.mode.z) {
    // A fresh production seed carries its exact admission time. Render-only
    // frames may admit rows before the next simulation step consumes them.
    let originTime=select(now-dt,s.origin.x,s.origin.w == -2.0);
    let angular=localAngularVelocity(s);
    s.flight=vec4<f32>(journey.mode.y,max(journey.mode.z,originTime),journey.mode.w,journey.mode.x);
    if(journey.mode.x>=2.0){s=initializeShipPosition(s);s.positionAnchor.w=s.flight.y;}
    // Local retargets retain spin. Warp owns xyz as its affine chord origin.
    s.origin=vec4<f32>(select(angular,s.p.xyz,journey.mode.x>=2.0),0.0);
    // Deadlines remain authoritative. A command received after its deadline is
    // an explicit warp correction at this admission boundary, not extra travel.
    if(journey.mode.x>=2.0&&s.flight.z<=s.flight.y){s.origin.w=-1.0;}
    // A director may interrupt warp before its endpoint. Local flight gets the
    // same explicit cruise handoff as a scheduled exit, never the warp derivative.
    if(initial.flight.w>=2.0&&journey.mode.x<2.0){s.v=vec4<f32>(0.0,0.0,0.0,s.v.w);s.a=vec4<f32>(0.0);}
  }
  if(s.flight.w>=2.0) {
    // The authoritative endpoint time is repacked from host double precision
    // at each epoch change, including a long command that spans several epochs.
    if(s.flight.x==journey.mode.y){s.flight.z=journey.mode.w;}
    ${warpPlace}
    if(now>=s.flight.z) {
      // Warp ends at rest. Local flight accelerates from 0 under sceneLimits.
      s.v=vec4<f32>(0.0,0.0,0.0,s.v.w);s.a=vec4<f32>(0.0);
      s.flight.w=select(0.0,-1.0,journey.range.z>0.0);
      s.origin=vec4<f32>(0.0,0.0,0.0,s.origin.w);
    }
  }
  return s;
}
fn journeyLocalDt(s:Ship,now:f32,dt:f32)->f32 {
  let journey=journeyFor(s);
  if(journey.mode.x>=2.0&&now-dt<s.flight.z){return max(0.0,now-s.flight.z);}
  return dt;
}
fn journeyVelocity(s:Ship,now:f32)->vec3<f32> {
  let journey=journeyFor(s);let limits=dynamics(shipType(s));
  let goal=encounterFrame(s)+journey.exit.xyz+formationOffset(s)*select(.45,1.0,classIndex(shipType(s))>=4u);
  let delta=goal-s.p.xyz;
  return unit(delta)*min(limits.x,brakingSpeedAt(s,limits,max(0.0,length(delta)-1.0),0.0));
}
struct BranchResult {ship:Ship,velocity:vec3<f32>}
fn branchGuidance(initial:Ship,incoming:vec3<f32>,now:f32)->BranchResult {
  var s=initial;let intent=groupIntent(groupOf(s));let command=intent.tactic;
  if(command.x==0.0){return BranchResult(s,incoming);}
  if(s.tactic.x!=command.x){s.tactic=vec4<f32>(command.x,0.0,now,s.tactic.w);}
  let branch=(s.identity.x&255u)%max(1u,u32(command.y));let directive=intent.branches[branch];
  let goal=encounterFrame(s)+directive.goal.xyz;let delta=goal-s.p.xyz;
  if(length(delta)<directive.goal.w){s.tactic.y=1.0;}
  let blend=smoothstep(command.z,command.z+command.w,now);
  // The CPU decides which types take a detour through branch weights.
  let enabled=select(0.0,1.0,s.tactic.y==0.0);
  let desired=unit(delta)*dynamics(shipType(s)).x*directive.weights.x;
  return BranchResult(s,mix(incoming,desired,blend*enabled*directive.weights.y));
}
`;
}
export const LIFECYCLE_WGSL = lifecycleWgsl(false);
