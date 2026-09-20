import {validatePopulationLifecycle} from './validate-population-lifecycle.mjs';
import {validateRegrouping} from './validate-regrouping.mjs';
import {validateRetirement} from './validate-retirement.mjs';
import {validateIdentities} from './validate-identities.mjs';
import {validatePopulation} from './validate-population.mjs';
import {validateStorage} from './validate-storage.mjs';
import {validatePacking} from './validate-packing.mjs';
import {validateCorrections} from './validate-corrections.mjs';
import {validatePressureEvents} from './validate-pressure-events.mjs';
import {validateRecoveryAnchors} from './validate-recovery-anchors.mjs';
import {validateDirectorRecovery} from './validate-director-recovery.mjs';
import {validateSnapshotRoutes} from './validate-snapshot-routes.mjs';
import {validateSnapshots} from './validate-snapshots.mjs';
import {validateStalls} from './validate-stalls.mjs';
import {validateNavigationEvents} from './validate-navigation-events.mjs';
import {validateProgress} from './validate-progress.mjs';
import {validateDeadlines} from './validate-deadlines.mjs';
import {validatePlannedLifecycle} from './validate-planned-lifecycle.mjs';
import {validateLifecycleBatch} from './validate-lifecycle-batch.mjs';
import {validateClock} from './validate-clock.mjs';
import {validateEventBudget} from './validate-event-budget.mjs';
import {validateEventFrames} from './validate-event-frames.mjs';
import {validateLiveEvents} from './validate-live-events.mjs';
import {validateLiveRoutes} from './validate-live-routes.mjs';
import {validateArrival} from './validate-arrival.mjs';
import {validateRoutes} from './validate-routes.mjs';
import {validateEphemeris} from './validate-ephemeris.mjs';
import {validateScopeBudget} from './validate-scope-budget.mjs';
import {validateScopes} from './validate-scopes.mjs';
import {validateRuntime} from './validate-runtime.mjs';
import {validateVolume} from './validate-volume.mjs';
import {bodyAt} from '../demo-ship-flight-poc/solar-layout.mjs';
import {validateCombat} from './validate-combat.mjs';
import {validateSequence} from './validate-sequence.mjs';
import {validateEngagement} from './validate-engagement.mjs';
import {createEngine} from './engine.mjs';
import {GRID_CELLS} from './spacing.mjs';
import {validateSpacing} from './validate-spacing.mjs';
import {createDirector,visualSurvivors,TYPES} from './director.mjs';
import {CLASS_BY_TYPE,CLASSES,classOf,radiusOf} from './classes.mjs';
const floats=buffer=>new Float32Array(buffer);
const targets=buffer=>floats(buffer).filter((_,i)=>i%48===16);
const quantile=(a,p)=>[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)*p)];
const slot=(e,fleet,type)=>e.director.groups[(fleet*TYPES+type)*8+4];
function command(e,fields){return e.command({revision:e.director.revision+1,fleet:0,...fields});}
function join(e){command(e,{joined:true});command(e,{fleet:1,joined:true});}
const classOfSlot=(words,i)=>CLASS_BY_TYPE[(words[i*48+20]>>8)&255];
function projection(ctx) {
  ctx.assert(visualSurvivors(1000,50,800)===40,'1000 logical / 50 visual / 200 losses removes exactly 10 representatives');
  const d=createDirector(2000);d.apply({revision:1,fleet:0,survivalFraction:.9});d.apply({revision:2,fleet:0,survivalFraction:.8});
  ctx.assert(d.alive===1800,'mixed-class fleet losses preserve exact aggregate visual quota');
  ctx.assert(!d.apply({revision:1,fleet:0,survivalFraction:0})&&d.alive===1800,'stale report cannot kill ships');
  let rejected=false;try{d.apply({revision:3,fleet:0,survivalFraction:1});}catch{rejected=true;}
  ctx.assert(rejected&&d.revision===2,'loss report cannot resurrect a visual identity');
  rejected=false;try{d.apply({revision:3,fleet:0,strategy:'invented'});}catch{rejected=true;}
  ctx.assert(rejected&&d.revision===2,'invalid report is rejected atomically');
  const population=createDirector(10000),g=population.groups;
  ctx.assert(population.alive===10000,'mixed fleet initializes all 10000 requested agents');
  ctx.assert(Array.from({length:64},(_,i)=>g[i*8]<=256).every(Boolean),'every type stays within 256 visual identities');
  ctx.assert(g[31*8]===1&&g[63*8]===1,'exactly one colossus per fleet');
}
async function freeFlight(ctx,canvas) {
  const e=await createEngine(canvas,{count:64});
  try {
    e.setDensityEnabled(false);e.setPlanetsEnabled(false);
    const initial=floats(await e.read(e.state));e.step(1/120,1/120);const held=floats(await e.read(e.state));
    ctx.assert(Array.from({length:e.count},(_,i)=>[0,1,2].every(a=>initial[i*48+a]===held[i*48+a])).every(Boolean),'unjoined ships hold without orbital movement');
    join(e);
    const directions=[];
    for(const x of [10,160]) {
      e.reset();const seed=floats(await e.read(e.state)),enemy=slot(e,1,0);
      seed.set([x,0,0],0);seed.set([x+20,0,0],enemy*48);e.device.queue.writeBuffer(e.state,0,seed);
      for(let f=1;f<=120;f++)e.step(f/120,1/120);
      directions.push(floats(await e.read(e.state))[4]);
    }
    ctx.assert(directions[0]>0,'central battle permits outward pursuit');
    ctx.assert(directions[1]<0,'distant outward pursuit gradually yields to return preference');
  }finally{e.destroy();}
}
async function planetAvoidance(ctx,canvas) {
  const e=await createEngine(canvas,{count:64});
  try {
    e.setDensityEnabled(false);command(e,{fleet:1,joined:true,strategy:'withdraw'});const index=slot(e,1,0),clearance=[];
    for(const enabled of [false,true]) {
      e.reset();e.setPlanetsEnabled(enabled);const seed=floats(await e.read(e.state));
      seed.set([-53,-98.8,0],index*48);seed.set([3,0,0],index*48+4);e.device.queue.writeBuffer(e.state,0,seed);let minimum=Infinity;
      for(let f=1;f<=360;f++){e.step(f/120,1/120);const state=floats(await e.read(e.state));minimum=Math.min(minimum,Math.hypot(...[0,1,2].map(a=>state[index*48+a]-bodyAt(1,f/120,1800)[a]))-bodyAt(1,f/120,1800)[3]-radiusOf(0));}
      clearance.push(minimum);
    }
    ctx.assert(clearance[0]<0,'obstacle negative control crosses enlarged planet without avoidance');
    ctx.assert(clearance[1]>0,'class-sized hull avoids enlarged planet with avoidance enabled');ctx.metric('planet_probe_hull_clearance',clearance[1]);
  }finally{e.destroy();}
}
async function capitalAvoidance(ctx,canvas) {
  const e=await createEngine(canvas,{count:64});
  try {
    e.setPlanetsEnabled(false);command(e,{fleet:1,joined:true,strategy:'withdraw'});
    const ship=slot(e,1,0),capital=slot(e,1,31),clearance=[];
    for(const enabled of [false,true]) {
      e.reset();e.setDensityEnabled(enabled);const seed=floats(await e.read(e.state));
      for(let i=0;i<e.count;i++)seed.set([80+i,80,80],i*48);
      seed.set([-radiusOf(31)-6,1,0],ship*48);seed.set([3,0,0],ship*48+4);seed.set([0,0,0],capital*48);
      e.device.queue.writeBuffer(e.state,0,seed);let minimum=Infinity;
      for(let f=1;f<=480;f++) {
        e.step(f/120,1/120);const pose=floats(await e.read(e.state));
        minimum=Math.min(minimum,Math.hypot(...[0,1,2].map(a=>pose[ship*48+a]-pose[capital*48+a]))-radiusOf(0)-radiusOf(31));
      }
      clearance.push(minimum);
    }
    ctx.assert(clearance[0]<0,'capital-spacing negative control crosses the colossus envelope');
    ctx.assert(clearance[1]>0,'friendly interceptor steers around moving colossus clearance envelope');
    ctx.metric('colossus_probe_hull_clearance',clearance[1]);
  }finally{e.destroy();}
}
async function classTargets(ctx,canvas) {
  const e=await createEngine(canvas,{count:200});
  try {
    join(e);let now=0;
    for(const kind of [5,0,4,1,2,3]) {
      const before=await e.read(e.state);command(e,{attackClass:kind});
      const uploaded=await e.read(e.state);ctx.assert(new Uint8Array(before).every((x,i)=>x===new Uint8Array(uploaded)[i]),'class order never writes live pose');
      now+=.01;e.step(now,.01);const data=await e.read(e.state),f=floats(data),w=new Uint32Array(data);
      ctx.assert(Array.from({length:e.count/2},(_,i)=>f[i*48+16]>0&&classOfSlot(w,f[i*48+16]-1)===kind).every(Boolean),`all blue targets match ${CLASSES[kind].name}`);
    }
    command(e,{attackClass:5});now+=.01;e.step(now,.01);command(e,{fleet:1,type:31,remaining:0});now+=.01;e.step(now,.01);
    ctx.assert(targets(await e.read(e.state)).slice(0,e.count/2).every(x=>x===0),'loss of sole colossus cannot broaden target permissions');
    command(e,{attackClass:0});now+=.01;e.step(now,.01);
    ctx.assert(targets(await e.read(e.state)).slice(0,e.count/2).every(x=>x>0),'next class order reacquires eligible targets after colossus loss');
  }finally{e.destroy();}
}
async function authority(ctx,e) {
  for(let f=1;f<=120;f++)e.step(f/120,1/120);
  ctx.assert(targets(await e.read(e.state)).every(x=>x===0),'proximity never starts a battle');
  command(e,{joined:true});e.step(1.01,.01);
  ctx.assert(targets(await e.read(e.state)).every(x=>x===0),'one joined fleet cannot attack an unjoined fleet');
  command(e,{fleet:1,joined:true});e.step(1.02,.01);
  ctx.assert(targets(await e.read(e.state)).every(x=>x>0),'both joined fleets acquire permitted opponents');
  command(e,{strategy:'hold'});e.step(1.03,.01);
  ctx.assert(targets(await e.read(e.state)).slice(0,e.count/2).every(x=>x===0),'hold directive preempts attack');
  command(e,{strategy:'pass'});e.step(1.04,.01);const before=floats(await e.read(e.state));
  command(e,{fleet:1,survivalFraction:.8});e.step(1.05,.01);
  const after=await e.read(e.state),f=floats(after),w=new Uint32Array(after);let dead=0,continuous=true,valid=true;
  for(let i=0;i<e.count;i++) {
    if(w[i*48+22]===0){dead++;continue;}
    for(let a=0;a<3;a++)continuous&&=Math.abs(f[i*48+a]-before[i*48+a]-f[i*48+a+4]*.01)<5e-6;
    const contact=f[i*48+16];if(contact>0)valid&&=w[(contact-1)*48+22]===1;
  }
  ctx.assert(dead===e.count/10,'20 percent fleet report removes exact projected quota');
  ctx.assert(continuous&&valid,'survivors stay continuous and never retain killed targets');
  command(e,{fleet:1,joined:false});e.step(1.06,.01);
  ctx.assert(targets(await e.read(e.state)).every(x=>x===0),'leaving battle invalidates targets');
}
function hullSamples(f,index,type) {
  const p=[...f.slice(index*48,index*48+3)];if(CLASS_BY_TYPE[type]<4)return [p];
  const q=f.slice(index*48+12,index*48+16),extent=classOf(type).extent;
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const counts=extent.map(e=>Math.ceil(e*2/(4/Math.sqrt(3))));
  return Array.from({length:counts[0]*counts[1]*counts[2]},(_,n)=>{
    const v=[n%counts[0],Math.floor(n/counts[0])%counts[1],Math.floor(n/(counts[0]*counts[1]))].map((x,a)=>((x+.5)/counts[a]*2-1)*extent[a]);
    const uv=cross(q,v),uuv=cross(q,uv);
    return p.map((x,a)=>x+v[a]+2*(q[3]*uv[a]+uuv[a]));
  });
}
function expectedDensity(e,data) {
  const f=floats(data),w=new Uint32Array(data),mass=[0,0];
  for(let i=0;i<e.count;i++) {
    const type=(w[i*48+20]>>8)&255,fleet=w[i*48+21],ordinal=w[i*48+20]&255;
    if(!e.director.roster.isLive(fleet,type,ordinal))continue;
    const samples=hullSamples(f,i,type);
    for(const p of samples)if(p.every(x=>x>=-124&&x<=119.96))mass[fleet]+=classOf(type).weight/samples.length;
  }
  return mass;
}
async function scopes(ctx,e) {
  const before=await e.read(e.state),expected=expectedDensity(e,before);e.setPressureMerged(true);e.step(1.07,.01);
  const after=floats(await e.read(e.state)),old=floats(before);let residual=0;
  for(let i=0;i<e.count;i++)for(let a=0;a<3;a++)if(new Uint32Array(after.buffer)[i*48+22])residual=Math.max(residual,Math.abs(after[i*48+a]-old[i*48+a]-after[i*48+a+4]*.01));
  ctx.assert(residual<5e-6,'pressure merge preserves class integration continuity');
  const counts=new Uint32Array(await e.read(e.density));
  const mass=fleet=>counts.slice(fleet*GRID_CELLS,(fleet+1)*GRID_CELLS).reduce((a,b)=>a+b,0)/1024;
  ctx.assert(Math.abs(expected[0]+expected[1]-mass(e.pressure.shared.slot))<3,'shared scope contains the combined class-weighted fleet volume');
  e.setPressureMerged(false);e.step(1.08,.01);
  ctx.assert(targets(await e.read(e.state)).every(x=>x===0),'pressure merge and split never start combat');
}
async function longRun(ctx,e) {
  join(e);let actions=0,maxAccelerationRatio=0;
  for(let frame=1;frame<=7200;frame++) {
    e.step(1.08+frame/120,1/120);
    if(frame%120===0) {
      const data=await e.read(e.state),f=floats(data),w=new Uint32Array(data);
      for(let i=0;i<e.count;i++){actions+=Number(f[i*48+11]===1);maxAccelerationRatio=Math.max(maxAccelerationRatio,Math.hypot(...f.slice(i*48+8,i*48+11))/classOf((w[i*48+20]>>8)&255).acceleration);}
    }
  }
  const data=await e.read(e.state),f=floats(data),w=new Uint32Array(data);let radius=0;
  for(let i=0;i<e.count;i++)if(w[i*48+22])radius=Math.max(radius,Math.hypot(...f.slice(i*48,i*48+3)));
  ctx.assert(f.every(Number.isFinite),'sixty seconds of mixed-class combat remain finite');
  ctx.assert(radius<175,'broad return bias keeps sampled battle within a large area');
  ctx.assert(maxAccelerationRatio<1.001,'every class respects its own acceleration limit');
  ctx.assert(w.filter((_,i)=>i%48===22).filter(x=>x===0).length===e.count/10,'visual contact never causes unreported deaths');
  // Close-range steering now avoids the old emergency-pass trigger in this fixture.
  // validateEngagement measures circulation and stopping directly; retain trigger counts as diagnostics.
  ctx.metric('maximum_final_battle_radius',radius);ctx.metric('observed_maneuver_samples',actions);ctx.metric('maximum_class_acceleration_ratio',maxAccelerationRatio);
  e.setDensityVisible(true);e.render();await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'mixed-class hulls, target links and 3D density rendering validate');
}
async function benchmark(ctx,canvas,count) {
  const e=await createEngine(canvas,{count});
  try {
    join(e);for(let f=1;f<=2400;f++)e.step(f/120,1/120);await e.device.queue.onSubmittedWorkDone();
    if(!e.timestamps){ctx.metric('timing','timestamp query unavailable');return;}
    const frames=240,q=e.device.createQuerySet({type:'timestamp',count:frames*2});
    const result=e.device.createBuffer({size:frames*16,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});const start=performance.now();
    for(let f=0;f<frames;f++) {
      if(f>=200){command(e,{attackClass:f%6});command(e,{fleet:1,attackClass:f%6});}
      e.step((2401+f)/120,1/120,{querySet:q,queryIndex:f*2});
    }
    ctx.metric(`encode_${count}_mean_ms`,(performance.now()-start)/frames);
    const encoder=e.device.createCommandEncoder();encoder.resolveQuerySet(q,0,frames*2,result,0);e.device.queue.submit([encoder.finish()]);
    const t=new BigUint64Array(await e.read(result)),ms=Array.from({length:frames},(_,i)=>Number(t[2*i+1]-t[2*i])/1e6);
    ctx.metric(`compute_${count}_p50_ms`,quantile(ms,.5));ctx.metric(`compute_${count}_p95_ms`,quantile(ms,.95));ctx.metric(`compute_${count}_p99_ms`,quantile(ms,.99));
    ctx.metric(`steady_${count}_p95_ms`,quantile(ms.slice(0,200),.95));ctx.metric(`mass_retarget_${count}_p95_ms`,quantile(ms.slice(200),.95));
    ctx.metric('adapter',JSON.stringify({vendor:e.adapter.info.vendor,architecture:e.adapter.info.architecture}));
    e.render();await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,`${count} mixed-class agents render without GPU errors`);
    q.destroy();result.destroy();
  }finally{e.destroy();}
}
const modes=new Map([
  ['pressure-events',validatePressureEvents],
  ['recovery-anchors',validateRecoveryAnchors],
  ['director-recovery',validateDirectorRecovery],
  ['snapshot-routes',validateSnapshotRoutes],
  ['snapshots',validateSnapshots],
  ['stalls',validateStalls],
  ['navigation-events',validateNavigationEvents],
  ['event-budget',validateEventBudget],
  ['event-frames',validateEventFrames],
  ['live-events',validateLiveEvents],
  ['clock',validateClock],
  ['lifecycle-batch',validateLifecycleBatch],['planned-lifecycle',validatePlannedLifecycle],
  ['population-lifecycle',validatePopulationLifecycle],['regrouping',validateRegrouping],['retirement',validateRetirement],['identities',validateIdentities],['population',validatePopulation],['storage',validateStorage],['packing',validatePacking],['corrections',validateCorrections],['deadlines',validateDeadlines],['progress',validateProgress],['live-routes',validateLiveRoutes],
  ['arrival',validateArrival],['routes',validateRoutes],['ephemeris',validateEphemeris],
  ['scope-budget',validateScopeBudget],['scopes',validateScopes],['runtime',validateRuntime],
]);
export async function validate(ctx,canvas) {
  const selected=modes.get(ctx.params.mode);if(selected)return selected(ctx,canvas);
  await validateVolume(ctx,canvas);
  await validateCombat(ctx,canvas);await validateSequence(ctx,canvas);await validateSequence(ctx,canvas,10000);
  projection(ctx);await validateEngagement(ctx,canvas);await validateSpacing(ctx,canvas);await freeFlight(ctx,canvas);await planetAvoidance(ctx,canvas);await capitalAvoidance(ctx,canvas);await classTargets(ctx,canvas);
  const e=await createEngine(canvas,{count:200});
  try{await authority(ctx,e);await scopes(ctx,e);await longRun(ctx,e);}finally{e.destroy();}
  await benchmark(ctx,canvas,1000);await benchmark(ctx,canvas,10000);
  ctx.metric('scope','Class-weighted density, capital clearance, target-class acquisition, gradual return, integration and trails; batched compute, render excluded.');
}
