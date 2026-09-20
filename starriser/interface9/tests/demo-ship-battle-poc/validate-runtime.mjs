import {createEngine} from './engine.mjs';
import {createNavigationEngine} from './navigation-engine.mjs';
import {createSequenceEngine} from './sequence-engine.mjs';
import {bodyAt} from '../demo-ship-flight-poc/solar-layout.mjs';
import {orbitRadius} from '../demo-ship-flight-poc/flight-layout.mjs';

async function navigation(ctx,canvas,scenario) {
  const e=await createNavigationEngine(canvas,{count:64,scenario,period:30,warpEnd:2});
  try {
    const initial=await e.read(e.state),f=new Float32Array(initial),w=new Uint32Array(initial),history=e.history;
    e.step(0,0);let current=new Float32Array(await e.read(e.state));
    const fields=scenario===3?[0,1,2,12,13,14,15]:[0,1,2,4,5,6,8,9,10,12,13,14,15];
    ctx.assert(Array.from({length:64},(_,i)=>fields.every(a=>Math.abs(f[i*48+a]-current[i*48+a])<1e-6)).every(Boolean),`director scenario ${scenario} activation preserves its pose under the mode contract`);
    if(scenario===3)ctx.assert(Math.hypot(...current.slice(4,7))>10,'warp activation supplies its declared kinematic velocity');
    if(scenario===0) {
      const planet=bodyAt(1,0,30);
      ctx.assert(Array.from({length:64},(_,i)=>Math.abs(Math.hypot(...[0,1,2].map(a=>f[i*48+a]-planet[a]))-orbitRadius((w[i*48+20]>>8)&255,planet[3]))<2e-5).every(Boolean),'director population starts on class-specific orbital radii');
    }
    for(let frame=1;frame<=720;frame++)e.step(frame/120,1/120);
    const after=await e.read(e.state),words=new Uint32Array(after);current=new Float32Array(after);
    ctx.assert(current.every(Number.isFinite)&&words.filter((_,i)=>i%48===23).every((x,i)=>x===w[i*48+23]),`director scenario ${scenario} retains finite state and stable identities`);
    ctx.assert(e.history===history,`director scenario ${scenario} retains its trail buffer`);
    e.setDensityVisible(true);e.render({distance:440});await e.device.queue.onSubmittedWorkDone();
    ctx.assert(e.errors.length===0,`director scenario ${scenario} rendering validates`);
  }finally{e.destroy();}
}
async function replayLifecycle(e) {
  const modes=new Set(),buffers=new Set([e.state]);let previous=null,battleObserved=false,peak=e.director.alive,finite=true;
  for(let frame=1;frame<=12000;frame++) {
    const time=frame/120;e.step(time,1/120);buffers.add(e.state);peak=Math.max(peak,e.director.alive);
    if(frame%120!==0)continue;
    const state=new Float32Array(await e.read(e.state));finite&&=state.every(Number.isFinite);
    const words=new Uint32Array(state.buffer);
    for(let i=0;i<e.count;i++)if(words[i*48+22])modes.add(state[i*48+31]);
    if(time===40)battleObserved=state.filter((_,i)=>i%48===16).some(x=>x>0)&&e.director.groups[3]===1&&e.director.groups[32*8+3]===1;
    previous=state;
  }
  return {modes,buffers,previous,battleObserved,peak,finite};
}
async function lifecycle(ctx,canvas) {
  const count=Number(ctx.params.count??1000);
  const e=await createSequenceEngine(canvas,{count,period:30,lifecycle:true,legacyLifecycle:true});
  try {
    const initial=new Uint32Array(await e.read(e.state)),history=e.history;
    const {modes,buffers,previous,battleObserved,peak,finite}=await replayLifecycle(e);
    const words=new Uint32Array(previous.buffer);
    const continuous=words.filter((_,i)=>i%48===23).every((x,i)=>x===initial[i*48+23]);
    ctx.metric('lifecycle_capacity',count);
    ctx.assert(finite&&continuous&&buffers.size===2&&e.history===history,'100-second directed lifecycle uses one persistent state/history lifetime');
    ctx.assert([-2,-1,0,1,2,3].every(mode=>modes.has(mode)),'same population executes orbit, departure, warp, approach, battle and escape');
    ctx.assert(battleObserved&&peak===count,'new lifecycle performs directed targeting and admits all reserved reinforcements');
    ctx.assert(e.sequence.history.find(event=>event.id==='late-loss')?.late&&e.director.alive<count,'new lifecycle applies delayed authoritative casualties');
    ctx.assert(e.sequence.history.length===e.sequence.events.length,'full lifecycle admits every directed event exactly once');
    ctx.assert(e.director.groups.filter((_,i)=>i%8===3).every(x=>x===0),'final orbital return cannot invent a new battle');
    e.render({distance:440});await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'full lifecycle renderer validates');
  }finally{e.destroy();}
}
export async function validateRuntime(ctx,canvas){for(const scenario of [0,1,3])await navigation(ctx,canvas,scenario);await interruptions(ctx,canvas);await callerEncoder(ctx,canvas);await lifecycle(ctx,canvas);}

