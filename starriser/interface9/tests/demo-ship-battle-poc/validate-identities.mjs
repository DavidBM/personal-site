import {displayReader} from './validate-event-frames.mjs';
import {createEngine} from './engine.mjs';
import {createDirectorRecovery} from '../demo-ship-flight-poc/director-recovery.mjs';
import {exportDirector} from './director-snapshot.mjs';
const same=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
const state=async e=>new Uint32Array(await e.read(e.state,e.count*192));
function identitiesMatch(e,w) {
  return e.slotLayout.logical.every((index,slot)=>w[slot*48+23]===e.director.population.ids[index]);
}
function shipById(words,id) {
  for(let slot=0;slot<words.length/48;slot++)if(words[slot*48+23]===id)return words.slice(slot*48,slot*48+48);
  throw Error(`Missing identity ${id}`);
}
async function pack(e) {while(e.packing.status.pending){e.packing.advance(17);await e.device.queue.onSubmittedWorkDone();}}
function join(e) {for(let fleet=0;fleet<2;fleet++)e.command({revision:e.director.revision+1,fleet,joined:true});}
export async function validateIdentities(ctx,canvas) {
  const count=Number(ctx.params.count??1000),start=0xffff0001;
  const e=await createEngine(canvas,{count,identityStart:start});
  try {
    e.setPlanetsEnabled(false);e.setTargetLinks(false);join(e);
    for(let n=1;n<=30;n++)e.step(n/120,1/120);
    const before=await state(e),handle=e.captureShip(3),original=e.resolveShip(handle);
    ctx.assert(identitiesMatch(e,before)&&handle.id===start+3,'GPU identity remains an exact u32 serial above the f32 integer range');
    ctx.assert(original.index===3&&original.slot===3&&e.resolveShip({id:4,lifetime:e.lifetime})===null,'persistent serial lookup cannot confuse a catalog address with an identity');
    const input={...handle};ctx.assert(e.followShip(input),'camera accepts a current persistent ship handle');
    input.id=e.captureShip(4).id;ctx.assert(e.followedShip.id===handle.id,'camera owns its captured handle even if the caller later mutates the input');
    const pixels=await e.pixels({follow:1,showEffects:false,showTrails:false,alpha:.4});
    const reader=await displayReader(e),displayBefore=new Uint32Array(await reader.read(.4));
    e.packing.requestOrder([...e.director.population.ids].reverse());await pack(e);
    const packed=await state(e),moved=e.resolveShip(handle);
    ctx.assert(identitiesMatch(e,packed)&&samePackedPose(before,packed,handle.id),'physical packing preserves pose words and target identities under non-index serial IDs');
    ctx.assert(moved.index===3&&moved.slot===count-4&&e.followedShip.id===handle.id,'the followed handle resolves its new slot after packing');
    const nextPixels=await e.pixels({follow:1,showEffects:false,showTrails:false,alpha:.4});
    const delta=pixelDifference(pixels,nextPixels),display=samePackedPose(displayBefore,new Uint32Array(await reader.read(.4)),handle.id);reader.destroy();
    ctx.metric('follow_diagnostic',{pixels:delta,display});
    ctx.assert(display,'historical GPU display pose and tactical references stay exact for the followed serial');
    // Reordering opaque instances can change a few depth-tied fragments where
    // hulls intersect. Keep the GPU pose exact and separately bound image drift.
    ctx.assert(delta.count<=delta.bytes*.00001,'opaque follow image changes at most 0.001 percent of channels after packing');
    await admitAndRecover(ctx,e,handle,packed,start);
    await revokedLifetime(ctx,e);
  }finally{e.destroy();}
  await exhaustion(ctx,canvas);
}
async function admitAndRecover(ctx,e,handle,before,start) {
  const initial=e.count,birth=e.reinforce([{fleet:0,type:0,visual:3,logical:60,position:[-40,8,0]},{fleet:1,type:31,visual:2,logical:40,position:[40,8,0]}]);
  await e.shipStorage.pending;const born=await state(e);
  ctx.assert(birth.firstId===start+initial&&identitiesMatch(e,born)&&same(before,born.slice(0,initial*48)),'GPU births use explicit new serials while all retained poses remain byte-identical');
  ctx.assert(e.resolveShip(handle).slot===initial-4&&e.followedShip.id===handle.id,'allocation and catalog growth preserve a previously captured follow handle');
  const newborn=e.captureShip(initial+4);ctx.assert(newborn.id===start+initial+4&&e.resolveShip(newborn).slot===initial+4,'newborn handles resolve independently from their GPU birth slots');
  const {snapshot}=createDirectorRecovery(e,e.now);
  ctx.assert(e.installSnapshot(snapshot,e.lifetime).status==='reconciled'&&e.resolveShip(handle)?.id===handle.id,'current-catalog snapshot recovery retains serial handles');
  e.command({revision:e.director.revision+1,fleet:0,type:0,remaining:0});e.step(e.now,0);
  e.packing.request();await pack(e);e.step(e.now+.01,.01);const w=await state(e);
  ctx.assert(identitiesMatch(e,w)&&new Set(w.filter((_,i)=>i%48===23)).size===e.count,'losses and live-first packing neither duplicate nor recycle serial identities');
  ctx.assert(e.resolveShip(handle)?.id===handle.id,'casualty retention is distinct from identity retirement');
  const progress=await e.readProgress();ctx.assert(progress.groups.reduce((sum,g)=>sum+g.live,0)===e.director.alive,'coarse progress still addresses fleet/type membership with independent ship IDs');
  e.render({follow:1});await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'independent identities, birth, loss, packing, snapshot and follow render without GPU errors');
  ctx.metric('identity_catalog',{firstId:e.director.population.ids[0],lastId:e.director.population.ids.at(-1),count:e.count,followed:e.followedShip});
}
async function exhaustion(ctx,canvas) {
  const e=await createEngine(canvas,{count:64,identityStart:0xffffffff-63});
  try {
    const before=await state(e),snapshot=JSON.stringify(exportDirector(e.director));let failed=false;
    try{e.reinforce({fleet:0,type:0,visual:1,logical:20,position:[0,0,0]});}catch(error){failed=/identity range/.test(error.message);}
    ctx.assert(failed&&same(before,await state(e))&&snapshot===JSON.stringify(exportDirector(e.director))&&e.shipStorage.status.revision===0,'u32 serial exhaustion rejects atomically without wrapping or changing GPU resources');
    ctx.assert(e.captureShip(63).id===0xffffffff&&before[63*48+23]===0xffffffff,'maximum u32 identity is preserved exactly in the live runtime');
    const foreign=e.captureShip(0),lifetime=e.lifetime;e.reset();
    ctx.assert(e.resolveShip(foreign)===null&&e.lifetime!==lifetime,'identical serial values in a new lifetime cannot validate an old handle');
  }finally{e.destroy();}
}

