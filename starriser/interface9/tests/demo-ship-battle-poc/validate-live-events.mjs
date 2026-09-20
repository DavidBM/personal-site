import {createEngine} from './engine.mjs';
import {createSequenceEngine} from './sequence-engine.mjs';
import {createDirectorWorker} from './worker-client.mjs';
import {approachRequest} from './local-routes.mjs';
const receive=(e,packet,lifetime=e.lifetime)=>e.receiveEvent(packet,lifetime);
const packet=(sequence,effectiveAt,commands,extra={})=>({id:`live-${sequence}`,sequence,effectiveAt,commands,...extra});
const warp=(fleet,revision,at,end,exit)=>({fleet,journey:{mode:'warp',revision,at,end,exit}});
const equal=(a,b)=>new Uint8Array(a).every((v,i)=>v===new Uint8Array(b)[i]);
async function liveMotion(ctx,e) {
  e.setDensityEnabled(false);e.setPlanetsEnabled(false);
  const state=await e.read(e.state),history=await e.read(e.history);
  const first=packet(2,2,[warp(0,1,2,4,[50,0,0])],{lane:0,revision:1});
  receive(e,first);first.commands[0].journey.exit[0]=999;
  receive(e,packet(1,2,[warp(1,1,2,4,[-50,0,0])],{lane:1,revision:1}));
  receive(e,packet(3,1,[warp(0,2,1,3,[40,0,0])],{lane:0,revision:2}));
  ctx.assert(e.events.inbox.status.pending===2&&e.events.inbox.status.receiptPrefix===3,'live ingress accepts reordered receipts and replaces only the selected pending lane');
  ctx.assert(equal(state,await e.read(e.state))&&equal(history,await e.read(e.history)),'receiving future orders never uploads or changes live GPU state/history');
  e.step(.999,0);ctx.assert(e.director.intents[0].journeys[0]===null,'future live warp cannot activate before its boundary');
  e.step(1.001,.002);const active=new Float32Array(await e.read(e.state));
  ctx.assert(active[28]===2&&active[29]===1&&e.events.history.find(x=>x.sequence===3).appliedAt===1,'live warp captures GPU origin at its exact boundary inside a straddling step');
  e.step(2,0);e.step(3,1);const arrived=new Float32Array(await e.read(e.state));
  ctx.assert(arrived[31]===0&&arrived[30]===3&&e.director.intents[32].journeys[0].revision===1,'superseded order stays cancelled while the independent fleet order and original deadline survive');
  const before=e.director.revision;
  ctx.assert(receive(e,packet(3,1,[warp(0,2,1,3,[40,0,0])],{lane:0,revision:2})).status==='duplicate','completed live sequence cannot be applied twice');
  e.flushEvents();ctx.assert(e.director.revision===before,'duplicate live packets do not advance authoritative state');
}
async function boundaries(ctx,e) {
  receive(e,packet(4,1,[{fleet:0,survivalFraction:.8}]));e.flushEvents();
  const state=await e.read(e.state),f=new Float32Array(state),w=new Uint32Array(state);
  const deaths=Array.from({length:e.count},(_,i)=>i).filter(i=>w[i*48+22]===0);
  ctx.assert(deaths.length===e.count/10&&deaths.every(i=>f[i*48+40]===3),'late live loss report projects its exact quota and uses current GPU effect time');
  ctx.assert(e.events.history.at(-1).late&&e.events.history.at(-1).appliedAt===3,'live report records the declared time and actual late admission independently');
  receive(e,packet(5,5,[{fleet:0,joined:true}],{lane:2,revision:1}));let rejected=false;
  try{receive(e,packet(6,4,[{fleet:0,strategy:'invalid'}],{lane:2,revision:2}));}catch{rejected=true;}
  ctx.assert(rejected&&e.events.inbox.status.pending===1,'invalid replacement cannot cancel a valid queued directive');
  rejected=false;try{receive(e,packet(6,4,[{fleet:0,survivalFraction:.6}],{lane:2,revision:2}));}catch{rejected=true;}
  ctx.assert(rejected&&e.events.inbox.status.pending===1,'replacement lanes cannot discard authoritative population facts');
  receive(e,packet(6,3,[{fleet:0,survivalFraction:1}]));e.flushEvents();
  ctx.assert(e.events.history.at(-1).status==='rejected'&&e.director.alive===e.count-deaths.length,'state-dependent resurrection attempt is recorded and cannot poison later delivery');
  e.step(5,0);ctx.assert(e.director.groups[3]===1,'valid order still applies after an unrelated rejected report');
  const lifetime=e.lifetime,receiver=e.events.receiver();receive(e,packet(7,6,[{fleet:1,joined:true}]));e.reset();
  ctx.assert(receive(e,packet(8,0,[{fleet:1,joined:true}]),lifetime).status==='superseded'&&receiver(packet(9,0,[])).status==='superseded'&&e.events.inbox.empty,'runtime reset revokes old callback lifetimes and queued packets');
}
async function replayAndLive(ctx,canvas) {
  const e=await createSequenceEngine(canvas,{count:1000});
  try {
    e.step(0,0);receive(e,packet(1,.5,[{fleet:0,fire:true}]));e.step(.6,.6);
    ctx.assert(e.sequence.history[0].appliedAt===0&&e.events.history[0].appliedAt===.5&&e.director.intents[0].fire===1,'startup replay and live packets share the same integration owner');
    e.step(12.01,0);ctx.assert(e.sequence.history.find(x=>x.id==='battle').appliedAt===12.01,'missed replay event admits at the shared current clock');
    e.render();await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'combined replay/live runtime renders without GPU errors');
  }finally{e.destroy();}
}
export async function validateLiveEvents(ctx,canvas) {
  const e=await createEngine(canvas,{count:Number(ctx.params.count??1000)});
  try{await liveMotion(ctx,e);await boundaries(ctx,e);e.render();await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'live packet motion and loss boundaries have no GPU errors');}finally{e.destroy();}
  ctx.assert(receive(e,packet(1,0,[])).status==='closed','closed runtime rejects live ingress');
  await replayAndLive(ctx,canvas);
  await futureRoute(ctx,canvas);
  await burst(ctx,canvas);
}
async function burst(ctx,canvas) {
  const e=await createEngine(canvas,{count:10000});
  try {
    for(let sequence=1;sequence<=64;sequence++)receive(e,packet(sequence,0,[{fleet:Math.floor((sequence-1)/32),type:(sequence-1)%32,fire:true}]));
    const writes=[],queue=e.device.queue,original=queue.writeBuffer,submit=queue.submit;let submissions=0;
    queue.writeBuffer=function(...args){writes.push({buffer:args[0],bytes:args[4]??args[2].byteLength});return Reflect.apply(original,this,args);};
    queue.submit=function(...args){submissions++;return Reflect.apply(submit,this,args);};
    try{e.flushEvents();}finally{queue.writeBuffer=original;queue.submit=submit;}
    const fullControls=writes.filter(w=>w.buffer===e.inspection.orders||(w.buffer===e.inspection.control&&w.bytes===e.inspection.baseControlBytes));
    ctx.assert(fullControls.length===2&&submissions===1&&e.events.history.length===64&&e.director.intents.every(intent=>intent.fire===1),'64 same-boundary live packets share two full director uploads and one activation');
    ctx.assert(writes.every(w=>!e.inspection.agents.includes(w.buffer)&&w.buffer!==e.history),'live packet burst never uploads individual GPU poses or trail history');
    await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'batched live activation has no GPU errors');
    ctx.metric('live_boundary_burst',{packets:64,submissions,fullDirectorWrites:fullControls.length,fullDirectorBytes:fullControls.reduce((n,w)=>n+w.bytes,0)});
  }finally{e.destroy();}
}
async function futureRoute(ctx,canvas) {
  const e=await createEngine(canvas,{count:64}),worker=createDirectorWorker();
  try {
    e.setDensityEnabled(false);e.setPlanetsEnabled(false);e.step(260,0);
    const at=262,p=e.solar.bodyAt(1,at),request=approachRequest(e.solar,{type:0,at,end:at+500,start:[p[0]+p[3]+25,p[1],p[2]]});
    const result=await worker.request('route',{definition:e.solar.definition,sceneEpochMs:e.solar.sceneEpochMs,request});
    const plan={fleet:0,type:0,cohort:0,revision:1,request,result};
    const state=await e.read(e.state);
    receive(e,packet(1,at,[],{routes:[plan],lane:0,revision:1}));
    ctx.assert(!e.routes.records.has(0)&&equal(state,await e.read(e.state)),'real worker future route remains queued without changing current GPU guidance or poses');
    e.step(at-.001,0);ctx.assert(!e.routes.records.has(0),'future route waits for its exact active window');
    e.step(at+.001,.002);const active=new Float32Array(await e.read(e.state));
    ctx.assert(e.routes.records.get(0)?.revision===1&&active[28]===1&&active[29]===70&&active[31]===1,'future worker route installs at its exact boundary in the rebased GPU epoch');
    receive(e,packet(2,at+1,[],{routes:[{...plan,revision:2}],lane:0,revision:2}));
    const stale=receive(e,packet(3,e.now,[],{routes:[plan],lane:0,revision:3}));e.flushEvents();
    ctx.assert(stale.status==='superseded'&&e.events.inbox.status.pending===1&&e.events.lastFailure===null,'superseded route receipt consumes its sequence without cancelling a valid future order or reporting a recovery fault');
    e.step(request.end+1,0);
    ctx.assert(e.events.history.at(-1).status==='rejected'&&e.routes.records.get(0)?.revision===1,'route received but missed past its deadline reports rejection without installing expired guidance');
    ctx.assert(e.errors.length===0,'future and expired route admission have no GPU errors');
  }finally{worker.destroy();e.destroy();}
}
