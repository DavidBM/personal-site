import {radiusOf} from './classes.mjs';
import {createEngine} from './engine.mjs';
import {populationCopies} from './population-copy.mjs';
import {displayReader} from './validate-event-frames.mjs';
import {historyReader} from './validate-corrections.mjs';
import {createDirectorRecovery} from '../demo-ship-flight-poc/director-recovery.mjs';
const words=raw=>new Uint32Array(raw);
const same=(a,b)=>a.length===b.length&&a.every((value,i)=>value===b[i]);
const order=(e,fields)=>e.command({revision:e.director.revision+1,...fields});
async function capture(e) {
  const result={};for(const name of ['a','b','history','links'])result[name]=await e.read(e.shipStorage.current.buffers[name],e.shipStorage.sizes[name]);return result;
}
function retained(before,after,oldCount,newCount) {
  return populationCopies(oldCount,newCount).filter(([name])=>name!=='heads').every(([name,from,to,size])=>same(new Uint8Array(before[name],from,size),new Uint8Array(after[name],to,size)));
}
function validTargets(e,raw) {
  const w=words(raw),f=new Float32Array(raw);let found=0;
  for(let i=0;i<e.count;i++)if(w[i*48+22]===1&&f[i*48+16]>0) {
    const target=f[i*48+16]-1;found++;
    if(target>=e.count||w[target*48+22]!==1||!e.director.canTarget(w[i*48+21],w[target*48+21]))return false;
  }
  return found>0;
}
function batchesToLimit(e) {
  const requests=[];let remaining=10000-e.count;
  for(let type=0;type<32&&remaining>0;type++)for(let fleet=0;fleet<2&&remaining>0;fleet++) {
    const visual=Math.min(remaining,256-e.director.roster.sizeFor(fleet,type));if(!visual)continue;
    requests.push({fleet,type,cohort:type%2,visual,logical:visual*20,position:[fleet?70:-70,40,0],spread:20});remaining-=visual;
  }
  return requests;
}
async function growing(ctx,canvas,count) {
  const e=await createEngine(canvas,{count,reserveFraction:.2});
  try {
    e.setPlanetsEnabled(false);for(let fleet=0;fleet<2;fleet++)order(e,{fleet,joined:true});
    for(let n=1;n<=30;n++)e.step(n/120,1/120);
    order(e,{fleet:0,type:0,remaining:0});e.step(e.now,0);
    e.packing.requestOrder(Array.from({length:count},(_,i)=>count-i));e.packing.advance(5);
    const initial=await capture(e),physical=e.slotLayout.physical.slice(),progress=e.readProgress(),beforeAlive=e.director.alive;
    const request=[{fleet:0,type:0,cohort:1,visual:50,logical:1000,position:[-70,40,20],spread:8},{fleet:1,type:31,visual:2,logical:60,position:[60,40,0],spread:8}];
    const oldRevision=e.director.population.revision,result=e.reinforce(request,{lifetime:e.lifetime,populationRevision:oldRevision});
    ctx.assert(result.status==='applied'&&e.count===count+52&&e.director.alive===beforeAlive+52,'real reinforcements exceed the initial reservation with exact representative counts');
    ctx.assert(e.reinforce(request).status==='busy','one in-flight population replacement bounds temporary resources');
    const after=await capture(e);await e.shipStorage.pending;
    ctx.assert(retained(initial,after,count,e.count),'growth relocates old poses, trails, event poses and correction records without changing any retained byte');
    ctx.assert(physical.every((slot,id)=>e.slotLayout.physical[id]===slot)&&e.packing.status.pending,'new IDs append without changing old physical slots or canceling progressive packing');
    const previous=await progress;ctx.assert(previous.groups.filter(g=>g.stale).every(g=>(g.fleet===0&&g.type===0)||(g.fleet===1&&g.type===31))&&previous.groups.some(g=>g.stale),'pending progress rejects affected population geometry while unrelated groups retain their epoch');
    ctx.assert(e.reinforce(request,{populationRevision:oldRevision}).status==='superseded','a stale population revision cannot replay an admission');
    ctx.assert(!e.director.roster.isLive(0,0,0)&&e.director.roster.count(0,0)===50,'new logical batches never resurrect earlier casualties');
    order(e,{fleet:0,type:0,remaining:800});e.step(e.now,0);
    ctx.assert(e.director.roster.count(0,0)===40,'1000 logical ships represented by 50 lose exactly 10 representatives after 200 logical losses');
    e.reinforce({fleet:0,type:0,cohort:0,visual:30,logical:900,position:[-70,40,20],spread:8});await e.shipStorage.pending;
    order(e,{fleet:0,type:0,remaining:850});e.step(e.now,0);
    ctx.assert(e.director.roster.count(0,0)===35&&e.director.roster.logicalCount(0,0)===850,'mixed representation ratios retain their own baselines across further admissions and losses');
    await scaleAndRecover(ctx,e,request);
  }finally{e.destroy();}
}
async function scaleAndRecover(ctx,e,request) {
    e.enqueueEvent({effectiveAt:.375,commands:[{fleet:1,admit:1,attackClass:0}]});
    const largest=e.reinforce(batchesToLimit(e));await e.shipStorage.pending;
    ctx.assert(largest.status==='applied'&&e.count===10000&&e.shipStorage.status.capacity===10000,'a mixed-type batch grows actual simulated population to 10000 without class-symmetric fleet assumptions');
    for(let n=1;n<=60;n++){e.packing.advance();e.step(.25+n/120,1/120);}
    const raw=await e.read(e.state,e.count*192),w=words(raw),live=w.filter((_,i)=>i%48===22).reduce((sum,n)=>sum+n,0);
    ctx.assert(new Set(Array.from({length:e.count},(_,i)=>w[i*48+23])).size===10000&&live===e.director.alive,'all 10000 identities are unique and queued admission commands produce the authoritative live count');
    ctx.assert(validTargets(e,raw),'motion and target selection remain valid while old packing continues over appended populations');
    ctx.assert((await e.readProgress()).groups.reduce((sum,g)=>sum+g.live,0)===live,'GPU progress includes new ordinals in both explicit cohort lanes');
    const {snapshot}=createDirectorRecovery(e,1);ctx.assert(e.installSnapshot(snapshot,e.lifetime).status==='reconciled','snapshot recovery preserves the enlarged identity catalog and logical admission batches');
    const oldCount=e.count;let rejected=false;try{e.reinforce(request);}catch{rejected=true;}
    ctx.assert(rejected&&e.count===oldCount,'capacity rejection leaves the live director and GPU population unchanged');
    e.reset();e.step(.01,.01);const reset=words(await e.read(e.state,e.count*192));
    ctx.assert(reset.every((value,i)=>i%48!==23||value===Math.floor(i/48)+1),'reset seeds the complete appended catalog in its logical identity order');
    e.render();await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'population growth, packing, queued events, snapshot recovery and reset have no GPU errors');
    ctx.metric('population_resources',{count:e.count,alive:e.director.alive,storage:e.shipStorage.status,packing:e.packing.status});
}
async function historical(ctx,canvas) {
  const e=await createEngine(canvas,{count:64,autoRebase:false});let reader,trail;
  try {
    e.setPlanetsEnabled(false);e.setTargetLinks(false);for(let fleet=0;fleet<2;fleet++)order(e,{fleet,joined:true,attackClass:5});
    e.step(255.75,.01);e.enqueueEvent({effectiveAt:255.8125,commands:[{fleet:0,type:0,journey:{mode:'warp',revision:1,at:250,end:251,exit:[50,0,0]}}]});e.step(256,.25);
    reader=await displayReader(e);trail=await historyReader(e);const before=await reader.read(.125),oldTrail=await trail.read(.125),state=await capture(e);
    e.reinforce({fleet:0,type:0,cohort:1,visual:7,logical:140,position:[-60,40,0],spread:4});await e.shipStorage.pending;
    reader.destroy();reader=await displayReader(e);trail.destroy();trail=await historyReader(e);
    const earlier=await reader.read(.125),birth=words(await reader.read(1));
    ctx.assert(retained(state,await capture(e),64,71),'population growth preserves a real populated event and correction cache');
    ctx.assert(same(words(before),words(earlier).slice(0,64*48))&&same(oldTrail,await trail.read(.125)),'earlier poses and emitter history remain exact across population growth');
    ctx.assert(words(earlier).filter((_,i)=>i>=64*48&&i%48===22).every(x=>x===0)&&birth.filter((_,i)=>i>=64*48&&i%48===22).every(x=>x===1),'new identities are absent before their birth boundary and visible at admission time');
    ctx.assert(e.rebaseClock()&&e.clock.origin===192,'clock rebasing uses the enlarged populated ranges');
    const shifted=words(await reader.read(.125));ctx.assert(shifted.filter((_,i)=>i>=64*48&&i%48===22).every(x=>x===0),'birth boundaries rebase with the old historical frame');
    e.packing.requestOrder(Array.from({length:71},(_,i)=>71-i));while(e.packing.status.pending)e.packing.advance();
    e.step(256+1/120,1/120);ctx.assert((await e.readProgress()).groups.reduce((sum,g)=>sum+g.live,0)===71,'new cohort tags survive subsequent packing and the next integration tick');
    ctx.assert(e.errors.length===0,'historical population admission and clock migration have no GPU validation errors');
  }finally{reader?.destroy();trail?.destroy();e.destroy();}
}
export async function validatePopulation(ctx,canvas) {await growing(ctx,canvas,Number(new URLSearchParams(location.search).get('count')??1000));await historical(ctx,canvas);await safetyAndLifetime(ctx,canvas);}

