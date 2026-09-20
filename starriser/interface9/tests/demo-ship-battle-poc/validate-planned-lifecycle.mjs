import {regroupLifecycle} from './validate-lifecycle-population.mjs';
import {createSequenceEngine} from './sequence-engine.mjs';
function admissions(ctx,e) {
  const {approaches,battleAt,events}=e.sequence;
  ctx.assert(approaches.length===2&&approaches[0].end===battleAt,'mock director schedules battle after all planned inbound windows');
  ctx.assert(approaches.every(p=>p.routes.every(r=>r.result.columns[1]===1&&r.result.columns[3]===1&&r.request.end<=p.end)),'both lifecycle approaches have feasible native worker plans');
  ctx.assert(events.filter(event=>event.commands.some(c=>c.journey?.mode==='approach')).length===0,'full lifecycle has no unplanned advisory approach command');
  ctx.metric('planned_lifecycle_schedule',{duration:e.sequence.duration,battleAt,phases:approaches.map(p=>({at:p.at,end:p.end,routes:p.routes.length}))});
}
function checkpoints(e,retirement=false,regroup=false) {
  const points=e.sequence.approaches.flatMap(phase=>phase.routes.map(route=>({time:route.request.end,route})));
  points.push({time:e.sequence.battleAt+.1,battle:true},{time:e.sequence.duration,final:true});
  if(retirement)points.push({time:e.sequence.battleAt+20,reclaim:true});
  if(regroup)points.push({time:e.sequence.battleAt+1,regroup:true});
  return points.sort((a,b)=>a.time-b.time);
}
async function advance(e,time,buffers,packing) {
  const step=1/120;
  let count=0;
  while(e.now<time-1e-7) {
    const next=Math.min(time,e.now+step);packing?.(next);e.step(next,next-e.now);buffers.add(e.state);
    if(++count%120===0)await e.device.queue.onSubmittedWorkDone();
  }
}
function sampleRoute(e,summary,route) {
  const row=summary.groups[(route.fleet*32+route.type)*2+route.cohort];
  const installed=e.routes.records.get((route.fleet*32+route.type)*2+route.cohort)?.revision===route.revision;
  return {fleet:route.fleet,type:route.type,cohort:route.cohort,deadline:route.request.end,installed,live:row.live,corrected:row.corrected,arrived:row.arrived,unapplied:row.unapplied};
}
async function replay(ctx,e) {
  const packing=ctx.params.packing==='1'?packingSchedule(e):null;
  const buffers=new Set([e.state]),identities=new Uint32Array(await e.read(e.state,e.count*192)),results=[];
  const points=checkpoints(e,ctx.params.retirement==='1',ctx.params.regroup==='1');let battle=false;const storage={history:e.history,reclaims:0,retired:0,ownership:new Map()};
  for(let i=0;i<points.length;) {
    const point=points[i];await advance(e,point.time,buffers,packing);const summary=await e.readProgress();
    if(point.battle)battle=await battleActive(e);
    await reclaimPoint(ctx,e,point,storage);
    if(point.regroup)await regroupLifecycle(ctx,e,storage);
    do{if(points[i].route)results.push(sampleRoute(e,summary,points[i].route));i++;}while(i<points.length&&points[i].time===point.time);
    console.log(`Planned lifecycle ${e.count}: t=${point.time.toFixed(1)}, ${results.length} approach cohorts audited`);
  }
  await verifyReplay(ctx,e,{buffers,storage,identities,results,battle});
  if(packing){ctx.assert(e.packing.status.swaps>e.count&&e.packing.status.lastSwaps<=64,'complete planned lifecycle repeatedly packs storage during navigation and combat');ctx.metric('planned_lifecycle_packing',e.packing.status);}
}
async function battleActive(e) {
  const data=await e.read(e.state,e.count*192),f=new Float32Array(data),w=new Uint32Array(data);
  const live=Array.from({length:e.count},(_,i)=>i).filter(i=>w[i*48+22]===1);
  return e.director.groups[3]===1&&e.director.groups[32*8+3]===1
    &&live.every(i=>f[i*48+31]===0)&&live.some(i=>f[i*48+16]>0);
}
async function verifyReplay(ctx,e,{buffers,storage,identities,results,battle}) {
  const state=await e.read(e.state,e.count*192),f=new Float32Array(state),w=new Uint32Array(state);
  ctx.metric('planned_lifecycle_arrivals',results);
  ctx.metric('planned_lifecycle_storage',{count:e.count,capacity:e.shipStorage.status.capacity,buffersSeen:buffers.size,historyRetained:e.history===storage.history,retired:storage.retired,regrouped:storage.ownership.size,identityRows:identities.length/48,finalRows:w.length/48,finite:f.every(Number.isFinite)});
  ctx.assert(results.length===192&&results.every(r=>r.installed&&r.live===r.arrived&&r.unapplied===0&&r.corrected===0),'every live representative reaches both planned approach deadlines without exceptional correction');
  ctx.assert(battle&&e.sequence.history.some(x=>x.id==='late-loss'&&x.late),'planned lifecycle admits battle and delayed authoritative losses');
  ctx.assert(e.sequence.history.length===e.sequence.events.length&&e.director.alive<e.count,'complete planned lifecycle applies all events including reinforcements and losses');
  ctx.assert(f.every(Number.isFinite)&&samePopulation(identities,w,storage.retired,storage.ownership)&&buffers.size===2*(storage.reclaims+1)&&e.history===storage.history,'complete planned lifecycle retains finite GPU state, identities and trail resources');
  ctx.assert([.6,.8].every((fraction,fleet)=>e.director.roster.cohorts[fleet][0].quota===Math.round(e.director.roster.cohorts[fleet][0].baseline*fraction)),'later casualty reports retain their original cohort baseline after reclamation');
  ctx.assert(e.director.groups.filter((_,i)=>i%8===3).every(x=>x===0),'final return leaves every fleet out of combat');
  ctx.assert(e.clock.rebases===9&&e.clock.local(e.now)<256,'complete lifecycle crosses nine GPU clock epochs with all arrival and battle deadlines intact');
}
export async function validatePlannedLifecycle(ctx,canvas) {
  const e=await createSequenceEngine(canvas,{count:Number(ctx.params.count??1000),period:30,lifecycle:true});
  try {
    admissions(ctx,e);if(ctx.params.population==='1')await admitToMovingOrbit(ctx,e);if(ctx.params.authorOnly!=='1')await replay(ctx,e);
    e.render({distance:440});await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'worker-planned lifecycle renders without GPU validation errors');
  }finally{e.destroy();}
}

