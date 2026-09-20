import {createEngine} from './engine.mjs';
const FRAMES=24;
const stats=values=>{const sorted=values.toSorted((a,b)=>a-b);return {p50:sorted[12],p95:sorted[22],maximum:sorted[23]};};
async function measure(e,boundaries) {
  const q=e.device.createQuerySet({type:'timestamp',count:FRAMES*4});
  const result=e.device.createBuffer({size:FRAMES*32,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});
  const commands=Array.from({length:e.director.capacity.groups},(_,group)=>({fleet:Math.floor(group/32),type:group%32,fire:false}));
  try {
    for(let frame=0;frame<FRAMES;frame++) {
      const start=e.now;
      for(let boundary=1;boundary<=boundaries;boundary++)e.enqueueEvent({effectiveAt:start+(boundary/(boundaries+1))/120,commands});
      e.step(start+1/120,1/120,{querySet:q,queryIndex:frame*4});
      e.render({distance:440,querySet:q,queryIndex:frame*4+2});
    }
    const encoder=e.device.createCommandEncoder();encoder.resolveQuerySet(q,0,FRAMES*4,result,0);e.device.queue.submit([encoder.finish()]);
    const values=new BigUint64Array(await e.read(result));
    const stage=offset=>stats(Array.from({length:FRAMES},(_,i)=>Number(values[i*4+offset+1]-values[i*4+offset])/1e6));
    return {boundaries,simulation:stage(0),render:stage(2)};
  }finally{q.destroy();result.destroy();}
}
export async function validateEventBudget(ctx,canvas) {
  const count=Number(ctx.params.count??10000),samples=[];
  for(const boundaries of [0,1,4]) {
    const e=await createEngine(canvas,{count,fleetCount:8});
    try {
      if(!e.timestamps){ctx.metric('event_gpu_budget','timestamp queries unavailable');return;}
      for(let fleet=0;fleet<8;fleet++)e.command({revision:e.director.revision+1,fleet,joined:true});
      for(let frame=1;frame<=60;frame++)e.step(frame/120,1/120);
      e.render({distance:440});await e.device.queue.onSubmittedWorkDone();
      samples.push(await measure(e,boundaries));
      ctx.assert(e.errors.length===0,`${boundaries} boundaries per group validate with real rendering interleaved`);
    }finally{e.destroy();}
  }
  ctx.metric('event_gpu_budget',{count,fleets:8,groups:256,frames:FRAMES,samples,scope:'GPU simulation and GPU render separately; concurrent CPU load; no presented-FPS claim'});
}
