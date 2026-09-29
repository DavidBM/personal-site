import {preparePipelines,selectShaderEntries,withGpuPreparationDiagnostics} from './pipeline-preparation.mjs';
import {prepareAdvancePipeline} from './advance-pipeline.mjs';
import {SHIP_WORDS} from './ship-layout.mjs';
import {createCompileReporter} from './compile-status.mjs';
import {pilotAdviceBytes} from './pilot-advice-layout.mjs';
import {MAX_SHIP_CAPACITY} from './ship-capacity.mjs';
import {createRetirementGpu} from './retirement-gpu.mjs';
import {createRegroupingGpu,regroupingRows} from './regrouping-gpu.mjs';
import {preparePopulationRegrouping} from './population-regrouping.mjs';
import {preparePopulationRetirement} from './population-retirement.mjs';
import {createShipHandles} from './ship-handles.mjs';
import {preparePopulationAdmission} from './population-admission.mjs';
import {createPopulationSpawner} from './population-spawn.mjs';
import {createShipStorage} from './ship-storage.mjs';
import {createSlotLayout,slotLayoutWords} from './slot-layout.mjs';
import {createPacking} from './packing.mjs';
import {routeBasisMatches} from './route-basis.mjs';
import {createEventFrame} from './event-frame.mjs';
import {EVENT_POSE_WORDS} from './event-gpu.mjs';
import {planFromProgress} from './progress-navigation.mjs';
import {attachEventRuntime} from './event-runtime.mjs';
import {createRuntimeClock,TRAIL_EMIT_HZ} from './runtime-clock.mjs';
import {createClockRebaser} from './clock-gpu.mjs';
import {createProgressSampler} from './progress.mjs';
import {createLiveRoutePlanner,routeJourney} from './live-route-planner.mjs';
import {createLocalRoutes} from './local-routes.mjs';
import {createSolarRuntime,validateSolarBodyIndex} from './solar-runtime.mjs';
import {writeKeplerSolar, compactToLab, copyKeplerCatalog} from './kepler-solar.mjs';
import {createPressureScopes} from './pressure-scopes.mjs';
import {seedNavigation} from './navigation.mjs';
import {queryWorkgroups} from './contact-queries.mjs';
import {spatialStorage} from './spatial-schedule.mjs';
import {createControl} from './control.mjs';
import {createNearbySelector,NEARBY_HULL_PAD,NEARBY_REPLACE,SCENE_NEARBY_REPLACE} from './nearby-bodies.mjs';
import {createNearbySchedule} from './nearby-schedule.mjs';
import {createGpuProfiler} from './gpu-profiler.mjs';
import { simulation, drawing, RING, STRIDE } from './shaders.mjs';
import {createDirector} from './director.mjs';
import {classOf,CLASS_BY_TYPE} from './classes.mjs';
import {defaultClassTuning,packClassTuning} from './class-tuning.mjs';
import {formationByteOffset,formationRecordBytes,formationPoseBytes,formationTailBytes} from './formation.mjs';
import {sceneRouteBytes,SCENE_ROUTE_WORDS} from './scene-route.mjs';
import {GRID_CELLS,HASH_BUCKETS} from './spacing.mjs';
export { RING, STRIDE };

function dispatchGroups(pass, groups) {
  if (groups > 0) pass.dispatchWorkgroups(groups);
}

export function capitalShipCount(director) {
  if (typeof director.capitalGroups === "function") {
    return director.capitalGroups().reduce((sum, g) => sum + (g.visual | 0), 0);
  }
  const fleetCount = director.fleetCount;
  let n = 0;
  for (let fleet = 0; fleet < fleetCount; fleet++) {
    n += director.groups[(fleet * 32 + 30) * 8 + 5] | 0;
    n += director.groups[(fleet * 32 + 31) * 8 + 5] | 0;
  }
  return n;
}

function initialPosition(type,ordinal,serial,fleet) {
  const side=fleet%2?1:-1,kind=CLASS_BY_TYPE[type];
  if(kind===5)return [side*62,32,0];
  if(kind===4)return [side*(30+ordinal%2*34),-10,Math.floor(ordinal/2)*90-45];
  const phase=serial*2.39996323,radius=8*Math.cbrt((serial*.754877666)%1);
  const y=2*((serial*.569840296)%1)-1,flat=Math.sqrt(1-y*y);
  return [side*12+radius*flat*Math.cos(phase),radius*y,radius*flat*Math.sin(phase)];
}
export function seedShips(count,director=createDirector(count),centers=null) {
  const data=new ArrayBuffer(count*STRIDE),f=new Float32Array(data),words=new Uint32Array(data);
  const live=director.population?.count??count;
  for(let i=0;i<count;i++) {
    const o=i*SHIP_WORDS;
    if(i>=live){words[o+22]=0;continue;}
    const key=director.population.keys[i],ordinal=key&255;
    const rec=director.occupied?.[key>>>8];
    const type=rec?rec.type:(key>>>8)%32,fleet=rec?rec.slot:key>>>13,groupIndex=key>>>8;
    const position=initialPosition(type,ordinal,i+1,fleet).map((x,a)=>x+(centers?.[fleet]?.[a]??0));
    f.set([...position,i*2.39996323],o);f.set([0,0,0,classOf(type).speed],o+4);
    f.set([0,(fleet%2?-1:1)*Math.SQRT1_2,0,Math.SQRT1_2],o+12);
    words.set([ordinal|(type<<8)|(director.population.cohorts[i]<<16)|(groupIndex<<18),fleet,Number(director.roster.isLive(fleet,type,ordinal)),director.population.ids[i]],o+20);f[o+40]=-1;
  }
  return data;
}

function seedSequence(data,director) {
  const f=new Float32Array(data),w=new Uint32Array(data);
  for(let i=0;i<f.length/SHIP_WORDS;i++) {
    const o=i*SHIP_WORDS,fleet=w[o+21],type=(w[o+20]>>8)&255,pending=!director.roster.isLive(fleet,type,w[o+20]&255);
    f[o]+=(pending?90:fleet?80:-24)-(fleet?12:-12);f[o+1]+=6;f[o+2]+=fleet?-8:8;
  }
}
async function checkedModules(device,cellSize,capacity,pressure,bodyCapacity,report,present) {
  const code=simulation(cellSize,capacity,pressure,bodyCapacity);
  let draw=null;
  if(present){
    const start=performance.now();draw=device.createShaderModule({label:'ship-drawing',code:drawing(cellSize,capacity,pressure,bodyCapacity)});
    const info=await draw.getCompilationInfo();
    if(info.messages.some(x=>x.type==='error'))throw Error(info.messages.map(x=>x.message).join('\n'));
    report({phase:'checking',label:'Ship drawing WGSL',durationMs:performance.now()-start});
  }
  // Production modules are specialized below. The full source is retained only
  // for explicit diagnostics; it is not submitted to the compiler at startup.
  return [code,draw];
}