function packingSchedule(e) {
  let period=-1;
  return time=>{
    const next=Math.floor(time/30);
    if(next!==period){period=next;const shift=(next*137+31)%e.count;e.packing.requestOrder(Array.from({length:e.count},(_,i)=>e.director.population.ids[(i+shift)%e.count]));}
    e.packing.advance(64);
  };
}
function samePopulation(before,after,retired=0,ownership=new Map()) {
  const source=new Map();for(let i=0;i<before.length;i+=48)source.set(before[i+23],[before[i+20],before[i+21]]);
  const seen=new Set();
  for(let i=0;i<after.length;i+=48){const id=after[i+23],identity=ownership.get(id)??source.get(id);if(seen.has(id)||!identity||identity[0]!==after[i+20]||identity[1]!==after[i+21])return false;seen.add(id);}
  return source.size-retired===seen.size;
}

async function admitToMovingOrbit(ctx,e) {
  for(let n=1;n<=60;n++)e.step(n/120,1/120);
  const summary=await e.readProgress(),count=e.count,raw=await e.read(e.state,count*192),history=await e.read(e.history,count*768);
  const result=e.reinforce({fleet:0,type:0,visual:10,logical:200,position:summary.groups[0].anchor,spread:0});await e.shipStorage.pending;
  const state=await e.read(e.state,count*192),trails=await e.read(e.history,count*768);
  ctx.assert(result.status==='applied'&&e.count===count+10,'moving orbit admits real new identities while the full authored navigation schedule remains pending');
  ctx.assert(new Uint8Array(raw).every((v,i)=>v===new Uint8Array(state)[i])&&new Uint8Array(history).every((v,i)=>v===new Uint8Array(trails)[i]),'orbit admission preserves every existing pose and trail byte before scheduled departure');
}

async function reclaimPoint(ctx,e,point,storage) {
  if(!point.reclaim)return;
  const result=await e.reclaim();await e.shipStorage.pending;
  ctx.assert(result.status==='applied'&&result.retired>0,'full lifecycle reclaims expired casualties during combat');
  storage.reclaims++;storage.retired+=result.retired;storage.history=e.history;
}
