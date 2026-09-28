/** A geometric forward target, with speed independent of steering magnitude.
 * Targets and distances are laboratory coordinates. No extra persistent state:
 * Ship.origin.xyz and Ship.a already own angular velocity and thrust history.
 */
import {TURN_ACCEL_SHARE} from './forward-motion.mjs';
export const TRANSPORT_MOTION_WGSL = /* wgsl */ `
fn localFlightMotion(s:Ship,intent:vec3<f32>,forces:vec3<f32>,reach:f32,aligning:bool,spacing:vec4<f32>,avoid:vec3<f32>,limits:vec4<f32>,turnRate:f32,dt:f32,controlDt:f32)->Ship {
  let steering=s.v.xyz+forces*.5;
  if(reach<=0.0){return forwardMotionWithEscape(s,steering,limits,turnRate,dt,controlDt,spacing.xyz);}
  // Fleet departure is an explicit, latched phase. A curvature follower turns
  // proportionally to speed; feeding its deliberately held pace back into
  // readiness would leave every hull creeping too slowly to become ready.
  if(aligning){
    let available=min(turnRate,${TURN_ACCEL_SHARE}*max(.0001,limits.y)/max(length(s.v.xyz)+limits.y*controlDt,.01));
    let planned=steerLocalAttitude(s,steering,controlDt,turnRate,available);
    return poweredForwardMotion(s,planned.origin.xyz,0.0,limits,dt,controlDt);
  }
  let speed=length(s.v.xyz);let forward=rotate(s.q,vec3<f32>(0.0,0.0,1.0));
  // Density/formation only bend the target; their vector magnitude cannot
  // secretly multiply throttle. Imminent contact/body constraints may brake.
  let danger=max(spacing.w,clamp(length(avoid)/max(limits.y,.0001),0.0,1.0));
  let braking=max(0.0,-dot(spacing.xyz+avoid,forward));
  let cruise=min(length(intent),limits.x);
  let wanted=mix(cruise,min(cruise,max(0.0,speed-braking*.5)),danger*f32(braking>0.0));
  let probe=mix(reach,min(reach,max(.05,repelScale(shipType(s))*2.0)),danger);
  return transportMotion(s,unit(steering)*probe,wanted,limits,turnRate,dt,controlDt);
}
fn transportMotion(initial:Ship,aimDelta:vec3<f32>,nominal:f32,limits:vec4<f32>,turnRate:f32,dt:f32,controlDt:f32)->Ship {
  let speed=length(initial.v.xyz);let acceleration=max(.0001,limits.y);
  let distance=length(aimDelta);let direction=unit(aimDelta);
  let forward=rotate(initial.q,vec3<f32>(0.0,0.0,1.0));
  let cosine=dot(forward,direction);
  // Curvature of the circle through a forward target, tangent to this hull.
  // Unlike an angle-power throttle, a distant turn is allowed a wider arc.
  let curvature=2.0*length(cross(forward,direction))/max(distance,.0001);
  let turn=max(0.0,turnRate);
  let reachable=min(turn/max(curvature,.000001),sqrt(${TURN_ACCEL_SHARE}*acceleration/max(curvature,.000001)));
  // A target behind the hull needs deliberate braking/reorientation. Its
  // antipodal circle has zero curvature but is not a reachable forward arc.
  let ahead=smoothstep(0.0,.25,cosine);
  // From rest, a large initial error is an explicit launch maneuver. Complete
  // it before starting a long looping arc. This cannot stop a cruising ship.
  let launching=speed<max(.00001,limits.x*.001)&&cosine<.8660254;
  let wanted=select(min(min(max(0.0,nominal),limits.x),reachable)*ahead,0.0,launching);
  let available=min(turnRate,${TURN_ACCEL_SHARE}*acceleration/max(speed+acceleration*controlDt,.01));
  let curveRate=max(speed,acceleration*controlDt)*curvature;
  let rate=min(available,select(mix(turnRate,curveRate,ahead),turnRate,launching));
  let heading=direction*select(0.0,max(nominal,.004),distance>.0001);
  let planned=steerLocalAttitude(initial,heading,controlDt,turnRate,rate);
  return poweredForwardMotion(initial,planned.origin.xyz,wanted,limits,dt,controlDt);
}
`;
