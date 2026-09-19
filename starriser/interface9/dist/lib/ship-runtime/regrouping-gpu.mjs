import {SHIP_WGSL} from './shaders.mjs';
import {eventPoseAddress,poseWrite} from './event-gpu.mjs';
import {correctionAddress,MAX_SHIP_CORRECTIONS,CORRECTIONS_PER_POPULATION} from './correction-gpu.mjs';
const code=/* wgsl */`
${SHIP_WGSL}
struct Config {counts:vec4<u32>,clock:vec4<f32>}
@group(0) @binding(0) var<storage,read_write> ships:array<Ship>;
@group(0) @binding(1) var<storage,read> history:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read_write> links:array<u32>;
@group(0) @binding(3) var<storage,read> membership:array<vec4<u32>>;
@group(0) @binding(4) var<uniform> config:Config;
@group(0) @binding(5) var<storage,read_write> observation:array<vec4<u32>>;
${eventPoseAddress}
${correctionAddress}
${poseWrite}
@compute @workgroup_size(128) fn inspect(@builtin(global_invocation_id) gid:vec3<u32>) {
  let i=gid.x;if(i>=config.counts.x){return;}
  var record=links[correctionDirectory(config.counts.x)+i];var count=0u;var maximum=0u;var reusable=0u;
  for(var n=0u;n<${MAX_SHIP_CORRECTIONS}u&&record>0u;n++) {
    if(record>config.counts.x*${CORRECTIONS_PER_POPULATION}u){count=0xffffffffu;break;}
    let at=correctionAt(config.counts.x,record-1u);maximum=max(maximum,record);count++;
    if(n==0u&&bitcast<f32>(links[at])==config.clock.x){reusable=record;}
    record=links[at+1u];
  }
  if(record>0u){count=0xffffffffu;}
  observation[i]=vec4<u32>(ships[i].identity.w,count,maximum,reusable);
}
fn transferred(handle:f32)->bool {
  return handle>0.0&&handle<=f32(config.counts.x)&&membership[u32(handle)-1u].y>0u;
}
fn preserveBoundary(before:Ship,after:Ship,i:u32,row:vec4<u32>) {
  let base=correctionAt(config.counts.x,row.z-1u);let directory=correctionDirectory(config.counts.x)+i;
  if(row.w==0u) {
    links[base]=bitcast<u32>(config.clock.x);links[base+1u]=links[directory];links[base+2u]=0u;links[base+3u]=0u;
    storePose(before,base+4u);
    for(var sample=0u;sample<48u;sample++) {
      let value=bitcast<vec4<u32>>(history[i*48u+sample]);let at=base+100u+sample*4u;
      links[at]=value.x;links[at+1u]=value.y;links[at+2u]=value.z;links[at+3u]=value.w;
    }
    links[directory]=row.z;
  }
  storePose(after,base+52u);
}
@compute @workgroup_size(128) fn regroup(@builtin(global_invocation_id) gid:vec3<u32>) {
  let i=gid.x;if(i>=config.counts.x){return;}let before=ships[i];var s=before;let row=membership[i];
  if(row.y>0u) {
    s.identity.x=row.x;s.identity.y=row.y-1u;
    // Orders are owned by fleets: equal revision numbers need a fresh admission.
    s.flight.x=-1.0;s.tactic.x=-1.0;
    if(s.flight.w>=2.0){s.v=vec4<f32>(s.v.xyz/max(.000001,length(s.v.xyz))*s.v.w*.75,s.v.w);s.a=vec4<f32>(0.0);s.flight.w=0.0;}
  }
  if(row.y>0u||transferred(s.aux.x)){s.aux.x=0.0;}
  if(row.y>0u||transferred(s.memory.x)){s.memory.x=0.0;}
  if(row.y>0u){preserveBoundary(before,s,i,row);}
  ships[i]=s;
}
`;

export async function createRegroupingGpu(device) {
  const module=device.createShaderModule({code}),info=await module.getCompilationInfo();
  if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.map(m=>m.message).join('\n'));
  const pipelines=await Promise.all(['inspect','regroup'].map(entryPoint=>device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint}})));
  const rows=device.createBuffer({size:10000*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const observation=device.createBuffer({size:10000*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
  const config=device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  function dispatch(encoder,pipeline,count,entries) {
    const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:entries.map(([binding,buffer])=>({binding,resource:{buffer}}))});
    const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(count/128));pass.end();
  }
  return {async inspect(state,links,count,time,read) {
    const data=new ArrayBuffer(32);new Uint32Array(data)[0]=count;new Float32Array(data)[4]=time;device.queue.writeBuffer(config,0,data);
    const encoder=device.createCommandEncoder();dispatch(encoder,pipelines[0],count,[[0,state],[2,links],[4,config],[5,observation]]);device.queue.submit([encoder.finish()]);
    return new Uint32Array(await read(observation,count*16));
  },encode(encoder,state,history,links,count,data) {
    device.queue.writeBuffer(rows,0,data);
    dispatch(encoder,pipelines[1],count,[[0,state],[1,history],[2,links],[3,rows],[4,config]]);
  },destroy(){rows.destroy();observation.destroy();config.destroy();}};
}

export function regroupingRows(population,layout,members,metadata) {
  const count=population.count;if(metadata.length!==count*4)throw Error('Incomplete regrouping observation');
  let next=0;
  for(let slot=0;slot<count;slot++) {
    if(metadata[slot*4]!==population.ids[layout.logical[slot]]||metadata[slot*4+1]>MAX_SHIP_CORRECTIONS)throw Error('Invalid regrouping identity or correction journal');
    next=Math.max(next,metadata[slot*4+2]);
  }
  const data=new Uint32Array(count*4);
  for(const row of members) {
    const slot=layout.physical[row.index],group=row.key>>>8,reuse=metadata[slot*4+3];
    if(!reuse&&metadata[slot*4+1]>=MAX_SHIP_CORRECTIONS)return null;
    const record=reuse||++next;if(record>count*CORRECTIONS_PER_POPULATION)return null;
    data.set([(row.key&255)|((group&31)<<8)|(row.cohort<<16)|(group<<18),(group>>>5)+1,record,Number(reuse>0)],slot*4);
  }
  return data;
}
