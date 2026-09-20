import {spatialStorage} from '../demo-ship-battle-poc/spatial-schedule.mjs';
import {filterGeometryBytes} from '../demo-ship-battle-poc/contact-cache.mjs';
import {queryWorkgroups} from '../demo-ship-battle-poc/contact-queries.mjs';
import {FLIGHT_GRID_CELLS as GRID_CELLS,flightType,flightLane,orbitRadius,orbitTilt} from './flight-layout.mjs';
import {classOf} from '../demo-ship-battle-poc/classes.mjs';
import {bodyAt} from './solar-layout.mjs';
import {HASH_BUCKETS} from '../demo-ship-battle-poc/spacing.mjs';
import {createGpuProfiler} from './gpu-profiler.mjs';
import { SIM, DRAW, RING, STRIDE } from './shaders.mjs';
export { RING, STRIDE };

function seedPosition(i,count,scenario,phase,team) {
  const planet=bodyAt(1,0,1800),type=flightType(i,count),r=orbitRadius(type,planet[3]),tilt=orbitTilt(type);
  let point=[planet[0]+r*Math.cos(phase),planet[1]+r*Math.sin(phase)*Math.sin(tilt),planet[2]+r*Math.sin(phase)*Math.cos(tilt)],offsetX=0;
  if(scenario===1||scenario===3) {
    const lane=flightLane(i,count,type);
    offsetX=scenario===3?-8*((i%41)/40):0;
    point=[(scenario===3?-80:-20)+offsetX,lane[0],lane[1]];
  }
  if(scenario===2)point=[(team?1:-1)*(8+i%256%7*.12),Math.sin(phase)*3,Math.cos(phase)*3];
  if(scenario===2&&type>=30)point=[0,0,flightLane(i,count,type)[1]];
  return {point,offsetX};
}

export function seedShips(count, scenario) {
  const data=new ArrayBuffer(count*STRIDE), f=new Float32Array(data), words=new Uint32Array(data);
  for(let i=0;i<count;i++) {
    const o=i*24, ordinal=i%256, type=flightType(i,count);
    const phase=(ordinal*2.39996323 + Math.floor(i/768)*0.73)%(Math.PI*2);
    const team=i<Math.floor(count/2)?0:1;
    const {point,offsetX}=seedPosition(i,count,scenario,phase,team);
    f.set([...point,phase],o);f[o+16]=offsetX;
    f.set([0,0,0,classOf(type).speed],o+4);
    if(scenario===2) f[o+4]=team?-2:2;
    f.set([0,Math.SQRT1_2,0,Math.SQRT1_2],o+12);
    words.set([ordinal|(type<<8),team,0,i+1],o+20);
  }
  return data;
}

function validateOptions(count,period,warpEnd) {
  if(!Number.isInteger(count)||count<1||count>10000)throw new Error('count must be 1–10000 visual agents');
  if(![period,warpEnd].every(x=>Number.isFinite(x)&&x>0))throw new Error('period and warp duration must be positive and finite');
}

async function checkedModules(device) {
  const modules=[device.createShaderModule({code:SIM}),device.createShaderModule({code:DRAW})];
  for(const m of modules) {
    const info=await m.getCompilationInfo();
    const failed=info.messages.filter(x=>x.type==='error');
    if(failed.length) throw new Error(failed.map(x=>`${x.lineNum}: ${x.message}`).join('\n'));
  }
  return modules;
}

const DEFAULT_VIEW=Object.freeze({follow:0,yaw:.25,pitch:.5,distance:42,alpha:1,showTrails:true});