const DEFAULT_VIEW=Object.freeze({follow:0,yaw:.25,pitch:.5,distance:42,alpha:1,showTrails:true,showEffects:true});

const DEFAULT_ENGINE=Object.freeze({count:1000,scenario:2,period:1800,warpEnd:8,reserveFraction:0,sequence:false,navigation:false,initialScenario:null,cellSize:4,pressurePlanet:null,fleetCount:2});
async function acquireDevice(options, lifetime) {
  if (options.device) {
    lifetime.ownsDevice = false;
    const timestamps = options.timestamps ?? options.device.features.has('timestamp-query');
    return {adapter: options.adapter ?? null, device: options.device, timestamps};
  }
  const adapter = await navigator.gpu?.requestAdapter({powerPreference: 'high-performance'});
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  const timestamps = adapter.features.has('timestamp-query');
  const requiredLimits={};
  if(adapter.limits.maxStorageBufferBindingSize>134217728)requiredLimits.maxStorageBufferBindingSize=adapter.limits.maxStorageBufferBindingSize;
  if(adapter.limits.maxBufferSize>268435456)requiredLimits.maxBufferSize=adapter.limits.maxBufferSize;
  const device = await adapter.requestDevice({requiredFeatures: timestamps ? ['timestamp-query'] : [],requiredLimits});
  lifetime.device = device;
  lifetime.ownsDevice = true;
  return {adapter, device, timestamps};
}

