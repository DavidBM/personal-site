import {createEngine} from './engine.mjs';
import {GRID_CELLS} from './spacing.mjs';
function report(e,fields){e.command({revision:e.director.revision+1,fleet:0,...fields});}
const start=(e,f,t)=>e.director.groups[(f*32+t)*8+4];
function distances(data,indices) {
  const f=new Float32Array(data);let minimum=Infinity,overlaps=0;
  for(let a=0;a<indices.length;a++)for(let b=a+1;b<indices.length;b++) {
    const distance=Math.hypot(...[0,1,2].map(k=>f[indices[a]*48+k]-f[indices[b]*48+k]));
    minimum=Math.min(minimum,distance);overlaps+=Number(distance<.475);
  }
  return {minimum,overlaps};
}
async function clump(ctx,e,x,enabled,pursuit=false) {
  e.reset();e.setDensityEnabled(enabled);
  const seed=new Float32Array(await e.read(e.state));
  for(let i=0;i<e.count;i++)seed.set([300+i*20,300,300],i*48);
  const indices=Array.from({length:12},(_,t)=>start(e,0,t));
  for(const i of indices)seed.set([x,0,0],i*48);
  if(pursuit){report(e,{joined:true,strategy:'pursue'});report(e,{fleet:1,joined:true,strategy:'hold'});seed.set([x+10,0,0],start(e,1,0)*48);}
  e.device.queue.writeBuffer(e.state,0,seed);
  for(let f=1;f<=600;f++)e.step(f/120,1/120);
  const result=distances(await e.read(e.state),indices);
  ctx.metric(`clump_${x}_${enabled}_${pursuit}`,JSON.stringify(result));return result;
}
async function loss(ctx,e) {
  report(e,{survivalFraction:0});e.step(6,.01);
  let data=await e.read(e.state),w=new Uint32Array(data),f=new Float32Array(data);
  ctx.assert(Array.from({length:e.count/2},(_,i)=>w[i*48+22]===0).every(Boolean),'all-lost report hides every selected-fleet hull including coincident ships');
  ctx.assert(Array.from({length:e.count/2},(_,i)=>w[(i+e.count/2)*48+22]===1&&f[(i+e.count/2)*48+16]===0).every(Boolean),'surviving opponents remain alive but lose their targets');
  const density=new Uint32Array(await e.read(e.density));
  const mass=density.slice(0,GRID_CELLS).reduce((a,b)=>a+b,0)/1024;
  ctx.assert(Math.abs(mass-1)<.01,'shared scope removes lost ships and retains its one in-bounds survivor');
  report(e,{fleet:1,survivalFraction:0});e.step(6.5,.01);data=await e.read(e.state);w=new Uint32Array(data);
  ctx.assert(w.filter((_,i)=>i%48===22).every(x=>x===0),'reporting both fleets lost leaves no live hulls');
}
async function fleetScope(ctx,canvas) {
  const e=await createEngine(canvas,{count:64});
  try {
    e.setPlanetsEnabled(false);const indices=[start(e,0,0),start(e,1,0)];
    const separation=[];
    for(const shared of [false,true]) {
      e.reset();e.setPressureMerged(shared);for(let n=1;n<=600;n++)e.step(n/120,1/120);const f=new Float32Array(await e.read(e.state));
      for(let i=0;i<e.count;i++)f.set([300+i*20,300,300],i*48);
      for(const i of indices){f.set([90,0,0],i*48);f.set([0,0,0],i*48+4);f.set([0,0,0],i*48+8);}
      e.device.queue.writeBuffer(e.state,0,f);
      for(let frame=1;frame<=360;frame++)e.step(5+frame/120,1/120);
      separation.push(distances(await e.read(e.state),indices).minimum);
    }
    ctx.assert(separation[0]<.001&&separation[1]>.475,'contact separation respects separate fleets and explicit shared pressure');
  }finally{e.destroy();}
}
async function saturatedClump(ctx,canvas) {
  const e=await createEngine(canvas,{count:1000});
  try {
    e.setPlanetsEnabled(false);const f=new Float32Array(await e.read(e.state));
    for(let i=0;i<e.count;i++)f.set([300+i*20,300,300],i*48);
    const indices=Array.from({length:128},(_,i)=>i);
    for(const i of indices){f.set([90,0,0],i*48);f.set([0,0,0],i*48+4);f.set([0,0,0],i*48+8);}
    const capitals=[start(e,0,30),start(e,0,31)];
    for(const i of capitals)f.set([-90,0,0],i*48);
    e.device.queue.writeBuffer(e.state,0,f);
    for(let frame=1;frame<=1200;frame++)e.step(frame/120,1/120);
    const data=await e.read(e.state),crowd=distances(data,indices),capital=distances(data,capitals);
    ctx.assert(crowd.minimum>.01&&crowd.overlaps<82,'overloaded contact bucket disperses 128 coincident ships without persistent exact stacks');
    ctx.assert(capital.minimum>1,'coincident capital hulls have a nonzero escape direction');
    ctx.metric('saturated_128_clump_after_10s',JSON.stringify(crowd));
    ctx.metric('capital_coincidence_separation_after_10s',capital.minimum);
  }finally{e.destroy();}
}
export async function validateSpacing(ctx,canvas) {
  const e=await createEngine(canvas,{count:64});
  try {
    e.setPlanetsEnabled(false);
    const absent=await clump(ctx,e,45,false);
    ctx.assert(absent.minimum===0,'negative control keeps identical unforced ships coincident');
    const inside=await clump(ctx,e,45,true),outside=await clump(ctx,e,90,true);
    ctx.assert(inside.overlaps===0&&outside.overlaps===0,'local GPU contacts separate coincident small ships inside and outside occupancy coverage');
    const chase=await clump(ctx,e,45,true,true);
    ctx.assert(chase.overlaps<6,'shared pursuit target cannot keep an entire coincident wing overlapped');
    await loss(ctx,e);
  }finally{e.destroy();}
  await fleetScope(ctx,canvas);await saturatedClump(ctx,canvas);
}
