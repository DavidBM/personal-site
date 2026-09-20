import {createEngine} from './engine.mjs';
import {displayReader} from './validate-event-frames.mjs';
import {spatialStorage} from './spatial-schedule.mjs';
import {EVENT_POSE_WORDS} from './event-gpu.mjs';
import {CORRECTION_WORDS,correctionWords} from './correction-gpu.mjs';
const equal=(a,b)=>new Uint8Array(a).every((x,i)=>x===new Uint8Array(b)[i]);
const near=(a,b,tolerance=.003)=>Math.abs(a-b)<tolerance;
const directory=e=>spatialStorage(e.count).linkWords+e.count*EVENT_POSE_WORDS;
function order(e,journey,type) {for(let fleet=0;fleet<e.director.fleetCount;fleet++)e.command({revision:e.director.revision+1,fleet,type,journey});}
function scene() {
  const body=(orbit,radius)=>[orbit,radius,orbit===0?0:100000,0,1,0,0,0,0,0,1,0];
  return {sceneEpochMs:1700000000000,definition:{version:1,epochMs:1700000000000,origin:[0,0,0],bodies:[...body(0,10),...body(1000,1),...body(2000,1)]}};
}
export async function historyReader(e) {
  const pipeline=await e.device.createComputePipelineAsync({layout:'auto',compute:{module:e.inspection.drawing,entryPoint:'inspectHistory'}});
  const output=e.device.createBuffer({size:48*192,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
  const entries=[[0,e.inspection.view],[2,e.history],[5,e.inspection.links],[6,output]].map(([binding,buffer])=>({binding,resource:{buffer}}));
  const bind=e.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries});
  return {async read(alpha) {
    e.render({alpha});const encoder=e.device.createCommandEncoder(),pass=encoder.beginComputePass();
    pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(1);pass.end();e.device.queue.submit([encoder.finish()]);
    const raw=new Float32Array(await e.read(output));return Float32Array.from({length:192},(_,i)=>raw[Math.floor(i/4)*48+i%4]);
  },destroy(){output.destroy();}};
}
async function prepare(e) {
  e.setDensityEnabled(false);e.setPlanetsEnabled(false);e.step(255.5,0);
  order(e,{mode:'warp',revision:1,at:255.5,end:255.6,exit:[-400,300,80]});e.step(255.6,.1);
  for(let n=1;n<=33;n++)e.step(255.6+n/120,1/120);
  order(e,{mode:'approach',revision:2,planet:0,at:255.875,end:255.9375,exit:[0,0,0]});e.step(255.875,0);
}
function battleEvent(e,event){if(event)e.enqueueEvent({effectiveAt:255.9375,commands:[{fleet:0,type:0,joined:true,journey:{mode:'local',revision:3,at:255.9375,end:300,exit:[0,0,0]}}]});}
async function arrival(ctx,canvas,count,event) {
  const e=await createEngine(canvas,{count,autoRebase:false,solar:scene()});let pose,history;
  try {
    await prepare(e);const before=new Float32Array(await e.read(e.state));
    battleEvent(e,event);
    e.step(256,.125);pose=await displayReader(e);history=await historyReader(e);
    const early=new Float32Array(await pose.read(.25)),late=new Float32Array(await pose.read(.75));
    ctx.assert(near(early[0],before[0]+before[4]*.03125,.05)&&early[39]===0,'pre-deadline draw pose retains local flight and has no premature recovery fade');
    ctx.assert(late[39]>0&&Math.hypot(...late.slice(0,3))<80,'post-deadline draw pose uses corrected arrival without interpolation across space');
    ctx.assert(late[28]===(event?3:2),'an exact battle order owns the phase after the local arrival correction');
    const raw=new Uint32Array(await e.read(e.inspection.links)),head=raw[directory(e)],record=directory(e)+e.count+(head-1)*CORRECTION_WORDS;
    const f=new Float32Array(raw.buffer);
    ctx.assert(head>0&&near(f[record],255.9375)&&f[record+52+35]===2,'GPU correction journal records the authoritative local deadline and explicit corrected arrival state');
    const old=await history.read(.25),current=await history.read(.75),live=new Float32Array(await e.read(e.history)).slice(0,192);
    ctx.assert(old.filter((_,i)=>i%4===3&&old[i]>=0&&old[i]<255.9375).length>=24,'pre-correction trail rendering retains its earlier timed segments');
    ctx.assert(equal(current.buffer,live.buffer)&&current.filter((_,i)=>i%4===3&&current[i]>=0).every(birth=>birth>=Math.fround(255.9375)),'post-correction trails use only the restarted emitter history');
    const progress=await e.readProgress();ctx.assert(progress.groups.some(g=>g.corrected>0&&g.arrived===g.live),'progress distinguishes corrected arrivals from natural arrival');
    await verifyRebase(ctx,e,pose,history,early,old);
    e.step(256+1/120,1/120);const next=new Uint32Array(await e.read(e.inspection.links));
    ctx.assert(next.slice(directory(e),directory(e)+count).every(x=>x===0),'the following tick retires correction history without repeating the arrival jump');
    ctx.assert(e.errors.length===0,'local correction, trails, events and clock maintenance validate on GPU');
    ctx.metric(event?'event_correction_bytes':'correction_bytes',correctionWords(count)*4);
  }finally{pose?.destroy();history?.destroy();e.destroy();}
}
async function verifyRebase(ctx,e,pose,history,early,old) {
  const pixels=await e.pixels({alpha:.25,follow:1,showEffects:false});
  ctx.assert(new Uint8Array(pixels).some((x,i)=>i%4!==3&&x>25),'pre-correction pixel comparison contains visible hull or trail samples');
  ctx.assert(e.rebaseClock(),'correction frame supports GPU epoch rebasing');
  const shifted=new Float32Array(await pose.read(.25)),oldShifted=await history.read(.25);
  ctx.assert([0,1,2,28].every(i=>early[i]===shifted[i])&&old.every((x,i)=>i%4===3?oldShifted[i]===(x>=192?x-192:-1):x===oldShifted[i]),'correction poses and historical trail samples retain their appearance across epoch changes');
  ctx.assert(equal(pixels,await e.pixels({alpha:.25,follow:1,showEffects:false})),'actual pre-correction scene pixels survive clock rebasing');
}
async function chained(ctx,canvas) {
  const e=await createEngine(canvas,{count:64});let pose,history;
  try {
    e.setDensityEnabled(false);e.setPlanetsEnabled(false);for(let n=0;n<=24;n++)e.step(n/120,n?1/120:0);
    for(const [revision,time,x] of [[1,.22,50],[2,.24,-50],[3,.26,100]])e.enqueueEvent({effectiveAt:time,commands:[{fleet:0,type:0,journey:{mode:'warp',revision,at:0,end:.1,exit:[x,0,0]}}]});
    e.step(.28,.08);pose=await displayReader(e);history=await historyReader(e);
    const states=[];for(const alpha of [.125,.375,.625,.875])states.push(new Float32Array(await pose.read(alpha)));
    ctx.assert(states.map(s=>s[28]).join(',')==='0,1,2,3','three discontinuities in one ship retain each distinct rendered phase');
    const samples=[];for(const alpha of [.125,.375,.625,.875])samples.push(await history.read(alpha));
    ctx.assert(samples.every((s,j)=>s.filter((_,i)=>i%4===3&&s[i]>=0).every(t=>t<.22+j*.02+.001)),'each interval selects its own pre-correction trail history without future samples');
    const raw=new Uint32Array(await e.read(e.inspection.links));let head=raw[directory(e)],depth=0;
    while(head){depth++;head=raw[directory(e)+e.count+(head-1)*CORRECTION_WORDS+1];}
    ctx.assert(depth===3&&e.errors.length===0,'sparse correction records form a bounded three-entry GPU-owned chain');
  }finally{pose?.destroy();history?.destroy();e.destroy();}
}
async function overflow(ctx,canvas) {
  const e=await createEngine(canvas,{count:64});
  try {
    e.step(.2,0);const state=await e.read(e.state),revision=e.director.revision;
    for(let n=1;n<=3;n++)e.enqueueEvent({effectiveAt:.2+n*.02,commands:[0,1].map(fleet=>({fleet,journey:{mode:'warp',revision:n,at:0,end:.1,exit:[n*20,0,0]}}))});
    let error;try{e.step(.28,.08);}catch(e){error=e;}
    ctx.assert(error?.code==='event-frame-capacity'&&error.message.includes('Correction history'),'excessive discontinuity history is rejected before journal consumption');
    ctx.assert(e.now===.2&&e.director.revision===revision&&e.events.inbox.status.pending===3&&equal(state,await e.read(e.state)),'correction overflow preserves pending authoritative events and live GPU state');
    e.step(.221,.021);e.step(.241,.02);e.step(.28,.039);
    ctx.assert(e.events.inbox.empty&&e.events.history.length===3&&e.errors.length===0,'a bounded retry consumes every preserved correction exactly once');
  }finally{e.destroy();}
}
export async function validateCorrections(ctx,canvas) {
  await arrival(ctx,canvas,Number(ctx.params.count??1000),false);await arrival(ctx,canvas,64,true);await chained(ctx,canvas);await overflow(ctx,canvas);await localDestination(ctx,canvas);await fallbackCohort(ctx,canvas);
}

