import {createEngine} from './engine.mjs';
// Deliberately supersede unfinished blends until every field slot participates.
// This measures the whole runtime's simulation, not a per-field extrapolation.
export async function validateScopeBudget(ctx,canvas) {
  const count=Number(ctx.params.count??10000),fleetCount=Number(ctx.params.fleets??4),e=await createEngine(canvas,{count,fleetCount});
  const fields=e.pressure.layout.fields;
  try {
    const planets=ctx.params.planets==='1';e.setPlanetsEnabled(planets);
    for(let fleet=0;fleet<fleetCount;fleet++)e.command({revision:e.director.revision+1,fleet,joined:true});
    for(let field=1;field<fields;field++) {
      const scope=e.pressure.create({center:[0,0,0]});
      for(let fleet=0;fleet<fleetCount;fleet++)e.pressure.assign({fleet,scope,revision:field,blend:1});
      const start=e.now;for(let frame=1;frame<=6;frame++)e.step(start+frame/120,1/120);
    }
    ctx.assert(e.pressure.activeCount===fields,'rapid supersession stays bounded with every field participating');
    if(!e.timestamps){ctx.metric('scope_peak_gpu_ms','timestamp queries unavailable');return;}
    const frames=24,q=e.device.createQuerySet({type:'timestamp',count:frames*2});
    const result=e.device.createBuffer({size:frames*16,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});
    try {
      for(let frame=0;frame<frames;frame++){e.step(e.now+1/120,1/120,{querySet:q,queryIndex:frame*2});e.render({distance:440});}
      const encoder=e.device.createCommandEncoder();encoder.resolveQuerySet(q,0,frames*2,result,0);e.device.queue.submit([encoder.finish()]);
      const values=new BigUint64Array(await e.read(result));
      const ms=Array.from({length:frames},(_,i)=>Number(values[i*2+1]-values[i*2])/1e6).sort((a,b)=>a-b);
      ctx.metric('scope_peak_gpu_ms',{count,fleets:fleetCount,fields:e.pressure.activeCount,p50:ms[12],p95:ms[22],maximum:ms[23],planets,scope:'Simulation only; real rendering interleaved; concurrent user CPU load'});
      ctx.assert(e.errors.length===0,'fully occupied pressure pool validates with interleaved rendering');
    }finally{q.destroy();result.destroy();}
  }finally{e.destroy();}
}