export async function createRuntime(options={}) {
  return createEngine(options.canvas??null,options);
}
export async function createEngine(canvas, options={}) {
  const settings={...DEFAULT_ENGINE,...options},report=createCompileReporter(options.onCompileStatus);
  const lifetime={device:null,ownsDevice:false};let solar;
  try {
    report({phase:'preparing',label:'Building ship director'});
    const director=createDirector(settings.count,{reserveFraction:settings.reserveFraction,fleetCount:settings.fleetCount,initialFleets:settings.initialFleets,identityStart:settings.identityStart,occupancy:settings.occupancy});
    const solarStart=performance.now();
    solar=await createSolarRuntime({period:settings.period,...settings.solar,onProgress:label=>report({phase:'preparing',label})});
    report({phase:'preparing',label:'Solar model and WASM',durationMs:performance.now()-solarStart});
    const runtime=await initializeEngine(canvas,settings,director,solar,lifetime,report);
    report({phase:'ready',label:'Ship runtime ready'});return runtime;
  } catch(error) {
    report({phase:'failed',label:'Ship runtime preparation failed',error:String(error)});
    if(lifetime.ownsDevice)lifetime.device?.destroy();solar?.destroy();throw error;
  }
}
async function initializeEngine(canvas,options,director,solar,lifetime,report) {
  report({phase:'preparing',label:'GPU resources'});
  let {count,scenario,period,warpEnd,sequence,navigation,initialScenario,cellSize,pressurePlanet,fleetCount}=options;
  function samplePressureBody(i,time,period) {
    validateSolarBodyIndex(i,solar.capacity);
    const pose=solar.bodyAt(i,time,period);
    if(!pose||pose.length<4)return [0,0,0,0];
    const r=pose[3];
    return [pose[0]||0,pose[1]||0,pose[2]||0,Number.isFinite(r)?r:0];
  }
  const pressure=createPressureScopes(fleetCount,{cellSize,planet:pressurePlanet,fieldCapacity:options.fieldCapacity,sampleBody:samplePressureBody});
  const {adapter,device,timestamps}=await acquireDevice(options,lifetime);
  const profiler=createGpuProfiler(device,timestamps,['Clear / recovery','Density + contacts','Hull volume','Spatial ordering','Contact cache','Contact filtering','Pursuer queries','Fleet reference','Pilot perception','Steer + separate + trails','Render']);
  const errors=[];
  const onGpuError=e=>{
    if(errors.length>=8||errors.includes(e.error.message))return;
    errors.push(e.error.message);console.error(e.error.message);
  };
  device.addEventListener('uncapturederror',onGpuError);
  const make=(size,usage)=>device.createBuffer({size,usage});
  const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
  const shipStorage=createShipStorage(device,count);
  let {history,links}=shipStorage.current.buffers;
  const agents=[shipStorage.current.buffers.a,shipStorage.current.buffers.b];
  const pilotEnabled=Boolean(director.capacity.occupancy);
  const uniform=make(pilotEnabled?160:64,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const view=make(96,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const modules=await checkedModules(device,cellSize,director.capacity,pressure.layout,solar.capacity,report,Boolean(canvas));
  report({phase:'preparing',label:'Auxiliary GPU kernels'});
  let progress;
  const clock=createRuntimeClock();
  const slotLayout=createSlotLayout(director,count);
  const orderBuffer=make(director.groups.byteLength+slotLayoutWords(director)*4,storage),density=make(pressure.bytes,storage);
  let spatial=spatialStorage(count);
  const routes=createLocalRoutes(director,solar),control=createControl(director,pressure,solar,routes,clock),eventFrame=createEventFrame(director,control,routes,clock);
  const nearbySelector=createNearbySelector(director,options.nearby);
  const nearbySchedule=createNearbySchedule(director,nearbySelector,{maxAge:1/(options.simHz??120)});
  // Record and pose pages follow the event frame. Director uploads stop at control.data.
  const formationOffset=formationByteOffset(control.data.byteLength,eventFrame.layout.bytes);
  const formationBytes=formationTailBytes(director.capacity.fleetCount);
  const formationZeros=new Uint8Array(formationBytes);
  let formPage=0;
  const warpOffsetCapacity=Math.max(1, options.warpOffsetCapacity|0);
  const sceneRouteBase=formationOffset+formationBytes;
  const sceneRouteZeros=new Uint8Array(sceneRouteBytes(director.capacity.fleetCount));
  const adviceBase=sceneRouteBase+sceneRouteZeros.byteLength;
  const adviceBytes=pilotAdviceBytes(pilotEnabled);
  const warpOffsetBase=adviceBase+adviceBytes;
  const travelOffsetBase=warpOffsetBase+warpOffsetCapacity*16;
  const controlBuffer=make(travelOffsetBase+warpOffsetCapacity*16,storage);
  const classTuning=make(192,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  device.queue.writeBuffer(classTuning,0,packClassTuning(defaultClassTuning()));
  const layout=device.createBindGroupLayout({entries:[
    {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
    // Binding 8 is read-write: the formation record and pose pages live in the director tail.
    ...[1,2,3,4,5,6,7,8].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:[1,4].includes(binding)?'read-only-storage':'storage'}})),
    {binding:9,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}}]});
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const timings=[];let compiled=0;
  const spatialEntries=['clearDensity','buildDensity','buildHullDensity','scheduleAgents','buildContactCache','buildContactMasks','buildPursuerQueries'];
  const entries=['advance','clearFormation',...(pilotEnabled?['predictPilots']:[]),'recover',...spatialEntries];
  const families=[['advance'],['clearFormation',...(pilotEnabled?['predictPilots']:[])],['recover'],spatialEntries];
  const compiledModules=new Map();let splitSource=null;
  function moduleFor(entryPoint,split=false){
    const roots=split?[entryPoint]:families.find(group=>group.includes(entryPoint));const key=(split?'split:':'')+roots.join(',');
    if(!compiledModules.has(key))compiledModules.set(key,(async()=>{
      if(split)splitSource??=simulation(cellSize,director.capacity,pressure.layout,solar.capacity,true);
      const start=performance.now(),code=selectShaderEntries(split?splitSource:modules[0],roots);
      const module=device.createShaderModule({label:`ship-${key}`,code});
      const info=await module.getCompilationInfo();
      if(info.messages.some(x=>x.type==='error'))throw Error(info.messages.filter(x=>x.type==='error').map(x=>`ship-${key}:${x.lineNum}:${x.linePos}: ${x.message}`).join('\n'));
      timings.push({label:`WGSL ${key}`,durationMs:performance.now()-start,bytes:code.length});
      return module;
    })());
    return compiledModules.get(key);
  }
  const compile=async(entryPoint,split=false)=>device.createComputePipelineAsync({
    label:`ship-${split?'split-':''}${entryPoint}`,layout:pipelineLayout,compute:{module:await moduleFor(entryPoint,split),entryPoint}});
  let eventPrepare=null;
  const jobs=entries.map(entryPoint=>({label:entryPoint,run:async()=>{
    if(entryPoint!=='advance')return compile(entryPoint);
    const result=await prepareAdvancePipeline(compile,timing=>{timings.push(timing);report({phase:'compiling',...timing});});
    eventPrepare=result.prepare;return result.pipeline;
  }}));
  jobs.push(
    {label:'Progress sampler',run:()=>createProgressSampler(device,director)},
    {label:'Population spawn',run:()=>createPopulationSpawner(device,director.capacity.groups)},
    {label:'Retirement',run:()=>createRetirementGpu(device)},
    {label:'Regrouping',run:()=>createRegroupingGpu(device)},
    {label:'Clock rebasing',run:()=>createClockRebaser(device,agents,history,links,shipStorage.current.bindings)},
    {label:'Packing',run:()=>createPacking(device,{agents,history,links,orders:orderBuffer,layout:slotLayout,count,director,eventFrame,bindings:shipStorage.current.bindings})});
  report({phase:'compiling',label:'Ship kernels',completed:0,total:jobs.length});
  const prepared=await withGpuPreparationDiagnostics(device,()=>preparePipelines(jobs,3,timing=>{
    timings.push(timing);report({phase:'compiling',...timing,completed:++compiled,total:jobs.length});
  }, progress=>report({phase:'compiling',label:'Ship kernels',...progress})));
  const pipelines=Object.fromEntries(entries.map((entry,i)=>[entry,prepared[i]]));
  const {advance:compute,clearFormation:formationClear,predictPilots:predict,recover:recovery,clearDensity:clear,
    buildDensity:populate,buildHullDensity:hullDensity,scheduleAgents:schedule,buildContactCache:cache,
    buildContactMasks:separate,buildPursuerQueries:pursuerQueries}=pipelines;
  const [sampler,spawner,retirement,regrouping,rebaser,packing]=prepared.slice(entries.length);progress=sampler;
  const capitalCount=()=>capitalShipCount(director);let hullCount=capitalCount();
  console.info('[ship-preparation] kernel timings (ms)',timings);
  let inspectionModule=null;
  function makeGroups(resources,phase) {
    const {bindings:r}=resources;
    return [[r.a,r.b],[r.b,r.a]].map(([old,next])=>device.createBindGroup({layout:compute.getBindGroupLayout(0),entries:
      [{buffer:uniform},old,next,r[phase],{buffer:orderBuffer},{buffer:density},r.heads,r.links,{buffer:controlBuffer},{buffer:classTuning}].map((resource,binding)=>({binding,resource}))}));
  }
  let groups=makeGroups(shipStorage.current,'history'),contactGroups=makeGroups(shipStorage.current,'geometry');
  const present=Boolean(canvas);
  const followCpu=[make(STRIDE*2,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),make(STRIDE*2,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ)];
  let followMap=0;
  let format=null,context=null,draw=[];
  if(present) {
    format=navigator.gpu.getPreferredCanvasFormat();
    context=canvas.getContext('webgpu');context.configure({device,format,alphaMode:'opaque',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  }
  const pipeline=async(entry,topology='triangle-list',transparent=false)=>device.createRenderPipelineAsync({layout:'auto',
    vertex:{module:modules[1],entryPoint:entry},fragment:{module:modules[1],entryPoint:'fragment',targets:[{format,
      ...(transparent?{blend:{color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}:{})}]},
    primitive:{topology,cullMode:'none'},depthStencil:{format:'depth24plus',depthWriteEnabled:!transparent,depthCompare:'less-equal'}});
  if(present)report({phase:'compiling',label:'Ship drawing pipelines',completed:0,total:8});
  if(present) draw=await Promise.all([pipeline('hull'),pipeline('trail','line-list',true),pipeline('planet'),pipeline('targetLink','line-list',true),pipeline('densityCell','line-list',true),pipeline('weapon','line-list',true),pipeline('thruster','line-list',true),pipeline('destruction','line-list',true)]);
  if(present)report({phase:'compiling',label:'Ship drawing pipelines',completed:8,total:8});
  report({phase:'preparing',label:'Ship runtime bindings and state'});
  function makeDrawGroups(resources) {
    if(!present)return [];
    const r=resources.bindings;
    return draw.map(p=>[[r.a,r.b],[r.b,r.a]].map(([state,old])=>device.createBindGroup({layout:p.getBindGroupLayout(0),entries:
      [{binding:0,resource:{buffer:view}},{binding:1,resource:state},{binding:3,resource:old},...(p===draw[1]?[{binding:2,resource:r.history}]:[]),...(p===draw[4]?[{binding:4,resource:{buffer:density}}]:[]),{binding:5,resource:r.links},{binding:8,resource:{buffer:controlBuffer}}]})));
  }
  let drawGroups=makeDrawGroups(shipStorage.current);
  function prepareStorageBindings(next) {
    const simulationGroups=makeGroups(next,'history'),geometryGroups=makeGroups(next,'geometry'),renderGroups=makeDrawGroups(next);
    const clockBindings=rebaser.prepareBindings(next.bindings),packingBindings=packing.prepareBindings(next.bindings,next.count);
    return ()=>{
      ({history,links}=next.buffers);agents[0]=next.buffers.a;agents[1]=next.buffers.b;
      groups=simulationGroups;contactGroups=geometryGroups;drawGroups=renderGroups;clockBindings();packingBindings();
    };
  }
  function resizeStorage(capacity){return closed?false:shipStorage.resize(capacity,prepareStorageBindings);}
  // Scene slots include inactive holes; raising their capacity admits no new IDs.
  // Copy both poses, history and event/correction pages wholly on the GPU.
  function growSceneCapacity(nextCount) {
    if(closed||nextCount<=count)return false;
    if(!director.capacity.occupancy)throw Error('Scene capacity requires a sparse director');
    return shipStorage.grow(nextCount,nextCount,next=>{
      const bindings=prepareStorageBindings(next);
      return ()=>{slotLayout.growCapacity(next.count);count=next.count;spatial=spatialStorage(count);bindings();};
    });
  }
  function reinforce(requests,expected={}) {
    if(closed)return {status:'closed'};
    if((expected.lifetime!==undefined&&expected.lifetime!==lifetimeToken)||(expected.populationRevision!==undefined&&expected.populationRevision!==director.population.revision))return {status:'superseded'};
    if(shipStorage.status.pending)return {status:'busy'};
    const prepared=preparePopulationAdmission(director,requests),population=prepared.director.population;
    const extension=slotLayout.prepareExtension(population),capacity=Math.min(MAX_SHIP_CAPACITY,Math.max(population.count,shipStorage.status.capacity*2));
    const changed=shipStorage.grow(population.count,capacity,next=>{
      const bindings=prepareStorageBindings(next);
      return ()=>{director.adopt(prepared.director,false);extension();count=next.count;spatial=spatialStorage(count);hullCount=capitalCount();bindings();};
    },(encoder,next)=>spawner.encode(encoder,next,prepared.batches,clock.local(now),emit,planetsEnabled?[0,1,2].map(i=>solar.bodyAt(i,now)):null));
    if(!changed)return {status:'busy'};
    uploadDirector();device.queue.writeBuffer(orderBuffer,director.groups.byteLength,slotLayout.data);refreshDensity();
    return {status:'applied',count,revision:director.population.revision,firstId:prepared.batches[0].firstId,admitted:prepared.batches.reduce((sum,b)=>sum+b.count,0)};
  }
  function retirementBasis() {return [lifetimeToken,motionRevision,director.revision,director.population.revision,slotLayout.status.revision,shipStorage.status.revision,clock.origin];}
  function populationRequestStatus(expected,pending=false) {
    if(closed)return 'closed';
    if((expected.lifetime!==undefined&&expected.lifetime!==lifetimeToken)||(expected.populationRevision!==undefined&&expected.populationRevision!==director.population.revision))return 'superseded';
    return shipStorage.status.pending||pending?'busy':null;
  }
  async function regroup(requests,expected={}) {
    const status=populationRequestStatus(expected,regroupingPending);if(status)return {status};
    const prepared=preparePopulationRegrouping(director,requests),basis=retirementBasis();regroupingPending=true;
    try {
      let rows=null;
      if(prepared.members.length) {
        const metadata=await regrouping.inspect(agents[current],links,count,clock.local(now),read);
        if(!basis.every((value,i)=>value===retirementBasis()[i]))return {status:'superseded'};
        rows=regroupingRows(director.population,slotLayout,prepared.members,metadata);if(!rows)return {status:'busy'};
      }
      return commitRegrouping(prepared,rows);
    }catch(error){if(closed)return {status:'closed'};throw error;}
    finally{regroupingPending=false;}
  }
  function commitRegrouping(prepared,rows) {
    const commit=slotLayout.prepareMembership(prepared.director.population);
    const encoder=device.createCommandEncoder();if(rows)regrouping.encode(encoder,agents[current],history,links,count,rows);
    device.queue.submit([encoder.finish()]);director.adopt(prepared.director,false);commit();motionRevision++;hullCount=capitalCount();
    uploadDirector();device.queue.writeBuffer(orderBuffer,director.groups.byteLength,slotLayout.data);refreshDensity();
    return {status:'applied',count,transferred:prepared.members.length,revision:director.population.revision};
  }
  async function reclaim() {
    if(closed)return {status:'closed'};
    if(reclaiming||shipStorage.status.pending)return {status:'busy'};
    if(count===0)return {status:'unchanged',count};
    reclaiming=true;const basis=retirementBasis(),resources=shipStorage.current;
    try {
      const metadata=await retirement.inspect(resources,clock.local(now-lastDt),read);
      if(!basis.every((value,i)=>value===retirementBasis()[i]))return {status:'superseded'};
      const plan=preparePopulationRetirement(director,slotLayout,metadata);if(!plan)return {status:'unchanged',count};
      return commitRetirement(resources,plan);
    }catch(error){if(closed)return {status:'closed'};throw error;}
    finally{reclaiming=false;}
  }
  function commitRetirement(resources,plan) {
    const population=plan.director.population,layout=slotLayout.prepareRetirement(population,plan.keep);
    const changed=shipStorage.compact(population.count,Math.max(1,population.count),next=>{
      const bindings=prepareStorageBindings(next);
      return ()=>{director.adopt(plan.director,false);layout();count=next.count;spatial=spatialStorage(count);hullCount=capitalCount();bindings();};
    },(encoder,next)=>retirement.encode(encoder,resources,next,plan,eventFrame.active));
    if(!changed)return {status:'busy'};
    uploadDirector();device.queue.writeBuffer(orderBuffer,director.groups.byteLength,slotLayout.data);refreshDensity();
    return {status:'applied',count,retired:plan.ids.length,revision:director.population.revision};
  }
  function refreshDensity() {
    input[0]=clock.local(now);input[2]=count;device.queue.writeBuffer(uniform,0,input);
    const encoder=device.createCommandEncoder();
    const clearPass=encoder.beginComputePass();clearPass.setPipeline(clear);clearPass.setBindGroup(0,groups[current]);dispatchGroups(clearPass,Math.ceil(Math.max(1,pressure.activeCount)*GRID_CELLS/128));clearPass.end();
    const pass=encoder.beginComputePass();pass.setPipeline(populate);pass.setBindGroup(0,groups[current]);dispatchGroups(pass,Math.ceil(count/128));pass.end();hullPass(encoder,null);
    device.queue.submit([encoder.finish()]);
  }
  const input=new Float32Array(pilotEnabled?40:16), camera=new Float32Array(24), initialWarpEnd=warpEnd;
  let tacticalMemoryEnabled=1;
  let densityMix=1,mergeTarget=1,densityEnabled=1,planetsEnabled=1,targetLinks=1,selectedFleet=0,followShip=null,densityVisible=false;
  let planning=null,closed=false,lifetimeToken={},batchDepth=0,ordersDirty=false,admissionTime=null;
  const shipHandles=createShipHandles(director,slotLayout,()=>lifetimeToken,()=>closed);
  let motionRevision=0,reclaiming=false,regroupingPending=false;
  let current=0, depth=null, dimensions='', now=0, phase=0, emit=true,lastDt=0,warpStart=0,warpX=-80;
  function reset(nextScenario=scenario) {
    lifetimeToken={};motionRevision++;followShip=shipHandles.capture(0);planning?.reset();packing.reset();eventFrame.disable();uploadEventFrame();clock.reset();rebaser.reset();pressure.reset();routes.reset();control.syncRoutes();
    scenario=nextScenario;now=0;phase=0;current=0;emit=true;lastDt=0;warpStart=0;warpX=-80;warpEnd=initialWarpEnd;
    const [low,high,redistribute]=clock.phases(0);input.set([0,0,count,low,period,redistribute,Number(emit),tacticalMemoryEnabled,densityMix,densityEnabled,planetsEnabled,high,1,0,0,0]);device.queue.writeBuffer(uniform,0,input);
    const seed=seedShips(count,director,options.fleetCenters);if(navigation)seedNavigation(seed,director,initialScenario??scenario,solar.bodyAt);if(sequence&&!navigation)seedSequence(seed,director);device.queue.writeBuffer(orderBuffer,0,director.groups);
    device.queue.writeBuffer(orderBuffer,director.groups.byteLength,slotLayout.data);
    invalidateNearby();solar.advance(0);refreshNearby(0);
    control.sync();control.syncPressure();control.syncSolar();device.queue.writeBuffer(controlBuffer,0,control.data);
    formPage=0;device.queue.writeBuffer(controlBuffer,formationOffset,formationZeros);
    device.queue.writeBuffer(controlBuffer,sceneRouteBase,sceneRouteZeros);
    if(adviceBytes)device.queue.writeBuffer(controlBuffer,adviceBase,new Uint8Array(adviceBytes));
    for(const b of agents) device.queue.writeBuffer(b,0,seed);
    const dead=new Float32Array(count*3*RING*4);for(let i=3;i<dead.length;i+=4) dead[i]=-1;
    device.queue.writeBuffer(history,0,dead);
    device.queue.writeBuffer(links,(spatial.linkWords+count*EVENT_POSE_WORDS)*4,new Uint32Array(count));
  }
  let keplerCatalog=null,keplerTime=0;
  const nearbyBodies=[],nearbyOptions={hullPad:NEARBY_HULL_PAD,replaceMargin:NEARBY_REPLACE,positions:null};
  function catalogBodies(time) {
    const n=keplerCatalog?keplerCatalog.length:solar.definition.bodies.length/12;
    while(nearbyBodies.length<n)nearbyBodies.push({p:[0,0,0],radius:0});
    nearbyBodies.length=n;
    for(let i=0;i<n;i++)updateNearbyBody(nearbyBodies[i],i,time);
    return nearbyBodies;
  }
  function updateNearbyBody(row,i,time) {
    if(keplerCatalog) {
      const b=keplerCatalog[i];
      row.p[0]=compactToLab(b.x??0);row.p[1]=compactToLab(b.y??0);row.p[2]=compactToLab(b.z??0);
      row.radius=compactToLab(Math.max(b.radius??0,1e-6));
    } else {
      const pose=solar.bodyAt(i,time);
      row.p[0]=pose[0];row.p[1]=pose[1];row.p[2]=pose[2];row.radius=pose[3];
    }
  }
  function keplerBodyAt(i) {
    const b=keplerCatalog[i];
    if(!b)return [0,0,0,0];
    return [compactToLab(b.x??0),compactToLab(b.y??0),compactToLab(b.z??0),compactToLab(Math.max(b.radius??0,1e-6))];
  }
  function stageKeplerBodies(bodies,time) {
    if(bodies.length>solar.capacity)throw new Error('Kepler catalog exceeds configured solar body capacity');
    if(!keplerCatalog) {
      nearbySchedule.invalidate();solar.bodyAt=keplerBodyAt;
      solar.advance=()=>{writeKeplerSolar(solar.data,keplerCatalog,now);};
      // Snapshot phase already describes the rendered instant. GPU extrapolation
      // starts at the consuming tick's clock, as it did before staging uploads.
      Object.defineProperty(solar,'time',{configurable:true,get(){return now;}});
    }
    keplerCatalog=copyKeplerCatalog(bodies,keplerCatalog);
    keplerTime=time;
  }
  function refreshNearby(time) {
    nearbyOptions.hullPad=keplerCatalog?0.05:NEARBY_HULL_PAD;
    nearbyOptions.replaceMargin=keplerCatalog?SCENE_NEARBY_REPLACE:NEARBY_REPLACE;
    nearbySchedule.ensure(time,catalogBodies(time),nearbyOptions);
  }
  function invalidateNearby() {
    nearbyOptions.positions=null;nearbySchedule.invalidate();
  }
  function prepareNearby(positions=nearbyOptions.positions) {
    if(closed)return;
    const time=keplerCatalog?keplerTime:now;
    nearbyOptions.positions=positions;
    nearbyOptions.hullPad=keplerCatalog?0.05:NEARBY_HULL_PAD;
    nearbyOptions.replaceMargin=keplerCatalog?SCENE_NEARBY_REPLACE:NEARBY_REPLACE;
    nearbySchedule.prepare(time,catalogBodies(time),nearbyOptions);
  }
  function updateFrame(time) {
    const center=sequence?solar.encounterAt(time):[0,0,0];
    solar.advance(time);refreshNearby(time);control.syncNearby();control.syncSolar();
    pressure.tick(time,period,center);control.syncPressure();
    control.frame(...center,time);
    // Nearby, pressure and solar are contiguous; publish one coherent tick tail.
    const offset=director.capacity.nearbyBase*4;
    const end=control.solarOffset*4+solar.data.byteLength;
    device.queue.writeBuffer(controlBuffer,offset,control.data,offset,end-offset);
    device.queue.writeBuffer(controlBuffer,0,control.data,0,32);
  }
  function prepareStep(time,dt,temporal) {
    prepareFrame(time,dt);
    if(!temporal&&eventFrame.active){eventFrame.disable();uploadEventFrame();}
  }
  function passWrites(querySet,index,sample,stage,edge){return querySet?{timestampWrites:{querySet,[edge]:index}}:sample?.(stage);}
  function profileSample(externalQueries){return externalQueries?null:profiler.begin();}
  function computeStage(encoder,shared,pipeline,group,workgroups,descriptor) {
    const pass=shared??encoder.beginComputePass(descriptor);
    pass.setPipeline(pipeline);pass.setBindGroup(0,group);dispatchGroups(pass,workgroups);
    if(!shared)pass.end();
  }
  function hullPass(encoder,sample,shared=null) {
    if(hullCount<=0)return;
    computeStage(encoder,shared,hullDensity,groups[current],hullCount,sample?.(2));
  }
  function orderPass(encoder,sample,shared) {
    computeStage(encoder,shared,schedule,groups[current],Math.ceil(Math.max(HASH_BUCKETS,count)/128),sample?.(3));
    computeStage(encoder,shared,cache,contactGroups[current],Math.ceil(count/128),sample?.(4));
    computeStage(encoder,shared,separate,contactGroups[current],queryWorkgroups(count),sample?.(5));
    computeStage(encoder,shared,pursuerQueries,contactGroups[current],queryWorkgroups(count),sample?.(6));
  }
  function clearAndPopulate(encoder,shared,recovering,querySet,queryIndex,sample) {
    const clearWrites=passWrites(querySet,queryIndex,sample,0,'beginningOfPassWriteIndex');
    if(recovering) {
      computeStage(encoder,shared,recovery,groups[current],Math.ceil(count/128),profileEdge(clearWrites,'beginningOfPassWriteIndex'));
      current=1-current;
    }
    computeStage(encoder,shared,clear,groups[current],Math.ceil(Math.max(1,pressure.activeCount)*GRID_CELLS/128),
      recovering?profileEdge(clearWrites,'endOfPassWriteIndex'):clearWrites);
    computeStage(encoder,shared,populate,groups[current],Math.ceil(count/128),sample?.(1));
  }
  function pilotAndMotion(encoder,shared,querySet,queryIndex,sample) {
    hullPass(encoder,sample,shared);
    if(pilotEnabled)computeStage(encoder,shared,formationClear,groups[current],director.capacity.fleetCount,sample?.(7));
    orderPass(encoder,sample,shared);
    if(!pilotEnabled)computeStage(encoder,shared,formationClear,groups[current],director.capacity.fleetCount,sample?.(7));
    if(predict)computeStage(encoder,shared,predict,groups[current],Math.ceil(count/128),sample?.(8));
    const movementWrites=passWrites(querySet,queryIndex+1,sample,9,'endOfPassWriteIndex');
    if(eventPrepare)computeStage(encoder,shared,eventPrepare,groups[current],Math.ceil(count/128),profileEdge(movementWrites,'beginningOfPassWriteIndex'));
    computeStage(encoder,shared,compute,groups[current],Math.ceil(count/128),eventPrepare?profileEdge(movementWrites,'endOfPassWriteIndex'):movementWrites);
  }
  function encodeCompute(encoder,recovering,querySet,queryIndex,sample) {
    // Separate passes preserve diagnostic timestamps; grouping is a measured option.
    const split=sample||querySet||options.separateComputePasses!==false;
    const shared=split?null:encoder.beginComputePass({label:'directed-simulation'});
    clearAndPopulate(encoder,shared,recovering,querySet,queryIndex,sample);
    pilotAndMotion(encoder,shared,querySet,queryIndex,sample);
    shared?.end();
  }
  function encodeTick(encoder,time,dt,{emitting=emit,querySet=null,queryIndex=0,temporal=false,recovering=false}={}) {
    prepareStep(time,dt,temporal);motionRevision++;
    const sample=profileSample(querySet);
    const previousTime=now;now=time;emit=emitting;lastDt=dt;updateFrame(time);
    densityMix+=(mergeTarget-densityMix)*(1-Math.exp(-dt*4));
    const [low,high,redistribute]=clock.phases(time);
    input.set([clock.local(time),dt,count,low,period,redistribute,Number(emitting),tacticalMemoryEnabled,densityMix,densityEnabled,planetsEnabled,high,
      Math.max(0,clock.trailTick(previousTime)+1),clock.trailTick(time),formPage,0]);
    formPage^=1;
    device.queue.writeBuffer(uniform,0,input);
    encodeCompute(encoder,recovering,querySet,queryIndex,sample);
    encodeFollowCopy(encoder);
  }
  function encodeFollowCopy(encoder) {
    const chosen=shipHandles.resolve(followShip);
    if(!chosen||count===0)return;
    const dest=followCpu[followMap],slot=chosen.slot*STRIDE;
    encoder.copyBufferToBuffer(agents[current],slot,dest,0,STRIDE);
    encoder.copyBufferToBuffer(agents[1-current],slot,dest,STRIDE,STRIDE);
  }
  function commitTick(){current=1-current;followMap=1-followMap;}
  function step(time,dt,options={}) {
    const encoder=device.createCommandEncoder();
    encodeTick(encoder,time,dt,options);
    device.queue.submit([encoder.finish()]);
    commitTick();
    prepareNearby();
  }
  function resize() {
    if(!present)return {width:1,height:1};
    const width=Math.max(1,Math.round(canvas.clientWidth*devicePixelRatio));
    const height=Math.max(1,Math.round(canvas.clientHeight*devicePixelRatio));
    if(dimensions!==`${width},${height}`) {
      canvas.width=width;canvas.height=height;dimensions=`${width},${height}`;depth?.destroy();
      depth=device.createTexture({size:[width,height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    }
    return {width,height};
  }
  function cameraCenter() {
    if(navigation)return solar.bodyAt(1,now).slice(0,3);
    const center=sequence?solar.encounterAt(now):[0,0,0];center[1]-=35;return center;
  }
  function renderWrites({querySet=null,queryIndex=0}){return querySet?{timestampWrites:{querySet,beginningOfPassWriteIndex:queryIndex,endOfPassWriteIndex:queryIndex+1}}:profiler.renderWrites();}
  function followCamera(weight){const chosen=shipHandles.resolve(followShip);return chosen?{weight,slot:chosen.slot}:{weight:0,slot:0};}
  function render(options={}) {
    if(!present)throw new Error('Kernel has no canvas presenter');
    const {follow,yaw,pitch,distance,alpha,showTrails,showEffects}={...DEFAULT_VIEW,...options};
    const {width,height}=resize();
    device.queue.writeBuffer(controlBuffer,director.capacity.words*4,pressure.data,0,16);
    const center=cameraCenter();
    const displayed=now-lastDt*(1-alpha),followed=followCamera(follow);
    // config.z is the explicit local simulation endpoint; reconstructing it
    // from display time and alpha can move an exact boundary by one f32 ULP.
    camera.set([center[0]+Math.sin(yaw)*Math.cos(pitch)*distance,center[1]+Math.sin(pitch)*distance,center[2]+Math.cos(yaw)*Math.cos(pitch)*distance,width/height,
      ...center,followed.weight,clock.local(displayed),count,scenario,Number(emit),period,planetsEnabled,clock.local(now),followed.slot,alpha,targetLinks,selectedFleet,densityMix,Math.cos(displayed*.1),Math.sin(displayed*.1),clock.trailTick(displayed),lastDt]);
    device.queue.writeBuffer(view,0,camera);
    const encoder=device.createCommandEncoder(); const pass=encoder.beginRenderPass({...renderWrites(options),colorAttachments:[{view:context.getCurrentTexture().createView(),
      clearValue:{r:.003,g:.008,b:.022,a:1},loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
    for(const [p,vertices,instances] of [[2,64*32*6,3],[0,36,count],[1,(RING-1)*2,count*3],[3,2,32],[4,24,GRID_CELLS],[5,2,count],[6,2,count*6],[7,2,count*12]]) {
      if((p===1&&!showTrails)||(p===4&&!densityVisible)||(p>=5&&!showEffects))continue;
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
  const separateScopes=Array(fleetCount).fill(null);
  function setPressureMerged(value) {
    mergeTarget=Number(value);
    const merged=pressure.members[0].target??pressure.create({frame:'encounter',halfExtent:cellSize*32});
    for(let fleet=0;fleet<fleetCount;fleet++) {
      if(!value&&!separateScopes[fleet])separateScopes[fleet]=pressure.create({...pressure.resolve(pressure.members[fleet].target??merged),name:`Fleet ${fleet}`});
      pressure.assign({fleet,scope:value?merged:separateScopes[fleet],revision:pressure.members[fleet].revision+1,blend:1});
    }
  }
  reset();
  const runtime={preparationTimings:timings,packing,slotLayout,shipStorage,resizeStorage,growSceneCapacity,reinforce,reclaim,regroup,inspection:{uniform,view,adviceBase,adviceBytes,drawing:modules[1],control:controlBuffer,baseControlBytes:control.data.byteLength,travelOffset:sceneRouteBase-director.capacity.fleetCount*64,fleetCount:director.capacity.fleetCount,orders:orderBuffer,get module(){return inspectionModule??=device.createShaderModule({label:'ship-diagnostics',code:modules[0]});},agents,get links(){return links;}},eventFrame,
    prepareEventFrame(start,end){prepareFrame(end,end-start);eventFrame.begin(start,end);},
    finishEventFrame(){eventFrame.finish();uploadEventFrame();},
    withEventTime(time,work){const previous=admissionTime;admissionTime=time;try{return work();}finally{admissionTime=previous;}},clock,clockGpu:rebaser,rebaseClock:()=>rebaseTime(now),solar,pressure,routes,progress,device,adapter,timestamps,get count(){return count;},errors,get history(){return history;},reset,step,render,read,pixels,profiler,director,density,batchCommands,
    commitSnapshot(prepared) {
      planning.reset();director.adopt(prepared.director);routes.reset();routes.data.set(prepared.routes.data);
      for(const [index,record] of prepared.routes.records)routes.records.set(index,record);
      pressure.commitSnapshot(prepared.pressure,prepared.at);separateScopes.fill(null);
      eventFrame.disable();uploadEventFrame();
      new Float32Array(eventFrame.data).set(prepared.placement,eventFrame.layout.placements);
      const offset=control.data.byteLength+eventFrame.layout.placements*4;
      device.queue.writeBuffer(controlBuffer,offset,prepared.placement);
      uploadDirector();step(prepared.at,0,{recovering:true});
    },
    installRoute(report){if(closed)return false;const applied=routes.install(report,routeTime());if(applied){control.syncRoutes();const offset=(control.routesOffset+applied.offset)*4;device.queue.writeBuffer(controlBuffer,offset,control.data,offset,applied.record.byteLength);}return Boolean(applied);},
    command(report){
      if(closed)return false;
      validateSolarBodyIndex(report.journey?.planet,solar.capacity);
      if(report.pressure!==undefined&&report.type!==undefined)throw new Error('Pressure orders are fleet-level');
      const pressureOrder=report.pressure===undefined?null:pressure.prepareOrder(report.fleet,report.pressure,routeTime());
      const applied=director.apply(report);
      if(applied){if(pressureOrder){pressure.applyOrder(pressureOrder);separateScopes.fill(null);}uploadDirector();}return applied;
    },
    applyCommands(commands,plans=[]) {
      if(closed)return [];
      const limit=director.capacity.groups*2;
      if(!Array.isArray(commands)||commands.length>limit+director.fleetCount||!Array.isArray(plans)||plans.length>limit)throw new Error('Directed command batch exceeds capacity');
      return batchCommands(()=>{
        for(const command of commands)runtime.command({revision:director.revision+1,...command});
        return plans.map(plan=>runtime.admitRoute(plan));
      });
    },
    admitRoute(plan,expected={}) {
      if(!routeContext(plan,expected))return false;
      validateSolarBodyIndex(plan.request.planet,solar.capacity);
      const journey=routeJourney(plan),prepared=routes.prepare(plan,routeTime(),journey);if(!prepared)return false;
      const applied=director.apply({revision:director.revision+1,fleet:plan.fleet,type:plan.type,cohort:plan.cohort??0,journey});
      if(applied){preserveContinuationEpoch(plan);routes.commit(prepared);uploadDirector();}return applied;
    },
    setTacticalMemoryEnabled(value){tacticalMemoryEnabled=Number(value);},
    setDensityVisible(value){densityVisible=value;},
    uploadClassTuning(data){if(!closed&&data){device.queue.writeBuffer(classTuning,0,data);if(pilotEnabled)input[35]++;}},
    setPilotView(matrix,origin,pixelGain,poseScale,follow=-1,selected=-1){
      if(!pilotEnabled||closed)return;
      input.set(matrix,16);input[32]=origin.x;input[33]=origin.y;input[34]=origin.z;
      input[36]=pixelGain;input[37]=poseScale;input[38]=follow;input[39]=selected;
    },
    uploadFormation(words,clearPoses=false){
      if(closed)return;
      const recordBytes=formationRecordBytes(director.capacity.fleetCount);
      if(!words||words.byteLength!==recordBytes)throw new Error('Formation record size mismatch');
      device.queue.writeBuffer(controlBuffer,formationOffset,words);
      if(clearPoses){
        // Roster changes in another fleet must not restart every navigation
        // reference. GPU identity validation fences retired/reused fleet slots.
        const poseBytes=formationPoseBytes(director.capacity.fleetCount);
        device.queue.writeBuffer(controlBuffer,formationOffset+recordBytes,formationZeros.buffer,recordBytes,poseBytes);
        const travelBytes=director.capacity.fleetCount*64;
        device.queue.writeBuffer(controlBuffer,sceneRouteBase-travelBytes,formationZeros.buffer,formationBytes-travelBytes,travelBytes);
      }
    },
    uploadSceneRoute(slot,data){
      if(closed)return;
      if(!Number.isInteger(slot)||slot<0||slot>=director.capacity.fleetCount||data.length!==SCENE_ROUTE_WORDS)throw new Error('Invalid scene route slot or record');
      device.queue.writeBuffer(controlBuffer,sceneRouteBase+slot*SCENE_ROUTE_WORDS*4,data);
    },
    copyTravelOffsets(encoder,from,to,count,scratch){
      const bytes=count*16;
      encoder.copyBufferToBuffer(controlBuffer,travelOffsetBase+from*16,scratch,0,bytes);
      encoder.copyBufferToBuffer(scratch,0,controlBuffer,travelOffsetBase+to*16,bytes);
    },
    uploadWarpOffsets(start,data,clearCapture=true){
      if(closed||!data||data.byteLength===0)return;
      if(!Number.isInteger(start)||start<0||start*16+data.byteLength>warpOffsetCapacity*16)throw new Error('Warp offset range exceeds reserved capacity');
      device.queue.writeBuffer(controlBuffer,warpOffsetBase+start*16,data);
      // A new logical occupant must not inherit a previous order capture.
      if(clearCapture)device.queue.writeBuffer(controlBuffer,travelOffsetBase+start*16,new Uint8Array(data.byteLength));
    },
    localTime(time){return clock.local(time);},
    classTuningBuffer(){return classTuning;},
    captureShip:shipHandles.capture,resolveShip:shipHandles.resolve,
    followShip(handle){const selected=shipHandles.resolve(handle);if(!selected)return false;followShip=shipHandles.capture(selected.index);return true;},
    get followedShip(){return shipHandles.resolve(followShip);},
    setFollowShip(value){const handle=shipHandles.capture(value);if(!handle)return false;followShip=handle;return true;},
    setTargetLinks(value){targetLinks=Number(value);},setSelectedFleet(value){selectedFleet=value;pressure.view(value);},
    setPlanetsEnabled(value){planetsEnabled=Number(value);},
    setPressureMerged,setDensityEnabled(value){densityEnabled=Number(value);},
    get closed(){return closed;},get lifetime(){return lifetimeToken;},
    get now(){return now;},get scenario(){return scenario;},get state(){return agents[current];},
    pendingPoseBuffer:()=>agents[1-current],
    encodeTick,commitTick,prepareNearby,invalidateNearby,get nearbyStats(){return nearbySchedule.stats;},get ownsDevice(){return lifetime.ownsDevice;},simDt:1/(options.simHz??120),
    extras:{pack:(limit)=>packing.advance(limit),spawn:reinforce,reclaim,regroup,rebase:()=>rebaseTime(now),
      compactVisuals(visuals) {
        if(typeof director.compactVisuals!=='function')return false;
        director.compactVisuals(visuals);
        slotLayout.rebind();
        hullCount=capitalCount();
        uploadDirector();
        return true;
      },
      keplerBodies(bodies,time) {
        // Stage CPU inputs only. updateFrame publishes the body table once, at
        // the consuming tick; prepareNearby runs after the previous submission.
        stageKeplerBodies(bodies??[],time??now);
      }},
    followPoseBuffer:()=>followCpu[1-followMap],
    destroy(){if(closed)return;closed=true;device.removeEventListener('uncapturederror',onGpuError);lifetimeToken={};followShip=null;planning?.reset();progress.destroy();packing.destroy();spawner.destroy();retirement.destroy();regrouping.destroy();rebaser.destroy();solar.destroy();profiler.destroy();shipStorage.destroy();for(const b of [uniform,view,orderBuffer,density,controlBuffer,classTuning,...followCpu])b.destroy();depth?.destroy();if(lifetime.ownsDevice)device.destroy();}};
  function rebaseTime(time) {
    if(closed)return false;
    const shift=clock.shiftFor(time);if(!shift)return false;
    if(count>0)rebaser.run(shift,eventFrame.active);clock.commit(shift);eventFrame.rebase(shift);uploadEventFrame();control.syncSolar();uploadDirector();
    input[0]=clock.local(now);const [low,high,redistribute]=clock.phases(now);input[3]=low;input[11]=high;input[5]=redistribute;
    input[12]=Math.max(0,input[12]-shift*TRAIL_EMIT_HZ);input[13]=clock.trailTick(now);
    device.queue.writeBuffer(uniform,0,input);return true;
  }
  function prepareFrame(time,dt) {
    clock.shiftFor(time);
    if(!Number.isFinite(dt)||dt<0||time<now)throw new Error('Invalid simulation clock');
    if(options.autoRebase!==false)rebaseTime(time);
  }
  function uploadEventFrame(){device.queue.writeBuffer(controlBuffer,control.data.byteLength,eventFrame.data,0,eventFrame.active?eventFrame.data.byteLength:16);}
  function uploadDirector(){ordersDirty=true;if(batchDepth===0)flushDirector();}
  function batchCommands(work){batchDepth++;try{return work();}finally{batchDepth--;if(ordersDirty&&batchDepth===0)flushDirector();}}
  function flushDirector(){control.sync();control.syncPressure();control.syncRoutes();device.queue.writeBuffer(orderBuffer,0,director.groups);device.queue.writeBuffer(controlBuffer,0,control.data);ordersDirty=false;}
  function sameRouteContext(expected,index) {
    return (expected.lifetime===undefined||expected.lifetime===lifetimeToken)
      &&(expected.epoch===undefined||expected.epoch===director.navigationEpochs[index]);
  }
  // A guarded phase continuation belongs to the same navigation request. A
  // newer worker replan may finish while this accepted route keeps moving.
  function preserveContinuationEpoch(plan) {
    if(plan.basis===undefined)return;
    director.navigationEpochs[(plan.fleet*32+plan.type)*2+(plan.cohort??0)]=plan.basis.epoch;
  }
  function routeTime(){return admissionTime??now;}
  function routeContext(plan,expected) {
    const time=routeTime();
    if(closed||time<plan.request.at||time>=plan.request.end)return false;
    const group=plan.fleet*32+plan.type,cohort=plan.cohort??0,index=group*2+cohort;
    if(!sameRouteContext(expected,index)||!routeBasisMatches(director,plan))return false;
    const previous=director.intents[group].journeys[cohort];
    return plan.revision>(previous?.revision??0);
  }
  planning=createLiveRoutePlanner(runtime,{workerFactory:options.routeWorkerFactory});
  runtime.readProgress=()=>progress.read(runtime);
  runtime.planFromProgress=(options,summary,context)=>planFromProgress(runtime,options,summary,context);
  runtime.planApproach=planning.request;runtime.routePlanning=planning;
  return attachEventRuntime(runtime);
}

function profileEdge(measure,edge) {
  const writes=measure?.timestampWrites;
  return writes?.[edge]===undefined?undefined:{timestampWrites:{querySet:writes.querySet,[edge]:writes[edge]}};
}
