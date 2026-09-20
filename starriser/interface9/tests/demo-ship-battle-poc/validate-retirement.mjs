import {createEngine} from './engine.mjs';
import {displayReader} from './validate-event-frames.mjs';
import {createDirectorRecovery} from '../demo-ship-flight-poc/director-recovery.mjs';
const command=(e,fields)=>e.command({revision:e.director.revision+1,...fields});
const readState=async e=>new Uint32Array(await e.read(e.state,e.count*192));
function byIdentity(words) {
  const result=new Map(),f=new Float32Array(words.buffer);
  for(let slot=0;slot<words.length/48;slot++) {
    const row=words.slice(slot*48,slot*48+48);
    for(const field of [16,24]){const handle=f[slot*48+field];row[field]=handle>0?words[(handle-1)*48+23]:0;}
    result.set(row[23],row);
  }
  return result;
}
function preserved(before,after) {
  const a=byIdentity(before),b=byIdentity(after),refs=new Set([16,24]);
  return [...b].every(([id,row])=>row.every((word,field)=>word===(refs.has(field)&&!b.has(a.get(id)[field])?0:a.get(id)[field])));
}
function sameHistory(before,after,oldIds,newIds) {
  const indices=new Map(oldIds.map((id,i)=>[id,i]));
  return newIds.every((id,i)=>after.slice(i*192,i*192+192).every((word,j)=>word===before[indices.get(id)*192+j]));
}
const ids=words=>Array.from({length:words.length/48},(_,i)=>words[i*48+23]);
async function snapshot(e) {
  return {state:await readState(e),previous:new Uint32Array(await e.read(e.inspection.agents.find(b=>b!==e.state),e.count*192)),history:new Uint32Array(await e.read(e.history,e.count*768))};
}
function reinforcement(e,sizes) {
  return sizes.map((visual,type)=>({fleet:0,type,visual,logical:visual*20,position:[-60,30,type],spread:8})).filter(row=>row.visual>0);
}
async function expired(e) {e.step(e.now,0);e.step(e.now+2.1,.01);}
async function finishPacking(e) {while(e.packing.status.pending)e.packing.advance(64);await e.device.queue.onSubmittedWorkDone();}
async function core(ctx,canvas,count) {
  const e=await createEngine(canvas,{count});
  try {
    e.setPlanetsEnabled(false);for(let fleet=0;fleet<2;fleet++)command(e,{fleet,joined:true});
    e.step(.5,.01);const sizes=Array.from(e.director.roster.sizes),dead=e.captureShip(e.director.population.count/2-1),survivor=e.captureShip(e.director.population.count/2);
    command(e,{fleet:0,survivalFraction:.5});e.step(.5,0);
    ctx.assert((await e.reclaim()).status==='unchanged','fresh casualties keep their destruction effects and prior live display pose');
    const pending=e.reclaim();e.packing.requestOrder([...e.director.population.ids].reverse());e.packing.advance(3);
    ctx.assert((await pending).status==='superseded','packing invalidates an in-flight retirement observation before it can mutate population');
    e.step(2.4,.01);e.enqueueEvent({effectiveAt:2.46,commands:[{fleet:1,type:0,journey:{mode:'warp',revision:1,at:2,end:2.1,exit:[50,0,0]}}]});e.step(2.5,.1);
    await collect(ctx,e,survivor);
    ctx.assert(e.resolveShip(dead)===null&&!e.followShip(dead),'retired identities cannot resolve or become camera targets');
    const missing=sizes.map((n,type)=>n-e.director.roster.retainedFor(0,type));const first=e.director.population.nextId;
    e.reinforce(reinforcement(e,missing));await e.shipStorage.pending;e.step(e.now+.01,.01);
    ctx.assert(e.count===count&&e.director.population.ids.at(-1)>=first&&e.resolveShip(dead)===null,'reused ordinal and physical capacity receives fresh serials without reviving old handles');
    await cycles(ctx,e,sizes,count);
    await emptyAndRestart(ctx,e);
  }finally{e.destroy();}
}
async function collect(ctx,e,survivor) {
  e.followShip(survivor);const before=await snapshot(e);let reader=await displayReader(e);
  const display=new Uint32Array(await reader.read(.2));reader.destroy();const oldCount=e.count;
  const q=e.device.queue,write=q.writeBuffer;let poseUploads=0;
  q.writeBuffer=function(...args){if(/^ships (a|b|history|links) /.test(args[0].label))poseUploads++;return Reflect.apply(write,this,args);};
  let result;try{result=await e.reclaim();}finally{q.writeBuffer=write;}
  await e.shipStorage.pending;const after=await snapshot(e);reader=await displayReader(e);const nextDisplay=new Uint32Array(await reader.read(.2));reader.destroy();
  ctx.assert(result.status==='applied'&&e.count===e.director.alive&&e.count<oldCount,'expired representatives leave the actual populated GPU range');
  ctx.assert(poseUploads===0&&preserved(before.state,after.state)&&preserved(before.previous,after.previous),'GPU retirement preserves both survivor poses and remaps or revokes tactical references without CPU pose uploads');
  ctx.assert(sameHistory(before.history,after.history,ids(before.state),ids(after.state)),'all retained emitter histories move with their persistent identity');
  ctx.assert(preserved(display,nextDisplay),'cached event and correction presentation survives shrinking and reference relocation');
  ctx.assert(e.followedShip?.id===survivor.id&&e.packing.status.pending,'survivor camera handles and pending packing orders survive reclamation');
  ctx.assert(e.shipStorage.status.capacity===e.count&&e.shipStorage.status.retiredBytes===0,'reclaimed populated storage shrinks and old resources retire after their queue fence');
  await finishPacking(e);e.step(e.now+.01,.01);
  ctx.assert((await e.readProgress()).groups.reduce((sum,g)=>sum+g.live,0)===e.director.alive,'coarse GPU counts remain exact with holes in fleet/type ordinals');
  const {snapshot:recovery}=createDirectorRecovery(e,e.now);ctx.assert(e.installSnapshot(recovery,e.lifetime).status==='reconciled','same-catalog recovery preserves retired membership and logical batch baselines');
  ctx.assert((await e.reclaim()).status==='unchanged','reclaiming twice cannot retire a surviving identity');
}
async function cycles(ctx,e,sizes,count) {
  let valid=true;const retiredHandles=[];
  for(let cycle=0;cycle<6;cycle++) {
    const index=e.director.population.keys.findIndex(key=>(key>>>13)===0);retiredHandles.push(e.captureShip(index));
    command(e,{fleet:0,survivalFraction:0});await expired(e);const result=await e.reclaim();await e.shipStorage.pending;
    valid&&=result.status==='applied'&&e.count===count/2&&e.director.roster.batches.slice(0,32).every(rows=>rows.length===0);
    e.reinforce(reinforcement(e,sizes));await e.shipStorage.pending;e.packing.request();await finishPacking(e);e.step(e.now+.01,.01);
    valid&&=e.count===count&&e.director.alive===count&&retiredHandles.every(handle=>e.resolveShip(handle)===null);
  }
  ctx.assert(valid,'six loss/reclaim/reinforce/pack cycles reuse real capacity and reclaim extinct logical metadata');
  const w=await readState(e);ctx.assert(new Set(ids(w)).size===count&&ids(w).every(id=>e.director.population.indexOf(id)>=0),'repeated address reuse preserves unique current serial identities');
  ctx.metric('reclamation_resources',{count:e.count,nextId:e.director.population.nextId,batches:e.director.roster.batches.reduce((sum,rows)=>sum+rows.length,0),storage:e.shipStorage.status});
}
async function emptyAndRestart(ctx,e) {
  for(let fleet=0;fleet<2;fleet++)command(e,{fleet,survivalFraction:0});await expired(e);
  const result=await e.reclaim();await e.shipStorage.pending;
  ctx.assert(result.status==='applied'&&e.count===0&&e.director.alive===0&&e.captureShip(0)===null,'all-lost populations release every catalog identity and populated slot');
  e.step(300,.01);e.render({follow:1});const progress=await e.readProgress();
  ctx.assert(progress.groups.every(g=>g.live===0)&&(await e.reclaim()).status==='unchanged','empty runtime supports clock advancement, progress, rendering and repeated reclamation');
  const {snapshot:recovery}=createDirectorRecovery(e,e.now);ctx.assert(e.installSnapshot(recovery,e.lifetime).status==='reconciled','empty population supports full runtime snapshot recovery');
  e.reinforce({fleet:0,type:0,visual:3,logical:60,position:[-30,10,0]});await e.shipStorage.pending;e.step(300.01,.01);
  ctx.assert(e.count===3&&e.director.alive===3&&new Set(ids(await readState(e))).size===3,'GPU admission restarts from empty storage with new identities');
  e.render();await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'reclamation, repeated reuse, empty runtime and restart have no GPU errors');
}
async function stale(ctx,canvas) {
  const e=await createEngine(canvas,{count:64});
  try {
    const pending=e.reclaim();ctx.assert((await e.reclaim()).status==='busy','one asynchronous retirement probe bounds readback and temporary memory');
    e.reset();ctx.assert((await pending).status==='superseded','reset rejects an old retirement observation');
    const moving=e.reclaim();e.step(.01,.01);ctx.assert((await moving).status==='superseded','even a same-order simulation step invalidates retirement observations');
    const closing=e.reclaim();e.destroy();ctx.assert(['closed','superseded'].includes((await closing).status),'teardown safely closes an in-flight retirement probe');
  }finally{e.destroy();}
}
export async function validateRetirement(ctx,canvas){await core(ctx,canvas,Number(ctx.params.count??1000));await stale(ctx,canvas);await fragmented(ctx,canvas);await multipleFleets(ctx,canvas);}

