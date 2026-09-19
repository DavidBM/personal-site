import {correctionAddress,MAX_SHIP_CORRECTIONS} from './correction-gpu.mjs';
import {eventPoseAddress} from './event-gpu.mjs';
import {SHIP_WGSL} from './shaders.mjs';
function fields(buffer) {
  const at=`${buffer}[i]`;
  const timers=['aux.y','aux.z','memory.y','memory.z','fx.y','fx.z','tactic.w'];
  return timers.map(field=>`${at}.${field}=max(0.0,${at}.${field}-shift.x);`).join('\n')+`
    ${at}.flight.y-=shift.x;${at}.flight.z-=shift.x;${at}.tactic.z-=shift.x;
    ${at}.fx.x=select(-1.0,${at}.fx.x-shift.x,${at}.fx.x>=shift.x);`;
}
const code=/* wgsl */`
${SHIP_WGSL}
@group(0) @binding(0) var<storage,read_write> a:array<Ship>;
@group(0) @binding(1) var<storage,read_write> b:array<Ship>;
@group(0) @binding(2) var<storage,read_write> history:array<vec4<f32>>;
@group(0) @binding(3) var<uniform> shift:vec4<f32>;
@group(0) @binding(4) var<storage,read_write> eventPoses:array<u32>;
${eventPoseAddress}
${correctionAddress}
fn rebasePose(base:u32) {
  for(var field=0u;field<48u;field++) {
    let timer=field==17u||field==18u||field==25u||field==26u||field==41u||field==42u||field==39u;
    let date=field==29u||field==30u||field==38u;
    if(!timer&&!date&&field!=40u){continue;}
    let previous=bitcast<f32>(eventPoses[base+field]);var value=previous-shift.x;
    if(timer){value=max(0.0,value);}if(field==40u&&previous<shift.x){value=-1.0;}
    eventPoses[base+field]=bitcast<u32>(value);
  }
}
fn rebaseCorrections(i:u32,count:u32) {
  var record=eventPoses[correctionDirectory(count)+i];
  for(var n=0u;n<${MAX_SHIP_CORRECTIONS}u&&record>0u;n++) {
    let at=correctionAt(count,record-1u);
    eventPoses[at]=bitcast<u32>(bitcast<f32>(eventPoses[at])-shift.x);
    rebasePose(at+4u);rebasePose(at+52u);
    for(var sample=0u;sample<48u;sample++) {
      let field=at+103u+sample*4u;let birth=bitcast<f32>(eventPoses[field]);
      eventPoses[field]=bitcast<u32>(select(-1.0,birth-shift.x,birth>=shift.x));
    }
    record=eventPoses[at+1u];
  }
}
@compute @workgroup_size(128) fn rebase(@builtin(global_invocation_id) gid:vec3<u32>) {
  let i=gid.x;if(i>=arrayLength(&history)){return;}
  if(i<arrayLength(&a)) {
  ${fields('a')}
  ${fields('b')}
    rebaseCorrections(i,arrayLength(&a));
  }
  if(shift.y>0.0&&i<arrayLength(&a)*8u){rebasePose(eventPoseBase(arrayLength(&a))+i*48u);}
  let birth=history[i].w;
  history[i].w=select(-1.0,birth-shift.x,birth>=shift.x);
}
`;
export async function createClockRebaser(device,agents,history,links,bindings=null) {
  const module=device.createShaderModule({code}),info=await module.getCompilationInfo();
  if(info.messages.some(m=>m.type==='error'))throw new Error(info.messages.map(m=>m.message).join('\n'));
  const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'rebase'}});
  const uniform=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  function makeBind(r){return device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[r.a,r.b,r.history,{buffer:uniform},r.links].map((resource,binding)=>({binding,resource}))});}
  const initial=bindings??{a:{buffer:agents[0]},b:{buffer:agents[1]},history:{buffer:history},links:{buffer:links}};
  let bind=makeBind(initial),samples=(initial.history.size??history.size)/16;
  const timing=createTiming(device);
  return {prepareBindings(r){const next=makeBind(r);return ()=>{bind=next;samples=r.history.size/16;};},run(shift,events=false) {
    device.queue.writeBuffer(uniform,0,new Float32Array([shift,Number(events),0,0]));
    const encoder=device.createCommandEncoder(),measure=timing.begin(),pass=encoder.beginComputePass(measure);
    pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(samples/128));pass.end();
    timing.resolve(encoder,measure);device.queue.submit([encoder.finish()]);timing.read(measure);
  },get latestMs(){return timing.latestMs;},readTiming:()=>timing.pending,reset:timing.reset,destroy(){timing.destroy();uniform.destroy();}};
}
export function createTiming(device) {
  const query=device.features.has('timestamp-query')?device.createQuerySet({type:'timestamp',count:2}):null;
  const resolve=query?device.createBuffer({size:16,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}):null;
  const staging=query?device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}):null;
  let pending=null,latestMs=null,closed=false,generation=0;
  async function consume(epoch) {
    try {
      await staging.mapAsync(GPUMapMode.READ);if(closed||generation!==epoch)return;
      const values=new BigUint64Array(staging.getMappedRange());latestMs=Number(values[1]-values[0])/1e6;
    }catch{if(!closed)latestMs=null;}finally{if(staging.mapState==='mapped')staging.unmap();pending=null;}
  }
  return {begin:()=>query&&!pending?{timestampWrites:{querySet:query,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}}:undefined,
    resolve(encoder,measure){if(measure){encoder.resolveQuerySet(query,0,2,resolve,0);encoder.copyBufferToBuffer(resolve,0,staging,0,16);}},
    read(measure){if(measure)pending=consume(generation);},get pending(){return pending;},get latestMs(){return latestMs;},
    reset(){generation++;latestMs=null;},destroy(){closed=true;query?.destroy();resolve?.destroy();staging?.destroy();}};
}
