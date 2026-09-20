import {createDirectorWorker} from './worker-client.mjs';
import {createEngine} from './engine.mjs';
import {createNavigationEngine} from './navigation-engine.mjs';
import {classOf,radiusOf} from './classes.mjs';
const outcome=promise=>promise.then(value=>({value}),error=>({error}));
async function sharedPlanner(ctx,worker) {
  const response=await fetch('/dist/test-fixtures/navigation.json');if(!response.ok)throw new Error('Prepare native navigation vectors');
  const fixture=await response.json(),result=await worker.request('route',fixture);
  ctx.assert(result.columns.length===fixture.columns.length&&result.columns.every((x,i)=>Math.abs(x-fixture.columns[i])<1e-7),'real worker WASM route agrees with native route and schedule vectors');
  ctx.assert(result.columns[2]>2&&result.columns[7]<=128&&result.columns[8]<=384,'moving-planet detour uses bounded 3D nodes and swept volumes');
  const short=await worker.request('route',{...fixture,request:{...fixture.request,end:.01}});
  ctx.assert(short.columns[1]===1&&short.columns[3]===0,'shared planner explicitly reports an insufficient local travel window');
  const invalid=await outcome(worker.request('route',{...fixture,request:{...fixture.request,planet:1.5}}));
  ctx.assert(Boolean(invalid.error),'worker rejects fractional route frame indices');
}
function staticScene() {
  const body=(orbit,radius)=>[orbit,radius,orbit===0?0:100000,0,1,0,0,0,0,0,1,0];
  return {sceneEpochMs:1700000000000,definition:{version:1,epochMs:1700000000000,origin:[0,0,0],bodies:[...body(0,10),...body(1000,1),...body(2000,1)]}};
}
function journey(e,request,revision) {
  e.command({revision:e.director.revision+1,fleet:0,type:0,journey:{mode:'approach',revision,planet:request.planet,at:request.at,end:request.end,exit:[0,0,0]}});
}
async function followRoute(ctx,canvas,worker) {
  const solar=staticScene(),e=await createEngine(canvas,{count:64,solar,pressurePlanet:0});
  try {
    const c=classOf(0),request={planet:0,at:0,end:20,start:[-40,0,0],destination:[19.6,0,0],capability:[c.speed,c.acceleration,c.jerk,c.turn,radiusOf(0),2]};
    const result=await worker.request('route',{...solar,request});
    const seed=new Float32Array(await e.read(e.state));
    for(let i=0;i<64;i++)seed.set([100+i*4,100,100],i*48);seed.set(request.start,0);e.device.queue.writeBuffer(e.state,0,seed);
    const history=e.history,before=new Uint8Array(await e.read(e.state));journey(e,request,1);
    const plan={fleet:0,type:0,revision:1,request,result};
    ctx.assert(!e.installRoute({...plan,result:{...result,sceneEpochMs:result.sceneEpochMs+1}}),'runtime rejects a route planned against another scene epoch');
    ctx.assert(e.installRoute(plan),'runtime admits a matching worker route into its actual control buffer');
    const after=new Uint8Array(await e.read(e.state));
    ctx.assert(before.every((x,i)=>x===after[i])&&e.history===history,'route installation never uploads individual poses or replaces trail history');
    ctx.assert(!e.installRoute(plan),'accepted route data cannot be replaced under the same journey revision');
    let clearance=Infinity,vertical=0,arrival=null;
    for(let frame=1;frame<=7200;frame++) {
      e.step(frame/120,1/120);
      if(frame%30!==0)continue;
      const state=new Float32Array(await e.read(e.state));
      clearance=Math.min(clearance,Math.hypot(...state.slice(0,3))-10-radiusOf(0));vertical=Math.max(vertical,Math.abs(state[1]));
      if(state[35]===1){arrival={time:frame/120,position:Array.from(state.slice(0,3))};break;}
    }
    ctx.metric('local_route_probe',{clearance,vertical,arrival,nominalSeconds:result.columns[4],points:result.columns[2]});
    ctx.assert(clearance>0&&vertical>2,'actual GPU ship follows a 3D detour around the planet with hull clearance');
    ctx.assert(arrival!==null&&arrival.time<=request.end&&arrival.position[0]>10,'GPU reaches the far-side arrival region inside the declared local window');
    journey(e,{...request,at:e.now,end:e.now+60},2);
    ctx.assert(!e.installRoute(plan),'a newer journey rejects a stale completed route');
    e.setDensityVisible(true);e.render({distance:100});await e.device.queue.onSubmittedWorkDone();
    ctx.assert(e.errors.length===0,'route-backed planet, density, ships and trails render without GPU errors');
  }finally{e.destroy();}
}
async function demos(ctx,canvas) {
  for(const scenario of [1,3]) {
    const e=await createNavigationEngine(canvas,{count:64,scenario,period:30,warpEnd:2});
    try {
      if(scenario===3)e.step(2,2);
      ctx.assert(e.routes.records.size===64,`interactive scenario ${scenario} admits shared-worker approaches for every ship type`);
      const fitted=[...e.routes.records.values()].every(r=>r.result.columns[3]===1);
      ctx.assert(fitted,`interactive scenario ${scenario} uses calculated local windows for all six classes`);
      e.step(e.now+1/120,1/120);e.render({distance:440});await e.device.queue.onSubmittedWorkDone();
      ctx.assert(e.errors.length===0,`interactive scenario ${scenario} route layout renders`);
    }finally{e.destroy();}
  }
}
export async function validateRoutes(ctx,canvas) {
  const worker=createDirectorWorker();
  try{await sharedPlanner(ctx,worker);await followRoute(ctx,canvas,worker);await demos(ctx,canvas);}
  finally{worker.destroy();}
}
