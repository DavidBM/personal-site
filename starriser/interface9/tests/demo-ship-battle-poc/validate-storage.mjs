import {createEngine} from './engine.mjs';
import {shipStorageSizes} from './ship-storage.mjs';
import {displayReader} from './validate-event-frames.mjs';
import {historyReader} from './validate-corrections.mjs';
import {createDirectorRecovery} from '../demo-ship-flight-poc/director-recovery.mjs';
function same(a,b){const left=new Uint8Array(a.buffer??a),right=new Uint8Array(b.buffer??b);return left.length===right.length&&left.every((value,i)=>value===right[i]);}
function order(e,fields){e.command({revision:e.director.revision+1,...fields});}
async function capture(e) {
  const result={};
  for(const [name,buffer] of Object.entries(e.shipStorage.current.buffers))result[name]=await e.read(buffer,e.shipStorage.sizes[name]);
  return result;
}
async function pack(e) {
  e.packing.requestOrder(Array.from({length:e.count},(_,i)=>e.count-i));
  for(let n=0;e.packing.status.pending;n++){if(n>e.count)throw Error('Packing failed to converge');e.packing.advance();if(n%16===0)await e.device.queue.onSubmittedWorkDone();}
}
async function preservedResize(ctx,e,capacity) {
  const before=await capture(e),old=e.shipStorage.current,progress=e.readProgress(),revision=e.packing.status.revision;
  const queue=e.device.queue,write=queue.writeBuffer;let uploads=0;
  queue.writeBuffer=function(...args){uploads++;return Reflect.apply(write,this,args);};
  try{ctx.assert(e.resizeStorage(capacity),'storage replacement is submitted while ships retain their current state');}
  finally{queue.writeBuffer=write;}
  ctx.assert(uploads===0,'storage replacement performs no CPU state or trail upload');
  ctx.assert(e.shipStorage.status.pending===1&&!e.resizeStorage(old.capacity),'a pending retirement prevents a second replacement allocation');
  const after=await capture(e);await e.shipStorage.pending;
  ctx.assert(Object.keys(before).every(name=>same(before[name],after[name])),'both poses, trails, spatial scratch and complete event/correction cache survive byte-for-byte');
  ctx.assert(e.packing.status.revision===revision,'allocation growth leaves the physical permutation and pending packing revision unchanged');
  ctx.assert(JSON.stringify((await progress).groups)===JSON.stringify((await e.readProgress()).groups),'queued and new progress samples agree across buffer replacement');
  ctx.assert(e.shipStorage.status.retiredBytes===0&&e.shipStorage.current.capacity===capacity,'previous buffers retire after submitted consumers and expose the requested capacity');
}
async function battle(ctx,canvas,count) {
  const e=await createEngine(canvas,{count});
  try {
    e.setPlanetsEnabled(false);for(let fleet=0;fleet<2;fleet++)order(e,{fleet,joined:true});
    for(let n=1;n<=30;n++)e.step(n/120,1/120);
    await pack(e);e.packing.requestOrder(Array.from({length:count},(_,i)=>(i+17)%count+1));e.packing.advance(2);
    ctx.assert(e.packing.status.pending,'resize begins with unfinished progressive packing');
    await preservedResize(ctx,e,10000);
    for(let n=1;n<=30;n++){e.packing.advance();e.step(.25+n/120,1/120);}
    const raw=await e.read(e.state,count*192),state=new Uint32Array(raw),floats=new Float32Array(raw);
    const targets=Array.from({length:count},(_,i)=>i).filter(i=>floats[i*48+16]>0);
    ctx.assert(targets.length>0&&targets.every(i=>{const target=(floats[i*48+16]-1)*48;return state[target+22]===1&&e.director.canTarget(state[i*48+21],state[target+21]);}),'target references remain valid while packing continues after growth');
    ctx.assert(new Set(Array.from({length:count},(_,i)=>state[i*48+23])).size===count,'motion after growth preserves every existing identity');
    order(e,{fleet:0,survivalFraction:.5});e.step(e.now,0);e.packing.request();while(e.packing.status.pending)e.packing.advance();
    ctx.assert((await e.readProgress()).groups.reduce((sum,g)=>sum+g.live,0)===e.director.alive,'losses and live-first packing use replacement buffers');
    await preservedResize(ctx,e,count);
    for(let n=0;n<4;n++){e.resizeStorage(10000);e.step(e.now+1/120,1/120);e.render();await e.shipStorage.pending;e.resizeStorage(count);e.step(e.now+1/120,1/120);await e.shipStorage.pending;}
    const sizes=shipStorageSizes(10000),maximum=Object.values(sizes).reduce((sum,x)=>sum+x,0);
    ctx.assert(e.shipStorage.status.peakBytes<=maximum*2&&e.shipStorage.status.retiredBytes===0,'repeated growth and shrinking converge within two bounded allocation sets');
    const {snapshot}=createDirectorRecovery(e,e.now+.1);
    ctx.assert(e.installSnapshot(snapshot,e.lifetime).status==='reconciled','director snapshot recovery remains valid after resource replacement');
    e.reset();e.resizeStorage(10000);e.reset();e.step(.01,.01);e.render();await e.shipStorage.pending;
    ctx.assert((await e.readProgress()).groups.reduce((sum,g)=>sum+g.live,0)===e.director.alive,'reset with an outstanding retirement seeds only the current allocation');
    ctx.metric('storage_resources',e.shipStorage.status);ctx.assert(e.errors.length===0,'resized simulation, packing, snapshot, reset and rendering report no GPU errors');
    e.resizeStorage(count);const pending=e.shipStorage.pending;e.destroy();await pending;
    ctx.assert(!e.resizeStorage(10000)&&e.shipStorage.status.retiredBytes===0,'teardown during retirement rejects further allocation requests');
  }finally{e.destroy();}
}
async function historical(ctx,canvas) {
  const e=await createEngine(canvas,{count:64,autoRebase:false});let poses,trails;
  try {
    e.setPlanetsEnabled(false);e.setTargetLinks(false);for(let fleet=0;fleet<2;fleet++)order(e,{fleet,joined:true,attackClass:5});
    e.step(255.75,.01);
    e.enqueueEvent({effectiveAt:255.8125,commands:[{fleet:0,type:0,journey:{mode:'warp',revision:1,at:250,end:251,exit:[50,0,0]}}]});
    e.step(256,.25);poses=await displayReader(e);trails=await historyReader(e);
    const before=await poses.read(.125),history=await trails.read(.125),pixels=await e.pixels({alpha:.125,follow:1,showEffects:false});
    const pending=e.readProgress();e.resizeStorage(10000);await e.shipStorage.pending;trails.destroy();trails=await historyReader(e);
    ctx.assert(same(before,await poses.read(.125))&&same(history,await trails.read(.125)),'pre-event poses and timed trails survive enlarged backing buffers');
    ctx.assert(same(pixels,await e.pixels({alpha:.125,follow:1,showEffects:false})),'follow-camera pixels are unchanged across allocation growth during an exact event interval');
    ctx.assert((await pending).status==='ready','semantic lifetime remains valid for already submitted progress');
    ctx.assert(e.rebaseClock()&&e.clock.origin===192,'clock rebasing addresses populated ranges within an oversized allocation');
    const rebased=await poses.read(.125);ctx.assert([0,1,2].every(i=>new Float32Array(rebased)[i]===new Float32Array(before)[i]),'rebasing oversized buffers preserves the historical displayed position');
    ctx.assert(e.errors.length===0,'historical render and clock replacement bindings have no validation errors');
  }finally{poses?.destroy();trails?.destroy();e.destroy();}
}
export async function validateStorage(ctx,canvas) {
  const count=Number(new URLSearchParams(location.search).get('count')??1000);
  if(count>=10000)throw Error('Storage growth fixture needs a starting population below 10000');
  await battle(ctx,canvas,count);await historical(ctx,canvas);
}
