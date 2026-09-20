import {classMask} from './classes.mjs';
import {createScenarioEngine} from '../demo-ship-flight-poc/scenarios.mjs';
import {createDirectorRecovery} from '../demo-ship-flight-poc/director-recovery.mjs';
import {exportDirector} from './director-snapshot.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function recover(ctx,canvas,scenario) {
  const e=await createScenarioEngine(canvas,{count:Number(ctx.params.count??1000),scenario,period:30});
  try {
    e.step(0,0);const time=scenario===4?e.sequence.battleAt+3:scenario===3?3:30;
    e.enqueueEvent({effectiveAt:time-1,commands:[{fleet:0,survivalFraction:.8}]});
    const future=e.enqueueEvent({effectiveAt:time+1,commands:[{fleet:0,attackClass:3}]});
    const before=exportDirector(e.director),resources=[e.history,e.density,...e.inspection.agents];
    const projected=createDirectorRecovery(e,time);
    ctx.assert(same(before,exportDirector(e.director))&&e.now===0,`scenario ${scenario} constructs complete current state without changing the live director`);
    ctx.assert(projected.rejected.length===0&&projected.snapshot.stream.pending.some(packet=>packet.sequence===future.sequence),`scenario ${scenario} reconstructs known casualties and retains its future order`);
    e.installSnapshot(projected.snapshot,e.lifetime);
    const raw=await e.read(e.state),f=new Float32Array(raw),w=new Uint32Array(raw);
    ctx.assert(f.every(Number.isFinite)&&w.filter((_,i)=>i%48===22).reduce((a,b)=>a+b,0)===e.director.alive,`scenario ${scenario} recovers finite GPU state and exact current membership`);
    ctx.assert(resources.every((buffer,i)=>buffer===[e.history,e.density,...e.inspection.agents][i]),`scenario ${scenario} recovers in the original GPU allocations`);
    if(scenario===5)scope(ctx,e);
    for(let frame=1;frame<=120;frame++)e.step(time+frame/120,1/120);
    ctx.assert(e.director.groups[2]===classMask(3),`scenario ${scenario} admits the retained future target order on schedule`);
    e.render({distance:440});await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,`scenario ${scenario} resumes and renders without GPU errors`);
  }finally{e.destroy();}
}
function scope(ctx,e) {
  ctx.assert(e.pressure.activeCount===1&&e.pressure.members.every(m=>e.pressure.resolve(m.target).planet===1),'pressure-demo recovery merges current planet coverage through ordinary director events');
  ctx.assert(e.director.groups.filter((_,i)=>i%8===3).every(n=>n===0)&&e.director.intents.every(intent=>intent.journeys[0].mode==='orbit'),'pressure-demo recovery applies peace and orbit orders without retaining action callbacks');
}
export async function validateDirectorRecovery(ctx,canvas) {
  for(const scenario of [0,1,2,3,4,5])await recover(ctx,canvas,scenario);
}
