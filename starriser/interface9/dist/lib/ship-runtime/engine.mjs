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
import {createSolarRuntime} from './solar-runtime.mjs';
import {writeKeplerSolar, compactToLab} from './kepler-solar.mjs';
import {createPressureScopes} from './pressure-scopes.mjs';
import {seedNavigation} from './navigation.mjs';
import {queryWorkgroups} from './contact-queries.mjs';
import {spatialStorage} from './spatial-schedule.mjs';
import {createControl} from './control.mjs';
import {selectNearbyBodies,NEARBY_HULL_PAD} from './nearby-bodies.mjs';
import {createGpuProfiler} from './gpu-profiler.mjs';
import { simulation, drawing, RING, STRIDE } from './shaders.mjs';
import {createDirector} from './director.mjs';
import {classOf,CLASS_BY_TYPE} from './classes.mjs';
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
    const o=i*48;
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
  for(let i=0;i<f.length/48;i++) {
    const o=i*48,fleet=w[o+21],type=(w[o+20]>>8)&255,pending=!director.roster.isLive(fleet,type,w[o+20]&255);
    f[o]+=(pending?90:fleet?80:-24)-(fleet?12:-12);f[o+1]+=6;f[o+2]+=fleet?-8:8;
  }
}
async function checkedModules(device,cellSize,capacity,pressure) {
  const modules=[device.createShaderModule({code:simulation(cellSize,capacity,pressure,true)}),device.createShaderModule({code:drawing(cellSize,capacity,pressure,true)})];
  for(const m of modules) {
    const info=await m.getCompilationInfo();
    const failed=info.messages.filter(x=>x.type==='error');
    if(failed.length) throw new Error(info.messages.map(x=>`${x.type} ${x.lineNum}: ${x.message}`).join('\n'));
  }
  return modules;
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
  const device = await adapter.requestDevice({requiredFeatures: timestamps ? ['timestamp-query'] : []});
  lifetime.device = device;
  lifetime.ownsDevice = true;
  return {adapter, device, timestamps};
}

