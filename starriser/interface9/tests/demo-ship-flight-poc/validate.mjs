import {validateRendered} from './validate-rendered.mjs';
import {validateLayout} from './validate-layout.mjs';
import {classOf,radiusOf} from '../demo-ship-battle-poc/classes.mjs';
import {flightType} from './flight-layout.mjs';
import {bodyAt} from './solar-layout.mjs';
import {validatePressure,validateMovingField} from './validate-pressure.mjs';
import { createEngine, STRIDE, RING } from './engine.mjs';
const floats=buffer=>new Float32Array(buffer);
const quantile=(a,p)=>[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*p))];
const observeContinuityFrame=frame=>frame<=8 || (frame>=89&&frame<=94) || frame===240;
const previousFrameWasObserved=frame=>frame<=8 || (frame>=90&&frame<=94);

async function continuous(ctx,engine) {
  engine.reset(0);engine.step(0,0);
  const before=await engine.read(engine.state);
  engine.step(0,0);const zero=await engine.read(engine.state);
  ctx.assert(new Uint8Array(before).every((x,i)=>x===new Uint8Array(zero)[i]),'zero time changes no state after initialization');
  const initial=floats(before);let previous=initial,maxVelocityResidual=0,maxAcceleration=0,maxJerk=0;
  for(let frame=1;frame<=240;frame++) {
    if(frame===90)engine.setPhase(2.4);
    engine.step(frame/120,1/120);
    // Compare consecutive real shader steps around retarget, using the integration equation as an independent invariant.
    if(observeContinuityFrame(frame)) {
      const current=floats(await engine.read(engine.state));
      if(previousFrameWasObserved(frame)) {
        for(let i=0;i<engine.count;i++) {
          const o=i*24;
          for(let axis=0;axis<3;axis++) {
            maxVelocityResidual=Math.max(maxVelocityResidual,Math.abs(current[o+axis]-previous[o+axis]-current[o+4+axis]/120));
          }
          maxAcceleration=Math.max(maxAcceleration,Math.hypot(...current.slice(o+8,o+11))/classOf(flightType(i,engine.count)).acceleration);
          maxJerk=Math.max(maxJerk,Math.hypot(current[o+8]-previous[o+8],current[o+9]-previous[o+9],current[o+10]-previous[o+10])*120/classOf(flightType(i,engine.count)).jerk);
        }
      }
      previous=current;
    }
  }
  const final=floats(await engine.read(engine.state));
  ctx.assert(final.every(Number.isFinite),'all active agent state finite');
  ctx.assert(maxVelocityResidual<1.2e-5,'position displacement agrees with integrated velocity through retarget');
  ctx.assert(maxAcceleration<1.0001,'each class acceleration stays within its own limit');
  ctx.assert(maxJerk<1.001,'each class jerk stays bounded through retarget');
  ctx.assert(Math.abs(final[1]-initial[1])>.01,'real vertical flight occurs');
  const words=new Uint32Array(await engine.read(engine.state));
  ctx.assert(Array.from({length:engine.count},(_,i)=>words[i*24+23]===i+1).every(Boolean),'persistent visual IDs survive all ping-pong steps');
  ctx.metric('continuityResidual',maxVelocityResidual);ctx.metric('maxAcceleration',maxAcceleration);ctx.metric('maxJerk',maxJerk);
}

