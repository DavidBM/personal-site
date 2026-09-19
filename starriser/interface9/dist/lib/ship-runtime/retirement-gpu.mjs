import {SHIP_WGSL} from './shaders.mjs';
import {eventPoseAddress,EVENT_POSE_WORDS} from './event-gpu.mjs';
import {correctionAddress,CORRECTION_WORDS,MAX_SHIP_CORRECTIONS} from './correction-gpu.mjs';
import {DESTRUCTION_SECONDS} from './combat-effects.mjs';
const address=`${eventPoseAddress}\n${correctionAddress}`;
const probe=/* wgsl */`
${SHIP_WGSL}
@group(0) @binding(0) var<storage,read> a:array<Ship>;
@group(0) @binding(1) var<storage,read> b:array<Ship>;
@group(0) @binding(2) var<storage,read> links:array<u32>;
@group(0) @binding(3) var<storage,read_write> result:array<vec4<u32>>;
@group(0) @binding(4) var<uniform> config:vec4<u32>;
${address}
fn expired(s:Ship)->bool {
  let first=bitcast<f32>(config.y);
  return s.identity.z==0u&&first-max(0.0,s.fx.x)>${DESTRUCTION_SECONDS};
}
@compute @workgroup_size(128) fn inspect(@builtin(global_invocation_id) gid:vec3<u32>) {
  let i=gid.x;if(i>=config.x){return;}var record=links[correctionDirectory(config.x)+i];var count=0u;var invalid=0u;
  for(var n=0u;n<${MAX_SHIP_CORRECTIONS}u&&record>0u;n++) {
    if(record>config.x*2u){invalid=1u;break;}count++;record=links[correctionAt(config.x,record-1u)+1u];
  }
  if(record>0u){invalid=1u;}
  result[i]=vec4<u32>(a[i].identity.w,select(0u,1u,expired(a[i])&&expired(b[i])&&a[i].identity.w==b[i].identity.w),count,invalid);
}
`;
const moves=/* wgsl */`
@group(0) @binding(6) var<storage,read> remap:array<u32>;
@group(0) @binding(7) var<storage,read> rows:array<vec4<u32>>;
@group(0) @binding(8) var<uniform> config:vec4<u32>;
fn moved(handle:f32)->f32 {
  if(handle<1.0||handle>f32(config.x)){return 0.0;}
  let slot=remap[u32(handle)-1u];return select(0.0,f32(slot+1u),slot<config.y);
}
`;
const poses=/* wgsl */`
${SHIP_WGSL}
@group(0) @binding(0) var<storage,read> a:array<Ship>;
@group(0) @binding(1) var<storage,read> b:array<Ship>;
@group(0) @binding(2) var<storage,read_write> nextA:array<Ship>;
@group(0) @binding(3) var<storage,read_write> nextB:array<Ship>;
@group(0) @binding(4) var<storage,read> history:array<vec4<f32>>;
@group(0) @binding(5) var<storage,read_write> nextHistory:array<vec4<f32>>;
${moves}
fn translated(initial:Ship)->Ship {var s=initial;s.aux.x=moved(s.aux.x);s.memory.x=moved(s.memory.x);return s;}
@compute @workgroup_size(128) fn gather(@builtin(global_invocation_id) gid:vec3<u32>) {
  let i=gid.x;if(i>=config.y){return;}let old=rows[i].x;
  nextA[i]=translated(a[old]);nextB[i]=translated(b[old]);
  for(var j=0u;j<48u;j++){nextHistory[i*48u+j]=history[old*48u+j];}
}
`;
const journal=/* wgsl */`
@group(0) @binding(0) var<storage,read> oldLinks:array<u32>;
@group(0) @binding(1) var<storage,read_write> links:array<u32>;
${moves}
${address}
fn copyWords(source:u32,destination:u32,length:u32){for(var j=0u;j<length;j++){links[destination+j]=oldLinks[source+j];}}
fn translatePose(at:u32) {for(var field=16u;field<=24u;field+=8u){links[at+field]=bitcast<u32>(moved(bitcast<f32>(links[at+field])));}}
@compute @workgroup_size(128) fn gather(@builtin(global_invocation_id) gid:vec3<u32>) {
  let i=gid.x;if(i>=config.y){return;}let row=rows[i];
  if(config.z>0u) {
    let source=eventPoseBase(config.x)+row.x*${EVENT_POSE_WORDS}u;let destination=eventPoseBase(config.y)+i*${EVENT_POSE_WORDS}u;
    copyWords(source,destination,${EVENT_POSE_WORDS}u);for(var j=0u;j<8u;j++){translatePose(destination+j*48u);}
  }
  links[correctionDirectory(config.y)+i]=select(0u,row.y+1u,row.z>0u);
  var record=oldLinks[correctionDirectory(config.x)+row.x];
  for(var j=0u;j<row.z;j++) {
    let source=correctionAt(config.x,record-1u);let destination=correctionAt(config.y,row.y+j);
    copyWords(source,destination,${CORRECTION_WORDS}u);translatePose(destination+4u);translatePose(destination+52u);
    links[destination+1u]=select(0u,row.y+j+2u,j+1u<row.z);record=oldLinks[source+1u];
  }
}
`;
async function pipeline(device,code,entryPoint) {
  const module=device.createShaderModule({code}),info=await module.getCompilationInfo();
  if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.map(m=>m.message).join('\n'));
  return device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint}});
}
function bind(device,pipeline,entries){return device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:entries.map(([binding,resource])=>({binding,resource}))});}
function run(encoder,pipeline,group,count){const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(count/128));pass.end();}
export async function createRetirementGpu(device) {
  const pipelines=await Promise.all([pipeline(device,probe,'inspect'),pipeline(device,poses,'gather'),pipeline(device,journal,'gather')]);
  const make=(size,usage)=>device.createBuffer({size,usage});
  const result=make(10000*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),rows=make(10000*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),remap=make(10000*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),uniform=make(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  return {async inspect(resources,earliest,read) {
    const config=new ArrayBuffer(16);new Uint32Array(config)[0]=resources.count;new Float32Array(config)[1]=earliest;device.queue.writeBuffer(uniform,0,config);
    const r=resources.bindings,group=bind(device,pipelines[0],[[0,r.a],[1,r.b],[2,r.links],[3,{buffer:result}],[4,{buffer:uniform}]]);
    const encoder=device.createCommandEncoder();run(encoder,pipelines[0],group,resources.count);device.queue.submit([encoder.finish()]);
    return new Uint32Array(await read(result,resources.count*16));
  },encode(encoder,before,next,plan,events) {
    if(next.count===0)return 0;
    device.queue.writeBuffer(rows,0,plan.rows);device.queue.writeBuffer(remap,0,plan.remap);device.queue.writeBuffer(uniform,0,new Uint32Array([before.count,next.count,Number(events),0]));
    const a=before.bindings,b=next.bindings,shared=[[6,{buffer:remap}],[7,{buffer:rows}],[8,{buffer:uniform}]];
    run(encoder,pipelines[1],bind(device,pipelines[1],[[0,a.a],[1,a.b],[2,b.a],[3,b.b],[4,a.history],[5,b.history],...shared]),next.count);
    run(encoder,pipelines[2],bind(device,pipelines[2],[[0,a.links],[1,b.links],...shared]),next.count);
    return next.count*(192*2+768+4+Number(events)*EVENT_POSE_WORDS*4)+plan.records*CORRECTION_WORDS*4;
  },destroy(){for(const buffer of [result,rows,remap,uniform])buffer.destroy();},scratchBytes:360016};
}
