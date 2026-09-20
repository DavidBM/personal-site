import {createEngine} from './engine.mjs';
import {createDirectorWorker} from './worker-client.mjs';
export async function validateLifecycleBatch(ctx,canvas) {
  const e=await createEngine(canvas,{count:Number(ctx.params.count??10000),period:30,navigation:true,scenario:0}),worker=createDirectorWorker();
  try {
    const authored=await worker.request('lifecycle-plan',{definition:e.solar.definition,sceneEpochMs:e.solar.sceneEpochMs});
    const phase=authored.approaches[1];e.step(phase.at,0);
    const before=new Uint8Array(await e.read(e.state)),history=new Uint8Array(await e.read(e.history));
    const writes=[],queue=e.device.queue,original=queue.writeBuffer;
    queue.writeBuffer=function(...args){writes.push({buffer:args[0],bytes:args[2].byteLength});return Reflect.apply(original,this,args);};
    let accepted;
    try{accepted=e.applyCommands([{fleet:0,joined:false},{fleet:1,joined:false}],phase.routes);}finally{queue.writeBuffer=original;}
    ctx.assert(accepted.length===128&&accepted.every(Boolean)&&e.routes.records.size===128,'one directed phase admits all 128 independent cohort routes');
    ctx.assert(writes.length===2&&writes.every(w=>w.buffer!==e.state&&w.buffer!==e.history),'cohort burst uploads each control buffer once and never uploads a live pose');
    const after=new Uint8Array(await e.read(e.state)),trails=new Uint8Array(await e.read(e.history));
    ctx.assert(before.every((x,i)=>x===after[i])&&history.every((x,i)=>x===trails[i]),'batched route admission preserves all GPU state and trail bytes');
    ctx.metric('lifecycle_batch_upload',{count:e.count,cohorts:accepted.length,writes:writes.length,bytes:writes.reduce((sum,w)=>sum+w.bytes,0)});
    e.step(phase.at,0);const progress=await e.readProgress();
    ctx.assert(progress.groups.filter(g=>g.live).every(g=>g.unapplied===0),'the GPU observes all batched journey revisions on activation');
    e.render({distance:440});await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'batched lifecycle controls render without GPU validation errors');
  }finally{worker.destroy();e.destroy();}
}
