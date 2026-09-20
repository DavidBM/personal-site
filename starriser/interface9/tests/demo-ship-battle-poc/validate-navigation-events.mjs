import {createDirectorWorker} from './worker-client.mjs';
import {approachRequest} from './local-routes.mjs';
import {createNavigationEngine} from './navigation-engine.mjs';
const command=(e,report)=>e.command({revision:e.director.revision+1,...report});
async function boundary(ctx,canvas,count) {
  const e=await createNavigationEngine(canvas,{count,scenario:3,warpEnd:2});
  try {
    e.setDensityEnabled(false);e.setPlanetsEnabled(false);e.step(0,0);e.step(1.999,0);
    const original=e.device.queue.submit;let submissions=0;
    e.device.queue.submit=function(...args){submissions++;return Reflect.apply(original,this,args);};
    try{e.step(2.001,.002);}finally{e.device.queue.submit=original;}
    const data=new Float32Array(await e.read(e.state));
    ctx.assert(submissions===1&&e.events.history[0].appliedAt===2&&e.eventFrame.counts.every(n=>n===1),'interactive warp arrival uses the shared event frame in one simulation submission');
    ctx.assert(e.routes.records.size===64&&data.filter((_,i)=>i%48===28).every(x=>x===2)&&data.filter((_,i)=>i%48===31).every(x=>x===1),'all interactive arrival routes activate at the declared warp endpoint');
    e.render({alpha:.25,distance:440});await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'interactive arrival renders with shared event interpolation');
  }finally{e.destroy();}
}
async function preemption(ctx,canvas) {
  const e=await createNavigationEngine(canvas,{count:64,scenario:3,warpEnd:2});
  try {
    e.step(0,0);
    command(e,{fleet:0,type:0,joined:true});command(e,{fleet:0,type:0,joined:false});
    command(e,{fleet:0,type:1,journey:{mode:'local',revision:20,at:0,end:0,exit:[0,0,0]}});
    command(e,{fleet:0,type:2,fire:true});
    e.step(1.999,0);e.step(2.001,.002);
    ctx.assert(!e.routes.records.has(0)&&!e.routes.records.has(2)&&e.routes.records.size===62,'a changed-away-and-back role or newer journey cancels only its own prepared arrival');
    ctx.assert(e.routes.records.has(4)&&e.director.intents[2].journeys[0].revision===2,'cosmetic fire changes leave the prepared arrival valid');
    ctx.assert(e.events.lastFailure===null&&e.events.inbox.empty,'superseded arrival plans do not poison the remaining route batch');
    const packet={effectiveAt:3,routes:[{...e.routes.records.get(4),fleet:0,type:2,basis:{journey:2,epoch:NaN}}]};let rejected=false;
    try{e.enqueueEvent(packet);}catch{rejected=true;}
    ctx.assert(rejected&&e.events.inbox.empty,'malformed route continuation basis rejects before queue mutation');
    ctx.assert(e.errors.length===0,'arrival preemption has no GPU errors');
  }finally{e.destroy();}
}
async function pendingReplan(ctx,canvas) {
  const actual=createDirectorWorker();let release,ready;
  const gate={request(...args){ready=actual.request(...args);return Promise.all([ready,new Promise(resolve=>{release=resolve;})]).then(([result])=>result);},destroy(){release?.();actual.destroy();}};
  const e=await createNavigationEngine(canvas,{count:64,scenario:3,warpEnd:2,routeWorkerFactory:()=>gate});
  try {
    e.step(0,0);e.step(1,0);const epoch=e.director.navigationEpochs[0];
    const request=approachRequest(e.solar,{type:0,at:1,start:[-20,0,0]});
    const pending=e.planApproach({fleet:0,type:0,revision:3,request});await ready;
    e.step(2.001,1.001);
    ctx.assert(e.director.intents[0].journeys[0].revision===2&&e.director.navigationEpochs[0]===epoch,'scheduled continuation keeps accepted flight moving inside the same navigation request');
    release();const result=await pending;
    ctx.assert(result.status==='admitted'&&e.director.intents[0].journeys[0].revision===3,'a scheduled arrival cannot cancel a newer worker replan that is still completing');
    const revised=approachRequest(e.solar,{type:0,at:e.now,start:[-20,0,0]});
    const superseded=e.planApproach({fleet:0,type:0,revision:4,request:revised});await ready;
    command(e,{fleet:0,type:0,joined:true});release();
    ctx.assert((await superseded).status==='superseded'&&e.director.intents[0].journeys[0].revision===3,'an explicit newer role order still cancels a pending replan after continuation');
    ctx.assert(e.errors.length===0,'worker completion across a scheduled arrival has no GPU errors');
  }finally{e.destroy();}
}
export async function validateNavigationEvents(ctx,canvas){await boundary(ctx,canvas,Number(ctx.params.count??1000));await preemption(ctx,canvas);await pendingReplan(ctx,canvas);}
