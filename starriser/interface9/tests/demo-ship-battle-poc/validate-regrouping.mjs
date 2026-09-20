import {createEngine} from './engine.mjs';
import {displayReader} from './validate-event-frames.mjs';
const command=(e,fields)=>e.command({revision:e.director.revision+1,...fields});
const state=async e=>new Uint32Array(await e.read(e.state,e.count*192));
const identical=(a,b)=>a.length===b.length&&a.every((word,i)=>word===b[i]);
function poseSame(a,b,slot) {return a.slice(slot*48,slot*48+16).every((word,i)=>word===b[slot*48+i]);}
function requests(e,from,to) {
  return Array.from({length:32},(_,type)=>({from,to,type,visual:Math.min(2,e.director.roster.count(from,type)),logical:20*Math.min(2,e.director.roster.count(from,type))})).filter(r=>r.visual);
}
async function display(e,alpha) {const reader=await displayReader(e);try{return new Uint32Array(await reader.read(alpha));}finally{reader.destroy();}}
function warmBattle(e) {
  e.setPlanetsEnabled(false);for(let fleet=0;fleet<2;fleet++)command(e,{fleet,joined:true});
  for(let n=1;n<=20;n++)e.step(n/60,1/60);
}
async function basic(ctx,canvas,count) {
  const e=await createEngine(canvas,{count});
  try {
    warmBattle(e);
    e.packing.requestOrder([...e.director.population.ids].reverse());e.packing.advance(3);
    const followed=e.captureShip(0);e.followShip(followed);
    const before=await state(e),history=new Uint32Array(await e.read(e.history,e.count*768)),buffer=e.state,previous=e.inspection.agents.find(b=>b!==e.state);
    const oldPrevious=new Uint32Array(await e.read(previous,e.count*192)),past=await display(e,.3),population=e.director.population.revision;
    const result=await e.regroup(requests(e,0,1));const after=await state(e),newPast=await display(e,.3);
    ctx.assert(result.status==='applied'&&result.transferred>32&&e.state===buffer&&e.count===count,'regrouping transfers mixed classes without replacing buffers or population count');
    ctx.assert(before.every((_,i)=>i%48>=16||after[i]===before[i]),'all cruise positions, velocities, acceleration and attitude remain bit-exact at transfer');
    ctx.assert(identical(history,new Uint32Array(await e.read(e.history,e.count*768)))&&identical(oldPrevious,new Uint32Array(await e.read(previous,e.count*192))),'regrouping retains all trail samples and the original previous-state buffer');
    ctx.metric('regrouping_display_differences',Array.from(past,(word,i)=>({slot:Math.floor(i/48),field:i%48,before:new Float32Array(past.buffer)[i],after:new Float32Array(newPast.buffer)[i],words:[word,newPast[i]]})).filter(r=>r.words[0]!==r.words[1]&&(r.field<16||[20,21,22,23].includes(r.field))).slice(0,20));
    ctx.assert(past.every((word,i)=>i%48<16||[20,21,22,23].includes(i%48)?newPast[i]===word:true),'earlier interpolated display retains source identity and exact motion');
    const moved=[];for(let i=0;i<count;i++)if(new Float32Array(after.buffer)[i*48+28]<0)moved.push(i);
    ctx.assert(moved.length===result.transferred&&moved.every(i=>after[i*48+21]===1&&after[i*48+23]===before[i*48+23]),'GPU membership follows persistent IDs after physical packing');
    ctx.assert(moved.every(i=>new Float32Array(after.buffer)[i*48+16]===0&&new Float32Array(after.buffer)[i*48+24]===0),'transferred tactical target and threat references are revoked');
    ctx.assert(e.followedShip?.id===followed.id&&e.packing.status.pending,'camera handle and unfinished packing survive ownership transfer');
    ctx.assert((await e.regroup(requests(e,1,0),{populationRevision:population})).status==='superseded','a stale population command cannot transfer current membership');
    e.step(e.now+1/60,1/60);const resumed=await state(e);
    ctx.assert(moved.every(i=>new Float32Array(resumed.buffer)[i*48+28]>=0),'the next simulation tick consumes each destination ownership boundary');
    ctx.assert((await e.readProgress()).groups.reduce((sum,g)=>sum+g.live,0)===e.director.alive,'destination progress counts include transferred representatives exactly once');
    await eventBoundary(ctx,e);await racesAndReuse(ctx,e);
    ctx.assert(e.errors.length===0,'regrouping completes without GPU validation errors');
  }finally{e.destroy();}
}
async function eventBoundary(ctx,e) {
  const start=e.now;
  e.enqueueEvent({effectiveAt:start+.04,commands:[{fleet:1,type:0,strategy:'hold'}]});
  e.enqueueEvent({effectiveAt:start+.08,commands:[{fleet:0,type:0,strategy:'withdraw'}]});
  e.step(start+.1,.1);
  const past=await display(e,.5),before=await state(e);
  await e.regroup({from:1,to:0,type:0,visual:1,logical:20});const after=await state(e),again=await display(e,.5);
  const moved=Array.from({length:e.count},(_,i)=>i).find(i=>before[i*48+21]!==after[i*48+21]);
  ctx.assert(poseSame(past,again,moved)&&past[moved*48+21]===again[moved*48+21],'active event-frame display uses the original fleet event directory after transfer');
  const current=await display(e,1);
  ctx.assert(current[moved*48+21]===0,'destination membership becomes visible at the exact transfer endpoint');
}
async function racesAndReuse(ctx,e) {
  const request={from:0,to:1,type:0,visual:1,logical:20};
  const revision=e.director.population.revision,pending=e.regroup(request);
  ctx.assert((await e.regroup(request)).status==='busy','only one regrouping probe can be in flight');
  e.step(e.now+.01,.01);
  ctx.assert((await pending).status==='superseded'&&e.director.population.revision===revision,'motion invalidates a pending transfer without changing ownership');
  const pendingPacking=e.regroup(request);e.packing.advance(2);
  ctx.assert((await pendingPacking).status==='superseded','physical packing invalidates a pending membership observation');
  const buffers=[e.state,e.history],alive=e.director.alive;let applied=0;
  for(let n=0;n<32;n++)for(const from of [0,1]) {
    const result=await e.regroup({...request,from,to:1-from});applied+=Number(result.status==='applied');
  }
  ctx.assert(applied===64&&e.director.alive===alive&&e.state===buffers[0]&&e.history===buffers[1],'64 same-boundary transfers reuse history records without growing storage or changing the live count');
  const receiver=e.regroup(request);e.destroy();
  ctx.assert(['closed','superseded'].includes((await receiver).status)&&(await e.regroup(request)).status==='closed','teardown rejects pending and future regrouping without committing stale ownership');
}
async function warp(ctx,canvas) {
  const e=await createEngine(canvas,{count:1000});
  try {
    e.setPlanetsEnabled(false);
    command(e,{fleet:0,type:0,journey:{mode:'warp',revision:10,at:0,end:10,exit:[300,40,50]}});
    command(e,{fleet:1,type:0,journey:{mode:'approach',revision:1,at:0,end:20,exit:[-40,20,0]}});
    e.step(2,.1);const old=await state(e),past=await display(e,.25);
    await e.regroup({from:0,to:1,type:0,visual:1,logical:20});const next=await state(e),again=await display(e,.25),f=new Float32Array(next.buffer);
    ctx.assert(identical(old.slice(0,4),next.slice(0,4))&&poseSame(past,again,0),'warp transfer preserves the admission point and the prior kinematic display');
    ctx.assert(Math.hypot(...f.slice(4,7))<=f[7]&&f[31]===0,'warp ownership change performs an explicit cruise-speed handoff');
    e.step(2.1,.1);const resumed=new Float32Array((await state(e)).buffer);
    ctx.assert(resumed[28]===1,'a lower destination journey revision supersedes a higher source revision');
    ctx.assert(e.errors.length===0,'warp regrouping has no GPU errors');
  }finally{e.destroy();}
}
export async function validateRegrouping(ctx,canvas) {
  const count=Number(new URLSearchParams(location.search).get('count')??1000);
  await basic(ctx,canvas,count);await warp(ctx,canvas);
}
