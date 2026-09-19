export const RECOVERY_WGSL=/* wgsl */`
fn recoveryClear(point:vec3<f32>,size:f32,now:f32)->vec3<f32> {
  var p=point;
  for(var sweep=0u;sweep<4u;sweep++){for(var i=0u;i<16u;i++) {
    let planet=body(i,now,u.control.x);if(planet.w<=0.0){continue;}
    let a=sceneAdapt(planet.w);let delta=p-planet.xyz;let radius=planet.w+size*a+2.0*a;
    if(length(delta)<radius){p=planet.xyz+select(vec3<f32>(0.0,1.0,0.0),unit(delta),length(delta)>.001)*radius;}
  }
  }
  let center=body(0u,now,u.control.x).xyz;var bound=0.0;var inside=false;
  for(var i=0u;i<16u;i++) {
    let planet=body(i,now,u.control.x);if(planet.w<=0.0){continue;}
    let a=sceneAdapt(planet.w);let radius=planet.w+size*a+2.0*a;
    bound=max(bound,length(planet.xyz-center)+radius);inside=inside||length(p-planet.xyz)<radius-.001;
  }
  if(inside){p=center+vec3<f32>(0.0,bound+2.0*sceneAdapt(max(body(0u,now,u.control.x).w,0.02)),0.0);}return p;
}
fn recoverShip(initial:Ship,i:u32,now:f32)->Ship {
  if(!admitted(initial)){return integrateShip(initial,i,now,0.0,false,trailLast(now)+1u,trailLast(now));}
  var s=initial;let group=groupOf(s);let journey=journeyFor(s);
  let cohort=navigationCohort(s);
  let placement=director.events.placements[group*2u+cohort];
  let direction=unit(vec3<f32>(variation(s.identity.w+137u)-.5,variation(s.identity.w+139u)-.5,variation(s.identity.w+149u)-.5));
  s.p=vec4<f32>(placement.center.xyz+direction*placement.center.w*pow(variation(s.identity.w+151u),.333333),s.p.w);
  s.v=vec4<f32>(placement.velocity.xyz,s.v.w);s.a=vec4<f32>(0.0);s.aux=vec4<f32>(0.0);s.memory=vec4<f32>(0.0);
  s.flight=vec4<f32>(journey.mode.y,now,journey.mode.w,journey.mode.x);s.tactic=vec4<f32>(0.0,0.0,now,now+1.0);
  s.fx=vec4<f32>(-1.0,0.0,0.0,0.0);s.aim=vec4<f32>(0.0);
  if(journey.mode.x==-1.0) {
    let planetId=u32(journey.range.z)-1u;let planet=body(planetId,now,u.control.x);
    let phase=variation(s.identity.w)*2.0*PI;let tilt=orbitTilt(shipType(s))+journey.range.w;let radius=orbitRadius(shipType(s),planet.w);
    s.p=vec4<f32>(planet.xyz+vec3<f32>(cos(phase),sin(phase)*sin(tilt),sin(phase)*cos(tilt))*radius,s.p.w);
    s.v=vec4<f32>(ringVelocity(s,planetId,now,journey.range.w),s.v.w);
  }
  if(journey.mode.x<2.0){s.p=vec4<f32>(recoveryClear(s.p.xyz,dimensions(shipType(s)).w,now),s.p.w);}
  s.origin=vec4<f32>(s.p.xyz,select(0.0,-1.0,journey.mode.x>=2.0&&now>=journey.mode.w));
  s.q=attitude(s.q,s.v.xyz,1.0,PI);
  return integrateShip(s,i,now,0.0,false,trailLast(now)+1u,trailLast(now));
}
`;
