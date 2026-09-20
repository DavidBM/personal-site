import {populationCycles} from './validate-population-cycles.mjs';
import {createEngine} from './engine.mjs';
import {displayReader} from './validate-event-frames.mjs';
import {createDirectorWorker} from './worker-client.mjs';
import {createDirectorRecovery} from '../demo-ship-flight-poc/director-recovery.mjs';
import {classOf,radiusOf} from './classes.mjs';
import {GRID_CELLS} from './spacing.mjs';
const command=(e,fields)=>e.command({revision:e.director.revision+1,...fields});
const state=async e=>new Uint32Array(await e.read(e.state,e.count*192));
const logical=e=>Array.from({length:e.director.capacity.groups},(_,g)=>e.director.roster.logicalCount(g>>>5,g&31)).reduce((a,b)=>a+b,0);
function advance(e,duration) {const start=e.now;for(let n=1;n<=Math.ceil(duration*120);n++){const next=Math.min(start+duration,start+n/120);e.step(next,next-e.now);}}
async function shown(e,alpha=.3) {const reader=await displayReader(e);try{return new Uint32Array(await reader.read(alpha));}finally{reader.destroy();}}
function retained(before,after,removed=0) {
  const byId=new Map();for(let i=0;i<before.length;i+=48)byId.set(before[i+23],before.subarray(i,i+48));
  let matched=0;
  for(let i=0;i<after.length;i+=48) {
    const row=byId.get(after[i+23]);if(!row)continue;matched++;
    if(![0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,20,21,22,23].every(k=>row[k]===after[i+k]))return false;
  }
  return matched===before.length/48-removed;
}
function targets(e,w) {
  const f=new Float32Array(w.buffer);let valid=true,number=0;
  for(let i=0;i<w.length/48;i++) {
    const handle=f[i*48+16];if(!handle)continue;number++;
    valid&&=handle<=e.count&&e.director.canTarget(w[i*48+21],w[(handle-1)*48+21]);
  }
  return {valid,number};
}
async function masses(e,scopes) {
  const w=new Uint32Array(await e.read(e.density));
  return scopes.map(scope=>w.subarray(scope.slot*GRID_CELLS,(scope.slot+1)*GRID_CELLS).reduce((a,b)=>a+b,0)/1024);
}
function expectedMass(e,fleets) {
  return fleets.reduce((total,fleet)=>total+Array.from({length:32},(_,type)=>classOf(type).weight*e.director.roster.count(fleet,type)).reduce((a,b)=>a+b,0),0);
}
function finishPacking(e){while(e.packing.status.pending)e.packing.advance(64);}
async function sharedLifecycle(ctx,e) {
  e.setPlanetsEnabled(false);
  const scopes=[-16,16].map(x=>e.pressure.create({center:[x,0,0],halfExtent:256}));
  for(let fleet=0;fleet<4;fleet++) {
    command(e,{fleet,joined:true,battle:Math.floor(fleet/2)+1,team:fleet%2});
    e.pressure.assign({fleet,scope:scopes[Math.floor(fleet/2)],revision:e.pressure.members[fleet].revision+1,blend:0});
  }
  e.pressure.retire(e.pressure.shared);advance(e,.5);
  command(e,{fleet:1,type:2,remaining:0});e.step(e.now,0);e.step(e.now+2.1,.01);
  const staleSnapshot=createDirectorRecovery(e,e.now).snapshot,initial=await state(e),live=e.director.alive,total=logical(e);
  const follow=e.captureShip(0);e.followShip(follow);
  const result=await e.regroup([0,30,31].map(type=>({from:0,to:2,type,visual:type===0?2:1,logical:type===0?40:20})));
  ctx.assert(result.status==='applied'&&e.director.alive===live&&logical(e)===total,'mixed fighters and capitals transfer across independent battles without changing outcomes');
  const mass=await masses(e,scopes),expected=[expectedMass(e,[0,1]),expectedMass(e,[2,3])];
  ctx.assert(mass.every((value,i)=>Math.abs(value-expected[i])<e.count*.02),'separate density fields immediately reflect the transferred full-volume ship mass');
  const oldDisplay=await shown(e);e.packing.requestOrder([...e.director.population.ids].reverse());e.packing.advance(64);
  ctx.assert(retained(oldDisplay,await shown(e)),'packing preserves an active ownership correction journal by persistent ID');
  rejectOldSnapshot(ctx,e,staleSnapshot);
  const retired=await e.reclaim();await e.shipStorage.pending;
  ctx.assert(retired.status==='applied'&&retired.retired>0&&retained(oldDisplay,await shown(e),retired.retired),'reclamation relocates active transfer history while retiring unrelated expired casualties');
  e.reinforce({fleet:1,type:2,visual:retired.retired,logical:retired.retired*20,position:[0,30,0],spread:4});await e.shipStorage.pending;
  ctx.assert(e.count===initial.length/48&&retained(oldDisplay,await shown(e),retired.retired),'births into reclaimed addresses preserve older transfer history and population capacity');
  finishPacking(e);
  ctx.assert(retained(oldDisplay,await shown(e),retired.retired)&&e.followedShip?.id===follow.id,'packing convergence preserves transfer and birth histories plus the follow handle');
  advance(e,.25);const current=await state(e),selection=targets(e,current);
  ctx.assert(selection.valid&&selection.number>e.count*.5,'transferred ships and opponents acquire only their destination battle targets');
  const progress=await e.readProgress();ctx.assert(progress.groups.reduce((sum,g)=>sum+g.live,0)===e.director.alive,'cohort progress remains exact after transfer, compaction, birth and physical relocation');
  await recoverAndSplit(ctx,e,scopes);await populationCycles(ctx,e);
  ctx.metric('population_lifecycle_resources',{count:e.count,storage:e.shipStorage.status,fields:e.pressure.allocated,fieldBytes:e.pressure.bytes});
}
function rejectOldSnapshot(ctx,e,snapshot) {
  let rejected=false;try{e.installSnapshot(snapshot,e.lifetime);}catch(error){rejected=error.message.includes('population layout');}
  ctx.assert(rejected,'a snapshot made before regrouping cannot restore earlier fleet ownership');
}
async function recoverAndSplit(ctx,e,scopes) {
  e.pressure.assign({fleet:2,scope:scopes[0],revision:e.pressure.members[2].revision+1,blend:.2});advance(e,.25);
  const {snapshot}=createDirectorRecovery(e,e.now),keys=e.director.population.keys.slice(),ids=e.director.population.ids.slice();
  ctx.assert(e.installSnapshot(snapshot,e.lifetime).status==='reconciled','current-catalog recovery accepts regrouped and reused identities after pressure merge');
  ctx.assert(keys.every((key,i)=>key===e.director.population.keys[i])&&ids.every((id,i)=>id===e.director.population.ids[i]),'recovery preserves the current transferred memberships and persistent serials');
  let stale=false;try{e.pressure.resolve(scopes[1]);}catch{stale=true;}
  ctx.assert(stale,'recovery revokes previous pressure field handles');
  const restored=e.pressure.members[3].target;
  e.pressure.assign({fleet:2,scope:restored,revision:e.pressure.members[2].revision+1,blend:.2});advance(e,.25);
  const w=await state(e);e.render({distance:500});await e.device.queue.onSubmittedWorkDone();
  ctx.assert(new Float32Array(w.buffer).every(Number.isFinite)&&targets(e,w).valid&&e.pressure.allocated<=3&&e.errors.length===0,'pressure split and recovered tactical motion remain finite with bounded field resources');
}
function scene() {
  const body=(orbit,radius)=>[orbit,radius,orbit===0?0:100000,0,1,0,0,0,0,0,1,0];
  return {sceneEpochMs:1700000000000,definition:{version:1,epochMs:1700000000000,origin:[0,0,0],bodies:[...body(0,10),...body(1000,1),...body(2000,1)]}};
}
function heldWorker(worker) {
  let release;const hold=new Promise(resolve=>{release=resolve;}),replies=[];
  return {request(kind,input,options){const reply=worker.request(kind,input,options);replies.push(reply);return Promise.all([reply,hold]).then(([value])=>value);},
    ready:()=>Promise.all(replies),release,destroy(){release();},get status(){return worker.status;}};
}
function heldProgress(e) {
  let release,ready;const hold=new Promise(resolve=>{release=resolve;}),original=GPUBuffer.prototype.mapAsync;
  GPUBuffer.prototype.mapAsync=function(...args){ready=original.apply(this,args);return Promise.all([ready,hold]).then(()=>undefined);};
  try{return {promise:e.readProgress(),ready:()=>ready,release};}finally{GPUBuffer.prototype.mapAsync=original;}
}
async function pendingWork(ctx,canvas) {
  const worker=createDirectorWorker(),held=heldWorker(worker),e=await createEngine(canvas,{count:64,solar:scene(),routeWorkerFactory:()=>held});let progress;
  try {
    const c=classOf(0),request={planet:0,at:0,end:1000,start:[-35,0,0],destination:[19.6,0,0],capability:[c.speed,c.acceleration,c.jerk,c.turn,radiusOf(0),2]};
    const plans=[0,1].map(fleet=>e.planApproach({fleet,type:0,cohort:0,revision:1,request}));const replies=await held.ready();
    e.enqueueEvent({effectiveAt:.05,commands:[],routes:[{fleet:0,type:0,cohort:0,revision:1,request,result:replies[0],basis:{journey:0,epoch:0}}]});
    progress=heldProgress(e);await progress.ready();
    const result=await e.regroup({from:0,to:1,type:0,visual:1,logical:20});held.release();progress.release();
    ctx.assert(result.status==='applied'&&(await Promise.all(plans)).every(r=>r.status==='superseded')&&e.routes.records.size===0,'completed native planner results for both transfer endpoints are rejected after ownership changes');
    const summary=await progress.promise,stale=summary.groups.filter(g=>g.stale);
    ctx.assert(stale.length===4&&stale.every(g=>g.type===0),'a real GPU progress readback held across regrouping marks exactly the two affected type groups stale');
    e.step(.1,.1);ctx.assert((await e.readProgress()).groups.every(g=>!g.stale),'fresh progress resumes after stale ownership observations are discarded');
    ctx.assert(e.routes.records.size===0&&e.events.history.some(row=>row.status==='superseded'),'an already queued route cannot reintroduce its pre-transfer continuation basis');
    ctx.assert(e.errors.length===0,'pending planner and progress admission checks have no GPU errors');
  }finally{progress?.release();held.release();e.destroy();worker.destroy();}
}
export async function validatePopulationLifecycle(ctx,canvas) {
  const e=await createEngine(canvas,{count:Number(ctx.params.count??1000),fleetCount:4});
  try{await sharedLifecycle(ctx,e);}finally{e.destroy();}
  await pendingWork(ctx,canvas);
}
