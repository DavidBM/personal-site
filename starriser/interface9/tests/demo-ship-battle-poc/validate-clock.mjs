import {createEngine} from './engine.mjs';
import {validateClockBoundaries} from './validate-clock-boundaries.mjs';
const TIMES=new Set([17,18,25,26,29,30,38,39,40,41,42]);
const TIMERS=new Set([17,18,25,26,39,41,42]);
function seeded(data) {
  const f=new Float32Array(data),w=new Uint32Array(data);
  for(let i=0;i<f.length/48;i++) {
    const at=i*48;for(const field of TIMES)f[at+field]=256+(field%3-1)*.25;
    f[at+29]=250;f[at+30]=270;f[at+31]=[-2,-1,0,1,2,3][i%6];
    f[at+40]=i%3===0?-1:255.75;f[at+41]=i%5===0?0:255.9375;w[at+22]=Number(i%4!==0);
  }
  return f;
}
function shifted(value,field) {
  if(field===40)return value>=192?value-192:-1;
  if(TIMERS.has(field))return Math.max(0,value-192);
  return value-192;
}
function compareState(before,after) {
  const a=new Float32Array(before),b=new Float32Array(after),x=new Uint32Array(before),y=new Uint32Array(after);
  return a.every((value,i)=>TIMES.has(i%48)?b[i]===shifted(value,i%48):x[i]===y[i]);
}
async function stateAudit(ctx,e) {
  e.step(256,0);const before=[];
  for(const buffer of e.inspection.agents) {
    const data=seeded(await e.read(buffer));e.device.queue.writeBuffer(buffer,0,data);before.push(data.buffer);
  }
  const trail=new Float32Array(await e.read(e.history));
  for(let i=3;i<trail.length;i+=4)trail[i]=i%7===0?-1:Math.fround(256-(Math.floor(i/4)%16)/60);
  e.device.queue.writeBuffer(e.history,0,trail);
  const pixels=new Uint8Array(await e.pixels({follow:1,alpha:.4,distance:180}));
  ctx.assert(pixels.some((x,i)=>i%4!==3&&x>25),'clock rendering comparison contains visible scene pixels');
  const lifetime=e.lifetime,summary=e.readProgress();ctx.assert(e.rebaseClock()&&e.clock.origin===192,'runtime performs one explicit GPU epoch change');
  const after=[];for(const buffer of e.inspection.agents)after.push(await e.read(buffer));
  ctx.assert(before.every((data,i)=>compareState(data,after[i])),'both pose buffers rebase every timestamp while preserving every other state bit');
  const next=new Float32Array(await e.read(e.history));
  ctx.assert(trail.every((x,i)=>i%4===3?next[i]===(x>=192?x-192:-1):next[i]===x),'trail birth times shift in place while sample positions and ring order remain unchanged');
  const image=new Uint8Array(await e.pixels({follow:1,alpha:.4,distance:180}));
  ctx.assert(pixels.every((x,i)=>x===image[i]),'follow camera, interpolation, hulls, weapon/death ages and trails render identical pixels across rebase');
  ctx.assert((await summary).status==='ready'&&e.lifetime===lifetime,'rebasing preserves pending progress reads and runtime lifetime');
  await e.clockGpu.readTiming();
  ctx.metric('clock_rebase_gpu_ms',e.clockGpu.latestMs);
  if(e.timestamps)ctx.assert(Number.isFinite(e.clockGpu.latestMs)&&e.clockGpu.latestMs>0,'clock maintenance has its own actual GPU timing sample');
  ctx.assert(!e.rebaseClock(),'repeated rebase request cannot shift the same epoch twice');
  e.reset();ctx.assert(e.clock.origin===0&&e.clock.rebases===0,'reset restores the shared GPU clock origin');
}
async function liveWarp(ctx,canvas) {
  const e=await createEngine(canvas,{count:64,autoRebase:false});
  try {
    e.setDensityEnabled(false);e.setPlanetsEnabled(false);e.step(250,0);
    for(let fleet=0;fleet<2;fleet++)e.command({revision:fleet+1,fleet,journey:{mode:'warp',revision:1,at:250,end:270,exit:[50,0,0]}});
    e.step(250,0);e.step(256,6);const mid=new Float32Array(await e.read(e.state));e.rebaseClock();e.step(260,4);
    const later=new Float32Array(await e.read(e.state));e.step(270,10);const end=new Float32Array(await e.read(e.state));
    const origin=Array.from({length:64},(_,i)=>Array.from(mid.slice(i*48+32,i*48+35)));
    ctx.assert(origin.every((p,i)=>p.every((x,k)=>Math.abs(later[i*48+k]-(x+end[i*48+k])*.5)<.0001)),'active warp retains its analytic trajectory through an epoch change');
    ctx.assert(end.filter((_,i)=>i%48===31).every(x=>x===0)&&end.filter((_,i)=>i%48===30).every(x=>x===78),'warp exits on the original scene deadline in the new GPU epoch');
    ctx.assert(e.errors.length===0,'live warp clock transition has no GPU errors');
  }finally{e.destroy();}
}
export async function validateClock(ctx,canvas) {
  const e=await createEngine(canvas,{count:Number(ctx.params.count??1000),autoRebase:false});
  try{await stateAudit(ctx,e);ctx.assert(e.errors.length===0,'clock state and drawing audit has no GPU errors');}finally{e.destroy();}
  await liveWarp(ctx,canvas);
  await validateClockBoundaries(ctx,canvas);
}
