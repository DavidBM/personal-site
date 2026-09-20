import {radiusOf} from './classes.mjs';
import {createEngine} from './engine.mjs';
import {authorTactic} from './tactics.mjs';
const W=48;
const slot=(e,f,t)=>e.director.groups[(f*32+t)*8+4];
function report(e,fields){e.command({revision:e.director.revision+1,fleet:0,...fields});}
async function isolate(canvas,entries) {
  const e=await createEngine(canvas,{count:64});e.setPlanetsEnabled(false);
  for(let fleet=0;fleet<2;fleet++)for(let type=0;type<32;type++)if(!entries.some(x=>x[0]===fleet&&x[1]===type))report(e,{fleet,type,remaining:0});
  return e;
}
async function pursuer(ctx,canvas) {
  const e=await isolate(canvas,[[0,0],[1,0],[1,1]]);
  try {
    report(e,{joined:true,attackType:1});report(e,{fleet:1,joined:true,strategy:'hold'});report(e,{fleet:1,type:0,strategy:'pursue',attackType:0});
    const source=slot(e,0,0),threat=slot(e,1,0),target=slot(e,1,1),f=new Float32Array(await e.read(e.state));
    f.set([0,0,0],source*W);f.set([-2,1,0],threat*W);f.set([30,0,0],target*W);f[threat*W+16]=source+1;
    e.device.queue.writeBuffer(e.state,0,f);e.step(.01,.01);
    let state=new Float32Array(await e.read(e.state));
    ctx.assert(state[source*W+24]===threat+1,'GPU remembers a nearby ship pursuing this representative');
    ctx.assert(state[source*W+16]===target+1,'nearby threat does not replace the director-approved target class');
    ctx.assert(state[source*W+25]>.5&&Math.abs(state[source*W+27])===1,'threat memory has a bounded expiry and persistent passing direction');
    const before=state[source*W+24];e.step(.05,.04);state=new Float32Array(await e.read(e.state));
    ctx.assert(state[source*W+24]===before,'contact memory survives between staggered scans');
    const deflections=[];
    for(const enabled of [false,true]) {
      e.reset();e.setTacticalMemoryEnabled(enabled);e.device.queue.writeBuffer(e.state,0,f);
      for(let n=1;n<=30;n++)e.step(n/120,1/120);
      const pose=new Float32Array(await e.read(e.state));deflections.push(pose[source*W+1]);
    }
    ctx.assert(deflections[1]<deflections[0]-.015,'remembered nearby pursuer produces an actual temporary sidestep');
    report(e,{fleet:1,type:0,remaining:0});e.step(.26,.01);state=new Float32Array(await e.read(e.state));
    ctx.assert(state[source*W+24]===0&&state[source*W+16]===target+1,'dead pursuer is forgotten without abandoning the permitted target');
  }finally{e.destroy();}
}
async function crowding(ctx,canvas) {
  const e=await createEngine(canvas,{count:1000});
  try {
    e.setPlanetsEnabled(false);
    for(let fleet=0;fleet<2;fleet++)for(let type=1;type<32;type++)report(e,{fleet,type,remaining:0});
    report(e,{joined:true,attackType:0});report(e,{fleet:1,joined:true,strategy:'hold'});
    const source=slot(e,0,0),target=slot(e,1,0),number=e.director.groups[0],f=new Float32Array(await e.read(e.state));
    for(let n=0;n<number;n++){f.set([-15,n*.2,0],(source+n)*W);f[(source+n)*W+16]=target+1;f.set([15,n*.2,0],(target+n)*W);}
    e.device.queue.writeBuffer(e.state,0,f);
    for(let frame=1;frame<=360;frame++)e.step(frame/120,1/120);
    const state=new Float32Array(await e.read(e.state)),targets=Array.from({length:number},(_,n)=>state[(source+n)*W+16]);
    ctx.assert(new Set(targets).size>1&&targets.filter(x=>x===target+1).length<=8,'crowded target memory redistributes attackers within the permitted type roster');
  }finally{e.destroy();}
}
async function weapons(ctx,canvas) {
  const e=await isolate(canvas,[[0,27],[1,31]]);
  try {
    report(e,{joined:true,attackType:31});report(e,{fleet:1,joined:true,strategy:'hold'});
    const source=slot(e,0,27),target=slot(e,1,31),f=new Float32Array(await e.read(e.state));
    f.set([radiusOf(27)+radiusOf(31)+3,0,0],source*W);f.set([0,0,0],target*W);f.set([0,0,0,1],source*W+12);e.device.queue.writeBuffer(e.state,0,f);
    f[source*W+4]=-2;e.device.queue.writeBuffer(e.state,0,f);e.step(.01,.01);
    const braking=new Float32Array(await e.read(e.state));ctx.assert(braking[source*W+47]>0&&braking[source*W+43]>0,'braking acceleration drives directional thruster intensity');
    e.reset();f[source*W+4]=0;e.device.queue.writeBuffer(e.state,0,f);
    for(let n=1;n<=1200;n++)e.step(n/120,1/120);
    let state=new Float32Array(await e.read(e.state)),q=state.slice(source*W+12,source*W+16);
    const facingX=2*(q[0]*q[2]+q[3]*q[1]);
    ctx.assert(facingX<-.95,'stationary frigate faces its target independently of flight velocity');
    ctx.assert(state[source*W+41]===0,'GPU cannot fabricate weapons without director fire approval');
    report(e,{fire:true});e.step(10.01,.01);state=new Float32Array(await e.read(e.state));
    ctx.assert(state[source*W+41]>10&&state[source*W+42]>state[source*W+41],'director approval emits a bounded weapon pulse with cooldown');
    const plain=new Uint8Array(await e.pixels({showEffects:false,distance:120})),effects=new Uint8Array(await e.pixels({showEffects:true,distance:120}));
    ctx.assert(effects.some((x,i)=>x!==plain[i]),'approved weapons and directional thrust produce actual rendered pixels');
    const alive=e.director.alive;for(let n=1;n<=240;n++)e.step(10.01+n/120,1/120);
    ctx.assert(e.director.alive===alive,'weapon presentation never causes damage or casualties');
    report(e,{survivalFraction:0});e.step(12.02,.01);state=new Float32Array(await e.read(e.state));
    ctx.assert(state[source*W+40]>12&&new Uint32Array(state.buffer)[source*W+22]===0,'authoritative casualty starts an effect at the final live pose');
    e.render();await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'weapon, directional thruster and destruction pipelines validate');
  }finally{e.destroy();}
}
async function warp(ctx,canvas) {
  const e=await createEngine(canvas,{count:64});
  try {
    e.setPlanetsEnabled(false);e.setDensityEnabled(false);const initial=new Float32Array(await e.read(e.state));
    report(e,{journey:{mode:'warp',revision:1,at:0,end:2,exit:[-24,10,0]}});e.step(0,0);e.step(1,1);
    const midpoint=new Float32Array(await e.read(e.state));e.step(2,1);const exit=new Float32Array(await e.read(e.state));
    ctx.assert([0,1,2].every(a=>Math.abs(midpoint[a]-(initial[a]+exit[a])*.5)<1e-5),'battle warp follows its absolute-time straight segment through the exact deadline');
    report(e,{journey:{mode:'warp',revision:2,at:2,end:4,exit:[-60,10,0]}});const before=new Uint8Array(await e.read(e.state));e.step(2,0);
    let now=new Float32Array(await e.read(e.state));ctx.assert([0,1,2].every(a=>now[a]===exit[a]),'new warp captures GPU position without a pose jump');
    e.step(3,1);now=new Float32Array(await e.read(e.state));const retargetOrigin=now.slice(0,3);
    report(e,{journey:{mode:'warp',revision:3,at:3,end:4,exit:[-80,12,8]}});
    const uploaded=new Float32Array(await e.read(e.state));ctx.assert([0,1,2].every(a=>uploaded[a]===retargetOrigin[a]),'mid-warp director retarget never uploads live position');
    e.step(3,0);now=new Float32Array(await e.read(e.state));ctx.assert([0,1,2].every(a=>now[a]===retargetOrigin[a]),'retargeted warp recaptures current GPU origin continuously');
    e.step(4,1);const arrived=new Float32Array(await e.read(e.state));
    report(e,{journey:{mode:'warp',revision:4,at:1,end:2,exit:[-90,8,4]}});e.step(4,0);now=new Float32Array(await e.read(e.state));
    ctx.assert([0,1,2].every(a=>Math.abs(now[a]-arrived[a]-[-10,-4,-4][a])<1e-5)&&now[30]===2&&now[31]===0,'expired late warp corrects to its formation exit without extending the deadline');
    ctx.assert(before.byteLength===64*192,'extended memory layout retains one fixed state record per representative');
  }finally{e.destroy();}
}
async function branches(ctx,canvas) {
  const e=await createEngine(canvas,{count:1000});
  try {
    report(e,{joined:true,attackClass:5});report(e,{fleet:1,joined:true,strategy:'hold'});
    report(e,{type:0,tactic:authorTactic({name:'pincer',splits:2,revision:1,at:0,blend:.1})});
    const source=slot(e,0,0),f=new Float32Array(await e.read(e.state));
    f.set([-20,3,0],source*W);f.set([-20,3,0],(source+1)*W);e.device.queue.writeBuffer(e.state,0,f);e.setDensityEnabled(false);e.setPlanetsEnabled(false);
    for(let n=1;n<=60;n++)e.step(n/120,1/120);
    let state=new Float32Array(await e.read(e.state));
    ctx.assert(state[source*W+6]<0&&state[(source+1)*W+6]>0,'GPU ordinal branches steer identical starting poses toward opposite pincer wings');
    ctx.assert(state[slot(e,0,1)*W+36]===0,'per-type tactic leaves other type cohorts unaffected');
    const before=new Uint8Array(state.buffer);report(e,{type:0,tactic:authorTactic({name:'vertical-pincer',splits:8,revision:2,at:.5})});
    const uploaded=new Uint8Array(await e.read(e.state));ctx.assert(before.every((x,i)=>x===uploaded[i]),'tactic replacement changes intent without resetting poses or memory');
    e.step(.51,.01);state=new Float32Array(await e.read(e.state));ctx.assert(state[source*W+36]===2,'GPU accepts a new eight-way tactic revision');
  }finally{e.destroy();}
}
export async function validateCombat(ctx,canvas){await pursuer(ctx,canvas);await crowding(ctx,canvas);await weapons(ctx,canvas);await warp(ctx,canvas);await branches(ctx,canvas);}
