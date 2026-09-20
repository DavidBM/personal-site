import {validateDirectorWorker,validateWorkerAdmission} from './validate-worker-browser.mjs';
import {createSolarRuntime} from './solar-runtime.mjs';
import {createDirectorWorker} from './worker-client.mjs';
import {createEngine,STRIDE} from './engine.mjs';
import {orbitRadius} from '../demo-ship-flight-poc/flight-layout.mjs';
const close=(a,b,tolerance)=>a.length===b.length&&a.every((x,i)=>Math.abs(x-b[i])<=tolerance);
function reference(records,index){const row=records.states[index];return [0,1,2].map(i=>({pose:row.slice(i*8,i*8+4),velocity:row.slice(i*8+4,i*8+7)}));}
async function compareWorker(ctx,records) {
  const worker=createDirectorWorker(),model=await createSolarRuntime(records);
  try {
    const result=await worker.request('ephemeris',records);
    let native=true,workerMatches=true;
    for(const [index,time] of records.times.entries())for(let body=0;body<3;body++) {
      const ref=reference(records,index)[body];
      native&&=close(model.bodyAt(body,time),ref.pose,1e-8)&&close(model.velocityAt(body,time),ref.velocity,1e-10);
      workerMatches&&=close(result[index].poses[body],ref.pose,1e-8)&&close(result[index].velocities[body],ref.velocity,1e-10);
    }
    ctx.assert(native,'browser WASM matches native ephemeris positions and velocities across large epochs');
    ctx.assert(workerMatches,'actual director worker uses the same native ephemeris contract');
    let rejected=false;try{await worker.request('ephemeris',{...records,definition:{...records.definition,version:999}});}catch{rejected=true;}
    ctx.assert(rejected,'worker rejects an unsupported planetary model version');
    const invalid=structuredClone(records);invalid.definition.bodies[1]=-1;rejected=false;
    try{await worker.request('ephemeris',invalid);}catch{rejected=true;}
    ctx.assert(rejected,'native validation errors cross the worker boundary as failures');
    rejected=false;try{await worker.request('ephemeris',{...records,times:Array(65).fill(0)});}catch{rejected=true;}
    ctx.assert(rejected,'worker rejects an oversized ephemeris query batch');
    const mutable=structuredClone(records),creating=createSolarRuntime(mutable);mutable.definition.bodies[15]=1.9;
    const isolated=await creating;try{ctx.assert(close(isolated.bodyAt(1,0),reference(records,2)[1].pose,1e-8),'model initialization owns its input snapshot across async loading');}finally{isolated.destroy();}
  }finally{worker.destroy();model.destroy();}
}
async function probe(e,pipeline,output) {
  const bind=e.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:e.inspection.uniform}},
    {binding:2,resource:{buffer:output}},
    {binding:8,resource:{buffer:e.inspection.control}},
  ]});
  const encoder=e.device.createCommandEncoder(),pass=encoder.beginComputePass();
  pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(3);pass.end();e.device.queue.submit([encoder.finish()]);
  return new Float32Array(await e.read(output));
}
async function compareGpu(ctx,canvas,records) {
  const e=await createEngine(canvas,{count:64,navigation:true,initialScenario:0,pressurePlanet:1,solar:records});
  const output=e.device.createBuffer({size:STRIDE*3,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
  try {
    const initial=new Float32Array(await e.read(e.state)),ids=new Uint32Array(initial.buffer),center=e.solar.bodyAt(1,0);
    ctx.assert(Array.from({length:64},(_,i)=>Math.abs(Math.hypot(...[0,1,2].map(a=>initial[i*48+a]-center[a]))-orbitRadius((ids[i*48+20]>>8)&255,center[3]))<.0001).every(Boolean),'runtime seeds orbital ships from the authoritative scene epoch');
    const pipeline=await e.device.createComputePipelineAsync({layout:'auto',compute:{module:e.inspection.module,entryPoint:'inspectBodies'}});
    let maximumPosition=0,maximumVelocity=0;
    for(const [index,time] of records.times.entries()) {
      if(time<0)continue;e.step(time,0);const poses=await probe(e,pipeline,output),ref=reference(records,index);
      for(let body=0;body<3;body++)for(let axis=0;axis<3;axis++) {
        maximumPosition=Math.max(maximumPosition,Math.abs(poses[body*48+axis]-ref[body].pose[axis]));
        maximumVelocity=Math.max(maximumVelocity,Math.abs(poses[body*48+4+axis]-ref[body].velocity[axis]));
      }
    }
    ctx.metric('planetary_gpu_error',{maximumPosition,maximumVelocity});
    ctx.assert(maximumPosition<.002&&maximumVelocity<.00002,'actual GPU model buffer and shader agree with native planetary truth');
    const after=new Float32Array(await e.read(e.state));
    ctx.assert(Array.from({length:64},(_,i)=>[0,1,2].every(a=>initial[i*48+a]===after[i*48+a])).every(Boolean),'updating planetary epochs never uploads or relocates live ship poses');
    e.setDensityVisible(true);e.render({distance:500});await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'ephemeris-backed planets, density and hull renderer validate');
  }finally{output.destroy();e.destroy();}
}
export async function validateEphemeris(ctx,canvas) {
  const response=await fetch('/dist/test-fixtures/ephemeris.json');if(!response.ok)throw new Error('Run prepare-navigation.mjs for this build');
  const records=await response.json();await validateDirectorWorker(ctx);await validateWorkerAdmission(ctx,canvas);await compareWorker(ctx,records);await compareGpu(ctx,canvas,records);
}
