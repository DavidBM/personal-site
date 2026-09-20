import {createEngine} from './engine.mjs';
import {createSequenceEngine} from './sequence-engine.mjs';
const poses=data=>Array.from({length:data.length/48},(_,i)=>Array.from(data.slice(i*48,i*48+3)));
const near=(a,b)=>a.every((p,i)=>p.every((x,k)=>Math.abs(x-b[i][k])<.002));
function warp(e,revision,at,end,exit) {
  for(let fleet=0;fleet<2;fleet++)e.command({revision:e.director.revision+1,fleet,journey:{mode:'warp',revision,at,end,exit}});
}
async function lateWarp(ctx,canvas) {
  const e=await createEngine(canvas,{count:Number(ctx.params.count??1000)});
  try {
    e.setPlanetsEnabled(false);e.setDensityEnabled(false);
    e.step(2.9,0);const initial=new Float32Array(await e.read(e.state));
    warp(e,1,1,3,[0,0,0]);e.step(2.9,0);
    const activated=new Float32Array(await e.read(e.state));
    ctx.assert(near(poses(initial),poses(activated)),'late pre-deadline warp starts at the current GPU pose');
    ctx.assert(activated.filter((_,i)=>i%48===30).every(t=>t===3),'late warp retains its exact director deadline');
    e.step(3,.1);const arrived=new Float32Array(await e.read(e.state));
    ctx.assert(arrived.filter((_,i)=>i%48===31).every(mode=>mode===0),'shortened warp ends at the deadline without a visual grace period');
    // Populate ordinary trail history before the expired-command correction.
    for(let i=1;i<=24;i++)e.step(3+i/120,1/120);
    warp(e,2,1,2,[60,0,0]);const before=new Uint8Array(await e.read(e.state));
    ctx.assert(before.every((x,i)=>x===new Uint8Array(arrived.buffer)[i])===false,'negative control includes ordinary movement before expired warp');
    e.step(e.now,0);const corrected=new Float32Array(await e.read(e.state));
    ctx.assert(near(poses(corrected),poses(arrived).map(p=>[p[0]+60,p[1],p[2]])),'expired warp corrects directly to its GPU formation endpoint at admission');
    ctx.assert(corrected.filter((_,i)=>i%48===30).every(t=>t===2)&&corrected.filter((_,i)=>i%48===31).every(mode=>mode===0),'expired warp cannot prolong travel past an already elapsed deadline');
    const history=new Float32Array(await e.read(e.history)),births=history.filter((_,i)=>i%4===3&&history[i]>=0);
    ctx.assert(births.length===e.count*3&&births.every(t=>Math.abs(t-e.now)<1e-5),'exceptional warp correction restarts emitter history without a long connecting trail');
    const a=new Uint8Array(await e.pixels({alpha:0,distance:180,showTrails:false,showEffects:false}));
    const b=new Uint8Array(await e.pixels({alpha:1,distance:180,showTrails:false,showEffects:false}));
    ctx.assert(a.every((x,i)=>x===b[i]),'render interpolation never blends across the exceptional warp correction');
    e.step(e.now+1/120,1/120);ctx.assert(new Float32Array(await e.read(e.state)).every(Number.isFinite),'ordinary motion resumes with finite state after correction');
    ctx.assert(e.errors.length===0,'deadline correction and interpolation render without GPU errors');
  }finally{e.destroy();}
}
async function stalledSequence(ctx,canvas) {
  const e=await createSequenceEngine(canvas,{count:1000});
  try {
    e.step(0,0);e.step(30,0);
    ctx.assert(e.sequence.history.filter(x=>x.id!=='approach').every(x=>x.appliedAt===30),'missed event boundaries admit at the current clock after a zero-step time jump');
    const data=new Float32Array(await e.read(e.state)),words=new Uint32Array(data.buffer);
    const deaths=Array.from({length:e.count},(_,i)=>i).filter(i=>words[i*48+22]===0);
    ctx.assert(deaths.length>0&&deaths.every(i=>data[i*48+40]===30),'late casualty effects use admission time without rewinding GPU clocks');
    ctx.assert(data.every(Number.isFinite)&&e.now===30,'overdue replay preserves a finite monotonic runtime clock');
    e.step(30,0);ctx.assert(e.sequence.history.length===11,'same-time replay does not reapply events');
    let rejected=false;try{e.step(29,0);}catch{rejected=true;}ctx.assert(rejected&&e.now===30,'sequence rejects backward time before submitting GPU work');
    ctx.assert(e.errors.length===0,'overdue event replay has no GPU validation errors');
  }finally{e.destroy();}
}
async function exactBoundaries(ctx,canvas) {
  const e=await createSequenceEngine(canvas,{count:1000});
  try {
    e.step(1.999,0);const before=new Float32Array(await e.read(e.state));
    ctx.assert(before.slice(e.count/2*48).filter((_,i)=>i%48===28).every(x=>x===0),'future warp intent remains unapplied before its event boundary');
    e.step(2.001,.002);const warpState=new Float32Array(await e.read(e.state));
    ctx.assert(warpState.slice(e.count/2*48).filter((_,i)=>i%48===29).some(x=>x===2)&&e.sequence.history.find(x=>x.id==='arrival').appliedAt===2,'straddling step captures warp origin at the exact event time');
    e.step(11.997,0);ctx.assert(e.director.groups[3]===0&&e.director.groups[32*8+3]===0,'approaches cannot start battle before the director event');
    e.step(12.003,.006);const data=new Float32Array(await e.read(e.state)),w=new Uint32Array(data.buffer);
    const active=Array.from({length:e.count},(_,i)=>i).filter(i=>w[i*48+22]===1);
    ctx.assert(e.sequence.history.find(x=>x.id==='battle').appliedAt===12&&active.every(i=>data[i*48+29]===12),'battle mode is applied at its exact boundary inside a straddling step');
    ctx.assert(e.errors.length===0,'exact warp and battle boundaries produce no GPU errors');
  }finally{e.destroy();}
}
export async function validateDeadlines(ctx,canvas){await lateWarp(ctx,canvas);await stalledSequence(ctx,canvas);await exactBoundaries(ctx,canvas);}
