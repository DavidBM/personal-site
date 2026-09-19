import {MAX_GROUP_EVENTS} from './event-frame.mjs';
import {CONTACT_WORDS} from './contact-cache.mjs';
import {CONTACT_QUERY_WORDS} from './contact-queries.mjs';
export const EVENT_POSE_WORDS=MAX_GROUP_EVENTS*2*48;
const FIELDS=['p','v','a','q','aux','identity','memory','flight','origin','tactic','fx','aim'];
export const eventControlWgsl=capacity=>/* wgsl */`
struct EventRow {clock:vec4<f32>,order:vec4<u32>,live:array<u32,8>,intent:GroupIntent,routes:array<LocalRoute,2>,battle:vec4<u32>,encounter:vec4<f32>}
struct RecoveryPlacement {center:vec4<f32>,velocity:vec4<f32>}
struct EventControl {clock:vec4<f32>,directory:array<vec4<u32>,${capacity.groups}>,rows:array<EventRow,${capacity.groups*(MAX_GROUP_EVENTS+1)}>,placements:array<RecoveryPlacement,${capacity.groups*2}>}
`;
export const eventOwnWgsl=/* wgsl */`
var<private> eventGroup:u32=0xffffffffu;
var<private> eventRow:u32=0u;
fn ownEvent(group:u32)->bool {
  if(director.events.clock.x==0.0||group!=eventGroup){return false;}
  return director.events.directory[group].x>0u;
}
fn eventIndex(group:u32,row:u32)->u32{return group*${MAX_GROUP_EVENTS+1}u+row;}
`;
export function eventField(name,type,base,field,enabled) {
  return `fn ${name}(group:u32)->${type}{${enabled?`if(ownEvent(group)){return director.events.rows[eventIndex(group,eventRow)].${field};}`:''}return ${base};}`;
}
export const eventPoseAddress=/* wgsl */`
fn eventPoseBase(count:u32)->u32{return count*${2+CONTACT_WORDS+CONTACT_QUERY_WORDS}u+65536u;}
fn eventPoseAt(count:u32,ship:u32,event:u32,side:u32)->u32{return eventPoseBase(count)+(ship*${MAX_GROUP_EVENTS*2}u+event*2u+side)*48u;}
`;
export const poseWrite=/* wgsl */`
fn storePose(s:Ship,base:u32) {
${FIELDS.map((field,k)=>`  {let value=${field==='identity'?`s.${field}`:`bitcast<vec4<u32>>(s.${field})`};links[base+${k*4}u]=value.x;links[base+${k*4+1}u]=value.y;links[base+${k*4+2}u]=value.z;links[base+${k*4+3}u]=value.w;}`).join('\n')}
}
`;
export const eventPoseWrite=/* wgsl */`${eventPoseAddress}
${poseWrite}
fn storeEventPose(s:Ship,i:u32,event:u32,side:u32){storePose(s,eventPoseAt(u32(u.clock.z),i,event,side));}
`;
export const eventPoseRead=/* wgsl */`
@group(0) @binding(5) var<storage,read> eventPoses:array<u32>;
${eventPoseAddress}
fn loadPose(base:u32)->Ship {
  var s:Ship;
${FIELDS.map((field,k)=>`  s.${field}=${field==='identity'?'':'bitcast<vec4<f32>>('}vec4<u32>(eventPoses[base+${k*4}u],eventPoses[base+${k*4+1}u],eventPoses[base+${k*4+2}u],eventPoses[base+${k*4+3}u])${field==='identity'?'':')'};`).join('\n')}
  return s;
}
fn loadEventPose(i:u32,event:u32,side:u32)->Ship{return loadPose(eventPoseAt(u32(view.clock.y),i,event,side));}
// Warp is kinematic even when its endpoint falls between simulation snapshots.
// Preserve warp presentation before that date and interpolate cruise only after it.
fn intervalDisplay(before:Ship,after:Ship,timeStart:f32,timeEnd:f32,now:f32)->Ship {
  if(now>=timeEnd){return after;}
  var start=timeStart;var point=before.p.xyz;var s=after;
  let warp=before.flight.w>=2.0&&before.flight.x==after.flight.x&&before.identity.z>0u&&after.identity.z>0u;
  if(warp) {
    let endpoint=before.origin.xyz+before.v.xyz*(before.flight.z-before.flight.y);
    if(now<before.flight.z) {
      s=before;s.p=vec4<f32>(before.origin.xyz+before.v.xyz*max(0.0,now-before.flight.y),s.p.w);
      let fraction=clamp((now-timeStart)/max(.000001,timeEnd-timeStart),0.0,1.0);let sign=select(-1.0,1.0,dot(before.q,after.q)>=0.0);s.q=normalize(mix(before.q,after.q*sign,fraction));return s;
    }
    if(before.flight.z>=timeStart&&before.flight.z<timeEnd){point=endpoint;start=before.flight.z;}
  }
  let fraction=clamp((now-start)/max(.000001,timeEnd-start),0.0,1.0);
  s.p=vec4<f32>(mix(point,after.p.xyz,fraction),s.p.w);
  let sign=select(-1.0,1.0,dot(before.q,after.q)>=0.0);s.q=normalize(mix(before.q,after.q*sign,fraction));return s;
}
fn eventDisplay(i:u32,initial:Ship,result:Ship)->Ship {
  let group=groupOf(initial);let count=director.events.directory[group].x;let now=view.clock.x;
  var before=initial;var after=result;var start=director.events.clock.y;var end=director.events.clock.z;var eventStart=false;
  for(var event=0u;event<count;event++) {
    let at=director.events.rows[group*${MAX_GROUP_EVENTS+1}u+event+1u].clock.x;
    if(now<at){after=loadEventPose(i,event,0u);end=at;break;}
    before=loadEventPose(i,event,1u);start=at;eventStart=true;
  }
  return correctionDisplay(i,before,after,start,end,now,eventStart);
}
`;
