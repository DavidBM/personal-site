import {createEngine} from './engine.mjs';
import {snapshot} from './validate-snapshots.mjs';
import {createDirectorWorker} from './worker-client.mjs';
import {classOf,radiusOf} from './classes.mjs';
function scene() {
  const body=(orbit,radius)=>[orbit,radius,orbit===0?0:100000,0,1,0,0,0,0,0,1,0];
  return {sceneEpochMs:1700000000000,definition:{version:1,epochMs:1700000000000,origin:[0,0,0],bodies:[...body(0,10),...body(1000,1),...body(2000,1)]}};
}
function route(e,revision,at) {
  const c=classOf(0);
  return {fleet:0,type:0,cohort:0,revision,request:{planet:0,at,end:1000,start:[-35,0,0],destination:[19.6,0,0],capability:[c.speed,c.acceleration,c.jerk,c.turn,radiusOf(0),2]}};
}
function gate(worker) {
  let release,reply;const held=new Promise(resolve=>{release=resolve;});
  return {request(kind,input,options){reply=worker.request(kind,input,options);return Promise.all([reply,held]).then(([result])=>result);},
    ready:()=>reply,destroy(){release();},get status(){return worker.status;}};
}
async function displayReader(e) {
  const pipeline=await e.device.createComputePipelineAsync({layout:'auto',compute:{module:e.inspection.drawing,entryPoint:'inspectDisplay'}});
  const output=e.device.createBuffer({size:e.count*192,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
  return {async read(alpha) {
    e.render({alpha,distance:100});
    const previous=e.inspection.agents.find(buffer=>buffer!==e.state);
    const entries=[[0,e.inspection.view],[1,e.state],[3,previous],[5,e.inspection.links],[6,output],[8,e.inspection.control]].map(([binding,buffer])=>({binding,resource:{buffer}}));
    const bind=e.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries}),encoder=e.device.createCommandEncoder(),pass=encoder.beginComputePass();
    pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(e.count/128));pass.end();e.device.queue.submit([encoder.finish()]);
    return new Float32Array(await e.read(output));
  },destroy(){output.destroy();}};
}
async function recoverRoute(ctx,e,worker,held) {
  const pending=e.planApproach(route(e,2,0));await held.ready();
  const plan=route(e,1,100);plan.result=await worker.request('route',{...scene(),request:plan.request});
  const source=e.director.fork();source.apply({revision:1,fleet:0,type:0,journey:{mode:'approach',revision:1,at:100,end:1000,planet:0,exit:[0,0,0]}});
  const value=snapshot(e,source);value.routes=[plan];value.pressure={scopes:[{planet:0}],members:[0,0]};
  for(const placement of value.placements)placement.position=[-35,0,0];
  const progress=e.readProgress();e.installSnapshot(value,e.lifetime);
  ctx.assert((await pending).status==='superseded','snapshot revokes a real completed worker result that was still waiting for admission');
  ctx.assert((await progress).groups.every(group=>group.stale),'in-flight GPU progress cannot be reused after snapshot placement');
  ctx.assert(e.routes.records.size===1&&e.director.intents[0].journeys[0].revision===1,'snapshot restores the active validated worker route without admitting stale pending work');
  const f=new Float32Array(await e.read(e.state));
  ctx.assert(f[28]===1&&f[31]===1&&f[30]===e.clock.local(1000),'GPU resumes the current local approach with its original route revision and deadline');
  await visibleRecovery(ctx,e);
  const probe=await displayReader(e);
  try {
    const shown=await probe.read(0);
    ctx.assert([0,1,2,12,13,14,15].every(i=>shown[i]===f[i]),'zero-duration recovery renders the recovered pose even at interpolation zero');
    const pixels=await e.pixels({alpha:0,distance:100});
    e.step(512,0);const before=await e.pixels({alpha:0,distance:100});
    ctx.assert(pixels.byteLength===before.byteLength&&e.clock.rebases===2,'recovered scene crosses another GPU epoch with its correction marker');
  }finally{probe.destroy();}
  const at=e.now;for(let frame=1;frame<=120;frame++)e.step(at+frame/120,1/120);
  const after=new Float32Array(await e.read(e.state));ctx.assert(after.every(Number.isFinite)&&Math.hypot(...[0,1,2].map(a=>after[a]-f[a]))>1,'restored local route continues physical motion after recovery');
  e.render({distance:100});await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'recovered route and subsequent motion render without GPU errors');
}
export async function validateSnapshotRoutes(ctx,canvas) {
  const worker=createDirectorWorker(),held=gate(worker),e=await createEngine(canvas,{count:64,solar:scene(),routeWorkerFactory:()=>held});
  try{await recoverRoute(ctx,e,worker,held);}finally{e.destroy();worker.destroy();}
}

async function visibleRecovery(ctx,e) {
  const initial=new Float32Array(await e.read(e.state)),view={alpha:0,distance:100,showTrails:false,showEffects:false};
  const hidden=new Uint8Array(await e.pixels(view)),copy=initial.slice();
  try {
    for(let i=0;i<e.count;i++)copy[i*48+39]-=.175;
    e.device.queue.writeBuffer(e.state,0,copy);const middle=new Uint8Array(await e.pixels(view));
    for(let i=0;i<e.count;i++)copy[i*48+39]=0;
    e.device.queue.writeBuffer(e.state,0,copy);const visible=new Uint8Array(await e.pixels(view));
    const changed=image=>image.reduce((n,value,i)=>n+Number(value!==hidden[i]),0),partial=changed(middle),complete=changed(visible);
    ctx.assert(complete>50&&partial>0&&partial<complete,'actual hull pixels reappear progressively through the bounded recovery dither');
    ctx.metric('recovery_pixels',{partialChangedBytes:partial,fullyVisibleChangedBytes:complete});
  }finally{e.device.queue.writeBuffer(e.state,0,initial);}
}
