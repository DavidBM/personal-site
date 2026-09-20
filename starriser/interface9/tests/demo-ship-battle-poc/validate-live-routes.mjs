import {createNavigationEngine} from './navigation-engine.mjs';
import {approachRequest} from './local-routes.mjs';
import {createEngine} from './engine.mjs';
import {createDirectorWorker} from './worker-client.mjs';
import {classOf,radiusOf} from './classes.mjs';
const outcome=promise=>promise.then(value=>({value}),error=>({error}));
function heldWorker() {
  const actual=createDirectorWorker(),jobs=[];
  return {jobs,request(kind,input,options){
    const response=actual.request(kind,input,options);let release;
    const gate=new Promise(resolve=>{release=resolve;});jobs.push({response,release});
    return Promise.all([response,gate]).then(([result])=>result);
  },ready:index=>jobs[index].response,release(index){jobs[index].release();},
  destroy(){actual.destroy();for(const job of jobs)job.release();},get status(){return actual.status;}};
}
function solarScene() {
  const body=(orbit,radius)=>[orbit,radius,orbit===0?0:100000,0,1,0,0,0,0,0,1,0];
  return {sceneEpochMs:1700000000000,definition:{version:1,epochMs:1700000000000,origin:[0,0,0],bodies:[...body(0,10),...body(1000,1),...body(2000,1)]}};
}
function command(e,value){return e.command({revision:e.director.revision+1,...value});}
function plan(e,revision,extra={}) {
  const c=classOf(0);
  return {fleet:0,type:0,revision,request:{planet:0,at:e.now,end:e.now+40,start:[-35,0,0],destination:[19.6,0,0],capability:[c.speed,c.acceleration,c.jerk,c.turn,radiusOf(0),2]},...extra};
}
async function preemption(ctx,e,gate) {
  command(e,{fleet:0,type:0,journey:{mode:'warp',revision:1,at:0,end:5,exit:[-20,0,0]}});e.step(.5,.5);
  const first=e.planApproach(plan(e,2));await gate.ready(0);
  const start=new Float32Array(await e.read(e.state));e.step(1,.5);
  const moved=new Float32Array(await e.read(e.state));
  ctx.assert(e.director.intents[0].journeys[0].mode==='warp'&&Math.abs(start[0]-moved[0])>.1,'accepted warp keeps moving while local replanning is pending');
  const secondInput=plan(e,3),second=e.planApproach(secondInput);
  ctx.assert(e.planApproach(secondInput)===second,'duplicate pending route revisions share one worker request');
  const conflict=await outcome(e.planApproach({...secondInput,request:{...secondInput.request,end:100}}));
  ctx.assert(Boolean(conflict.error),'a conflicting payload cannot reuse a pending journey revision');
  secondInput.fleet=1;secondInput.type=4;await gate.ready(1);
  gate.release(0);ctx.assert((await first).status==='superseded','older completed route cannot replace a newer pending revision');
  command(e,{fleet:1,joined:true});const before=new Uint8Array(await e.read(e.state)),history=new Uint8Array(await e.read(e.history));
  gate.release(1);ctx.assert((await second).status==='admitted'&&e.director.intents[0].journeys[0].revision===3,'latest route retains its fleet/type snapshot and survives unrelated fleet orders');
  const after=new Uint8Array(await e.read(e.state));
  ctx.assert(before.every((x,i)=>x===after[i]),'atomic route admission never changes a live GPU state byte');
  e.step(e.now,0);const activated=new Float32Array(await e.read(e.state)),previous=new Float32Array(before.buffer),trails=new Uint8Array(await e.read(e.history));
  ctx.assert([0,1,2].every(i=>activated[i]===previous[i])&&Math.hypot(...activated.slice(4,7))<=classOf(0).speed,'live warp-to-route preemption preserves position and hands off cruise velocity');
  ctx.assert(history.every((x,i)=>x===trails[i]),'live route preemption preserves every trail sample');
}
async function authority(ctx,e,gate) {
  const old=e.planApproach(plan(e,4));await gate.ready(2);
  command(e,{fleet:0,type:0,joined:true});command(e,{fleet:0,type:0,joined:false});
  gate.release(2);ctx.assert((await old).status==='superseded','role change away and back invalidates old planning results');
  const kept=e.planApproach(plan(e,5));await gate.ready(3);const epoch=e.director.navigationEpochs[0];
  command(e,{fleet:0,type:0,remaining:19});gate.release(3);
  ctx.assert((await kept).status==='admitted'&&epoch<e.director.navigationEpochs[0],'casualty-only reports allow the pending journey to be admitted');
  const input=plan(e,6),invalid=outcome(e.planApproach(input)),reply=await gate.ready(4),revision=e.director.revision;
  reply.columns[4]=NaN;gate.release(4);ctx.assert(Boolean((await invalid).error)&&e.director.revision===revision&&e.director.intents[0].journeys[0].revision===5,'invalid route payload fails before changing accepted intent');
  const retry=e.planApproach(input);await gate.ready(5);gate.release(5);
  ctx.assert((await retry).status==='admitted','failed planning can retry the same immutable unaccepted revision');
  const prior=new Float32Array(await e.read(e.state));e.step(e.now,0);const current=new Float32Array(await e.read(e.state));
  ctx.assert([0,1,2,4,5,6,8,9,10,12,13,14,15].every(i=>prior[i]===current[i]),'ordinary live route replacement retains position, velocity, acceleration and attitude');
}
async function failureBoundaries(ctx,e,gate) {
  const short=plan(e,7);short.request.end=e.now+.01;const failed=e.planApproach(short);await gate.ready(6);const before=e.director.revision;gate.release(6);
  ctx.assert((await failed).status==='infeasible'&&e.director.revision===before,'infeasible planning preserves the accepted journey');
  const expiredInput=plan(e,8),expired=e.planApproach(expiredInput);await gate.ready(7);e.step(expiredInput.request.end+1,0);gate.release(7);
  ctx.assert((await expired).status==='expired'&&e.director.revision===before,'a result delivered after its window cannot commit a journey');
  const reset=e.planApproach(plan(e,9));await gate.ready(8);const lifetime=e.lifetime;e.reset();
  ctx.assert((await reset).status==='superseded'&&e.lifetime!==lifetime&&e.routes.records.size===0,'reset revokes pending work and route data with the old GPU lifetime');
}
export async function validateLiveRoutes(ctx,canvas) {
  const count=Number(ctx.params.count??64),gate=heldWorker(),e=await createEngine(canvas,{count,solar:solarScene(),routeWorkerFactory:()=>gate});
  try {
    const seed=new Float32Array(await e.read(e.state)),words=new Uint32Array(seed.buffer);
    for(let i=0;i<count;i++)seed.set(words[i*48+21]===0&&((words[i*48+20]>>8)&255)===0?[-40,0,0]:[100+i*4,100,100],i*48);
    e.device.queue.writeBuffer(e.state,0,seed);ctx.metric('live_route_capacity',count);
    await preemption(ctx,e,gate);await authority(ctx,e,gate);await failureBoundaries(ctx,e,gate);
    e.render({distance:100});await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'live replanning runtime renders without GPU errors');
  }finally{e.destroy();}
  ctx.assert((await e.planApproach({revision:10})).status==='closed','closed runtime cannot restart route planning');
  await automaticExit(ctx,canvas);
}

async function automaticExit(ctx,canvas) {
  const gate=heldWorker(),e=await createNavigationEngine(canvas,{count:64,scenario:3,period:30,warpEnd:2,routeWorkerFactory:()=>gate});
  try {
    e.step(1,1);
    const request=approachRequest(e.solar,{type:0,at:1,start:[-40,0,0],planeShift:.35});
    const pending=e.planApproach({fleet:0,type:0,revision:3,request});await gate.ready(0);gate.release(0);
    ctx.assert((await pending).status==='admitted','post-warp demo accepts a live local-route replacement before its original exit');
    e.step(1,0);e.step(2,1);
    ctx.assert(e.director.intents[0].journeys[0].revision===3&&e.director.intents[0].journeys[0].planeShift===.35,'automatic warp exit cannot overwrite the revised route or its orbital inclination');
    ctx.assert(e.director.intents[1].journeys[0].revision===2,'unaffected types still receive their scheduled post-warp approaches');
    e.render({distance:440});await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'revised post-warp demo renders without GPU errors');
  }finally{e.destroy();}
}
