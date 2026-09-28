import {seedPilotModel,SHIP_BYTES,INTENT_BYTES,FLEET_BYTES,GRID_BUCKETS,CELL_SLOTS} from './model.mjs';
import {SHARED} from './shared.wgsl.mjs';
import {PREDICT} from './predict.wgsl.mjs';
import {PHYSICAL} from './physical.wgsl.mjs';
import {DRAW} from './render.wgsl.mjs';

async function moduleFor(device,label,code,onStatus,timings){
  onStatus?.(`Checking ${label}`);const start=performance.now();
  const module=device.createShaderModule({label,code});
  const info=await module.getCompilationInfo();
  const errors=info.messages.filter(m=>m.type==='error');
  if(errors.length)throw Error(`${label}: ${errors.map(m=>`${m.lineNum}:${m.message}`).join('\n')}`);
  timings.push({stage:`${label} WGSL`,ms:performance.now()-start});return module;
}
async function pipelineFor(device,module,layout,entryPoint,onStatus,timings){
  onStatus?.(`Compiling ${entryPoint}`);const start=performance.now();
  const result=await device.createComputePipelineAsync({label:entryPoint,layout,compute:{module,entryPoint}});
  timings.push({stage:entryPoint,ms:performance.now()-start});return result;
}
function buffer(device,label,size,usage,data){
  const result=device.createBuffer({label,size,usage});if(data)device.queue.writeBuffer(result,0,data);return result;
}
function computeLayout(device){
  const entries=Array.from({length:8},(_,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===0?'uniform':binding===1||binding===5?'read-only-storage':'storage'}}));
  return device.createBindGroupLayout({entries});
}
/** GPU-resident laboratory. The CPU schedules ticks and uploads commands only. */
export async function createPilotRuntime({device,canvas=null,format='bgra8unorm',onStatus,...options}){
  const data=seedPilotModel(options),timings=[],owned=[];
  const make=(name,size,usage,initial)=>{const value=buffer(device,name,size,usage,initial);owned.push(value);return value;};
  const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
  const uniform=make('pilot inputs',80,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const states=[0,1].map(i=>make(`pilot poses ${i}`,data.ships.byteLength,storage,data.ships));
  const intents=make('pilot intent pages',data.count*INTENT_BYTES*2,storage);
  const fleets=make('pilot fleet references',data.fleets.byteLength,storage,data.fleets);
  const homes=make('pilot stable homes',data.offsets.byteLength,storage,data.offsets);
  const grid=make('pilot spatial index',GRID_BUCKETS*(CELL_SLOTS+1)*4,storage);
  const stats=make('pilot counters',64,storage);
  try{
    const binding=computeLayout(device),layout=device.createPipelineLayout({bindGroupLayouts:[binding]});
    const pipelines={};
    for(const [label,code,entries] of [['Shared fleet and index',SHARED,['clearGrid','indexShips','navigateFleets']],['Pilot',PREDICT,['predict','refreshUrgent']],['Physical flight',PHYSICAL,['integrate']]]){
      const module=await moduleFor(device,label,code,onStatus,timings);
      for(const entry of entries)pipelines[entry]=await pipelineFor(device,module,layout,entry,onStatus,timings);
    }
    const groups=states.map((old,index)=>device.createBindGroup({layout:binding,entries:[uniform,old,states[1-index],intents,fleets,homes,grid,stats].map((value,binding)=>({binding,resource:{buffer:value}}))}));
    const drawing=canvas?await createDrawing(device,canvas,format,uniform,states,onStatus,timings,make):null;
    onStatus?.('Ready');
    return runtimeState({device,data,timings,owned,uniform,states,intents,fleets,stats,pipelines,groups,drawing});
  }catch(error){for(const resource of owned)resource.destroy();throw error;}
}
async function createDrawing(device,canvas,format,uniform,states,onStatus,timings,make){
  const module=await moduleFor(device,'Darts and picking',DRAW,onStatus,timings);
  const visibility=GPUShaderStage.VERTEX|GPUShaderStage.COMPUTE;
  const entries=[{binding:0,visibility,buffer:{type:'uniform'}},...[1,2].map(binding=>({binding,visibility,buffer:{type:'read-only-storage'}})),{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}}];
  const binding=device.createBindGroupLayout({entries}),layout=device.createPipelineLayout({bindGroupLayouts:[binding]});
  const pick=make('pilot pick',4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST);
  onStatus?.('Compiling dart renderer');const start=performance.now();
  const pipeline=await device.createRenderPipelineAsync({layout,vertex:{module,entryPoint:'dart'},fragment:{module,entryPoint:'shade',targets:[{format}]},primitive:{topology:'triangle-list'}});
  timings.push({stage:'dart renderer',ms:performance.now()-start});
  const select=await pipelineFor(device,module,layout,'selectShip',onStatus,timings);
  const groups=states.map((current,index)=>device.createBindGroup({layout:binding,entries:[uniform,states[1-index],current,pick].map((value,binding)=>({binding,resource:{buffer:value}}))}));
  const context=canvas.getContext('webgpu');context.configure({device,format,alphaMode:'opaque'});
  return {context,pipeline,select,groups,pick};
}
function runtimeState(resources){
  const {device,data,timings,uniform,pipelines,groups,states,drawing}=resources;
  let current=0,tick=0,time=0,destroyed=false;
  const revisions=new Uint32Array(data.fleetCount).fill(1);
  const inputs=new Float32Array(20);
  const settings={fullRate:false,delayed:false,micro:true,selected:-1,center:[0,0,0],zoom:200,yaw:0,pitch:.75,aspect:1,height:800};
  function upload(dt,alpha=1,point=[0,0]){
    inputs.set([time,dt,data.count,tick,...settings.center,settings.zoom,settings.yaw,settings.pitch,settings.aspect,settings.height,Number(settings.fullRate),Number(settings.delayed),settings.selected,Number(settings.micro),data.fleetCount,alpha,...point]);
    device.queue.writeBuffer(uniform,0,inputs);
  }
  function step(dt=1/30,{querySet=null}={}){
    if(destroyed)throw Error('Pilot runtime destroyed');
    time+=dt;upload(dt);const encoder=device.createCommandEncoder({label:'pilot tick'});
    const shared=['shared',['clearGrid','indexShips','navigateFleets'],0],pilot=['prediction',['predict'],3],physical=['physical',['integrate'],2];
    const stages=settings.delayed?[shared,['urgent pilot',['refreshUrgent'],1],physical,pilot]:[shared,pilot,physical];
    for(const [label,entries,slot] of stages){
      const timestampWrites=querySet?{querySet,beginningOfPassWriteIndex:slot*2,endOfPassWriteIndex:slot*2+1}:undefined;
      const pass=encoder.beginComputePass({label,timestampWrites});pass.setBindGroup(0,groups[current]);
      for(const entry of entries){pass.setPipeline(pipelines[entry]);pass.dispatchWorkgroups(workgroups(entry,data));}pass.end();
    }
    device.queue.submit([encoder.finish()]);current=1-current;tick++;return tick;
  }
  function draw(alpha=1,{view=null}={}){
    if(!drawing||destroyed)return;upload(0,alpha);
    const encoder=device.createCommandEncoder();const pass=encoder.beginRenderPass({colorAttachments:[{view:view??drawing.context.getCurrentTexture().createView(),clearValue:[.015,.02,.035,1],loadOp:'clear',storeOp:'store'}]});
    pass.setPipeline(drawing.pipeline);pass.setBindGroup(0,drawing.groups[current]);pass.draw(3,data.count);
    if(settings.selected>=0)pass.draw(3,1,0,settings.selected);
    pass.end();device.queue.submit([encoder.finish()]);
  }
  async function select(point){
    if(!drawing||destroyed)return -1;upload(0,1,point);device.queue.writeBuffer(drawing.pick,0,new Uint32Array([0xffffffff]));
    const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(drawing.select);pass.setBindGroup(0,drawing.groups[current]);pass.dispatchWorkgroups(Math.ceil(data.count/128));pass.end();device.queue.submit([encoder.finish()]);
    const [value]=new Uint32Array(await readPilotBuffer(device,drawing.pick,4));return value===0xffffffff?-1:value&65535;
  }
  function order(fleet,point){
    if(destroyed||!Number.isInteger(fleet)||fleet<0||fleet>=data.fleetCount)throw Error('Unknown pilot fleet');
    if(point.length!==3||!point.every(Number.isFinite))throw Error('Order needs a finite 3D point');
    device.queue.writeBuffer(resources.fleets,fleet*FLEET_BYTES+80,new Float32Array([...point,0]));
    device.queue.writeBuffer(resources.fleets,fleet*FLEET_BYTES+72,new Uint32Array([++revisions[fleet],0]));
  }
  return {data,timings,settings,step,draw,select,order,
    get tick(){return tick;},get time(){return time;},get state(){return states[current];},get previousState(){return states[1-current];},
    fleets:resources.fleets,intents:resources.intents,stats:resources.stats,
    memoryBytes:data.count*(SHIP_BYTES*2+INTENT_BYTES*2+16)+data.fleetCount*FLEET_BYTES+GRID_BUCKETS*(CELL_SLOTS+1)*4+144,
    destroy(){destroyed=true;drawing?.context.unconfigure();for(const resource of resources.owned)resource.destroy();},
  };
}
function workgroups(entry,data){if(entry==='clearGrid')return Math.ceil(GRID_BUCKETS/128);if(entry==='navigateFleets')return Math.ceil(data.fleetCount/64);return Math.ceil(data.count/128);}
export async function readPilotBuffer(device,source,size,offset=0){
  const target=device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(source,offset,target,0,size);device.queue.submit([encoder.finish()]);await target.mapAsync(GPUMapMode.READ);return target.getMappedRange().slice(0);}finally{target.destroy();}
}