export async function createRuntime(options={}) {
  return createEngine(options.canvas??null,options);
}
export async function createEngine(canvas, options={}) {
  const settings={...DEFAULT_ENGINE,...options};
  const director=createDirector(settings.count,{reserveFraction:settings.reserveFraction,fleetCount:settings.fleetCount,initialFleets:settings.initialFleets,identityStart:settings.identityStart,occupancy:settings.occupancy});
  const solar=await createSolarRuntime({period:settings.period,...settings.solar}),lifetime={device:null,ownsDevice:false};
  try{return await initializeEngine(canvas,settings,director,solar,lifetime);}
  catch(error){if(lifetime.ownsDevice)lifetime.device?.destroy();solar.destroy();throw error;}
}
async function initializeEngine(canvas,options,director,solar,lifetime) {
  let {count,scenario,period,warpEnd,sequence,navigation,initialScenario,cellSize,pressurePlanet,fleetCount}=options;
  function samplePressureBody(i,time,period) {
    const pose=solar.bodyAt(i,time,period);
    if(!pose||pose.length<4)return [0,0,0,0];
    const r=pose[3];
    return [pose[0]||0,pose[1]||0,pose[2]||0,Number.isFinite(r)?r:0];
  }
  const pressure=createPressureScopes(fleetCount,{cellSize,planet:pressurePlanet,fieldCapacity:options.fieldCapacity,sampleBody:samplePressureBody});
  const {adapter,device,timestamps}=await acquireDevice(options,lifetime);
  const profiler=createGpuProfiler(device,timestamps,['Clear / recovery','Density + contacts','Hull volume','Spatial ordering','Contact cache','Contact filtering','Pursuer queries','Steer + separate + trails','Render']);
  const errors=[];
  device.addEventListener('uncapturederror',e=>{errors.push(e.error.message); console.error(e.error.message);});
  const make=(size,usage)=>device.createBuffer({size,usage});
  const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
  const shipStorage=createShipStorage(device,count);
  let {history,links}=shipStorage.current.buffers;
  const agents=[shipStorage.current.buffers.a,shipStorage.current.buffers.b];
  const uniform=make(64,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const view=make(96,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const modules=await checkedModules(device,cellSize,director.capacity,pressure.layout);
  const progress=await createProgressSampler(device,director);
  const clock=createRuntimeClock();
  const slotLayout=createSlotLayout(director,count);
  const orderBuffer=make(director.groups.byteLength+slotLayoutWords(director)*4,storage),density=make(pressure.bytes,storage);
  let spatial=spatialStorage(count);
  const routes=createLocalRoutes(director,solar),control=createControl(director,pressure,solar,routes,clock),eventFrame=createEventFrame(director,control,routes,clock),controlBuffer=make(control.data.byteLength+eventFrame.layout.bytes+4096,storage);
  const spawner=await createPopulationSpawner(device,director.capacity.groups);
  const retirement=await createRetirementGpu(device);
  const regrouping=await createRegroupingGpu(device);
  const rebaser=await createClockRebaser(device,agents,history,links,shipStorage.current.bindings);
  const packing=await createPacking(device,{agents,history,links,orders:orderBuffer,layout:slotLayout,count,director,eventFrame,bindings:shipStorage.current.bindings});
  const layout=device.createBindGroupLayout({entries:[
    {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
    ...[1,2,3,4,5,6,7,8].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:[1,4,8].includes(binding)?'read-only-storage':'storage'}}))]});
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const compute=await device.createComputePipelineAsync({layout:pipelineLayout,compute:{module:modules[0],entryPoint:'advance'}});
  const recovery=await device.createComputePipelineAsync({layout:pipelineLayout,compute:{module:modules[0],entryPoint:'recover'}});
  const clear=await device.createComputePipelineAsync({layout:pipelineLayout,compute:{module:modules[0],entryPoint:'clearDensity'}});
  const populate=await device.createComputePipelineAsync({layout:pipelineLayout,compute:{module:modules[0],entryPoint:'buildDensity'}});
  const hullDensity=await device.createComputePipelineAsync({layout:pipelineLayout,compute:{module:modules[0],entryPoint:'buildHullDensity'}});
  const capitalCount=()=>capitalShipCount(director);
  let hullCount=capitalCount();
  const schedule=await device.createComputePipelineAsync({layout:pipelineLayout,compute:{module:modules[0],entryPoint:'scheduleAgents'}});
  const cache=await device.createComputePipelineAsync({layout:pipelineLayout,compute:{module:modules[0],entryPoint:'buildContactCache'}});
  const separate=await device.createComputePipelineAsync({layout:pipelineLayout,compute:{module:modules[0],entryPoint:'buildContactMasks'}});
  const pursuerQueries=await device.createComputePipelineAsync({layout:pipelineLayout,compute:{module:modules[0],entryPoint:'buildPursuerQueries'}});
  function makeGroups(resources,phase) {
    const {bindings:r}=resources;
    return [[r.a,r.b],[r.b,r.a]].map(([old,next])=>device.createBindGroup({layout:compute.getBindGroupLayout(0),entries:
      [{buffer:uniform},old,next,r[phase],{buffer:orderBuffer},{buffer:density},r.heads,r.links,{buffer:controlBuffer}].map((resource,binding)=>({binding,resource}))}));
  }
  let groups=makeGroups(shipStorage.current,'history'),contactGroups=makeGroups(shipStorage.current,'geometry');
  const present=Boolean(canvas);
  const followCpu=[make(384,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),make(384,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ)];
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
  if(present) draw=await Promise.all([pipeline('hull'),pipeline('trail','line-list',true),pipeline('planet'),pipeline('targetLink','line-list',true),pipeline('densityCell','line-list',true),pipeline('weapon','line-list',true),pipeline('thruster','line-list',true),pipeline('destruction','line-list',true)]);
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
  function reinforce(requests,expected={}) {
    if(closed)return {status:'closed'};
    if((expected.lifetime!==undefined&&expected.lifetime!==lifetimeToken)||(expected.populationRevision!==undefined&&expected.populationRevision!==director.population.revision))return {status:'superseded'};
    if(shipStorage.status.pending)return {status:'busy'};
    const prepared=preparePopulationAdmission(director,requests),population=prepared.director.population;
    const extension=slotLayout.prepareExtension(population),capacity=Math.min(10000,Math.max(population.count,shipStorage.status.capacity*2));
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
  const input=new Float32Array(16), camera=new Float32Array(24), initialWarpEnd=warpEnd;
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
    solar.advance(0);refreshNearby(0,sequence?solar.encounterAt(0):[0,0,0]);
    control.sync();control.syncPressure();control.syncSolar();device.queue.writeBuffer(controlBuffer,0,control.data);
    for(const b of agents) device.queue.writeBuffer(b,0,seed);
    const dead=new Float32Array(count*3*RING*4);for(let i=3;i<dead.length;i+=4) dead[i]=-1;
    device.queue.writeBuffer(history,0,dead);
    device.queue.writeBuffer(links,(spatial.linkWords+count*EVENT_POSE_WORDS)*4,new Uint32Array(count));
  }
  let keplerCatalog=null;
  function catalogBodies(time) {
    if(keplerCatalog?.length) {
      return keplerCatalog.map((b)=>({
        p:[compactToLab(b.x),compactToLab(b.y),compactToLab(b.z)],
        radius:compactToLab(Math.max(b.radius,1e-6)),
      }));
    }
    const n=solar.definition.bodies.length/12;
    return Array.from({length:n},(_,i)=>{const pose=solar.bodyAt(i,time);return {p:pose.slice(0,3),radius:pose[3]};});
  }
  function refreshNearby(time,center) {
    const positions=Array.from({length:director.fleetCount},(_,fleet)=>{
      const at=fleet*4;
      if(director.encounters[at+3]>0)return [director.encounters[at],director.encounters[at+1],director.encounters[at+2]];
      return null;
    });
    selectNearbyBodies(director,catalogBodies(time),{positions,hullPad:keplerCatalog?0.05:NEARBY_HULL_PAD});
  }
  function updateFrame(time) {
    const center=sequence?solar.encounterAt(time):[0,0,0];
    solar.advance(time);refreshNearby(time,center);control.syncNearby();control.syncSolar();
    device.queue.writeBuffer(controlBuffer,control.solarOffset*4,control.data,control.solarOffset*4,solar.data.byteLength);
    device.queue.writeBuffer(controlBuffer,director.capacity.nearbyBase*4,director.nearby);
    pressure.tick(time,period,center);control.syncPressure();
    control.frame(...center,time);
    device.queue.writeBuffer(controlBuffer,director.capacity.words*4,pressure.data);
    device.queue.writeBuffer(controlBuffer,0,control.data,0,32);
  }
  function prepareStep(time,dt,temporal) {
    prepareFrame(time,dt);
    if(!temporal&&eventFrame.active){eventFrame.disable();uploadEventFrame();}
  }
  function passWrites(querySet,index,sample,stage,edge){return querySet?{timestampWrites:{querySet,[edge]:index}}:sample?.(stage);}
  function profileSample(externalQueries){return externalQueries?null:profiler.begin();}
  function hullPass(encoder,sample) {
    if(hullCount<=0)return;
    const pass=encoder.beginComputePass(sample?.(2));pass.setPipeline(hullDensity);pass.setBindGroup(0,groups[current]);pass.dispatchWorkgroups(hullCount);pass.end();
  }
  function orderPass(encoder,sample) {
    const pass=encoder.beginComputePass(sample?.(3));pass.setPipeline(schedule);pass.setBindGroup(0,groups[current]);dispatchGroups(pass,Math.ceil(HASH_BUCKETS/128));pass.end();
    const contacts=encoder.beginComputePass(sample?.(4));contacts.setPipeline(cache);contacts.setBindGroup(0,contactGroups[current]);dispatchGroups(contacts,Math.ceil(count/128));contacts.end();
    const separation=encoder.beginComputePass(sample?.(5));separation.setPipeline(separate);separation.setBindGroup(0,contactGroups[current]);dispatchGroups(separation,queryWorkgroups(count));separation.end();
    const pursuers=encoder.beginComputePass(sample?.(6));pursuers.setPipeline(pursuerQueries);pursuers.setBindGroup(0,contactGroups[current]);dispatchGroups(pursuers,queryWorkgroups(count));pursuers.end();
  }
  function encodeCompute(encoder, recovering, querySet, queryIndex, sample) {
    const clearWrites=passWrites(querySet,queryIndex,sample,0,'beginningOfPassWriteIndex');
    if(recovering) {
      const recoveryPass=encoder.beginComputePass(profileEdge(clearWrites,'beginningOfPassWriteIndex'));
      recoveryPass.setPipeline(recovery);recoveryPass.setBindGroup(0,groups[current]);dispatchGroups(recoveryPass,Math.ceil(count/128));recoveryPass.end();current=1-current;
    }
    const clearPass=encoder.beginComputePass(recovering?profileEdge(clearWrites,'endOfPassWriteIndex'):clearWrites);
    clearPass.setPipeline(clear);clearPass.setBindGroup(0,groups[current]);dispatchGroups(clearPass,Math.ceil(Math.max(1,pressure.activeCount)*GRID_CELLS/128));clearPass.end();
    const gridPass=encoder.beginComputePass(sample?.(1));
    gridPass.setPipeline(populate);gridPass.setBindGroup(0,groups[current]);dispatchGroups(gridPass,Math.ceil(count/128));gridPass.end();
    hullPass(encoder,sample);
    orderPass(encoder,sample);
    const pass=encoder.beginComputePass(passWrites(querySet,queryIndex+1,sample,7,'endOfPassWriteIndex'));
    pass.setPipeline(compute);pass.setBindGroup(0,groups[current]);dispatchGroups(pass,Math.ceil(count/128));pass.end();
  }
  function encodeTick(encoder,time,dt,{emitting=emit,querySet=null,queryIndex=0,temporal=false,recovering=false}={}) {
    prepareStep(time,dt,temporal);motionRevision++;
    const sample=profileSample(querySet);
    const previousTime=now;now=time;emit=emitting;lastDt=dt;updateFrame(time);
    densityMix+=(mergeTarget-densityMix)*(1-Math.exp(-dt*4));
    const [low,high,redistribute]=clock.phases(time);
    input.set([clock.local(time),dt,count,low,period,redistribute,Number(emitting),tacticalMemoryEnabled,densityMix,densityEnabled,planetsEnabled,high,
      Math.max(0,clock.trailTick(previousTime)+1),clock.trailTick(time),0,0]);
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
  const runtime={packing,slotLayout,shipStorage,resizeStorage,reinforce,reclaim,regroup,inspection:{uniform,view,drawing:modules[1],control:controlBuffer,baseControlBytes:control.data.byteLength,orders:orderBuffer,module:modules[0],agents,get links(){return links;}},eventFrame,
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
      const journey=routeJourney(plan),prepared=routes.prepare(plan,routeTime(),journey);if(!prepared)return false;
      const applied=director.apply({revision:director.revision+1,fleet:plan.fleet,type:plan.type,cohort:plan.cohort??0,journey});
      if(applied){preserveContinuationEpoch(plan);routes.commit(prepared);uploadDirector();}return applied;
    },
    setTacticalMemoryEnabled(value){tacticalMemoryEnabled=Number(value);},
    setDensityVisible(value){densityVisible=value;},
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
    encodeTick,commitTick,get ownsDevice(){return lifetime.ownsDevice;},simDt:1/(options.simHz??120),
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
        const snapshot=(bodies??[]).map((b)=>({...b}));
        keplerCatalog=snapshot;
        solar.bodyAt=(i)=>{
          const b=snapshot[i];
          if(!b)return [0,0,0,0];
          return [compactToLab(b.x),compactToLab(b.y),compactToLab(b.z),compactToLab(Math.max(b.radius,1e-6))];
        };
        solar.advance=()=>{writeKeplerSolar(solar.data,snapshot,now);};
        // GPU body() adds (t − solar.clock)×rate. Snapshot phase is already at
        // the rendered instant; pin clock to runtime now so rings stay on the disc.
        Object.defineProperty(solar,'time',{configurable:true,get(){return now;}});
        solar.advance(now);
        refreshNearby(time??now,[0,0,0]);
        control.syncNearby();
        control.syncSolar();
        device.queue.writeBuffer(controlBuffer,control.solarOffset*4,control.data,control.solarOffset*4,solar.data.byteLength);
        device.queue.writeBuffer(controlBuffer,director.capacity.nearbyBase*4,director.nearby);
      }},
    followPoseBuffer:()=>followCpu[1-followMap],
    destroy(){if(closed)return;closed=true;lifetimeToken={};followShip=null;planning?.reset();progress.destroy();packing.destroy();spawner.destroy();retirement.destroy();regrouping.destroy();rebaser.destroy();solar.destroy();profiler.destroy();shipStorage.destroy();for(const b of [uniform,view,orderBuffer,density,controlBuffer,...followCpu])b.destroy();depth?.destroy();if(lifetime.ownsDevice)device.destroy();}};
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
