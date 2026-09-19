// One asynchronous sample every 30 simulation steps. Never wait in the frame loop.
export function createGpuProfiler(device,enabled,labels) {
  let counter=0,recording=false,busy=false,needsMap=false,destroyed=false,latest=null;
  if(!enabled)return {begin:()=>null,renderWrites:()=>({}),resolve:()=>{},submitted:()=>{},destroy:()=>{},get latest(){return null;},supported:false};
  const count=labels.length*2,bytes=count*8;
  const queries=device.createQuerySet({type:'timestamp',count});
  const resolveBuffer=device.createBuffer({size:bytes,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});
  const staging=device.createBuffer({size:bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const writes=index=>({timestampWrites:{querySet:queries,beginningOfPassWriteIndex:index*2,endOfPassWriteIndex:index*2+1}});
  function begin() {
    counter++;
    if(destroyed||recording||busy||counter%30!==0)return null;
    recording=true;return writes;
  }
  function resolve(encoder) {
    if(!recording)return;
    encoder.resolveQuerySet(queries,0,count,resolveBuffer,0);
    encoder.copyBufferToBuffer(resolveBuffer,0,staging,0,bytes);
    recording=false;busy=true;needsMap=true;
  }
  function submitted() {
    if(!needsMap)return;needsMap=false;
    staging.mapAsync(GPUMapMode.READ).then(()=>{
      if(destroyed)return;
      const values=new BigUint64Array(staging.getMappedRange());
      latest=labels.map((label,i)=>({label,ms:Number(values[i*2+1]-values[i*2])/1e6}));
      staging.unmap();busy=false;
    }).catch(()=>{busy=false;});
  }
  return {begin,renderWrites:()=>recording?writes(labels.length-1):{},resolve,submitted,supported:true,get latest(){return latest;},
    destroy(){destroyed=true;queries.destroy();resolveBuffer.destroy();staging.destroy();}};
}
