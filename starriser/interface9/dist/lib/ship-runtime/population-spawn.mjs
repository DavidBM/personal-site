import {SHIP_WGSL} from './shaders.mjs';
import {CLASS_WGSL} from './classes.mjs';
import {eventPoseAddress,poseWrite,EVENT_POSE_WORDS} from './event-gpu.mjs';
import {correctionAddress} from './correction-gpu.mjs';
const code=/* wgsl */`
${SHIP_WGSL}
${CLASS_WGSL}
struct Admission {range:vec4<u32>,identity:vec4<u32>,center:vec4<f32>,velocity:vec4<f32>}
struct Spawn {counts:vec4<u32>,clock:vec4<f32>,planets:array<vec4<f32>,3>}
@group(0) @binding(0) var<storage,read_write> a:array<Ship>;
@group(0) @binding(1) var<storage,read_write> b:array<Ship>;
@group(0) @binding(2) var<storage,read_write> history:array<vec4<f32>>;
@group(0) @binding(3) var<storage,read_write> links:array<u32>;
@group(0) @binding(4) var<storage,read> admissions:array<Admission>;
@group(0) @binding(5) var<uniform> config:Spawn;
@group(0) @binding(6) var<storage,read> ordinals:array<u32>;
${eventPoseAddress}
${correctionAddress}
${poseWrite}
fn variation(seed:u32)->f32 {
  var x=seed;x=(x^(x>>16u))*0x7feb352du;x=(x^(x>>15u))*0x846ca68bu;x=x^(x>>16u);return f32(x&0xffffffu)/16777216.0;
}
fn admissionFor(slot:u32)->Admission {
  var low=0u;var high=config.counts.z;
  while(low+1u<high){let middle=(low+high)/2u;if(admissions[middle].range.x<=slot){low=middle;}else{high=middle;}}
  return admissions[low];
}
fn emitter(s:Ship,e:u32)->vec3<f32> {
  let local=vec3<f32>((f32(e)-1.0)*.5,select(-.2,.15,e==1u),-1.0)*dimensions(shipType(s)).xyz;
  return s.p.xyz+local+2.0*cross(s.q.xyz,cross(s.q.xyz,local)+s.q.w*local);
}
fn clearBirth(point:vec3<f32>,size:f32)->vec3<f32> {
  if(config.clock.y==0.0){return point;}var p=point;
  for(var sweep=0u;sweep<4u;sweep++){for(var i=0u;i<3u;i++) {
    let body=config.planets[i];let delta=p-body.xyz;let radius=body.w+size+2.0;
    if(length(delta)<radius){p=body.xyz+select(vec3<f32>(0.0,1.0,0.0),delta/max(.000001,length(delta)),length(delta)>.001)*radius;}
  }}
  let center=config.planets[0].xyz;var bound=0.0;var inside=false;
  for(var i=0u;i<3u;i++){let body=config.planets[i];let radius=body.w+size+2.0;bound=max(bound,length(body.xyz-center)+radius);inside=inside||length(p-body.xyz)<radius-.001;}
  if(inside){p=center+vec3<f32>(0.0,bound+2.0,0.0);}return p;
}
@compute @workgroup_size(128) fn spawn(@builtin(global_invocation_id) gid:vec3<u32>) {
  let i=config.counts.x+gid.x;if(i>=config.counts.y){return;}
  let command=admissionFor(i);let id=command.identity.z+i-command.range.x;let ordinal=ordinals[i-config.counts.x];
  let phase=variation(id+37u)*6.2831853;let y=variation(id+41u)*2.0-1.0;let radius=command.center.w*pow(variation(id+43u),.3333333);
  let direction=vec3<f32>(cos(phase)*sqrt(max(0.0,1.0-y*y)),y,sin(phase)*sqrt(max(0.0,1.0-y*y)));
  var s:Ship;s.identity=vec4<u32>(ordinal|(command.identity.y<<8u)|(command.range.w<<16u)|((command.identity.x*32u+command.identity.y)<<18u),command.identity.x,1u,id);
  s.p=vec4<f32>(clearBirth(command.center.xyz+direction*radius,dimensions(command.identity.y).w),f32(id)*2.39996323);s.v=vec4<f32>(command.velocity.xyz,dynamics(command.identity.y).x);
  s.q=vec4<f32>(0.0,select(.70710678,-.70710678,(s.identity.y&1u)==1u),0.0,.70710678);
  s.origin=vec4<f32>(s.p.xyz,0.0);s.tactic.w=config.clock.x+1.0;s.fx.x=-1.0;
  a[i]=s;b[i]=s;var before=s;before.identity.z=0u;
  for(var j=0u;j<48u;j++){history[i*48u+j]=vec4<f32>(0.0,0.0,0.0,-1.0);}
  if(config.counts.w>0u){let tick=u32(floor(max(0.0,config.clock.x)*60.0));for(var e=0u;e<3u;e++){history[i*48u+e*16u+tick%16u]=vec4<f32>(emitter(s,e),config.clock.x);}}
  for(var row=0u;row<8u;row++){storePose(before,eventPoseBase(config.counts.y)+i*${EVENT_POSE_WORDS}u+row*48u);}
  // Append one birth boundary behind the retained old correction pool. Its
  // directory entry hides this identity in the still-displayed earlier frame.
  let record=config.counts.x+i;let at=correctionAt(config.counts.y,record);
  links[at]=bitcast<u32>(config.clock.x);links[at+1u]=0u;links[at+2u]=0u;links[at+3u]=0u;
  storePose(before,at+4u);storePose(s,at+52u);
  for(var j=0u;j<192u;j++){links[at+100u+j]=select(0u,bitcast<u32>(-1.0),j%4u==3u);}
  links[correctionDirectory(config.counts.y)+i]=record+1u;
}
`;
export async function createPopulationSpawner(device,maximumBatches) {
  const module=device.createShaderModule({code}),info=await module.getCompilationInfo();
  if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.map(m=>m.message).join('\n'));
  const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'spawn'}});
  const records=device.createBuffer({size:maximumBatches*64,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const uniform=device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const ordinalBuffer=device.createBuffer({size:10000*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  return {encode(encoder,next,batches,time,emitting,planets) {
    const data=new ArrayBuffer(batches.length*64),words=new Uint32Array(data),floats=new Float32Array(data);
    for(const [i,batch] of batches.entries()) {
      words.set([batch.firstIndex,batch.count,batch.first,batch.cohort,batch.fleet,batch.type,batch.firstId,0],i*16);
      floats.set([...batch.position,batch.spread,...batch.velocity,0],i*16+8);
    }
    const config=new ArrayBuffer(80);new Uint32Array(config).set([batches[0].firstIndex,next.count,batches.length,Number(emitting)]);const clock=new Float32Array(config);clock.set([time,Number(planets!==null)],4);if(planets)for(let i=0;i<3;i++)clock.set(planets[i],8+i*4);
    device.queue.writeBuffer(ordinalBuffer,0,Uint32Array.from(batches.flatMap(batch=>batch.ordinals)));
    device.queue.writeBuffer(records,0,data);device.queue.writeBuffer(uniform,0,config);
    const r=next.bindings,bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[r.a,r.b,r.history,r.links,{buffer:records},{buffer:uniform},{buffer:ordinalBuffer}].map((resource,binding)=>({binding,resource}))});
    const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil((next.count-batches[0].firstIndex)/128));pass.end();
  },destroy(){records.destroy();uniform.destroy();ordinalBuffer.destroy();}};
}