async function warp(ctx,engine) {
  engine.reset(3);engine.step(0,0);engine.step(3.995,3.995);
  let state=floats(await engine.read(engine.state));
  ctx.assertApprox(state[0],-80+60*3.995/4,.00002,'canonical straight warp evaluated at absolute time');
  const mid=await engine.read(engine.state);
  engine.render({follow:0});engine.render({follow:.5});engine.render({follow:1});
  const midAfter=await engine.read(engine.state);
  ctx.assert(new Uint8Array(mid).every((x,i)=>x===new Uint8Array(midAfter)[i]),'camera toggles during warp never alter canonical state');
  engine.step(4,0.005);state=floats(await engine.read(engine.state));
  ctx.assertApprox(state[0],-20,.00001,'warp reaches system border at exact event time');
  ctx.assertApprox(state[4],2,.00001,'warp hands back explicit cruise velocity');
  const canonical=await engine.read(engine.state);
  engine.render({follow:0});engine.render({follow:1});
  const after=await engine.read(engine.state);
  ctx.assert(new Uint8Array(canonical).every((x,i)=>x===new Uint8Array(after)[i]),'follow camera and stretch never write canonical state');
  engine.step(4.005,.005);state=floats(await engine.read(engine.state));
  ctx.assert(state[0]>-20&&state[0]<-19.97,'post-warp local integration consumes only its actual subinterval');
  engine.reset(3);engine.step(3.995,3.995);engine.step(4.005,.010);
  const split=floats(await engine.read(engine.state));
  ctx.assertApprox(split[0],state[0],.00001,'event-straddling step matches explicit split at warp boundary');
  engine.reset(3);engine.step(1,1);
  const oldPosition=floats(await engine.read(engine.state))[0];
  engine.rescheduleWarp(2);engine.step(1,0);
  ctx.assertApprox(floats(await engine.read(engine.state))[0],oldPosition,1e-6,'warp rescheduling preserves current position');
  engine.step(2,1);ctx.assertApprox(floats(await engine.read(engine.state))[0],-20,1e-5,'rescheduled warp obeys new deadline');
}

