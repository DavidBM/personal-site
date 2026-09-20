import {createScopeDemo} from './scope-demo.mjs';
import {createEngine} from './engine.mjs';
import {createDirectorRecovery} from '../demo-ship-flight-poc/director-recovery.mjs';
const near=(a,b)=>Math.abs(a-b)<1e-6;
async function timeline(ctx,canvas) {
  const e=await createScopeDemo(canvas,{count:1000,period:30});
  try {
    e.step(11.999,0);const before=new Uint8Array(await e.read(e.state)),trail=e.history;
    e.step(12.001,.002);
    ctx.assert(e.sequence.history.at(-1).id==='shared-planet'&&e.sequence.history.at(-1).appliedAt===12,'shared pressure starts at its exact director event boundary');
    ctx.assert(e.pressure.members.every(m=>m.start===12&&m.end===14)&&e.eventFrame.active,'pressure transition shares the ordinary GPU event frame and preserves its blend interval');
    e.step(14,0);ctx.assert(e.pressure.activeCount===1&&e.pressure.members.every(m=>e.pressure.resolve(m.target).planet===1),'normal pressure playback converges on the shared planet field');
    e.step(20.5,.5);ctx.assert(e.pressure.members.every(m=>m.start===20&&m.end===22),'normal playback also schedules the split through the same director');
    e.step(28.01,.01);const w=new Uint32Array(await e.read(e.state));
    ctx.assert(w.filter((_,i)=>i%48===23).every((serial,i)=>serial===new Uint32Array(before.buffer)[i*48+23])&&e.history===trail,'pressure events preserve persistent ship identities and trail allocation');
    ctx.assert(e.sequence.history.at(-1).id==='peace'&&e.director.intents.every(intent=>intent.journeys[0].mode==='orbit'),'peace and orbit orders survive the shared pressure event path');
    e.setPressureMerged(false);e.step(30,0);e.setPressureMerged(true);e.step(32,0);
    ctx.assert(e.pressure.activeCount===1,'explicit merge controls resolve current destinations after directed field retirement');
    e.render({distance:640});await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'shared pressure timeline renders without GPU errors');
  }finally{e.destroy();}
}
async function overflow(ctx,canvas) {
  const e=await createEngine(canvas,{count:1000});
  try {
    for(let i=1;i<=9;i++)e.enqueueEvent({effectiveAt:0,commands:[{fleet:0,pressure:{name:`field-${i}`,center:[i*20,0,0],blend:1},survivalFraction:.8}]});
    const before=await e.read(e.state),result=e.advanceTo(0);
    ctx.assert(result.status==='needs-reconciliation'&&result.steps===0&&e.events.inbox.status.pending===9&&e.director.alive===1000,'pressure pool overflow is detected before any packet or casualty fact is consumed');
    const after=new Uint8Array(await e.read(e.state));ctx.assert(new Uint8Array(before).every((x,i)=>x===after[i]),'overflow preserves every original GPU state byte');
    const current=createDirectorRecovery(e,0);e.installSnapshot(current.snapshot,e.lifetime);
    ctx.assert(e.events.inbox.empty&&e.director.alive===900&&near(e.pressure.resolve(e.pressure.members[0].target).center[0],180),'current-state recovery applies the authoritative losses and final pressure destination within capacity');
    e.render({distance:440});await e.device.queue.onSubmittedWorkDone();ctx.assert(e.pressure.activeCount<=2&&e.errors.length===0,'pressure overload recovery remains bounded and renders successfully');
  }finally{e.destroy();}
}
export async function validatePressureEvents(ctx,canvas){await timeline(ctx,canvas);await overflow(ctx,canvas);}
