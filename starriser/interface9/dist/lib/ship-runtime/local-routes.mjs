import {orbitRadius,orbitTilt} from './flight-layout.mjs';
import {classOf,radiusOf} from './classes.mjs';
export const ROUTE_POINTS=16,ROUTE_WORDS=8+ROUTE_POINTS*4;
export const modelKey=solar=>JSON.stringify([solar.sceneEpochMs,solar.definition.version,solar.definition.epochMs,solar.definition.origin,solar.definition.bodies]);
export function approachRequest(solar,{type,planet=1,at=0,start,planeShift=0,end}) {
  const p=solar.bodyAt(planet,at),relative=start.map((x,i)=>x-p[i]);
  const tilt=orbitTilt(type)+planeShift,phase=Math.atan2(relative[1]*Math.sin(tilt)+relative[2]*Math.cos(tilt),relative[0]);
  const radius=orbitRadius(type,p[3]),destination=[radius*Math.cos(phase),radius*Math.sin(phase)*Math.sin(tilt),radius*Math.sin(phase)*Math.cos(tilt)];
  const c=classOf(type),distance=Math.hypot(...relative.map((x,i)=>x-destination[i]));
  end??=at+Math.max(30,4*distance/(c.speed*.7)+4*Math.PI/c.turn+20);
  const freeRadius=Math.min(radius-p[3],Math.hypot(...relative)-p[3])-radiusOf(type)-2;
  const corridorWidth=Math.max(.01,Math.min(25,freeRadius*.7));
  return {planet,at,end,planeShift,start:relative,destination,arrival:'ring',corridorWidth,capability:[c.speed,c.acceleration,c.jerk,c.turn,radiusOf(type),2+corridorWidth]};
}
function checkAddress(director,fleet,type,cohort) {
  if(!Number.isInteger(fleet)||fleet<0||fleet>=director.fleetCount)throw new Error('Invalid route fleet');
  if(!Number.isInteger(type)||type<0||type>=32||![0,1].includes(cohort))throw new Error('Invalid route type/cohort');
}
function validateColumns(columns,windowSeconds) {
  if(!Array.isArray(columns))throw new Error('Invalid route columns');
  const count=columns[2];
  if(columns[0]!==1||columns[1]!==1||!Number.isInteger(count)||count<2||count>ROUTE_POINTS)throw new Error('Invalid planned route');
  if(columns.length!==12+count*4||!columns.every(Number.isFinite))throw new Error('Invalid route point records');
  validateSchedule(columns,windowSeconds);
}
function validateSchedule(columns,windowSeconds) {
  if(columns[3]!==1||columns[4]>windowSeconds)throw new Error('Local route does not fit the declared window');

  const times=Array.from({length:columns[2]},(_,i)=>columns[15+i*4]);
  if(times[0]!==0||times.at(-1)!==columns[4]||!times.every((x,i)=>i===0||x>=times[i-1]))throw new Error('Invalid route schedule');
}
function validCorridor(request) {
  const width=request.corridorWidth??0;
  return Number.isFinite(width)&&width>=0&&width+0.002<=request.capability[5]&&[undefined,'ring'].includes(request.arrival);
}
function fitsCapability(request,type) {
  const c=classOf(type),limit=[c.speed,c.acceleration,c.jerk,c.turn],values=request.capability;
  return values.length===6&&limit.every((x,i)=>values[i]>0&&values[i]<=x)&&values[4]>=radiusOf(type)&&values[5]>=.002;
}
function matchesSource(request,result,type,key) {
  return modelKey(result)===key&&validCorridor(request)&&JSON.stringify(result.request)===JSON.stringify(request)&&fitsCapability(request,type);
}
function matchesSchedule(intent,request){return ['planet','at','end'].every(key=>intent[key]===request[key])&&(intent.planeShift??0)===(request.planeShift??0);}
function matchesJourney(intent,revision,request,now){return intent?.revision===revision&&intent.mode==='approach'&&now<=request.end&&matchesSchedule(intent,request);}
export function createLocalRoutes(director,solar) {
  const data=new Float32Array(director.capacity.groups*2*ROUTE_WORDS),key=modelKey(solar),records=new Map();
  function validate({fleet,type,cohort=0,revision,request,result}) {
    checkAddress(director,fleet,type,cohort);
    if(!matchesSource(request,result,type,key))return false;
    validateColumns(result.columns,request.end-request.at);
    return packRoute(revision,request,result,type);
  }
  function prepare(plan,now,proposed=null) {
    const {fleet,type,cohort=0,revision,request,result}=plan;
    checkAddress(director,fleet,type,cohort);const intent=proposed??director.intents[fleet*32+type].journeys[cohort];
    if(!matchesJourney(intent,revision,request,now))return false;
    const record=validate(plan);if(!record)return false;
    const index=(fleet*32+type)*2+cohort,offset=index*ROUTE_WORDS;
    if(records.get(index)?.revision===revision)return false;
    return {offset,record,index,snapshot:structuredClone({revision,request,result})};
  }
  function commit(prepared){data.set(prepared.record,prepared.offset);records.set(prepared.index,prepared.snapshot);return prepared;}
  function install(plan,now){const prepared=prepare(plan,now);return prepared&&commit(prepared);}
  return {data,records,validate,prepare,commit,install,reset(){data.fill(0);records.clear();}};
}
function packRoute(revision,request,result,type) {
    const width=request.corridorWidth??0;
    const record=new Float32Array(ROUTE_WORDS);record.set([revision,result.columns[2],request.planet+1,request.arrival==='ring'?-width:width,request.at,request.end,result.columns[4],Math.max(3,radiusOf(type)*1.5,width*1.25)]);
    record.set(result.columns.slice(12),8);if(!record.every(Number.isFinite))throw new Error('Route exceeds GPU range');
    return record;
}
export const ROUTE_CONTROL_WGSL=`struct LocalRoute {header:vec4<f32>,clock:vec4<f32>,points:array<vec4<f32>,${ROUTE_POINTS}>}`;
export const ROUTE_GUIDANCE_WGSL=/* wgsl */`
fn routeStep(initial:Ship,journey:Journey,now:f32,fallback:vec3<f32>)->NavigationResult {
  var s=initial;
  let cohort=navigationCohort(s);
  let route=groupRoute(groupOf(s),cohort);
  if(route.header.x!=s.flight.x||route.header.z!=journey.range.z||route.header.y<2.0){return NavigationResult(s,fallback);}
  let count=u32(route.header.y);let planet=body(u32(route.header.z)-1u,now,u.control.x);
  let velocity=bodyVelocity(u32(route.header.z)-1u,now,u.control.x);let position=s.p.xyz-planet.xyz;
  // Integration resolves missed deadlines before this controller. Never
  // extrapolate an expired corridor if this guidance is called independently.
  if(s.origin.w>=1.0){return NavigationResult(s,fallback);}
  if(now>route.clock.y){return NavigationResult(s,velocity);}
  var nearest=1e30;var segment=0u;var fraction=0.0;var point=route.points[0].xyz;
  for(var i=0u;i+1u<count;i++) {
    let a=route.points[i].xyz;let delta=route.points[i+1u].xyz-a;
    let t=clamp(dot(position-a,delta)/max(dot(delta,delta),.00001),0.0,1.0);let projected=a+delta*t;
    let distance=dot(position-projected,position-projected);
    if(distance<=nearest){nearest=distance;segment=i;fraction=t;point=projected;}
  }
  let limits=dynamics(shipType(s));let next=route.points[segment+1u].xyz;
  let tangent=unit(next-route.points[segment].xyz);
  let nominalRemaining=max(.1,route.clock.z-mix(route.points[segment].w,route.points[segment+1u].w,fraction));
  let urgency=nominalRemaining/max(.1,route.clock.y-now);
  let speed=limits.x*clamp(.7*urgency,.35,.85);
  let lateral=point-position;let lateralDistance=length(lateral);
  // The corridor supplies direction and a boundary, not an attractive centerline.
  // Inside its width, density and each ship's existing lateral displacement are free.
  let correction=unit(lateral)*max(0.0,lateralDistance-abs(route.header.w));
  let desired=velocity+capped(tangent*speed+correction*1.4,speed);
  var arrival=length(position-route.points[count-1u].xyz);
  if(route.header.w<0.0) {
    let tilt=orbitTilt(shipType(s))+journey.range.w;let axis=vec3<f32>(0.0,sin(tilt),cos(tilt));
    let phase=atan2(dot(position,axis),position.x);
    let onRing=orbitRadius(shipType(s),planet.w)*(vec3<f32>(cos(phase),0.0,0.0)+axis*sin(phase));
    arrival=length(position-onRing);
  }
  if(arrival<route.clock.w){s.origin.w=1.0;}
  return NavigationResult(s,mix(fallback,desired,smoothstep(route.clock.w,route.clock.w*2.0,arrival)));
}
`;
