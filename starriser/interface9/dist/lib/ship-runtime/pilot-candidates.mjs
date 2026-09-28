import {ANGULAR_RAMP_SECONDS,ANGULAR_SETTLE_SECONDS} from './angular-motion.mjs';
import {TURN_ACCEL_SHARE,THRUST_RAMP_SECONDS} from './forward-motion.mjs';
/** Bounded acceleration-aware alternatives for imminent indexed contacts.
 * This is best-effort steering, not an ORCA collision-free guarantee. The
 * existing exact-cell filter and 64-record bucket budget remain authoritative.
 */
export const PILOT_CANDIDATES_WGSL = /* wgsl */ `
struct PilotThreats {records:array<u32,8>,risk:array<f32,8>,count:u32}
fn pilotRampedIntegral(initial:f32,wanted:f32,rate:f32,time:f32)->f32 {
  let ramp=min(time,abs(wanted-initial)/max(rate,.000001));
  return initial*ramp+.5*sign(wanted-initial)*rate*ramp*ramp+wanted*(time-ramp);
}
fn pilotPredictedTurn(s:Ship,error:vec4<f32>,available:f32,rate:f32,time:f32)->vec3<f32>{
  let acceleration=max(rate/${ANGULAR_RAMP_SECONDS},.000001);
  let forward=rotate(s.q,vec3<f32>(0.0,0.0,1.0));let retained=capped(localAngularVelocity(s),rate);
  // Keep yaw/pitch momentum even when the new aim lies on another turn axis.
  // Roll alone does not bend the predicted centerline.
  let initial=retained-forward*dot(retained,forward);
  let wanted=error.xyz*min(available,min(error.w/${ANGULAR_SETTLE_SECONDS},sqrt(2.0*acceleration*error.w)));
  let delta=wanted-initial;let duration=length(delta)/acceleration;let ramp=min(time,duration);
  let rotation=initial*ramp+delta*(.5*ramp*ramp/max(duration,.000001))+wanted*(time-ramp);
  let along=dot(rotation,error.xyz);let retainedAlong=max(0.0,dot(initial,error.xyz));
  // Long-horizon targets are bounded, but braking an existing turn may carry
  // the nose past the desired heading. Do not erase that stopping angle.
  let ceiling=max(error.w,retainedAlong*retainedAlong/(2.0*acceleration));
  return rotation+error.xyz*(min(along,ceiling)-along);
}
fn pilotReachablePosition(s:Ship,velocity:vec3<f32>,limits:vec4<f32>,time:f32)->vec3<f32>{
  let forward=rotate(s.q,vec3<f32>(0.0,0.0,1.0));let error=headingError(s.q,velocity);
  let speed=length(s.v.xyz);let acceleration=max(.0001,limits.y);let turnRate=dynamics(shipType(s)).w;
  let available=min(turnRate,${TURN_ACCEL_SHARE}*acceleration/max(speed+acceleration*min(time,.5),.01));
  let rotation=pilotPredictedTurn(s,error,available,turnRate,time);let turn=length(rotation);
  let axial=acceleration*sqrt(max(0.0,1.0-${TURN_ACCEL_SHARE}*${TURN_ACCEL_SHARE}));
  let thrust=clamp(dot(s.a.xyz,forward),-axial,axial);
  let requested=sign(length(velocity)-speed)*axial;
  let jerk=max(.000001,min(limits.z,acceleration/${THRUST_RAMP_SECONDS}));
  let change=pilotRampedIntegral(thrust,requested,jerk,time);
  let wanted=min(length(velocity),limits.x);
  // A speed request cannot instantly cancel retained thrust. Permit exactly
  // its stopping-speed excursion on either side, then bound long horizons.
  let excursion=thrust*abs(thrust)/(2.0*jerk);
  let nextSpeed=max(0.0,clamp(speed+change,min(wanted,speed+min(0.0,excursion)),max(wanted,speed+max(0.0,excursion))));
  let middle=rotate(angularRotation(s.q,rotation*.5),vec3<f32>(0.0,0.0,1.0));
  let arc=select(1.0,sin(turn*.5)/max(turn*.5,.000001),turn>.0001);
  return middle*((speed+nextSpeed)*.5*time*arc);
}
fn pilotThreats(s:Ship,i:u32)->PilotThreats {
  var result:PilotThreats;let center=contactCell(s.p.xyz);
  for(var cell=0u;cell<27u;cell++){
    let at=separationOffset(i)+cell*2u;let low=links[at];let high=links[at+1u];
    if((low|high)==0u){continue;}
    let location=neighborCell(center,cell);let first=firstContact(contactBucket(location));
    for(var half=0u;half<2u;half++){
      var mask=select(low,high,half==1u);
      while(mask!=0u){
        let record=first-1u+half*32u+firstTrailingBit(mask);mask&=mask-1u;
        let other=loadContact(record);if(other.slot==i||any(other.cell!=location)){continue;}
        let response=contactPush(s,other);if(response.w<=.05){continue;}
        // Risk rank, with serial tie-breaking independent of atomic insertion.
        let risk=response.w+1.0/(1.0+length(other.p-s.p.xyz))*.001+f32(other.serial&1023u)*.00000001;
        var slot=result.count;
        if(slot>=8u){slot=0u;for(var k=1u;k<8u;k++){if(result.risk[k]<result.risk[slot]){slot=k;}}}
        if(result.count<8u||risk>result.risk[slot]){result.records[slot]=record;result.risk[slot]=risk;result.count=min(8u,result.count+1u);}
      }
    }
  }
  return result;
}
fn pilotCandidateCost(s:Ship,velocity:vec3<f32>,desired:vec3<f32>,threats:PilotThreats,limits:vec4<f32>,horizon:f32)->f32 {
  var cost=dot(velocity-desired,velocity-desired)/max(dot(desired,desired),.0001);
  var before=vec3<f32>(0.0);let mine=repelRadius(shipType(s),journeyBodyRadius(s));
  for(var sample=1u;sample<=4u;sample++){
    let time=horizon*f32(sample)*.25;let prior=horizon*f32(sample-1u)*.25;
    let position=pilotReachablePosition(s,velocity,limits,time);
    for(var j=0u;j<threats.count;j++){
      let other=loadContact(threats.records[j]);let gap=other.p-s.p.xyz;
      let begin=gap+other.v*prior-before;let end=gap+other.v*time-position;let segment=end-begin;
      let along=clamp(-dot(begin,segment)/max(dot(segment,segment),.000001),0.0,1.0);
      let clearance=length(begin+segment*along)/max(mine+other.radius,.001);
      cost+=12.0*max(0.0,1.08-clearance)*contactPredictiveShare(s,other)/(1.0+time);
    }
    before=position;
  }
  return cost;
}
fn pilotChooseVelocity(s:Ship,i:u32,desired:vec3<f32>,limits:vec4<f32>,urgency:f32)->vec3<f32>{
  if(urgency<.1||length(desired)<.00001){return desired;}
  let threats=pilotThreats(s,i);if(threats.count==0u){return desired;}
  let horizon=clamp(2.0+length(s.v.xyz)/max(limits.y,.0001),2.0,CONTACT_HORIZON_SECONDS);
  let forward=unit(desired);var right=unit(cross(vec3<f32>(0.0,1.0,0.0),forward));
  if(length(right)<.1){right=vec3<f32>(1.0,0.0,0.0);}
  let angle=clamp(dynamics(shipType(s)).w*horizon,.02,.65);
  var best=desired;var score=pilotCandidateCost(s,best,desired,threats,limits,horizon);
  for(var k=0u;k<5u;k++){
    let turn=select(angle,-angle,k==1u||k==3u);
    let speed=length(desired)*select(1.0,.7,k>=2u);
    var candidate=(forward*cos(turn)+right*sin(turn))*speed;
    if(k==4u){candidate=forward*length(desired)*.35;}
    let cost=pilotCandidateCost(s,candidate,desired,threats,limits,horizon)+select(0.0,.002,k==1u||k==3u);
    if(cost<score){score=cost;best=candidate;}
  }
  return best;
}
`;
