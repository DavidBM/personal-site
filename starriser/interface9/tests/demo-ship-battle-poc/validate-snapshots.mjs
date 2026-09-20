import {createEngine} from './engine.mjs';
import {exportDirector} from './director-snapshot.mjs';
import {modelKey} from './local-routes.mjs';
import {orbitRadius} from '../demo-ship-flight-poc/flight-layout.mjs';
import {radiusOf} from './classes.mjs';
const equal=(a,b)=>new Uint8Array(a).every((x,i)=>x===new Uint8Array(b)[i]);
const command=(d,c)=>d.apply({revision:d.revision+1,...c});
const packet=(sequence,effectiveAt,commands,extra={})=>({id:`recovery-${sequence}`,sequence,effectiveAt,commands,...extra});
export function snapshot(e,source,at=300,revision=1) {
  return {version:1,revision,at,model:modelKey(e.solar),director:exportDirector(source),routes:[],
    placements:Array.from({length:e.director.capacity.groups*2},()=>({position:e.solar.bodyAt(1,at).slice(0,3),velocity:[0,0,0],spread:3})),
    pressure:{scopes:[{planet:1},{center:[600,50,0],halfExtent:400}],members:[0,1]},
    stream:{through:2,lanes:Array(4096).fill(0),pending:[]}};
}
function seed(e) {
  const source=e.director.fork();
  command(source,{fleet:0,admit:1,survivalFraction:.8});command(source,{fleet:1,admit:1});
  command(source,{fleet:0,type:0,journey:{mode:'orbit',revision:1,at:100,end:100,planet:1,exit:[0,0,0]}});
  command(source,{fleet:0,type:1,journey:{mode:'warp',revision:1,at:100,end:200,exit:[800,60,30]}});
  command(source,{fleet:0,type:2,journey:{mode:'warp',revision:1,at:299,end:302,exit:[900,80,20]}});
  return source;
}
async function invalid(ctx,e,value) {
  const before=await e.read(e.state),history=await e.read(e.history),orders=exportDirector(e.director),inbox=e.events.inbox,origin=e.clock.origin;
  const changes=[v=>v.placements.pop(),v=>v.placements[0].spread=Infinity,v=>v.model='wrong',v=>v.stream.lanes.pop(),v=>v.pressure.members[0]=8,v=>v.pressure.scopes[0].halfExtent=1e300,v=>delete v.director.fleets[0].team,v=>v.director.groups[0].journeys[0].at=301];
  for(const change of changes) {const bad=structuredClone(value);change(bad);let rejected=false;try{e.installSnapshot(bad,e.lifetime);}catch{rejected=true;}ctx.assert(rejected,'malformed snapshot rejects before live commit');}
  ctx.assert(Math.abs(e.now-.025)<1e-9&&e.clock.origin===origin&&e.events.inbox===inbox&&JSON.stringify(exportDirector(e.director))===JSON.stringify(orders),'invalid recovery preserves live time, director, receipts and epochs');
  ctx.assert(equal(before,await e.read(e.state))&&equal(history,await e.read(e.history)),'invalid recovery preserves both pose and trail bytes');
}
function gpuWrites(e,work) {
  const q=e.device.queue,write=q.writeBuffer,writes=[];
  q.writeBuffer=function(...args){writes.push(args[0]);return Reflect.apply(write,this,args);};
  try{const result=work();return {result,writes};}finally{q.writeBuffer=write;}
}
function poseChecks(ctx,e,raw,before) {
  const f=new Float32Array(raw),w=new Uint32Array(raw),old=new Uint32Array(before),live=[];
  for(let i=0;i<e.count;i++)if(w[i*48+22])live.push(i);
  ctx.assert(f.every(Number.isFinite)&&live.length===e.director.alive&&live.length===e.count*.8,'snapshot materializes the exact authoritative live roster with finite GPU state');
  ctx.assert(Array.from({length:e.count},(_,i)=>[20,21,23].every(field=>w[i*48+field]===old[i*48+field])).every(Boolean),'recovery preserves persistent identity, fleet and serial for every reserved slot');
  ctx.assert(live.every(i=>Math.abs(f[i*48+39]-(e.clock.local(300)+1))<.001),'every recovered live ship receives a bounded reappearance marker');
  const slot=type=>e.director.groups[type*8+4],orbit=slot(0),expired=slot(1),active=slot(2),planet=e.solar.bodyAt(1,300);
  const distance=Math.hypot(...[0,1,2].map(a=>f[orbit*48+a]-planet[a]));
  ctx.assert(Math.abs(distance-orbitRadius(0,planet[3]))<.01,'missed orbit arrival distributes ships on their current moving class ring');
  ctx.assert(Math.hypot(...[800,60,30].map((v,a)=>f[expired*48+a]-v))<=7.01&&f[expired*48+31]===0,'expired warp resumes directly at its authoritative exit without replaying missed travel');
  ctx.assert(f[active*48+31]===2&&f[active*48+30]===e.clock.local(302),'in-progress warp retains the original authoritative end time');
  const locals=live.filter(i=>w[i*48+21]===1);
  ctx.assert(locals.every(i=>[0,1,2].every(body=>{
    const p=e.solar.bodyAt(body,300),r=radiusOf((w[i*48+20]>>>8)&255);
    return Math.hypot(...p.slice(0,3).map((v,a)=>f[i*48+a]-v))>=p[3]+r+1.98;
  })),'GPU current-phase placement clears every local hull from all moving planetary obstacles');
}
async function recovered(ctx,e,value) {
  const before=await e.read(e.state),buffers=[...e.inspection.agents,e.history,e.inspection.links,e.inspection.control,e.density],handle=e.pressure.shared;
  const receiver=e.events.receiver();
  receiver(packet(3,100,[{fleet:0,survivalFraction:.6}]),.025);
  receiver(packet(4,300.02,[{fleet:0,type:3,fire:true}],{lane:2,revision:2}),.025);
  value.stream.pending=[packet(2,300.01,[{fleet:0,type:3,fire:false}],{lane:2,revision:1})];value.stream.lanes[2]=1;
  await invalid(ctx,e,value);e.advanceTo(300);
  const {result,writes}=gpuWrites(e,()=>e.installSnapshot(value,e.lifetime));
  ctx.assert(result.status==='reconciled'&&e.now===300&&e.solar.time===300&&e.presentation.state.status==='ready','validated snapshot releases the suspension hold and synchronizes ship, planet and presentation clocks');
  ctx.assert(e.clock.origin===192&&e.events.recovery.count===1,'long recovery rebases the GPU clock and exposes its correction count');
  ctx.assert(writes.every(buffer=>!e.inspection.agents.includes(buffer)&&buffer!==e.history&&buffer!==e.inspection.links),'CPU recovery uploads only group controls and anchors; GPU owns individual poses and trails');
  ctx.assert(buffers.every((buffer,i)=>buffer===[...e.inspection.agents,e.history,e.inspection.links,e.inspection.control,e.density][i]),'recovery preserves every existing pose, trail, spatial, control and density allocation');
  scopeAndInboxChecks(ctx,e,handle);
  const raw=await e.read(e.state);poseChecks(ctx,e,raw,before);
  await rebuiltPressure(ctx,e);
  const history=new Float32Array(await e.read(e.history)),births=history.filter((_,i)=>i%4===3&&history[i]>=0);
  ctx.assert(births.length===e.director.alive*3&&births.every(t=>t===e.clock.local(300)),'recovery reseeds each live emitter at the source without long catch-up trail segments');
  e.render({alpha:0,distance:440});await e.device.queue.onSubmittedWorkDone();
  for(let n=0;n<8&&e.now<300.025-1e-9;n++)e.advanceTo(e.now+e.simDt);
  ctx.assert(e.director.intents[3].fire===1&&e.events.history.filter(h=>h.sequence===4&&h.status==='applied').length===1,'newer future order still activates exactly once after recovery');
  receiver(packet(5,300.025,[{fleet:1,type:0,fire:true}]),300.025);e.flushEvents();
  ctx.assert(e.director.intents[32].fire===1,'existing transport receiver follows the replaced inbox after reconciliation');
  const revision=e.events.recovery.revision,rawAfter=await e.read(e.state);let rejected=false;
  try{e.installSnapshot(value,e.lifetime);}catch{rejected=true;}
  ctx.assert(rejected&&revision===e.events.recovery.revision&&equal(rawAfter,await e.read(e.state)),'duplicate or stale snapshot cannot replay a correction');
  ctx.assert(e.errors.length===0,'recovery and subsequent interpolated rendering have no GPU errors');
}
async function replayRecovery(ctx,e) {
  e.reset();const journal=e.events.replay([{id:'covered',effectiveAt:1,deliveredAt:1,commands:[{fleet:1,survivalFraction:0}]},{id:'future',effectiveAt:302,deliveredAt:302,commands:[{fleet:0,type:4,fire:true}]}]);
  const value=snapshot(e,e.director,300,1);let rejected=false;try{e.installSnapshot(value,e.lifetime);}catch{rejected=true;}
  ctx.assert(rejected&&!journal.complete&&journal.history.length===0,'startup journal needs explicit snapshot coverage before missed events can be consumed');
  value.replayAt=300;e.installSnapshot(value,e.lifetime);
  ctx.assert(journal.history.length===1&&journal.history[0].status==='reconciled'&&!journal.complete,'covered startup events are reconciled without applying historical casualties; future replay remains queued');
  const lifetime=e.lifetime;e.reset();
  ctx.assert(e.installSnapshot(value,lifetime).status==='superseded'&&e.now===0,'reset invalidates a delayed snapshot callback before GPU mutation');
}
export async function validateSnapshots(ctx,canvas) {
  const e=await createEngine(canvas,{count:Number(ctx.params.count??1000),reserveFraction:.2});
  try{
    for(let n=0;n<8&&e.now<.025-1e-9;n++)e.advanceTo(e.now+e.simDt);
    await recovered(ctx,e,snapshot(e,seed(e)));await replayRecovery(ctx,e);
  }finally{e.destroy();}
  ctx.assert(e.installSnapshot({},e.lifetime).status==='superseded','destroyed runtime rejects recovery without touching the GPU');
}

function scopeAndInboxChecks(ctx,e,handle) {
  let stale=false;try{e.pressure.resolve(handle);}catch{stale=true;}
  ctx.assert(stale&&e.pressure.activeCount===2&&e.pressure.layout.fields<=16,'pressure restoration revokes old scope handles and rebuilds bounded current memberships');
  const pressure=e.pressure.resolve(e.pressure.members[0].target);
  ctx.assert(pressure.planet===1&&pressure.halfExtent>orbitRadius(31,e.solar.bodyAt(1,300)[3]),'restored planet pressure covers every class ring with margin');
  ctx.assert(e.events.inbox.status.pending===1&&e.events.history.some(h=>h.sequence===3&&h.status==='applied')&&e.events.history.some(h=>h.sequence===2&&h.status==='superseded'),'snapshot keeps newer casualties and replaces the older future lane without replaying covered history');
}

async function rebuiltPressure(ctx,e) {
  const before=await e.read(e.density);e.step(e.now,0);
  ctx.assert(new Uint32Array(before).some(n=>n>0)&&equal(before,await e.read(e.density)),'snapshot rebuilds pressure from recovered positions in the same submitted frame');
}
