import {createEngine} from './engine.mjs';
import {classOf} from './classes.mjs';
import {GRID_CELLS} from './spacing.mjs';
const fleetMass=e=>Array.from({length:e.director.fleetCount},(_,fleet)=>Array.from({length:32},(_,type)=>classOf(type).weight*e.director.groups[(fleet*32+type)*8]).reduce((a,b)=>a+b,0));
const command=(e,fleet,value)=>e.command({revision:e.director.revision+1,fleet,...value});
const assign=(e,fleet,scope,value={})=>e.pressure.assign({fleet,scope,revision:e.pressure.members[fleet].revision+1,...value});
async function fieldMass(e,scope){const w=new Uint32Array(await e.read(e.density));return w.subarray(scope.slot*GRID_CELLS,(scope.slot+1)*GRID_CELLS).reduce((a,b)=>a+b,0)/1024;}
function targetsAgree(e,data) {
  const f=new Float32Array(data),w=new Uint32Array(data);let targets=0,valid=true;
  for(let i=0;i<e.count;i++) {
    const handle=f[i*48+16];if(!handle)continue;targets++;
    valid&&=handle<=e.count&&e.director.canTarget(w[i*48+21],w[(handle-1)*48+21]);
  }
  return {targets,valid};
}
function advance(e,seconds){const start=e.now;for(let frame=1;frame<=seconds*120;frame++)e.step(start+frame/120,1/120);}
async function seedRegions(e) {
  const data=await e.read(e.state),f=new Float32Array(data),w=new Uint32Array(data);
  for(let i=0;i<e.count;i++)f[i*48]+=w[i*48+21]<2?-160:160;
  e.device.queue.writeBuffer(e.state,0,data);
  return w.filter((_,i)=>i%48===23);
}
async function membership(ctx,e,a,b) {
  const mass=fleetMass(e);
  e.step(0,0);
  ctx.assert(Math.abs(await fieldMass(e,a)-mass[0]-mass[1])<e.count*.008,'first scope contains only its two fleets, including full capital volumes');
  ctx.assert(Math.abs(await fieldMass(e,b)-mass[2]-mass[3])<e.count*.008,'second simultaneous scope has its own frame and volume mass');
  advance(e,.25);ctx.assert(targetsAgree(e,await e.read(e.state)).targets===0,'four fleets sharing pressure do not invent battles');
  for(let fleet=0;fleet<4;fleet++)command(e,fleet,{joined:true,battle:fleet<2?101:202,team:fleet%2,battleCenter:[fleet<2?-160:160,0,0]});
  advance(e,1);let result=targetsAgree(e,await e.read(e.state));
  ctx.assert(result.targets>e.count*.9&&result.valid,'two simultaneous battles select only director-permitted opponents');
  command(e,1,{battle:202,team:0,battleCenter:[160,0,0]});advance(e,.25);result=targetsAgree(e,await e.read(e.state));
  ctx.assert(result.targets>0&&result.valid,'battle reassignment invalidates old opponents independently of pressure scopes');
  command(e,3,{joined:false});advance(e,.25);result=targetsAgree(e,await e.read(e.state));
  ctx.assert(result.targets===0,'leaving the only opposing team clears all remaining targets');
}
async function transitions(ctx,e,a,b) {
  const start=e.now,history=e.history,state=await e.read(e.state),trails=await e.read(e.history);
  assign(e,1,b,{blend:2});
  ctx.assert(new Uint8Array(await e.read(e.state)).every((x,i)=>x===new Uint8Array(state)[i]),'scope assignment never uploads ship poses');
  ctx.assert(new Uint8Array(await e.read(e.history)).every((x,i)=>x===new Uint8Array(trails)[i]),'scope assignment leaves the timed trail ring intact');
  advance(e,.5);const before=e.pressure.members[1].weights.slice();assign(e,1,a,{blend:1});
  ctx.assert(e.pressure.members[1].weights.every((x,i)=>x===before[i]),'superseding an in-progress scope blend starts at current weights');
  assign(e,1,b,{at:start+1,blend:.25});assign(e,1,a,{at:start+1,blend:.25});advance(e,1);
  ctx.assert(e.pressure.members[1].weights[a.slot]===1&&e.pressure.members[1].weights[b.slot]===0,'latest future pressure command wins without an extra field');
  ctx.assert(e.history===history&&e.pressure.activeCount===2,'converged split retains trail resources and two active fields');
}
async function recycling(ctx,e,a,b) {
  const originalHistory=e.history,buffers=new Set([e.state]);let previous=a,finite=true,maxAllocated=0;
  for(let round=0;round<12;round++) {
    const next=e.pressure.create({center:[-160,0,0],halfExtent:128+round*8});
    assign(e,0,next,{blend:.1});assign(e,1,next,{blend:.1});
    e.pressure.retire(previous);advance(e,.25);buffers.add(e.state);
    const state=await e.read(e.state);finite&&=new Float32Array(state).every(Number.isFinite);
    maxAllocated=Math.max(maxAllocated,e.pressure.allocated);previous=next;
  }
  ctx.assert(finite&&maxAllocated===2&&e.history===originalHistory&&buffers.size<=2,'repeated field replacement converges to two scopes without replacing agent buffers');
  const current=e.pressure.create({center:[-160,0,0]});assign(e,0,current,{blend:0});assign(e,1,current,{blend:0});
  e.pressure.retire(previous);e.step(e.now,0);
  ctx.assert(Math.abs(await fieldMass(e,current)-fleetMass(e)[0]-fleetMass(e)[1])<e.count*.008,'recycled field slot is cleared and rebuilt from current GPU positions');
  const old=b;assign(e,2,current,{blend:0});assign(e,3,current,{blend:0});e.pressure.retire(b);e.step(e.now,0);
  let rejected=false;try{assign(e,2,old);}catch{rejected=true;}
  ctx.assert(rejected,'stale scope handles cannot bind a recycled or retired field');
  return current;
}
async function teardown(ctx,e,scope) {
  for(let fleet=0;fleet<4;fleet++){command(e,fleet,{survivalFraction:0});assign(e,fleet,null,{blend:0});}
  e.pressure.retire(scope);e.step(e.now+.01,.01);e.setDensityVisible(true);e.render({distance:600});await e.device.queue.onSubmittedWorkDone();
  ctx.assert(e.pressure.activeCount===0&&e.pressure.allocated===0&&e.errors.length===0,'empty pressure pool still clears contacts and renders safely before teardown');
}
export async function validateScopes(ctx,canvas) {
  await fleetLimits(ctx,canvas);await planetAdmission(ctx,canvas);
  const count=Number(ctx.params.count??1000),e=await createEngine(canvas,{count,fleetCount:4});
  try {
    e.setPlanetsEnabled(false);const identities=await seedRegions(e),a=e.pressure.create({center:[-160,0,0]}),b=e.pressure.create({center:[160,0,0]});
    for(let fleet=0;fleet<4;fleet++)assign(e,fleet,fleet<2?a:b,{blend:0});e.pressure.retire(e.pressure.shared);
    await membership(ctx,e,a,b);await pausedOverlay(ctx,e,a,b);await transitions(ctx,e,a,b);const final=await recycling(ctx,e,a,b);
    const words=new Uint32Array(await e.read(e.state));ctx.assert(words.filter((_,i)=>i%48===23).every((id,i)=>id===identities[i]),'fleet, battle and pressure changes preserve visual identities');
    e.pressure.view(0,final);e.step(e.now,0);e.setDensityVisible(true);e.render({distance:600});await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'four-fleet pressure and hull rendering validates');
    ctx.metric('scope_capacity',{ships:count,fleets:4,fields:e.pressure.layout.fields,cellLimit:64,fieldBytes:e.pressure.bytes});
    await teardown(ctx,e,final);
  }finally{e.destroy();}
}