async function localDestination(ctx,canvas) {
  const e=await createEngine(canvas,{count:64});
  try {
    e.setPlanetsEnabled(false);e.setDensityEnabled(false);
    order(e,{mode:'warp',revision:1,at:0,end:.1,exit:[400,300,200]});e.step(.1,.1);
    const pose=new Float32Array(await e.read(e.state));
    order(e,{mode:'approach',revision:2,at:.1,end:.2,exit:[-20,10,30]});e.step(.2,.1);
    const after=new Float32Array(await e.read(e.state));
    const expected=[-20,10,30].map((x,i)=>x+(pose[i]-[400,300,200][i])*.45);
    ctx.assert(expected.every((x,i)=>near(x,after[i]))&&after[35]===2,'nonplanet local arrival corrects to its encounter-relative destination and formation offset');
    ctx.assert(after.every(Number.isFinite)&&e.errors.length===0,'nonplanet correction never indexes an absent planetary frame');
  }finally{e.destroy();}
}

async function fallbackCohort(ctx,canvas) {
  const e=await createEngine(canvas,{count:1000,reserveFraction:.8});
  try {
    e.setPlanetsEnabled(false);e.setDensityEnabled(false);
    for(let fleet=0;fleet<2;fleet++)e.command({revision:e.director.revision+1,fleet,admit:1});
    order(e,{mode:'approach',revision:1,at:0,end:.1,exit:[10000,10000,10000]});e.step(.1,.1);
    const raw=new Uint32Array(await e.read(e.inspection.links)),progress=await e.readProgress();
    ctx.assert(raw.slice(directory(e),directory(e)+e.count).every(x=>x>0)&&progress.groups.reduce((n,g)=>n+g.corrected,0)===1000,'admitted reserved cohorts without their own intent share primary correction and retain individual history');
    for(let n=1;n<=3;n++)e.enqueueEvent({effectiveAt:.1+n*.02,commands:[0,1].map(fleet=>({fleet,journey:{mode:'warp',revision:1+n,at:0,end:.1,exit:[n,0,0]}}))});
    let rejected=false;try{e.step(.18,.08);}catch(error){rejected=error.code==='event-frame-capacity';}
    ctx.assert(rejected&&e.events.inbox.status.pending===3&&e.errors.length===0,'correction capacity includes reserved fallback ordinals before consuming a replacement burst');
  }finally{e.destroy();}
}
