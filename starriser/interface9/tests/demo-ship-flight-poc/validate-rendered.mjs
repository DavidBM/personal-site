import {createEngine} from './engine.mjs';
const summary=values=>{const a=[...values].sort((x,y)=>x-y);return {p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:a.at(-1)};};
async function sampleScene(ctx,canvas,scenario) {
  const e=await createEngine(canvas,{count:10000,scenario,period:30});let queries,result;
  try {
    for(let frame=1;frame<=3600;frame++) {
      e.step(frame/120,1/120);
      if(frame%120===0){e.render({distance:440});await e.device.queue.onSubmittedWorkDone();}
    }
    ctx.assert(e.timestamps,'rendered simulation timing requires hardware timestamps');
    queries=e.device.createQuerySet({type:'timestamp',count:480});
    result=e.device.createBuffer({size:3840,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});
    for(let frame=0;frame<240;frame+=2) {
      await new Promise(requestAnimationFrame);
      for(let sub=0;sub<2;sub++)e.step(30+(frame+sub+1)/120,1/120,{querySet:queries,queryIndex:2*(frame+sub)});
      e.render({distance:440});
    }
    const encoder=e.device.createCommandEncoder();encoder.resolveQuerySet(queries,0,480,result,0);e.device.queue.submit([encoder.finish()]);
    const values=new BigUint64Array(await e.read(result)),ms=Array.from({length:240},(_,i)=>Number(values[2*i+1]-values[2*i])/1e6);
    ctx.metric(`rendered_${scenario===0?'orbit':'approach'}_10000_ms`,JSON.stringify(summary(ms)));
    ctx.assert(e.errors.length===0,'rendered mixed-class scenario has no GPU validation errors');
  }finally{queries?.destroy();result?.destroy();e.destroy();}
}
export async function validateRendered(ctx,canvas) {
  await sampleScene(ctx,canvas,0);await sampleScene(ctx,canvas,1);
  ctx.metric('scope','All simulation passes at 10k ships with rendering between pairs of 120-Hz steps. GPU simulation timestamps exclude rendering; this is not proof of 120 presented FPS.');
}
