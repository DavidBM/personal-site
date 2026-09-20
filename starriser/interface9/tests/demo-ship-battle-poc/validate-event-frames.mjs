import {createEngine} from './engine.mjs';
import {spatialStorage} from './spatial-schedule.mjs';
import {EVENT_POSE_WORDS} from './event-gpu.mjs';
const equal=(a,b)=>new Uint8Array(a).every((v,i)=>v===new Uint8Array(b)[i]);
const near=(a,b)=>Math.abs(a-b)<.0001;
const warp=(type,revision,at,end,exit)=>({fleet:0,type,journey:{mode:'warp',revision,at,end,exit}});
function enqueue(e,effectiveAt,commands){e.enqueueEvent({effectiveAt,commands});}
function tracked(e,work) {
  const queue=e.device.queue,write=queue.writeBuffer,submit=queue.submit;let submissions=0;const writes=[];
  queue.writeBuffer=function(...args){writes.push({buffer:args[0],bytes:args[4]??args[2].byteLength});return Reflect.apply(write,this,args);};
  queue.submit=function(...args){submissions++;return Reflect.apply(submit,this,args);};
  try{work();return {submissions,writes};}finally{queue.writeBuffer=write;queue.submit=submit;}
}
export async function displayReader(e) {
  const pipeline=await e.device.createComputePipelineAsync({layout:'auto',compute:{module:e.inspection.drawing,entryPoint:'inspectDisplay'}});
  const output=e.device.createBuffer({size:e.count*192,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
  return {async read(alpha) {
    e.render({alpha,distance:180});
    const previous=e.inspection.agents.find(buffer=>buffer!==e.state);
    const entries=[[0,e.inspection.view],[1,e.state],[3,previous],[5,e.inspection.links],[6,output],[8,e.inspection.control]].map(([binding,buffer])=>({binding,resource:{buffer}}));
    const bind=e.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries}),encoder=e.device.createCommandEncoder(),pass=encoder.beginComputePass();
    pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(e.count/128));pass.end();e.device.queue.submit([encoder.finish()]);
    return await e.read(output);
  },destroy(){output.destroy();}};
}
async function groups(ctx,canvas,count) {
  const e=await createEngine(canvas,{count,fleetCount:8});
  try {
    const end=1/120;
    for(let group=0;group<256;group++)enqueue(e,end*(group+1)/257,[{fleet:Math.floor(group/32),type:group%32,fire:true}]);
    const result=tracked(e,()=>e.step(end,end));
    ctx.assert(result.submissions===1&&e.events.history.length===256&&e.eventFrame.counts.every(n=>n===1),'256 independently timed groups use one simulation submission and one row each');
    ctx.assert(result.writes.every(w=>!e.inspection.agents.includes(w.buffer)&&w.buffer!==e.history&&w.buffer!==e.inspection.links),'event frame uploads only group directives; GPU owns boundary poses and trails');
    const state=new Float32Array(await e.read(e.state));
    ctx.assert(state.every(Number.isFinite)&&e.director.intents.every(intent=>intent.fire===1),'all independently timed groups activate with finite GPU state');
    e.render();await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'eight-fleet event metadata and boundary pose rendering validate on GPU');
    ctx.metric('event_frame_resources',{count,groups:256,submissions:result.submissions,metadataBytes:e.eventFrame.data.byteLength,poseBytes:count*EVENT_POSE_WORDS*4,uploadBytes:result.writes.reduce((n,w)=>n+w.bytes,0)});
  }finally{e.destroy();}
}
function compareCache(previous,next) {
    const dates=new Set([17,18,25,26,29,30,38,39,40,41,42]),timers=new Set([17,18,25,26,39,41,42]);
  return previous.every((v,i)=>!dates.has(i%48)?next[i]===v:next[i]===(timers.has(i%48)?Math.max(0,v-192):i%48===40?(v>=192?v-192:-1):v-192));
}
function cachedLifecycle(ctx,e,before,f,w,base,submissions) {
    ctx.assert(e.eventFrame.counts[0]===4&&submissions===1,'four boundaries in one group integrate in a single GPU invocation');
    ctx.assert(near(f[base],before[0])&&f[base+48+28]===1&&near(f[base+48+29],255.8),'warp starts from the live GPU boundary pose at its declared time');
    const second=base+2*48,loss=base+4*48;
    ctx.assert(f[second+48+28]===2&&[0,1,2].every(a=>near(f[second+a],f[second+48+a])),'mid-tick warp replacement captures the previous warp pose without jumping');
    ctx.assert(w[loss+22]===1&&w[loss+48+22]===0&&near(f[loss+48+40],255.9),'GPU retains both sides of an exact casualty boundary');
}
async function timeline(ctx,canvas) {
  const e=await createEngine(canvas,{count:64,reserveFraction:.25,autoRebase:false});let probe;
  try {
    e.setDensityEnabled(false);e.setPlanetsEnabled(false);e.step(255.75,0);
    const before=new Float32Array(await e.read(e.state));
    enqueue(e,255.8,[warp(0,1,255.8,255.9,[50,0,0])]);
    enqueue(e,255.85,[warp(0,2,255.85,255.95,[-50,0,0])]);
    enqueue(e,255.9,[{fleet:0,type:0,remaining:0}]);
    enqueue(e,255.95,[{fleet:0,type:0,fire:true}]);
    const result=tracked(e,()=>e.step(256,.25));
    const raw=await e.read(e.inspection.links),base=spatialStorage(e.count).linkWords,f=new Float32Array(raw),w=new Uint32Array(raw);
    cachedLifecycle(ctx,e,before,f,w,base,result.submissions);
    probe=await displayReader(e);
    const early=new Float32Array(await probe.read(.1)),late=await probe.read(.8),middle=new Float32Array(await probe.read(.5));
    ctx.assert(early[28]===0&&near(early[0],before[0])&&new Uint32Array(late)[22]===0&&middle[28]===2,'the actual draw pose shows pre-warp, replacement warp and death at the requested interpolation time');
    const pixels=await e.pixels({alpha:.5,distance:180}),cache=raw.slice(base*4,(base+e.count*EVENT_POSE_WORDS)*4),metadata=new Float32Array(e.eventFrame.data).slice();
    ctx.assert(e.rebaseClock(),'an active event frame supports manual clock rebasing');
    const shiftedRaw=await e.read(e.inspection.links),shifted=shiftedRaw.slice(base*4,(base+e.count*EVENT_POSE_WORDS)*4),next=new Float32Array(shifted),previous=new Float32Array(cache);
    const matches=compareCache(previous,next);
    ctx.assert(matches,'GPU rebases cached boundary dates while preserving every other cached state word');
    const after=new Float32Array(await probe.read(.5));
    ctx.assert([0,1,2,28].every(a=>middle[a]===after[a])&&equal(pixels,await e.pixels({alpha:.5,distance:180})),'interpolated event poses and pixels survive epoch rebasing');
    ctx.assert(new Float32Array(e.eventFrame.data)[1]===metadata[1]-192,'event frame metadata shares the rebased GPU epoch');
    e.step(256+1/120,1/120);ctx.assert(!e.eventFrame.active,'ordinary next tick retires the old event interpolation metadata');
    ctx.assert(e.errors.length===0,'multi-boundary lifecycle, interpolation and epoch maintenance have no GPU errors');
  }finally{probe?.destroy();e.destroy();}
}
async function overflow(ctx,canvas) {
  const e=await createEngine(canvas,{count:64});
  try {
    e.step(255.99,0);const before=await e.read(e.state),history=await e.read(e.history),revision=e.director.revision;
    for(let n=1;n<=5;n++)enqueue(e,255.99+n*.004,[{fleet:0,type:0,fire:Boolean(n%2)}]);
    let rejected=false;const result=tracked(e,()=>{try{e.step(256.02,.03);}catch(error){rejected=error.message.includes('GPU event capacity');}});
    ctx.assert(rejected&&result.submissions===0&&result.writes.length===0&&e.clock.origin===0,'per-group overflow rejects before GPU writes, submissions or clock rebasing');
    ctx.assert(e.director.revision===revision&&e.now===255.99&&e.events.inbox.status.pending===5&&equal(before,await e.read(e.state))&&equal(history,await e.read(e.history)),'overflow preserves all queued packets, director state and live GPU poses/history');
    e.step(256,.01);e.step(256.02,.02);
    ctx.assert(e.events.history.length===5&&e.events.inbox.empty,'a rejected interval can be retried in representable ticks without losing events');
    ctx.assert(e.errors.length===0,'overflow recovery by bounded retry has no GPU errors');
  }finally{e.destroy();}
}
async function continuousOrders(ctx,canvas) {
  const e=await createEngine(canvas,{count:64});
  try {
    e.setDensityEnabled(false);e.setPlanetsEnabled(false);
    e.command({revision:1,fleet:0,joined:true,strategy:'withdraw'});
    for(let tick=1;tick<=24;tick++) {
      enqueue(e,tick/120,[{fleet:0,type:0,fire:Boolean(tick%2)}]);e.step(tick/120,1/120);
    }
    const data=new Float32Array(await e.read(e.state));
    ctx.assert(Math.hypot(...data.slice(4,7))>.001&&Math.hypot(...data.slice(8,11))>.01,'commands at every tick endpoint cannot starve the once-per-tick steering controller');
    ctx.assert(e.errors.length===0,'continuous endpoint commands have no GPU errors');
  }finally{e.destroy();}
}
async function warpEndpoint(ctx,canvas) {
  const e=await createEngine(canvas,{count:64});let probe;
  try {
    e.setDensityEnabled(false);e.setPlanetsEnabled(false);
    enqueue(e,.1,[warp(0,1,.1,.4,[50,0,0])]);e.step(.6,.6);probe=await displayReader(e);
    const raw=new Float32Array(await e.read(e.inspection.links)),at=spatialStorage(e.count).linkWords+48;
    const during=new Float32Array(await probe.read(.5)),after=new Float32Array(await probe.read(5/6));
    ctx.assert(during[31]===2&&[0,1,2].every(k=>near(during[k],raw[at+32+k]+raw[at+4+k]*(.3-raw[at+29]))),'draw interpolation preserves analytic warp pose and mode before an in-tick endpoint');
    ctx.assert(after[31]===0&&after.every(Number.isFinite),'draw interpolation switches to cruise after the in-tick warp endpoint');
    ctx.assert(e.errors.length===0,'kinematic endpoint rendering has no GPU errors');
  }finally{probe?.destroy();e.destroy();}
}
export async function validateEventFrames(ctx,canvas) {
  await groups(ctx,canvas,Number(ctx.params.count??1000));await timeline(ctx,canvas);await overflow(ctx,canvas);await continuousOrders(ctx,canvas);await warpEndpoint(ctx,canvas);
}
