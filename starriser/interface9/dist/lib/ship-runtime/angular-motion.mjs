/** Authored turn is radians/second. Reach full angular speed in this many seconds. */
export const ANGULAR_RAMP_SECONDS = 0.25;
export const ANGULAR_SETTLE_SECONDS = 0.2;
export const ANGULAR_DIRECTION_EPSILON = 0.0005;
export const ANGULAR_SPEED_EPSILON = 0.002;

// Ship.origin is an explicit tagged union, without another buffer or pose stride:
// fresh origin.w==-2: origin.x is admission time; active flight.w>=2: xyz is the
// affine warp origin; all other local modes: xyz is world angular velocity.
// origin.w independently retains local arrival/correction status. Whole-Ship
// copies carry angular state through history, events, packing and capacity growth.
export const ANGULAR_MOTION_WGSL = /* wgsl */ `
fn localAngularVelocity(s:Ship)->vec3<f32> {
  if(s.origin.w == -2.0 || s.flight.w >= 2.0){return vec3<f32>(0.0);}
  return s.origin.xyz;
}
fn headingError(q:vec4<f32>,direction:vec3<f32>)->vec4<f32> {
  let forward=rotate(q,vec3<f32>(0.0,0.0,1.0));
  let desired=unit(direction);let axis=cross(forward,desired);
  let sine=length(axis);let cosine=clamp(dot(forward,desired),-1.0,1.0);
  if(sine>0.000001){return vec4<f32>(axis/sine,atan2(sine,cosine));}
  // A reversal has infinitely many axes. The transported ship up chooses one
  // consistently; a world-up reconstruction instead flips at its pole.
  return vec4<f32>(rotate(q,vec3<f32>(0.0,1.0,0.0)),select(0.0,PI,cosine<0.0));
}
fn angularRotation(q:vec4<f32>,rotation:vec3<f32>)->vec4<f32> {
  let angle=length(rotation);
  if(angle<0.0000001){return q;}
  return normalize(qmul(vec4<f32>(rotation*(sin(angle*.5)/angle),cos(angle*.5)),q));
}
// Kinematic warp already fixes its exact tangent. Preserve transported up while
// aligning +Z; ordinary local motion uses the bounded forward-flight controller.
fn flightAttitude(q:vec4<f32>,velocity:vec3<f32>)->vec4<f32> {
  // Preserve the pre-existing warp-only speed threshold. Local flight uses
  // the separately named slow-motion damping threshold below.
  if(length(velocity)<0.001){return q;}
  let error=headingError(q,velocity);
  return angularRotation(q,error.xyz*error.w);
}
fn steerLocalAttitude(initial:Ship,direction:vec3<f32>,dt:f32,turnRate:f32,requestedRate:f32)->Ship {
  return steerLocalAttitudeResponse(initial,direction,dt,turnRate,requestedRate,${ANGULAR_RAMP_SECONDS},${ANGULAR_SETTLE_SECONDS});
}
fn steerLocalAttitudeResponse(initial:Ship,direction:vec3<f32>,dt:f32,turnRate:f32,requestedRate:f32,ramp:f32,settle:f32)->Ship {
  var s=initial;
  if(dt<=0.0 || s.origin.w == -2.0 || s.flight.w >= 2.0){return s;}
  let rate=max(0.0,turnRate);let acceleration=rate/ramp;
  // Class edits may lower the cap. This explicit retune clamp precedes ordinary
  // acceleration-limited integration; unchanged limits preserve both bounds.
  let previous=capped(localAngularVelocity(s),rate);
  var desired=vec3<f32>(0.0);
  if(length(direction)>=${ANGULAR_SPEED_EPSILON}) {
    let error=headingError(s.q,direction);
    let angle=max(0.0,error.w-${ANGULAR_DIRECTION_EPSILON});
    let speed=min(min(rate,max(0.0,requestedRate)),min(angle/settle,sqrt(2.0*acceleration*angle)));
    desired=error.xyz*speed;
  }
  let omega=previous+capped(desired-previous,acceleration*dt);
  s.origin=vec4<f32>(omega,s.origin.w);
  s.q=angularRotation(s.q,(previous+omega)*(.5*dt));
  return s;
}
fn localAttitude(initial:Ship,dt:f32,turnRate:f32)->Ship {
  return steerLocalAttitude(initial,initial.v.xyz,dt,turnRate,turnRate);
}
`;