async function fragmented(ctx,canvas) {
  const e=await createEngine(canvas,{count:64});
  try {
    e.setPlanetsEnabled(false);e.step(255,.01);command(e,{fleet:0,type:0,remaining:0});e.step(255.1,.1);
    e.reinforce([100,1,100].map(logical=>({fleet:0,type:0,visual:1,logical,position:[-30,10,0]})));await e.shipStorage.pending;
    command(e,{fleet:0,type:0,remaining:100});e.step(255.2,.1);e.step(256.1,.01);
    ctx.assert(e.clock.origin>0&&(await e.reclaim()).status==='unchanged','clock rebasing does not prematurely retire recent death effects');
    e.step(257.2,.01);const result=await e.reclaim();await e.shipStorage.pending;
    ctx.assert(result.retired===2&&e.director.roster.sizeFor(0,0)===4&&e.director.roster.retainedFor(0,0)===2,'partial logical batches release separate interior ordinal holes');
    e.reinforce({fleet:0,type:0,visual:2,logical:40,position:[-30,10,0]});await e.shipStorage.pending;
    const w=await readState(e),ordinals=[w[(e.count-2)*48+20]&255,w[(e.count-1)*48+20]&255];
    ctx.assert(ordinals[0]===0&&ordinals[1]===2,'GPU births consume explicit noncontiguous reused ordinals');
    e.step(257.21,.01);const progress=await e.readProgress();
    ctx.assert(progress.groups[0].live===4&&e.director.roster.logicalCount(0,0)===140,'reused holes preserve both GPU live counts and mixed logical baselines');
    e.reset();e.step(.01,.01);e.render();await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'fragmented ordinal reuse and reset have no GPU errors');
  }finally{e.destroy();}
}