async function safetyAndLifetime(ctx,canvas) {
  const e=await createEngine(canvas,{count:64,pressurePlanet:1,cellSize:8});
  try {
    e.step(5,.01);const center=e.solar.bodyAt(1,e.now).slice(0,3),q=e.device.queue,write=q.writeBuffer;let poseUploads=0;
    q.writeBuffer=function(...args){if(/^ships (a|b|history|links) /.test(args[0].label))poseUploads++;return Reflect.apply(write,this,args);};
    try{e.reinforce([{fleet:0,type:0,visual:3,logical:60,position:center,spread:0},{fleet:1,type:31,visual:2,logical:40,position:center,spread:0}]);}
    finally{q.writeBuffer=write;}
    await e.shipStorage.pending;const raw=await e.read(e.state,e.count*192),f=new Float32Array(raw),w=words(raw);
    const born=Array.from({length:5},(_,i)=>64+i);
    ctx.assert(poseUploads===0,'population admission uploads coarse commands without CPU poses or trail history');
    ctx.assert(born.every(i=>[0,1,2].every(planet=>{const body=e.solar.bodyAt(planet,e.now);return Math.hypot(...[0,1,2].map(axis=>f[i*48+axis]-body[axis]))>=body[3]+radiusOf((w[i*48+20]>>>8)&255)-.01;})),'GPU birth placement clears all moving planets for small ships and colossi');
    const history=new Float32Array(await e.read(e.history,e.count*768));
    ctx.assert(born.every(i=>Array.from({length:48},(_,j)=>history[i*192+j*4+3]).filter(birth=>birth>=0).length===3),'all three emitters receive exactly one initial time-based source sample');
    const lifetime=e.lifetime,progress=e.readProgress();e.reset();
    ctx.assert((await progress).status==='superseded'&&e.reinforce({},{lifetime}).status==='superseded','reset rejects both old population requests and pending coarse GPU observations');
    const count=e.count,before=await e.read(e.state,e.count*192);let rejected=false;
    try{e.reinforce([{fleet:0,type:0,visual:2,logical:40,position:center},{fleet:1,type:31,visual:256,logical:5120,position:center}]);}catch{rejected=true;}
    ctx.assert(rejected&&e.count===count&&same(words(before),words(await e.read(e.state,e.count*192))),'an invalid later row rejects a whole admission batch before changing GPU state');
    e.reinforce({fleet:0,type:0,visual:1,logical:20,position:center});const pending=e.shipStorage.pending;e.destroy();await pending;
    ctx.assert(e.reinforce({}).status==='closed'&&e.shipStorage.status.retiredBytes===0,'teardown safely retires an in-flight admission and rejects later births');
  }finally{e.destroy();}
}