export async function createEngine(canvas, { count=1000, scenario=0, period=1800, warpEnd=8 }={}) {
  validateOptions(count,period,warpEnd);
  const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
  if(!adapter) throw new Error('WebGPU adapter unavailable');
  const timestamps=adapter.features.has('timestamp-query');
  const device=await adapter.requestDevice({requiredFeatures:timestamps?['timestamp-query']:[]});
  const profiler=createGpuProfiler(device,timestamps,['Clear','Density + contacts','Hull volume','Spatial ordering','Contact cache','Contact filtering','Steer + separate + trails','Render']);
  const errors=[];
  device.addEventListener('uncapturederror',e=>{errors.push(e.error.message); console.error(e.error.message);});
  const make=(size,usage)=>device.createBuffer({size,usage});
  const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
  const agents=[make(count*STRIDE,storage),make(count*STRIDE,storage)];
  const history=make(count*3*RING*16,storage),geometry=make(filterGeometryBytes(count),storage);
  const uniform=make(48,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const view=make(80,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const modules=await checkedModules(device);
  const spatial=spatialStorage(count);
  const density=make(2*GRID_CELLS*4,storage),heads=make(spatial.headWords*4,storage),links=make(spatial.linkWords*4,storage);
  const layout=device.createBindGroupLayout({entries:[
    {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
    ...[1,2,3,5,6,7].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===1?'read-only-storage':'storage'}}))]});
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const kernels=await Promise.all(['clearDensity','buildDensity','buildHullDensity','advance','scheduleAgents','buildContactCache','buildContactMasks'].map(entryPoint=>device.createComputePipelineAsync({layout:pipelineLayout,compute:{module:modules[0],entryPoint}})));
  const makeGroups=phaseBuffer=>agents.map((old,i)=>device.createBindGroup({layout,entries:
    [uniform,old,agents[1-i],phaseBuffer,density,heads,links].map((buffer,index)=>({binding:[0,1,2,3,5,6,7][index],resource:{buffer}}))}));
  const groups=makeGroups(history),contactGroups=makeGroups(geometry);
  const contactPlan=[[4,3,Math.ceil(HASH_BUCKETS/128),groups],[5,4,Math.ceil(count/128),contactGroups],[6,5,queryWorkgroups(count),contactGroups]];
  const format=navigator.gpu.getPreferredCanvasFormat();
  const context=canvas.getContext('webgpu');context.configure({device,format,alphaMode:'opaque',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  const pipeline=async(entry,topology='triangle-list',transparent=false)=>device.createRenderPipelineAsync({layout:'auto',
    vertex:{module:modules[1],entryPoint:entry},fragment:{module:modules[1],entryPoint:'fragment',targets:[{format,
      ...(transparent?{blend:{color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}:{})}]},
    primitive:{topology,cullMode:'none'},depthStencil:{format:'depth24plus',depthWriteEnabled:!transparent,depthCompare:'less-equal'}});
  const draw=await Promise.all([pipeline('hull'),pipeline('trail','line-list',true),pipeline('planet'),pipeline('densityCell','line-list',true)]);
  const drawGroups=draw.map(p=>agents.map((buffer,i)=>device.createBindGroup({layout:p.getBindGroupLayout(0),entries:
    [{binding:0,resource:{buffer:view}},{binding:1,resource:{buffer}},{binding:3,resource:{buffer:agents[1-i]}},...(p===draw[1]?[{binding:2,resource:{buffer:history}}]:[]),...(p===draw[3]?[{binding:4,resource:{buffer:density}}]:[])]})));
  const input=new Float32Array(12), camera=new Float32Array(20), initialWarpEnd=warpEnd;
  let densityEnabled=1,densityVisible=false;
  let current=0, depth=null, dimensions='', now=0, phase=0, emit=true,lastDt=0,warpStart=0,warpX=-80;
  function reset(nextScenario=scenario) {
    scenario=nextScenario;now=0;phase=0;current=0;emit=true;lastDt=0;warpStart=0;warpX=-80;warpEnd=initialWarpEnd;
    const seed=seedShips(count,scenario);
    for(const b of agents) device.queue.writeBuffer(b,0,seed);
    const dead=new Float32Array(count*3*RING*4);for(let i=3;i<dead.length;i+=4) dead[i]=-1;
    device.queue.writeBuffer(history,0,dead);
  }
  function hullPass(encoder,sample) {
    const pass=encoder.beginComputePass(sample?.(2));pass.setPipeline(kernels[2]);pass.setBindGroup(0,groups[current]);pass.dispatchWorkgroups(count>=6?2:0);pass.end();
  }
  function contactPasses(encoder,sample) {
    for(const [kernel,label,work,bindings] of contactPlan) {
      const pass=encoder.beginComputePass(sample?.(label));pass.setPipeline(kernels[kernel]);pass.setBindGroup(0,bindings[current]);pass.dispatchWorkgroups(work);pass.end();
    }
  }
  function profileSample(querySet){return querySet?null:profiler.begin();}
  function step(time,dt,{emitting=emit,querySet=null,queryIndex=0}={}) {
    const sample=profileSample(querySet);
    now=time;emit=emitting;lastDt=dt;
    input.set([time,dt,count,scenario,period,phase,Number(emitting),densityEnabled,warpStart,warpEnd,warpX,-20]);
    device.queue.writeBuffer(uniform,0,input);
    const encoder=device.createCommandEncoder();
    const clearPass=encoder.beginComputePass(querySet?{timestampWrites:{querySet,beginningOfPassWriteIndex:queryIndex}}:sample?.(0));
    clearPass.setPipeline(kernels[0]);clearPass.setBindGroup(0,groups[current]);clearPass.dispatchWorkgroups(Math.ceil(2*GRID_CELLS/128));clearPass.end();
    const gridPass=encoder.beginComputePass(sample?.(1));
    gridPass.setPipeline(kernels[1]);gridPass.setBindGroup(0,groups[current]);gridPass.dispatchWorkgroups(Math.ceil(count/128));gridPass.end();
    hullPass(encoder,sample);contactPasses(encoder,sample);
    const pass=encoder.beginComputePass(querySet?{timestampWrites:{querySet,endOfPassWriteIndex:queryIndex+1}}:sample?.(6));
    pass.setPipeline(kernels[3]);pass.setBindGroup(0,groups[current]);pass.dispatchWorkgroups(Math.ceil(count/128));pass.end();
    device.queue.submit([encoder.finish()]);current=1-current;
  }
  function resize() {
    const width=Math.max(1,Math.round(canvas.clientWidth*devicePixelRatio));
    const height=Math.max(1,Math.round(canvas.clientHeight*devicePixelRatio));
    if(dimensions!==`${width},${height}`) {
      canvas.width=width;canvas.height=height;dimensions=`${width},${height}`;depth?.destroy();
      depth=device.createTexture({size:[width,height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    }
    return {width,height};
  }
  function render(options={}) {
    const {follow,yaw,pitch,distance,alpha,showTrails}={...DEFAULT_VIEW,...options};
    const {width,height}=resize();
    const center=bodyAt(1,now,period).slice(0,3);if(scenario!==0)center[1]+=40;
    camera.set([center[0]+Math.sin(yaw)*Math.cos(pitch)*distance,center[1]+Math.sin(pitch)*distance,center[2]+Math.cos(yaw)*Math.cos(pitch)*distance,width/height,
      ...center,follow,now-lastDt*(1-alpha),count,scenario,Number(emit),period,warpStart,warpEnd,0,alpha,0,0,1]);
    device.queue.writeBuffer(view,0,camera);
    const encoder=device.createCommandEncoder(); const pass=encoder.beginRenderPass({...profiler.renderWrites(),colorAttachments:[{view:context.getCurrentTexture().createView(),
      clearValue:{r:.003,g:.008,b:.022,a:1},loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
    for(const [p,vertices,instances] of [[2,64*32*6,3],[0,36,count],[1,(RING-1)*2,count*3],[3,24,GRID_CELLS]]) {
      if((p===1&&!showTrails)||(p===3&&!densityVisible))continue;
      pass.setPipeline(draw[p]);pass.setBindGroup(0,drawGroups[p][current]);pass.draw(vertices,instances);
    }
    pass.end();profiler.resolve(encoder);device.queue.submit([encoder.finish()]);profiler.submitted();
  }
  async function read(buffer,bytes=buffer.size) {
    const staging=make(bytes,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
    try {
      const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(buffer,0,staging,0,bytes);device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);return staging.getMappedRange().slice(0);
    } finally { staging.destroy(); }
  }
  async function pixels(options={}) {
    render(options);
    const bytesPerRow=Math.ceil(canvas.width*4/256)*256;
    const staging=make(bytesPerRow*canvas.height,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
    try {
      const encoder=device.createCommandEncoder();
      encoder.copyTextureToBuffer({texture:context.getCurrentTexture()},{buffer:staging,bytesPerRow},{width:canvas.width,height:canvas.height});
      device.queue.submit([encoder.finish()]);await staging.mapAsync(GPUMapMode.READ);
      return staging.getMappedRange().slice(0);
    }finally{staging.destroy();}
  }
  reset();
  return {device,adapter,timestamps,count,errors,history,reset,step,render,read,pixels,profiler,density,
    setDensityVisible(value){densityVisible=value;},setDensityEnabled(value){densityEnabled=Number(value);},
    get now(){return now;},get scenario(){return scenario;},get state(){return agents[current];},
    setPhase(value){phase=value;},setPeriod(value){period=value;},
    rescheduleWarp(endTime){
      if(scenario!==3||now>=warpEnd||!Number.isFinite(endTime)||endTime<=now)throw new Error('reschedule requires active warp and a future deadline');
      warpX+=( -20-warpX)*(now-warpStart)/(warpEnd-warpStart);warpStart=now;warpEnd=endTime;
    },
    destroy(){profiler.destroy();for(const b of [...agents,history,geometry,uniform,view,density,heads,links])b.destroy();depth?.destroy();device.destroy();}};
}