async function trails(ctx,engine) {
  engine.reset(0);engine.step(0,0);engine.step(.02,.02);
  const saved=floats(await engine.read(engine.history));
  engine.step(.52,.5,{emitting:false});
  const disabled=floats(await engine.read(engine.history));
  ctx.assert(disabled.every((x,i)=>x===saved[i]),'disabled emission does not fabricate history');
  engine.step(.532,.012,{emitting:true});
  const resumed=floats(await engine.read(engine.history));
  let births=0, invalidBirths=0;
  for(let i=3;i<resumed.length;i+=4)if(resumed[i]>=0){births++;if(resumed[i]<.53199)invalidBirths++;}
  ctx.assert(invalidBirths===0,'no new births inside short disabled interval');
  ctx.assert(births===engine.count*3,'restart seeds precisely one point per emitter');
  const positions=floats(await engine.read(engine.state));
  // CPU rotate oracle with explicit q*v*q^-1, independent of shader's cross-product formula.
  const mul=(a,b)=>[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
  const q=[...positions.slice(12,16)], inv=[-q[0],-q[1],-q[2],q[3]];
  for(let e=0;e<3;e++) {
    const extent=classOf(0).extent;
    const offset=[(e-1)*.5*extent[0],(e===1?.15:-.2)*extent[1],-extent[2],0];
    const rotated=mul(mul(q,offset),inv), index=(e*RING+Math.floor(.532*60)%RING)*4;
    for(let axis=0;axis<3;axis++)ctx.assertApprox(resumed[index+axis],positions[axis]+rotated[axis],1.2e-5,'historical emitter uses sampled quaternion');
  }
  engine.step(.533,.001);const later=floats(await engine.read(engine.history));
  ctx.assert(later.every((x,i)=>x===resumed[i]),'between cadence crossings already-emitted points remain fixed');
  engine.reset(0);engine.step(0,0);engine.step(.01,.01);engine.step(.02,.01,{emitting:false});
  const noTrails=new Uint8Array(await engine.pixels({showTrails:false}));
  const trailsOn=new Uint8Array(await engine.pixels({showTrails:true}));
  ctx.assert(trailsOn.every((x,i)=>x===noTrails[i]),'missing newer trail endpoints produce no origin-to-emitter pixels after a short stop');
  engine.reset(3);engine.step(0,0);for(let f=1;f<=120;f++)engine.step(f/120,1/120);
  const without=new Uint8Array(await engine.pixels({showTrails:false,follow:1,distance:80}));
  const withTrail=new Uint8Array(await engine.pixels({showTrails:true,follow:1,distance:80}));
  ctx.assert(withTrail.some((x,i)=>x!==without[i]),'positive pixel control: live warp trails are actually rendered');
}

async function battle(ctx,engine) {
  engine.reset(2);let decisions=0;
  const seed=floats(await engine.read(engine.state)),opponent=engine.count/2*24;
  seed.set([-1,0,0],0);seed.set([2,0,0],4);
  seed.set([1,0,0],opponent);seed.set([-2,0,0],opponent+4);
  engine.device.queue.writeBuffer(engine.state,0,seed);
  for(let f=1;f<=360;f++) {
    engine.step(f/120,1/120);
    if(f===1||f%30===0){const state=floats(await engine.read(engine.state));for(let i=0;i<engine.count;i++)if(state[i*24+11]===1)decisions++;}
  }
  ctx.assert(decisions>0,'agents make actual predicted-contact evasion decisions');
  ctx.metric('observedEvasionDecisions',decisions);
}

async function approach(ctx,engine) {
  engine.reset(1);
  let closest=Infinity;
  for(let f=1;f<=7200;f++) {
    engine.step(f/120,1/120);
    if(f%60===0) {
      const state=floats(await engine.read(engine.state)),t=f/120;
      const spheres=[0,1,2].map(i=>bodyAt(i,t,1800));
      for(let i=0;i<engine.count;i++)for(const b of spheres)closest=Math.min(closest,Math.hypot(state[i*24]-b[0],state[i*24+1]-b[1],state[i*24+2]-b[2])-b[3]-radiusOf(flightType(i,engine.count)));
    }
  }
  const result=await engine.read(engine.state),words=new Uint32Array(result);
  const arrived=Array.from({length:engine.count},(_,i)=>words[i*24+22]===2).filter(Boolean).length;
  ctx.assert(arrived===engine.count,'all fixture agents traverse both 3D corridor guides');
  ctx.assert(closest>0,'sampled approach hulls remain outside all three body surfaces');
  ctx.metric('approach_sampled_min_surface_clearance',closest);
  ctx.metric('approach_clearance_sample_interval_s',.5);
}

async function benchmark(ctx,canvas,count) {
  const engine=await createEngine(canvas,{count,scenario:2,period:1800});
  try {
    for(let f=1;f<=120;f++)engine.step(f/120,1/120);
    await engine.device.queue.onSubmittedWorkDone();
    if(!engine.timestamps){ctx.metric(`gpu_${count}`,'timestamp-query unavailable; no compute timing claim');return;}
    const frames=240, querySet=engine.device.createQuerySet({type:'timestamp',count:frames*2});
    const result=engine.device.createBuffer({size:frames*16,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});
    const encodeStart=performance.now();
    for(let f=0;f<frames;f++)engine.step((121+f)/120,1/120,{querySet,queryIndex:f*2});
    const encodingMs=performance.now()-encodeStart;
    const encoder=engine.device.createCommandEncoder();encoder.resolveQuerySet(querySet,0,frames*2,result,0);engine.device.queue.submit([encoder.finish()]);
    const times=new BigUint64Array(await engine.read(result));
    const ms=Array.from({length:frames},(_,i)=>Number(times[i*2+1]-times[i*2])/1e6);
    ctx.metric(`compute_${count}_p50_ms`,quantile(ms,.50));ctx.metric(`compute_${count}_p95_ms`,quantile(ms,.95));ctx.metric(`compute_${count}_p99_ms`,quantile(ms,.99));
    ctx.metric(`encode_${count}_mean_ms`,encodingMs/frames);
    ctx.metric(`state_${count}_bytes`,count*STRIDE*2);ctx.metric(`history_${count}_bytes`,count*3*RING*16);
    const info=engine.adapter.info;
    ctx.metric('adapter',JSON.stringify({vendor:info?.vendor,architecture:info?.architecture,device:info?.device,description:info?.description}));
    engine.render({follow:0});await engine.device.queue.onSubmittedWorkDone();
    ctx.assert(engine.errors.length===0,`${count} agents produce no WebGPU validation errors`);
    querySet.destroy();result.destroy();
  }finally{engine.destroy();}
}

export async function validate(ctx,canvas) {
  if(ctx.params.mode==='rendered'){await validateRendered(ctx,canvas);return;}
  await validateLayout(ctx,canvas);
  await validatePressure(ctx,canvas);await validateMovingField(ctx,canvas);
  const engine=await createEngine(canvas,{count:32,warpEnd:4});
  try {await continuous(ctx,engine);await warp(ctx,engine);await trails(ctx,engine);await battle(ctx,engine);await approach(ctx,engine);
    ctx.assert(engine.errors.length===0,'small fixtures produce no WebGPU validation errors');
  }finally{engine.destroy();}
  await benchmark(ctx,canvas,1000);await benchmark(ctx,canvas,10000);
  ctx.metric('scope','Isolated isotropic controller + 1 paired threat + 3 moving spheres + 3 emitter histories. Includes shared density and bounded neighbor separation. No production meshes, BE, worker planner or total-frame qualification.');
}