async function callerEncoder(ctx,canvas) {
  const e=await createNavigationEngine(canvas,{count:64,scenario:0,period:30});
  try {
    e.step(0,0);
    const encoder=e.device.createCommandEncoder();
    e.encodeTick(encoder,1/120,1/120);
    e.device.queue.submit([encoder.finish()]);
    e.commitTick();
    const state=new Float32Array(await e.read(e.state));
    ctx.assert(e.now===1/120&&state.every(Number.isFinite),'caller encoder tick advances the shared clock and produces finite poses');
    ctx.assert(e.ownsDevice,'lab construction still owns the device it requested');
    ctx.assert(e.errors.length===0,'caller encoder tick has no GPU errors');
    const guest=await createEngine(canvas,{count:64,device:e.device,adapter:e.adapter,timestamps:e.timestamps});
    ctx.assert(!guest.ownsDevice,'an injected device is not owned by the guest engine');
    guest.destroy();
    e.step(2/120,1/120);
    ctx.assert(e.errors.length===0,'destroying a guest engine does not destroy an injected device');
    const {encodeDirectorPacket}=await import('/dist/lib/ship-runtime/packet.js');
    const receipt=e.receiveEvent(encodeDirectorPacket({
      id:'binary-1',sequence:1,effectiveAt:e.now,commands:[{fleet:0,strategy:'hold'}],
    }),e.lifetime,e.now);
    ctx.assert(receipt.status==='queued'||receipt.status==='applied','binary director packet is accepted on the live receive path');
    ctx.assert(typeof e.extras.pack==='function'&&typeof e.extras.rebase==='function','named extras are distinct from encodeTick');
  }finally{e.destroy();}
}

async function interruptions(ctx,canvas) {
  const e=await createNavigationEngine(canvas,{count:64,scenario:0,period:30});
  try {
    let now=0,revision=20;e.step(0,0);
    for(const mode of ['departure','warp','orbit','warp','approach','local','orbit']) {
      const before=await e.read(e.state),history=await e.read(e.history),old=new Float32Array(before);
      e.command({revision:++revision,fleet:0,joined:mode==='local',journey:{mode,revision,at:now,end:now+2,exit:[-20,40,80],planet:1}});
      ctx.assert(new Uint8Array(await e.read(e.state)).every((x,i)=>x===new Uint8Array(before)[i]),`${mode} command never uploads a live pose`);
      e.step(now,0);const state=new Float32Array(await e.read(e.state));
      ctx.assert(Array.from({length:32},(_,i)=>[0,1,2].every(a=>Math.abs(state[i*48+a]-old[i*48+a])<1e-5)).every(Boolean),`${mode} preemption captures current GPU position continuously`);
      ctx.assert(new Uint8Array(await e.read(e.history)).every((x,i)=>x===new Uint8Array(history)[i]),`${mode} preemption preserves timed emitter history`);
      if(old[31]>=2&&mode!=='warp')ctx.assert(Math.hypot(...state.slice(4,7))<=state[7],'interrupted warp hands local flight a cruise-compatible velocity');
      for(let step=0;step<30;step++){now+=1/120;e.step(now,1/120);}
    }
  }finally{e.destroy();}
}
