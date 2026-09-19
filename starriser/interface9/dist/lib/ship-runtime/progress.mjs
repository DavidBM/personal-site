import {orbitRadius,orbitTilt} from './flight-layout.mjs';
import {radiusOf} from './classes.mjs';
import {PROGRESS_WORDS,progressWgsl} from './progress-gpu.mjs';
function packSources(engine) {
  const director=engine.director,bodies=[0,1,2].map(i=>engine.solar.bodyAt(i,engine.now));
  const data=new ArrayBuffer(director.capacity.groups*128),w=new Uint32Array(data),f=new Float32Array(data);
  for(let group=0;group<director.capacity.groups;group++) {
    const type=group%32,at=group*32,intent=director.intents[group];
    w.set([director.groups[group*8+4],director.roster.split[type],director.roster.sizeFor(Math.floor(group/32),type),0],at);
    f[at+4]=intent.journeys[0]?.revision??0;f[at+5]=(intent.journeys[1]??intent.journeys[0])?.revision??0;
    w.set(director.roster.live.subarray(group*8,group*8+8),at+8);
    for(let cohort=0;cohort<2;cohort++)writeOrbit(f,at+16+cohort*8,type,intent.journeys[cohort]??intent.journeys[0],bodies);
  }
  return data;
}
function writeOrbit(f,at,type,journey,bodies) {
  if(journey?.mode!=='orbit')return;
  const body=bodies[journey.planet],tilt=orbitTilt(type)+(journey.planeShift??0);
  f.set([...body.slice(0,3),orbitRadius(type,body[3]),Math.sin(tilt),Math.cos(tilt),Math.max(3,radiusOf(type)*1.5),1],at);
}
function decode(buffer,snapshot,director) {
  const f=new Float32Array(buffer),w=new Uint32Array(buffer),groups=[];
  for(let index=0;index<snapshot.epochs.length*2;index++) {
    const at=index*PROGRESS_WORDS,group=Math.floor(index/2),live=w[at+20];
    const vector=offset=>Array.from(f.subarray(at+offset,at+offset+3));
    groups.push({fleet:Math.floor(group/32),type:group%32,cohort:index%2,stale:director.groupEpochs[group]!==snapshot.epochs[group],
      epoch:snapshot.epochs[group],navigationEpoch:snapshot.navigation[index],live,corrected:f[at+11],arrived:w[at+21],warp:w[at+22],unapplied:w[at+23],
      minimum:live?vector(0):null,maximum:live?vector(4):null,meanPosition:live?vector(8).map(x=>x/live):null,
      meanVelocity:live?vector(12).map(x=>x/live):null,anchor:live?vector(16):null,maximumSpeed:f[at+3],maximumAcceleration:f[at+7]});
  }
  return {status:'ready',time:snapshot.time,lifetime:snapshot.lifetime,groups};
}
export async function createProgressSampler(device,director) {
  const rows=director.capacity.groups*2,bytes=rows*PROGRESS_WORDS*4;
  const module=device.createShaderModule({code:progressWgsl(director.capacity)});
  const info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw new Error(info.messages.map(m=>m.message).join('\n'));
  const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'summarize'}});
  const metadata=device.createBuffer({size:director.capacity.groups*128,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const output=device.createBuffer({size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
  const staging=device.createBuffer({size:bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  let pending=null,closed=false,reads=0;
  async function consume(engine,snapshot) {
    try {
      await staging.mapAsync(GPUMapMode.READ);
      if(closed||engine.closed)return {status:'closed',groups:[]};
      if(engine.lifetime!==snapshot.lifetime)return {status:'superseded',groups:[]};
      return decode(staging.getMappedRange(),snapshot,director);
    }catch(error){if(closed||engine.closed)return {status:'closed',groups:[]};throw error;}
    finally{if(staging.mapState==='mapped')staging.unmap();pending=null;}
  }
  function read(engine) {
    if(closed||engine.closed)return Promise.resolve({status:'closed',groups:[]});
    if(pending)return pending;
    const snapshot={lifetime:engine.lifetime,time:engine.now,epochs:director.groupEpochs.slice(),navigation:director.navigationEpochs.slice()};
    device.queue.writeBuffer(metadata,0,packSources(engine));
    const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[engine.state,metadata,output,engine.inspection.orders].map((buffer,binding)=>({binding,resource:{buffer}}))});
    const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();
    pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(rows);pass.end();
    encoder.copyBufferToBuffer(output,0,staging,0,bytes);device.queue.submit([encoder.finish()]);reads++;
    pending=consume(engine,snapshot);return pending;
  }
  return {read,get stats(){return {reads,inFlight:Number(pending!==null),readbackBytes:bytes,resourceBytes:bytes*2+metadata.size};},
    destroy(){if(closed)return;closed=true;metadata.destroy();output.destroy();staging.destroy();}};
}
