import {createEngine} from './engine.mjs';
import {displayReader} from './validate-event-frames.mjs';
import {createDirectorRecovery} from '../demo-ship-flight-poc/director-recovery.mjs';
import {historyReader} from './validate-corrections.mjs';
const same=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
const words=buffer=>new Uint32Array(buffer);
const floats=buffer=>new Float32Array(buffer);
function normalized(buffer,physicalState=buffer) {
  const w=words(buffer),f=floats(buffer),ids=words(physicalState),rows=new Map();
  for(let slot=0;slot<w.length/48;slot++) {
    const at=slot*48,row=Array.from(w.slice(at,at+48));
    for(const field of [16,24]){const handle=f[at+field];row[field]=handle>0?ids[(handle-1)*48+23]:0;}
    rows.set(w[at+23],row);
  }
  return rows;
}
function samePoses(before,after,oldState=before,newState=after) {
  const a=normalized(before,oldState),b=normalized(after,newState);
  return a.size===b.size&&[...a].every(([id,row])=>same(row,b.get(id)??[]));
}
function sameTrails(before,after,oldState,newState) {
  const previous=words(before),next=words(after),a=words(oldState),b=words(newState),slots=new Map();
  for(let slot=0;slot<a.length/48;slot++)slots.set(a[slot*48+23],slot);
  return Array.from({length:b.length/48},(_,slot)=>slot).every(slot=>same(previous.slice(slots.get(b[slot*48+23])*192,(slots.get(b[slot*48+23])+1)*192),next.slice(slot*192,(slot+1)*192)));
}
async function capture(e) {const states=[];for(const buffer of e.inspection.agents)states.push(await e.read(buffer));return {states,state:await e.read(e.state),history:await e.read(e.history)};}
async function drain(e,limit=64) {
  let batches=0;
  while(e.packing.status.pending){if(!e.packing.advance(limit))break;if(++batches%8===0)await e.device.queue.onSubmittedWorkDone();if(batches>e.count)throw new Error('Packing did not converge');}
  await e.device.queue.onSubmittedWorkDone();await e.packing.readTiming();return batches;
}
function direct(e,value){e.command({revision:e.director.revision+1,...value});}
function validTargets(e,buffer) {
  const f=floats(buffer),w=words(buffer);let targets=0;
  for(let i=0;i<e.count;i++) {
    if(w[i*48+22]===0||f[i*48+16]===0)continue;
    const other=(f[i*48+16]-1)*48,fleet=w[i*48+21],group=fleet*32+((w[i*48+20]>>>8)&255),type=(w[other+20]>>>8)&255;
    if(w[other+22]!==1||!e.director.canTarget(fleet,w[other+21])||(e.director.groups[group*8+2]&(1<<type))===0)return false;targets++;
  }
  return targets>0;
}
async function battle(ctx,canvas,count) {
  const e=await createEngine(canvas,{count});
  try {
    e.setPlanetsEnabled(false);e.setTargetLinks(false);
    for(let fleet=0;fleet<2;fleet++)direct(e,{fleet,joined:true,strategy:'pass',attackClass:5,fire:true});
    for(let frame=1;frame<=60;frame++)e.step(frame/120,1/120);
    e.step(e.now,0);const before=await capture(e),density=await e.read(e.density),pending=e.readProgress();
    e.packing.requestOrder(Array.from({length:count},(_,i)=>count-i));const tracked=await trackUploads(e,()=>drain(e)),batches=tracked.result;const after=await capture(e);
    const forbidden=[...e.inspection.agents,e.history,e.inspection.links,e.density];
    ctx.assert(tracked.writes.every(write=>!forbidden.includes(write.buffer)),'physical packing never uploads live poses, trails, frame history or density from the CPU');
    ctx.assert(tracked.writes.reduce((n,write)=>n+write.bytes,0)===e.packing.status.uploadBytes,'reported packing upload bytes match actual queue writes');
    ctx.assert(batches>1&&e.packing.status.lastSwaps<=64,'arbitrary physical reordering converges through bounded 64-swap GPU batches');
    ctx.assert(before.states.every((state,i)=>samePoses(state,after.states[i])),'both pose buffers preserve every ship state word and logical target/threat through packing');
    ctx.assert(sameTrails(before.history,after.history,before.state,after.state),'all three timed trails move with their ship without resetting samples or births');
    ctx.assert(words(after.state)[23]===count&&e.slotLayout.physical[0]===count-1,'physical ordering changes while persistent ship IDs retain their meaning');
    const priorProgress=await pending,nextProgress=await e.readProgress();
    ctx.assert(priorProgress.status==='ready'&&JSON.stringify(priorProgress.groups)===JSON.stringify(nextProgress.groups),'pending and subsequent group progress retain identical per-cohort geometry and counts across physical moves');
    e.step(e.now,0);ctx.assert(same(words(density),words(await e.read(e.density))),'rebuilt point and full-volume capital density is identical after physical packing');
    ctx.assert(validTargets(e,after.state),'packing translates live tactical references to the same permitted opponents');
    for(let frame=1;frame<=60;frame++)e.step(.5+frame/120,1/120);
    ctx.assert(validTargets(e,await e.read(e.state)),'target selection, capital lookup and tactical simulation remain valid after packing');
    direct(e,{fleet:0,survivalFraction:.5});e.step(e.now,0);e.packing.request();await drain(e);
    const compacted=words(await e.read(e.state));
    ctx.assert(Array.from({length:e.director.alive},(_,i)=>compacted[i*48+22]).every(x=>x===1)&&Array.from({length:count-e.director.alive},(_,i)=>compacted[(i+e.director.alive)*48+22]).every(x=>x===0),'loss-driven packing moves survivors to the front and dead representatives to the tail');
    ctx.assert((await e.readProgress()).groups.reduce((n,g)=>n+g.live,0)===e.director.alive,'logical casualty counts do not depend on the compacted physical order');
    ctx.metric('packing_resources',{count,batches,scratchBytes:e.packing.status.scratchBytes,slotTableBytes:e.slotLayout.data.byteLength,uploadBytes:e.packing.status.uploadBytes,lastUploadBytes:e.packing.status.lastUploadBytes,sampledBatch:e.packing.status.sampledBatch,sampledSwaps:e.packing.status.sampledSwaps,lastBatchMs:e.packing.status.latestMs});
    ctx.assert(e.packing.status.lastUploadBytes===count*4+e.packing.status.lastSwaps*8+16+e.slotLayout.data.byteLength,'packing uploads only index remaps, slot tables and bounded batch metadata');
    ctx.assert(e.packing.status.scratchBytes===10000*4+1040,'packing scratch is an index remap and fixed batch metadata, without full pose/history staging');
    if(e.timestamps)ctx.assert(e.packing.status.latestMs>0,'GPU packing timing includes both swap and reference-remap passes');
    e.render({follow:1});await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'packed combat, progress and rendering have no GPU validation errors');
  }finally{e.destroy();}
}
async function frameHistory(ctx,canvas) {
  const e=await createEngine(canvas,{count:64,autoRebase:false});let reader,trailReader;
  try {
    e.setPlanetsEnabled(false);e.setDensityEnabled(false);e.setTargetLinks(false);
    for(let fleet=0;fleet<2;fleet++)direct(e,{fleet,joined:true,attackClass:5});e.step(255.75,.01);
    for(const [type,time,exit] of [[0,255.8125,50],[1,255.875,-50]])e.enqueueEvent({effectiveAt:time,commands:[{fleet:0,type,journey:{mode:'warp',revision:1,at:250,end:251,exit:[exit,0,0]}}]});
    e.step(256,.25);reader=await displayReader(e);trailReader=await historyReader(e);const oldTrails=await readViews(trailReader),before=await capture(e),views=await readViews(reader);
    e.setFollowShip(1);const pixels=await e.pixels({alpha:.125,follow:1,showTrails:false,showEffects:false});
    e.packing.requestOrder(Array.from({length:64},(_,i)=>(i+7)%64+1));await drain(e,3);const after=await capture(e),moved=await readViews(reader);
    e.setFollowShip(0);const newTrails=await readViews(trailReader);
    ctx.assert(oldTrails.every((trail,i)=>same(trail,newTrails[i])),'each historical trail interval follows its stable ship through physical packing');
    ctx.assert(floats(views[0])[16]>0,'historical reference preservation starts with a real tactical target');
    ctx.assert(views.every((view,i)=>samePoses(view,moved[i],before.state,after.state)),'packing preserves each pre-event, between-event and post-correction display pose');
    ctx.assert(sameTrails(before.history,after.history,before.state,after.state),'packing retains the live timed trail ring while correction directories move');
    e.setFollowShip(1);const nextPixels=await e.pixels({alpha:.125,follow:1,showTrails:false,showEffects:false});
    ctx.assert(new Uint8Array(pixels).some((x,i)=>i%4!==3&&x>25)&&same(new Uint8Array(pixels),new Uint8Array(nextPixels)),'following a stable ship renders the same visible hull pixels after physical packing');
    const last=await reader.read(.375);ctx.assert(e.rebaseClock(),'a packed correction frame supports clock rebasing');
    const shifted=await reader.read(.375);ctx.assert(words(last).filter((_,i)=>i%48<3).every((x,i)=>x===words(shifted).filter((_,j)=>j%48<3)[i]),'packed historical positions survive subsequent GPU epoch maintenance');
    const {snapshot:value}=createDirectorRecovery(e,300);e.installSnapshot(value,e.lifetime);
    ctx.assert((await e.readProgress()).groups.reduce((n,g)=>n+g.live,0)===e.director.alive,'snapshot recovery keeps the current physical mapping and valid group progress');
    e.packing.requestOrder(Array.from({length:64},(_,i)=>64-i));e.packing.advance(1);e.reset();
    ctx.assert(!e.packing.status.pending&&e.slotLayout.physical.every((slot,id)=>slot===id),'reset cancels pending packing and restores the seed mapping');
    ctx.assert(e.errors.length===0,'packing event history, snapshots and clock maintenance has no GPU errors');
  }finally{reader?.destroy();trailReader?.destroy();e.destroy();}
  ctx.assert(e.packing.request()===false&&e.packing.advance()===false,'teardown rejects stale packing requests and work');
}
export async function validatePacking(ctx,canvas){await battle(ctx,canvas,Number(ctx.params.count??1000));await frameHistory(ctx,canvas);}

async function readViews(reader){const values=[];for(const alpha of [.125,.375,.75])values.push(await reader.read(alpha));return values;}

async function trackUploads(e,work) {
  const queue=e.device.queue,original=queue.writeBuffer,writes=[];
  queue.writeBuffer=function(buffer,offset,data,dataOffset,size){writes.push({buffer,offset,bytes:size===undefined?data.byteLength:size*(data.BYTES_PER_ELEMENT??1)});return Reflect.apply(original,this,arguments);};
  try{return {result:await work(),writes};}finally{queue.writeBuffer=original;}
}
