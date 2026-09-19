export const LIFECYCLE_WGSL=/* wgsl */`
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
    s.flight=vec4<f32>(journey.mode.y,max(journey.mode.z,now-dt),journey.mode.w,journey.mode.x);
    s.origin=vec4<f32>(s.p.xyz,0.0);
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
    let exit=journey.exit.xyz+formationOffset(s);
    let duration=max(.000001,s.flight.z-s.flight.y);
    let progress=select(clamp((now-s.flight.y)/duration,0.0,1.0),1.0,now>=s.flight.z);
    let direction=unit(exit-s.origin.xyz);
    s.p=vec4<f32>(mix(s.origin.xyz,exit,progress),s.p.w);
    s.v=vec4<f32>((exit-s.origin.xyz)/duration,s.v.w);s.a=vec4<f32>(0.0);
    s.q=attitude(s.q,direction,dt,12.0);s.aux.x=0.0;
    if(now>=s.flight.z) {
      // Warp ends at rest. Local flight accelerates from 0 under sceneLimits.
      s.v=vec4<f32>(0.0,0.0,0.0,s.v.w);s.a=vec4<f32>(0.0);
      s.flight.w=select(0.0,-1.0,journey.range.z>0.0);
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
  return unit(delta)*min(limits.x,sqrt(max(0.0,length(delta)-1.0)*limits.y));
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
