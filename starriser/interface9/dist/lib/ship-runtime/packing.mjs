import {PACKING_WGSL} from './packing-gpu.mjs';
import {createTiming} from './clock-gpu.mjs';
export async function createPacking(device,{agents,history,links,orders,layout,count,director,eventFrame,bindings=null}) {
  const module=device.createShaderModule({code:PACKING_WGSL}),info=await module.getCompilationInfo();
  if(info.messages.some(m=>m.type==='error'))throw new Error(info.messages.map(m=>m.message).join('\n'));
  const visibility=GPUShaderStage.COMPUTE;
  const bindLayout=device.createBindGroupLayout({entries:Array.from({length:7},(_,binding)=>({binding,visibility,buffer:{type:binding===6?'uniform':binding>=4?'read-only-storage':'storage'}}))});
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[bindLayout]});
  const pipelines=await Promise.all(['swapSlots','remapReferences'].map(entryPoint=>device.createComputePipelineAsync({layout:pipelineLayout,compute:{module,entryPoint}})));
  const make=(size,usage)=>device.createBuffer({size,usage:usage|GPUBufferUsage.COPY_DST});
  const remap=make(10000*4,GPUBufferUsage.STORAGE),pairs=make(256*4,GPUBufferUsage.STORAGE),uniform=make(16,GPUBufferUsage.UNIFORM);
  function makeBind(r){return device.createBindGroup({layout:bindLayout,entries:[r.a,r.b,r.history,r.links,{buffer:remap},{buffer:pairs},{buffer:uniform}].map((resource,binding)=>({binding,resource}))});}
  let bind=makeBind(bindings??{a:{buffer:agents[0]},b:{buffer:agents[1]},history:{buffer:history},links:{buffer:links}});
  const timing=createTiming(device);let closed=false,batches=0,lastSwaps=0,generation=0,sampled=null,uploadBytes=0,lastUploadBytes=0;
  function advance(limit=64) {
    if(closed)return false;const batch=layout.prepare(limit);if(!batch)return false;
    device.queue.writeBuffer(remap,0,batch.remap);device.queue.writeBuffer(pairs,0,batch.pairs,0,batch.length*2);device.queue.writeBuffer(uniform,0,new Uint32Array([count,batch.length,Number(eventFrame.active),0]));
    const encoder=device.createCommandEncoder(),measure=timing.begin();
    for(let stage=0;stage<2;stage++) {
      const pass=encoder.beginComputePass(stageTiming(measure,stage));pass.setPipeline(pipelines[stage]);pass.setBindGroup(0,bind);
      pass.dispatchWorkgroups(Math.ceil((stage===0?batch.length:count)/(stage===0?64:128)));pass.end();
    }
    timing.resolve(encoder,measure);device.queue.submit([encoder.finish()]);timing.read(measure);
    if(measure){const epoch=generation,value={batch:batches+1,swaps:batch.length};timing.pending.then(()=>{if(!closed&&generation===epoch)sampled=value;});}
    layout.commit(batch);device.queue.writeBuffer(orders,director.groups.byteLength,layout.data);batches++;lastSwaps=batch.length;lastUploadBytes=count*4+batch.length*8+16+layout.data.byteLength;uploadBytes+=lastUploadBytes;return true;
  }
  return {prepareBindings(r,nextCount=count){const next=makeBind(r);return ()=>{bind=next;count=nextCount;};},request:()=>closed?false:layout.liveFirst(),requestOrder:ids=>closed?false:layout.request(ids),advance,layout,
    get status(){return {...layout.status,batches,lastSwaps,uploadBytes,lastUploadBytes,scratchBytes:remap.size+256*4+16,sampledSwaps:sampled?.swaps??0,sampledBatch:sampled?.batch??0,latestMs:sampled?timing.latestMs:null};},
    readTiming:()=>timing.pending,reset(){generation++;sampled=null;layout.reset();timing.reset();batches=0;lastSwaps=0;uploadBytes=0;lastUploadBytes=0;},
    destroy(){closed=true;timing.destroy();remap.destroy();pairs.destroy();uniform.destroy();}};
}

function stageTiming(measure,stage) {
  if(!measure)return undefined;
  const writes=measure.timestampWrites,key=stage===0?'beginningOfPassWriteIndex':'endOfPassWriteIndex';
  return {timestampWrites:{querySet:writes.querySet,[key]:writes[key]}};
}
