import {EVENT_POSE_WORDS} from './event-gpu.mjs';
// Sparse, GPU-owned discontinuity history. Ordinary frames only clear one index
// per ship. Host preflight bounds allocation; render traversals are also bounded.
export const CORRECTION_WORDS=292,CORRECTIONS_PER_POPULATION=2,MAX_SHIP_CORRECTIONS=10;
export const correctionWords=count=>count*(1+CORRECTIONS_PER_POPULATION*CORRECTION_WORDS);
export const correctionAddress=/* wgsl */`
fn correctionDirectory(count:u32)->u32{return eventPoseBase(count)+count*${EVENT_POSE_WORDS}u;}
fn correctionAt(count:u32,record:u32)->u32{return correctionDirectory(count)+count+record*${CORRECTION_WORDS}u;}
`;
export const CORRECTION_WRITE=/* wgsl */`
${correctionAddress}
var<private> journalEnabled:bool=false;
fn recordCorrection(before:Ship,after:Ship,i:u32,now:f32) {
  if(!journalEnabled){return;}
  let count=u32(u.clock.z);let slot=atomicAdd(&heads[scheduleCounter()+1u],1u);
  if(slot>=count*${CORRECTIONS_PER_POPULATION}u){return;} // Guard even a malformed diagnostic dispatch.
  let base=correctionAt(count,slot);let directory=correctionDirectory(count)+i;
  links[base]=bitcast<u32>(now);links[base+1u]=links[directory];links[base+2u]=0u;links[base+3u]=0u;
  storePose(before,base+4u);storePose(after,base+52u);
  for(var sample=0u;sample<48u;sample++) {
    let value=bitcast<vec4<u32>>(history[i*48u+sample]);let at=base+100u+sample*4u;
    links[at]=value.x;links[at+1u]=value.y;links[at+2u]=value.z;links[at+3u]=value.w;
  }
  links[directory]=slot+1u;
}
`;
export const CORRECTION_READ=/* wgsl */`
${correctionAddress}
fn correctionDisplay(i:u32,initial:Ship,result:Ship,timeStart:f32,timeEnd:f32,now:f32,eventStart:bool)->Ship {
  let count=u32(view.clock.y);var record=eventPoses[correctionDirectory(count)+i];
  var before=initial;var after=result;var start=timeStart;var end=timeEnd;var foundBefore=false;
  for(var n=0u;n<${MAX_SHIP_CORRECTIONS}u&&record>0u;n++) {
    let at=correctionAt(count,record-1u);let time=bitcast<f32>(eventPoses[at]);
    if(time>now&&time<=end){after=loadPose(at+4u);end=time;}
    if(!foundBefore&&time<=now&&time>=start&&!(eventStart&&time==start)) {before=loadPose(at+52u);start=time;foundBefore=true;}
    record=eventPoses[at+1u];
  }
  return intervalDisplay(before,after,start,end,now);
}
fn displayHistory(i:u32,sample:u32)->vec4<f32> {
  let count=u32(view.clock.y);var record=eventPoses[correctionDirectory(count)+i];var selected=0u;
  for(var n=0u;n<${MAX_SHIP_CORRECTIONS}u&&record>0u;n++) {
    let at=correctionAt(count,record-1u);
    if(bitcast<f32>(eventPoses[at])>view.clock.x){selected=at;}
    record=eventPoses[at+1u];
  }
  if(selected==0u){return history[i*48u+sample];}
  let at=selected+100u+sample*4u;
  return bitcast<vec4<f32>>(vec4<u32>(eventPoses[at],eventPoses[at+1u],eventPoses[at+2u],eventPoses[at+3u]));
}
`;
