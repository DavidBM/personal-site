import {ANGULAR_RAMP_SECONDS,ANGULAR_SETTLE_SECONDS} from './angular-motion.mjs';
import {TURN_ACCEL_SHARE} from './forward-motion.mjs';
import {DECELERATION_MULTIPLIER,THRUST_RAMP_SECONDS} from './braking.mjs';
/** Production-only recovery math. Imports numeric constants, not WGSL libraries.
 * No route scans, bindings or entry points.
 * Local pilot members tag tactic.x = -(1 + pressure); y = last error, z = its
 * simulation timestamp. aim.xyz fences journey/order/phase, aim.w caches the
 * individual arrival demand, and memory.w is the normalized capture dwell.
 * aux.yz/fx.z hold the member's passing plane/body (pilot-bypass.mjs). Combat
 * owns these fields again after localStep clears the tag. tactic.w keeps its
 * existing fade. The bypass planes/IDs are excluded from clock rebasing.
 */
export const PILOT_RECOVERY_WGSL = /* wgsl */ `
fn pilotRecoveryFactor(s:Ship)->f32 {return max(max(1.0,-s.tactic.x),max(director.fleetGuides[s.identity.y].status.y,select(1.0,s.aim.w,s.tactic.x<0.0)));}
fn pilotRecoveryFrequency(s:Ship,dt:f32)->f32 {
  // Response stays resolvable at this cadence; actuator authority has no game cap.
  return min(.5*sqrt(pilotRecoveryFactor(s)),.25/max(dt,.001));
}
fn pilotRelativePosition(s:Ship,reference:Ship)->vec3<f32> {
  if(s.positionLow.w>0.0&&reference.positionLow.w>0.0){
    return (reference.positionAnchor.xyz-s.positionAnchor.xyz)+(reference.positionLow.xyz-s.positionLow.xyz);
  }
  return reference.p.xyz-s.p.xyz;
}
fn pilotTrackingVelocity(error:vec3<f32>,velocity:vec3<f32>,quiet:f32,frequency:f32)->vec3<f32> {
  let correction=error*max(0.0,1.0-quiet/max(length(error),.000001));
  return velocity+correction*(frequency*.5);
}
fn pilotAssessRecovery(initial:Ship,error:vec3<f32>,relativeVelocity:vec3<f32>,heading:vec3<f32>,blocked:bool,enabled:bool,now:f32)->Ship {
  var s=initial;let quiet=max(.02,repelScale(shipType(s))*.75);
  let distance=length(error);let relativeSpeed=length(relativeVelocity);
  let forward=rotate(s.q,vec3<f32>(0.0,0.0,1.0));
  let cosine=dot(forward,unit(heading));let turning=length(heading)>.00001&&cosine<.5;
  // While reorienting, expect angular progress, not forward translation.
  let score=select(sqrt(dot(error,error)+.25*dot(relativeVelocity,relativeVelocity)),quiet*(2.0-cosine),turning);
  let phase=select(0.0,s.flight.w,enabled);
  let observation=select(score,-score,turning);
  let stamp=vec3<f32>(s.flight.x,director.fleetGuides[s.identity.y].status.x,phase);
  if(s.tactic.x>=0.0||any(s.aim.xyz!=stamp)){
    s.tactic=vec4<f32>(-1.0,observation,now+1.0,s.tactic.w);s.aim=vec4<f32>(stamp,s.aim.w);s.fx.y=0.0;
    return s;
  }
  // A new kind of expectation retains authority but starts a fresh comparison.
  if((s.tactic.y<0.0)!=turning){s.tactic.y=observation;s.tactic.z=now;return s;}
  let elapsed=now-s.tactic.z;if(elapsed<.25){return s;}
  // Shared schedule authority is a floor, never accumulated frustration debt.
  var pressure=max(0.0,-s.tactic.x-1.0);
  let settled=distance<=quiet&&relativeSpeed<=quiet*.5;
  if(!enabled||settled){pressure/=1.0+elapsed*2.0;}
  else if(!blocked&&elapsed<2.0){
    let expected=abs(s.tactic.y)/(1.0+.1*elapsed);
    let miss=max(0.0,score-expected-quiet*.05)/max(quiet,abs(s.tactic.y));
    pressure+=elapsed*.7*clamp(miss*10.0,0.0,1.0);
  }
  // Refresh the observation even when blocked; no stored debt on release.
  s.tactic=vec4<f32>(-(1.0+pressure),observation,now,s.tactic.w);
  return s;
}
fn pilotRecoveryMotion(initial:Ship,steering:vec3<f32>,nominal:f32,reach:f32,base:vec4<f32>,turnRate:f32,feedforward:vec3<f32>,enabled:bool,dt:f32,controlDt:f32)->Ship {
  let speed=length(initial.v.xyz);let forward=rotate(initial.q,vec3<f32>(0.0,0.0,1.0));
  let direction=unit(steering);let cosine=dot(forward,direction);
  let factor=pilotRecoveryFactor(initial);let gain=sqrt(factor);
  let frequency=select(1.0,pilotRecoveryFrequency(initial,controlDt),enabled);
  let curvature=2.0*length(cross(forward,direction))/max(reach,.02);
  // Solve the existing coupled turn budget, including one control interval.
  // Only actual speed triggers immediate curve assistance, not a faraway goal.
  let curveRate=min(speed*curvature,.25/max(controlDt,.001));
  let curveAcceleration=curveRate*speed/max(${TURN_ACCEL_SHARE}-curveRate*controlDt,.1);
  let aligned=nominal*smoothstep(0.0,.25,cosine);
  let stopping=max(0.0,speed*speed-aligned*aligned)/(${(2*DECELERATION_MULTIPLIER).toFixed(8)}*max(reach-speed*controlDt,.02));
  let previousAxial=dot(initial.a.xyz,forward);
  let retained=max(max(previousAxial,-previousAxial/${DECELERATION_MULTIPLIER}),length(cross(localAngularVelocity(initial),initial.v.xyz))/${TURN_ACCEL_SHARE});
  // Safety authority is independent of formation frustration / captured state.
  let acceleration=max(retained,max(base.y*factor,max(curveAcceleration,stopping)));
  let turn=min(max(turnRate*gain,curveRate),.25/max(controlDt,.001));
  let ramp=max(${THRUST_RAMP_SECONDS}/gain,controlDt*2.0);
  let jerk=max(base.z*factor*gain,max(0.0,acceleration-base.y)/ramp);
  let limits=vec4<f32>(base.x*gain,acceleration,jerk,base.w);
  let available=min(turn,${TURN_ACCEL_SHARE}*acceleration/max(speed+acceleration*controlDt,.01));
  let reachable=min(turn/max(curvature,.000001),sqrt(${TURN_ACCEL_SHARE}*acceleration/max(curvature,.000001)));
  let ahead=smoothstep(0.0,.25,cosine);
  // Rest detection is a normal-class threshold, independent of turbo.
  let launching=speed<max(.00001,base.x*.001)&&cosine<.8660254;
  let wanted=select(min(max(0.0,nominal),min(limits.x,reachable))*ahead,0.0,launching);
  let rate=min(available,select(mix(turn,max(speed,acceleration*controlDt)*curvature,ahead),turn,launching));
  let cue=direction*select(0.0,max(nominal,.004),length(steering)>.000001);
  // Retain existing spin during authority release; never clamp live attitude state.
  let cap=max(turn,length(localAngularVelocity(initial)));
  let planned=steerLocalAttitudeResponse(initial,cue,controlDt,cap,rate,max(${ANGULAR_RAMP_SECONDS}/gain,controlDt*2.0),max(${ANGULAR_SETTLE_SECONDS}/gain,controlDt*2.0));
  let brakeResponse=max(controlDt*2.0,reach/max(speed,.001)*.5);
  let response=min(1.0/(2.0*frequency),select(1e10,brakeResponse,speed>wanted));
  var s=poweredForwardMotionResponse(initial,planned.origin.xyz,wanted,limits,dt,controlDt,response,ramp,dot(feedforward,forward));
  let axial=dot(s.a.xyz,rotate(s.q,vec3<f32>(0.0,0.0,1.0)));
  let ordinary=base.y*select(1.0,${DECELERATION_MULTIPLIER},axial<0.0);
  let effort=max(length(s.a.xyz)/max(ordinary,.0001),
    max(length(s.origin.xyz)/max(turnRate,.0001),length(s.v.xyz)/max(base.x,.0001)));
  s.a.w=1.0-1.0/max(1.0,effort);
  return s;
}
`;