async function multipleFleets(ctx,canvas) {
  const e=await createEngine(canvas,{count:1000,fleetCount:4,initialFleets:[0,2]});
  try {
    e.setPlanetsEnabled(false);
    for(let fleet=0;fleet<4;fleet++) {
      const scope=e.pressure.create({center:[fleet*60,0,0]});e.pressure.assign({fleet,scope,revision:e.pressure.members[fleet].revision+1,blend:0});
      command(e,{fleet,joined:true,battle:Math.floor(fleet/2)+1,team:fleet%2});
    }
    e.step(.1,.01);command(e,{fleet:0,survivalFraction:0});await expired(e);
    const density=new Uint32Array(await e.read(e.density));const result=await e.reclaim();await e.shipStorage.pending;
    const after=new Uint32Array(await e.read(e.density));
    ctx.assert(result.retired===250&&e.count===750&&e.director.alive===250,'four-fleet retirement retains both unadmitted reserve fleets');
    ctx.assert(density.every((value,i)=>value===after[i]),'reclamation preserves rebuilt density across independent pressure fields');
    e.reinforce({fleet:3,type:0,visual:100,logical:2000,position:[60,20,0]});await e.shipStorage.pending;
    e.enqueueEvent({effectiveAt:2.3,commands:[{fleet:3,admit:0}]});e.step(2.31,.11);
    const progress=await e.readProgress();
    ctx.assert(e.count===850&&e.director.alive===600&&progress.groups.reduce((sum,g)=>sum+g.live,0)===600,'later reserved-fleet admission includes new batches after unrelated retirement');
    e.render();await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'four fleets, independent battles and scope density validate through reclamation');
  }finally{e.destroy();}
}
