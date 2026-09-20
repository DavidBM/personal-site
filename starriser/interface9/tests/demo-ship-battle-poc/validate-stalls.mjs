import {createEngine} from './engine.mjs';
const equal=(a,b)=>new Uint8Array(a).every((x,i)=>x===new Uint8Array(b)[i]);
const enqueue=(e,effectiveAt,commands)=>e.enqueueEvent({effectiveAt,commands});
async function catchupFrames(ctx,e) {
  if(!e.timestamps)return [e.advanceTo(.1),e.advanceTo(.1),e.advanceTo(.1)];
  const q=e.device.createQuerySet({type:'timestamp',count:30}),states=[];
  const result=e.device.createBuffer({size:240,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});
  try {
    for(let frame=0;frame<3;frame++) {
      const state=e.advanceTo(.1,{querySet:q,queryIndex:frame*10});states.push(state);
      e.render({alpha:state.alpha,distance:440,querySet:q,queryIndex:frame*10+8});
    }
    const encoder=e.device.createCommandEncoder();encoder.resolveQuerySet(q,0,30,result,0);e.device.queue.submit([encoder.finish()]);
    const values=new BigUint64Array(await e.read(result));
    const elapsed=index=>Number(values[index+1]-values[index])/1e6;
    const samples=states.map((s,frame)=>({steps:s.steps,simulationMs:Array.from({length:s.steps},(_,step)=>elapsed(frame*10+step*2)).reduce((a,b)=>a+b,0),renderMs:elapsed(frame*10+8)}));
    ctx.assert(samples.every(s=>s.steps<=1&&(s.steps===0||s.simulationMs>0)&&s.renderMs>0),'presentation takes at most one simulation tick and still renders');
    ctx.metric('catchup_gpu',{count:e.count,samples,scope:'Three diagnostic recovery frames; density/planets enabled; GPU step sums exclude CPU/queue gaps; not presented FPS'});
    return states;
  }finally{q.destroy();result.destroy();}
}
async function catchup(ctx,e) {
  enqueue(e,e.simDt,[{fleet:0,journey:{mode:'warp',revision:1,at:e.simDt,end:e.simDt*2,exit:[50,0,0]}}]);
  const first=e.advanceTo(e.simDt);
  ctx.assert(first.steps===1&&Math.abs(e.now-e.simDt)<1e-8&&e.solar.time===e.now,'one preset tick advances ships and planets together');
  const skip=e.advanceTo(e.simDt);
  ctx.assert(skip.steps===0,'duplicate presentation time does not simulate');
  const states=await catchupFrames(ctx,e);
  ctx.assert(states.every(s=>s.steps<=1),'100 ms presentation never takes four catch-up ticks');
  const freeze=e.advanceTo(e.now+0.4);
  ctx.assert(freeze.steps===0&&freeze.reason==='suspension'&&e.solar.time===e.now,'gaps over 300 ms freeze ships and planets on one clock');
  e.render({alpha:freeze.alpha,distance:440});await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'frozen presentation still renders without GPU errors');
}
async function heldScene(ctx,e,{before,history,clock,now}) {
  ctx.assert(e.now===now&&e.solar.time===now&&e.clock.origin===clock,'suspension holds the matched ship and planet clock without rebasing');
  ctx.assert(equal(before,await e.read(e.state))&&equal(history,await e.read(e.history))&&e.events.inbox.status.pending===1,'suspension preserves GPU poses, trail history and queued commands');
}
async function interrupted(ctx,e) {
  const before=await e.read(e.state),history=await e.read(e.history),clock=e.clock.origin,now=e.now;
  enqueue(e,200,[{fleet:0,joined:true}]);
  const state=e.advanceTo(300);
  ctx.assert(state.status==='needs-reconciliation'&&state.reason==='suspension'&&state.steps===0&&state.target===300,'long suspension requests current-state reconciliation instead of replaying the missed trip');
  await heldScene(ctx,e,{before,history,clock,now});
  const later=e.advanceTo(301);ctx.assert(later.target===301&&later.simulated===now&&later.steps===0,'recovery keeps the newest requested time without integrating an unbounded backlog');
  let rejected=false;try{e.advanceTo(300);}catch{rejected=true;}
  ctx.assert(rejected&&e.presentation.state.target===301,'backward presentation time rejects without altering the recovery request');
  e.reset();ctx.assert(e.presentation.state.status==='ready'&&e.presentation.state.target===0,'reset revokes the old presentation backlog and recovery request');
}
async function overloaded(ctx,e) {
  e.setDensityEnabled(false);e.setPlanetsEnabled(false);
  for(let n=1;n<=5;n++)enqueue(e,n/1000,[{fleet:0,type:0,fire:Boolean(n%2)}]);
  const state=e.advanceTo(1/120);
  ctx.assert(state.reason==='event-overflow'&&state.steps===0&&e.now===0&&e.events.inbox.status.pending===5,'event overflow becomes an explicit reconciliation request without consuming a packet');
  e.reset();
  let latest;
  for(let frame=1;frame<=10;frame++)latest=e.advanceTo(frame/25);
  ctx.assert(latest.steps<=1&&latest.reason==null,'40 ms presents take at most one preset tick and do not freeze');
  const hitch=e.advanceTo(latest.target+0.4);
  ctx.assert(hitch.steps===0&&hitch.reason==='suspension'&&e.solar.time===e.now,'a 400 ms present gap freezes ships and planets together');
  ctx.assert(e.errors.length===0,'bounded presentation overload has no GPU errors');
}
async function liveReceipts(ctx,e) {
  e.reset();const receive=e.events.receiver(),pose=await e.read(e.state);
  receive({id:'receipt-a',sequence:1,effectiveAt:.005,commands:[{fleet:0,type:0,fire:true}]},.02);
  receive({id:'receipt-b',sequence:2,effectiveAt:.005,commands:[{fleet:0,type:1,fire:true}]},.03);
  ctx.assert(equal(pose,await e.read(e.state))&&e.now===0,'receipt timestamps may lead lagging presentation without moving GPU state');
  e.advanceTo(.01);ctx.assert(e.events.history.length===0,'catch-up cannot activate a report before it was received');
  while(e.now<.025&&e.presentation.state.reason==null)e.advanceTo(e.now+e.simDt);
  ctx.assert(e.events.history.length===1&&e.events.history[0].appliedAt===.02,'an earlier receipt activates once presentation reaches its delivery');
  while(e.now<.04&&e.presentation.state.reason==null)e.advanceTo(e.now+e.simDt);
  ctx.assert(e.events.history.length===2&&e.events.history[1].appliedAt===.03&&e.events.history[1].receivedAt===.03&&e.events.history[1].effectiveAt===.005,'effect, receipt and activation times remain distinct while presenting');
  ctx.assert(e.errors.length===0,'late live receipts during catch-up have no GPU errors');
}
async function rebasedCatchup(ctx,e) {
  e.reset();e.step(255.99,0);
  enqueue(e,256.02,[{fleet:0,type:0,journey:{mode:'warp',revision:100,at:256.02,end:256.07,exit:[50,0,0]}}]);
  for(let n=0;n<64&&e.now<256.09&&e.presentation.state.reason==null;n++)e.advanceTo(Math.min(256.09,e.now+e.simDt));
  const f=new Float32Array(await e.read(e.state));
  ctx.assert(e.clock.rebases===1&&e.clock.origin===192&&f[28]===100,'bounded presentation crosses an epoch and retains the warp command');
  e.render({alpha:e.presentation.state.alpha,distance:440});await e.device.queue.onSubmittedWorkDone();
  ctx.assert(f.every(Number.isFinite)&&e.errors.length===0,'clock rebasing during catch-up preserves finite state and valid rendering');
}
export async function validateStalls(ctx,canvas) {
  const e=await createEngine(canvas,{count:Number(ctx.params.count??1000)});
  try{await catchup(ctx,e);await interrupted(ctx,e);await overloaded(ctx,e);await liveReceipts(ctx,e);await rebasedCatchup(ctx,e);}finally{e.destroy();}
  ctx.assert(e.advanceTo(1000).status==='closed','closed presentation clock cannot submit GPU work');
}
