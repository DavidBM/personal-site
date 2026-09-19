import {approachRequest} from './local-routes.mjs';
import {classOf} from './classes.mjs';
export const MAX_PROGRESS_AGE=.25;
export function progressCurrent(engine,summary,row) {
  return summary?.status==='ready'&&summary.lifetime===engine.lifetime&&Boolean(row)&&!row.stale
    &&row.epoch===engine.director.groupEpochs[row.fleet*32+row.type]
    &&engine.now>=summary.time&&engine.now-summary.time<=MAX_PROGRESS_AGE;
}
function address(engine,value) {
  if(!Number.isInteger(value.fleet)||value.fleet<0||value.fleet>=engine.director.fleetCount)throw new Error('Invalid progress fleet');
  if(!Number.isInteger(value.type)||value.type<0||value.type>=32||![0,1].includes(value.cohort))throw new Error('Invalid progress type/cohort');
}
function requestFromRow(engine,options,summary,row) {
  const request=approachRequest(engine.solar,{...options,at:summary.time,start:row.anchor});
  // Conservative demo authoring allowance for scattered entry points. An explicit
  // director deadline stays unchanged; this is not a proof of arbitrary entry paths.
  if(options.end===undefined) {
    const spread=Math.hypot(...row.anchor.map((x,i)=>Math.max(Math.abs(row.minimum[i]-x),Math.abs(row.maximum[i]-x))));
    request.end+=2*spread/(classOf(options.type).speed*.7);
  }
  return {fleet:options.fleet,type:options.type,cohort:options.cohort,revision:options.revision,request};
}
function sourceStatus(engine,summary,row,signal) {
  if(engine.closed)return 'closed';
  if(signal?.aborted)return 'superseded';
  if(!progressCurrent(engine,summary,row))return 'stale-progress';
  return row.live?null:'empty';
}
export async function planFromProgress(engine,value,provided=null,{signal}={}) {
  const options=structuredClone({...value,cohort:value.cohort??0});address(engine,options);
  const summary=provided??await engine.readProgress();
  const row=summary.groups?.[(options.fleet*32+options.type)*2+options.cohort];
  const status=sourceStatus(engine,summary,row,signal);
  if(status)return {status,revision:options.revision};
  return engine.planApproach(requestFromRow(engine,options,summary,row),{signal});
}
export function createProgressRetargeter(engine) {
  let controller=null,revision=0,state={pending:false,admitted:0,deferred:0};
  async function visit(batch,summary,index) {
    if(!progressCurrent(engine,summary,summary.groups?.[index]))summary=await engine.readProgress();
    const row=summary.groups?.[index];
    if(!batch.current()||!row?.live)return summary;
    const result=await planFromProgress(engine,{fleet:row.fleet,type:row.type,cohort:row.cohort,revision:batch.revision,planet:1,planeShift:batch.planeShift},summary,{signal:batch.signal});
    if(batch.current())state[result.status==='admitted'?'admitted':'deferred']++;
    return summary;
  }
  async function retarget(phase) {
    controller?.abort();controller=new AbortController();
    revision=Math.max(revision,...engine.director.intents.flatMap(intent=>intent.journeys.map(journey=>journey?.revision??0)))+1;
    const signal=controller.signal,lifetime=engine.lifetime;
    const batch={signal,revision,planeShift:.12*Math.sin(phase),current:()=>!signal.aborted&&!engine.closed&&engine.lifetime===lifetime};
    state={pending:true,admitted:0,deferred:0};
    try {
      let summary=await engine.readProgress();
      for(let index=0;index<engine.director.capacity.groups*2;index++) {
        if(!batch.current())return;
        summary=await visit(batch,summary,index);
      }
    }finally{if(controller.signal===signal)state.pending=false;}
  }
  return {retarget,get status(){return state;}};
}