async function planetAdmission(ctx,canvas) {
  const e=await createEngine(canvas,{count:128,fleetCount:4,initialFleets:[0,1,2],navigation:true,initialScenario:0,pressurePlanet:1});
  try {
    for(let fleet=0;fleet<4;fleet++)command(e,fleet,{journey:{mode:'orbit',revision:1,at:0,end:0,exit:[0,0,0],planet:1}});
    e.step(0,0);const before=await e.read(e.state),old=new Float32Array(before),history=e.history;
    ctx.assert(e.director.alive===96,'unadmitted fleet has no live representatives or density');
    command(e,3,{admit:0});
    ctx.assert(new Uint8Array(await e.read(e.state)).every((x,i)=>x===new Uint8Array(before)[i]),'later fleet admission changes masks without a CPU pose upload');
    e.step(0,0);const admitted=new Float32Array(await e.read(e.state));
    ctx.assert(e.director.alive===128&&Array.from({length:128},(_,i)=>[0,1,2].every(a=>old[i*48+a]===admitted[i*48+a])).every(Boolean),'new fleet activates in the same persistent GPU population');
    const first=new Float32Array(e.pressure.data).slice(e.pressure.layout.frames,e.pressure.layout.frames+4);advance(e,2);
    const frame=new Float32Array(e.pressure.data).slice(e.pressure.layout.frames,e.pressure.layout.frames+4);
    ctx.assert(frame[3]>4&&frame.some((x,i)=>i<3&&Math.abs(x-first[i])>0),'planetary scope moves with the planet and enlarges cells to cover all class rings');
    const state=new Float32Array(await e.read(e.state));
    ctx.assert(Array.from({length:128},(_,i)=>[0,1,2].every(a=>Math.abs(state[i*48+a]-frame[a])<frame[3]*28)).every(Boolean),'every orbital ship stays inside the planetary pressure coverage margin');
    ctx.assert(Math.abs(await fieldMass(e,e.pressure.shared)-fleetMass(e).reduce((a,b)=>a+b,0))<128*.008,'planet-centered field includes all admitted class volumes');
    ctx.assert(e.history===history&&targetsAgree(e,await e.read(e.state)).targets===0,'planetary admission keeps trails and never grants battle permission');
  }finally{e.destroy();}
}

async function fleetLimits(ctx,canvas) {
  for(const fleetCount of [1,8]) {
    const e=await createEngine(canvas,{count:fleetCount*32,fleetCount});
    try {
      e.setPlanetsEnabled(false);
      for(let fleet=0;fleet<fleetCount;fleet++)command(e,fleet,{joined:true,attackClass:5});
      advance(e,.25);const state=await e.read(e.state),result=targetsAgree(e,state);
      ctx.assert(new Float32Array(state).every(Number.isFinite)&&result.valid&&result.targets===(fleetCount===1?0:e.count),`${fleetCount}-fleet boundary uses correct packed GPU permissions`);
      e.render({distance:440});await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,`${fleetCount}-fleet GPU layout and rendering validates`);
    }finally{e.destroy();}
  }
}

async function pausedOverlay(ctx,e,a,b) {
  e.setDensityVisible(true);e.pressure.view(0,a);
  const left=new Uint8Array(await e.pixels({distance:600,showTrails:false}));
  e.pressure.view(2,b);const right=new Uint8Array(await e.pixels({distance:600,showTrails:false}));
  ctx.assert(left.some((x,i)=>x!==right[i]),'density overlay switches scopes while simulation time is paused');
  e.pressure.view(0);e.setDensityVisible(false);
}
