// Velocity guidance only: no angle clock, orbital slots or direct pose writes.
export const ENGAGEMENT_WGSL=/* wgsl */`
fn engagementRadius(s:Ship,contact:Ship)->f32 {
  let hulls=dimensions(shipType(s)).w+dimensions(shipType(contact)).w;
  let limits=dynamics(shipType(s));
  // Small craft need enough room to turn with their actual acceleration budget.
  if(classIndex(shipType(s))>=3u){return hulls+2.5;}
  // A compact pass radius; closeEngagement reduces speed to make the tighter turn feasible.
  return hulls+1.25+limits.x*limits.x/limits.y*.35;
}
fn approachVelocity(s:Ship,contact:Ship)->vec3<f32> {
  let delta=contact.p.xyz-s.p.xyz;let limits=dynamics(shipType(s));
  let gap=length(delta)-engagementRadius(s,contact);
  // A quiet distance band prevents capital ships endlessly correcting tiny errors.
  let error=sign(gap)*max(0.0,abs(gap)-.5);
  let speed=min(limits.x,min(abs(error)*.8,sqrt(2.0*limits.y*abs(error))*.7));
  return contact.v.xyz+unit(delta)*sign(error)*speed;
}
fn passingTangent(s:Ship,contact:Ship,inward:vec3<f32>)->vec3<f32> {
  let relative=s.v.xyz-contact.v.xyz;
  var tangent=relative-inward*dot(relative,inward);
  if(length(tangent)<.05) {
    // Straight-on/stationary approaches have no lateral momentum to preserve.
    // Use the ship's own horizontal axis, projected onto the target tangent plane.
    let right=rotate(s.q,vec3<f32>(1.0,0.0,0.0))*select(select(-1.0,1.0,(s.identity.w&1u)==0u),s.memory.w,s.memory.w!=0.0);
    tangent=right-inward*dot(right,inward);
    if(length(tangent)<.001){tangent=cross(inward,rotate(s.q,vec3<f32>(0.0,1.0,0.0)));}
  }
  return unit(tangent);
}
fn closeEngagement(s:Ship,contact:Ship,incoming:vec3<f32>)->vec3<f32> {
  if(classIndex(shipType(s))>=3u){return approachVelocity(s,contact);}
  let delta=contact.p.xyz-s.p.xyz;let distance=length(delta);let inward=unit(delta);
  let limits=dynamics(shipType(s));let radius=engagementRadius(s,contact);
  let width=max(3.0,limits.x*limits.x/(2.0*limits.y)+limits.x*.4);
  let weight=1.0-smoothstep(radius+1.0,radius+width,distance);
  let speed=min(limits.x,sqrt(max(distance,.1)*limits.y*.6));
  let radial=clamp((distance-radius)*.8,-limits.x*.4,limits.x*.4);
  let passing=contact.v.xyz+passingTangent(s,contact,inward)*speed+inward*radial;
  return mix(incoming,passing,weight);
}
`;