async function revokedLifetime(ctx,e) {
    const old=e.captureShip(3),pending=e.readProgress();e.reset();
    ctx.assert(e.resolveShip(old)===null&&!e.followShip(old)&&(await pending).status==='superseded','reset revokes old identity handles and pending observations');
    ctx.assert(e.captureShip(3).id===old.id&&identitiesMatch(e,await state(e)),'reset reseeds the retained serial catalog without turning IDs into indices');
    const fresh=e.captureShip(3);e.destroy();ctx.assert(e.resolveShip(fresh)===null&&!e.followShip(fresh)&&e.captureShip(0)===null,'teardown revokes every outstanding identity handle');
}

function samePackedPose(before,after,id) {
  const a=shipById(before,id),b=shipById(after,id);
  const addressFields=new Set([16,24]);
  if(!a.every((word,i)=>addressFields.has(i)||word===b[i]))return false;
  const target=(words,pose,field)=>{const slot=new Float32Array(pose.buffer)[field]-1;return slot>=0?words[slot*48+23]:0;};
  return [16,24].every(field=>target(before,a,field)===target(after,b,field));
}

function pixelDifference(a,b) {
  const left=new Uint8Array(a),right=new Uint8Array(b);let count=0,max=0,total=0;
  for(let i=0;i<left.length;i++){const d=Math.abs(left[i]-right[i]);count+=Number(d>0);max=Math.max(max,d);total+=d;}
  return {count,max,total,bytes:left.length};
}
