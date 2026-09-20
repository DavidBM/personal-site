import {createEngine} from './engine.mjs';
import {approachRequest,ROUTE_WORDS} from './local-routes.mjs';
import {routeJourney} from './live-route-planner.mjs';
const command=(e,report)=>e.command({revision:e.director.revision+1,...report});
function fullTrail(data,time) {
  for(let row=0;row<data.length;row+=64) {
    const times=Array.from({length:16},(_,i)=>data[row+i*4+3]).sort((a,b)=>a-b);
    if(Math.abs(times[15]-time)>.00003||times.some((t,i)=>i>0&&Math.abs(t-times[i-1]-1/60)>.00003))return false;
  }
  return data.every(Number.isFinite);
}
async function trailCadence(ctx,e) {
  for(const rate of [30,60,120,240]) {
    e.reset();e.setDensityEnabled(false);e.setPlanetsEnabled(false);
    for(let fleet=0;fleet<2;fleet++)command(e,{fleet,journey:{mode:'warp',revision:rate,at:255.75,end:257,exit:[50,0,0]}});
    e.step(255.75,0);
    for(let frame=1;frame<=rate/2;frame++)e.step(255.75+frame/rate,1/rate);
    const trail=new Float32Array(await e.read(e.history));
    ctx.assert(e.clock.rebases===1&&fullTrail(trail,e.clock.local(e.now)),`${rate} Hz simulation preserves 60 Hz trail cadence across automatic clock rebasing`);
  }
  e.step(e.now+1/120,1/120,{emitting:false});e.step(e.now+1/120,1/120,{emitting:true});
  const trail=new Float32Array(await e.read(e.history));
  ctx.assert(trail.filter((_,i)=>i%4===3).filter(x=>x>=0).length===e.count*3,'restarting emission after rebase seeds exactly one current source per emitter');
}
async function clockLifetime(ctx,e) {
  const before=new Uint8Array(await e.read(e.state)),origin=e.clock.origin,now=e.now;
  const invalid=[[NaN,0],[-1,0],[now-1,0],[448,-1],[448,Infinity]];let rejected=0;
  for(const args of invalid){try{e.step(...args);}catch{rejected++;}}
  const after=new Uint8Array(await e.read(e.state));
  ctx.assert(rejected===invalid.length&&e.clock.origin===origin&&e.now===now&&before.every((x,i)=>x===after[i]),'invalid and backward frame clocks reject before host or GPU state changes');
  e.step(448,0);const pending=e.clockGpu.readTiming();e.reset();await pending;
  ctx.assert(e.clockGpu.latestMs===null&&e.clock.origin===0,'reset invalidates an outstanding clock timing readback');
  e.step(256,0);const closing=e.clockGpu.readTiming();e.destroy();await closing;
  ctx.assert(e.clockGpu.latestMs===null,'teardown settles outstanding clock timing without publishing retired results');
}
async function rebasedRoutes(ctx,canvas) {
  const e=await createEngine(canvas,{count:64});
  try {
    const at=100000000.125;e.step(at,0);
    const p=e.solar.bodyAt(1,at),request=approachRequest(e.solar,{type:0,at,end:at+1000,start:[p[0]+p[3]+25,p[1],p[2]]});
    const pending=e.planApproach({fleet:0,type:0,revision:1,request});
    e.step(at+192,0);
    ctx.assert((await pending).status==='admitted','actual worker result remains admissible across a GPU epoch change during planning');
    const packed=new Float32Array(await e.read(e.inspection.control)),base=e.inspection.baseControlBytes/4-e.routes.data.length;
    ctx.assert(packed[base+4]===Math.fround(request.at-e.clock.origin)&&packed[base+5]===Math.fround(request.end-e.clock.origin),'live route upload uses local GPU dates from host double precision');
    const record=e.routes.records.get(0),replacement={fleet:0,type:0,revision:2,request:record.request,result:record.result};
    command(e,{fleet:0,type:0,journey:routeJourney(replacement)});
    ctx.assert(e.installRoute(replacement),'direct route installation accepts a revision after clock rebasing');
    const next=new Float32Array(await e.read(e.inspection.control));
    ctx.assert(next[base]===2&&next[base+4]===packed[base+4]&&next[base+5]===packed[base+5]&&e.routes.data.length%ROUTE_WORDS===0,'direct route upload shares the same epoch conversion and record layout');
    ctx.assert(record.request.at===at&&e.director.intents[0].journeys[0].at===at,'GPU clock shifts never rewrite authoritative route or journey timestamps');
    e.step(e.now+1/120,1/120);
    const state=new Float32Array(await e.read(e.state));
    ctx.assert(state[28]===2&&state[31]===1&&state.every(Number.isFinite),'live GPU approach applies the revised large-epoch route');
    ctx.assert(e.errors.length===0,'large-epoch live planning and GPU admission have no validation errors');
  }finally{e.destroy();}
}
export async function validateClockBoundaries(ctx,canvas) {
  const e=await createEngine(canvas,{count:64});
  try{await trailCadence(ctx,e);await clockLifetime(ctx,e);ctx.assert(e.errors.length===0,'clock cadence and lifetime boundaries have no GPU errors');}finally{e.destroy();}
  await rebasedRoutes(ctx,canvas);
}
