/** Cinematic forward flight: steering intent cannot independently slide the hull. */
import {ANGULAR_SPEED_EPSILON} from './angular-motion.mjs';
import { DECELERATION_MULTIPLIER, THRUST_RAMP_SECONDS, SPEED_RESPONSE_SECONDS } from './braking.mjs';
export { THRUST_RAMP_SECONDS } from './braking.mjs';
export const STEERING_RESPONSE_SECONDS = SPEED_RESPONSE_SECONDS;
export const TURN_ACCEL_SHARE = .65;
export const FORWARD_MOTION_WGSL = /* wgsl */ `
fn forwardMotion(initial:Ship,steering:vec3<f32>,limits:vec4<f32>,turnRate:f32,dt:f32,controlDt:f32)->Ship {
  return forwardMotionWithEscape(initial,steering,limits,turnRate,dt,controlDt,vec3<f32>(0.0));
}
fn forwardMotionWithEscape(initial:Ship,steering:vec3<f32>,limits:vec4<f32>,turnRate:f32,dt:f32,controlDt:f32,escape:vec3<f32>)->Ship {
  let speed=length(initial.v.xyz);
  let acceleration=max(.0001,limits.y);
  // Keep some acceleration available for thrust/braking during a powered turn.
  let turn=min(turnRate,${TURN_ACCEL_SHARE}*acceleration/max(speed+acceleration*controlDt,.01));
  var heading=steering;let intentSpeed=length(steering);
  // A shallow contact still owns a meaningful escape direction at rest. Promote
  // only the angular cue: ambient noise, cancelled intent and throttle retain
  // their original deadbands/magnitude. Moving brakes must not amplify residue.
  if(speed<${ANGULAR_SPEED_EPSILON} && intentSpeed>0.0 && intentSpeed<${ANGULAR_SPEED_EPSILON} && dot(escape,escape)>0.0){
    heading=steering/intentSpeed*${ANGULAR_SPEED_EPSILON*2};
  }
  let planned=steerLocalAttitude(initial,heading,controlDt,turnRate,turn);
  let omega=planned.origin.xyz;
  var s=initial;
  s.q=angularRotation(initial.q,omega*dt);
  let forward=rotate(s.q,vec3<f32>(0.0,0.0,1.0));
  let cosine=max(0.0,dot(forward,unit(steering)));
  let square=cosine*cosine;
  let sixth=square*square*square;
  // Slow-turning capitals need stronger braking while off-heading to avoid
  // orbiting their destination. Agile hulls retain powered turns.
  let alignment=mix(sixth*sixth,square,smoothstep(.01,.1,turnRate));
  // Continuous forward-thrust envelope; no 25-degree stop threshold.
  // Brake through large heading changes. A stopped ship still turns toward the
  // desired travel direction; braking never turns the nose backwards by itself.
  let wanted=min(limits.x,length(steering))*alignment;
  return poweredForwardMotion(initial,omega,wanted,limits,dt,controlDt);
}
// One owner for acceleration/jerk and pose integration. Guidance controllers
// supply a turn and scalar speed; neither writes velocity independently.
fn poweredForwardMotion(initial:Ship,omega:vec3<f32>,wanted:f32,limits:vec4<f32>,dt:f32,controlDt:f32)->Ship {
  let speed=length(initial.v.xyz);let acceleration=max(.0001,limits.y);
  let before=rotate(initial.q,vec3<f32>(0.0,0.0,1.0));
  let forward=rotate(angularRotation(initial.q,omega*dt),vec3<f32>(0.0,0.0,1.0));
  let normal=(speed+acceleration*controlDt)*length(cross(omega,forward));
  let axial=sqrt(max(0.0,acceleration*acceleration-normal*normal));
  let brake=sqrt(max(0.0,pow(acceleration*${DECELERATION_MULTIPLIER},2.0)-normal*normal));
  let desired=clamp((wanted-speed)/${STEERING_RESPONSE_SECONDS},-brake,axial);
  let jerk=min(limits.z,acceleration/${THRUST_RAMP_SECONDS});
  let previous=dot(initial.a.xyz,before);
  let thrust=clamp(previous+clamp(desired-previous,-jerk*controlDt,jerk*controlDt),-brake,axial);
  return integrateForwardMotion(initial,omega,thrust,dt);
}
`;
