import {createEngine} from './engine.mjs';
import {classOf,radiusOf} from './classes.mjs';
const slot=(e,f,t)=>e.director.groups[(f*32+t)*8+4];
function report(e,fields){e.command({revision:e.director.revision+1,fleet:0,...fields});}
async function pair(canvas,type,side=1) {
  const e=await createEngine(canvas,{count:64});e.setPlanetsEnabled(false);
  for(let f=0;f<2;f++)for(let t=0;t<32;t++)if(t!==(f===0?type:31))report(e,{fleet:f,type:t,remaining:0});
  report(e,{joined:true,attackType:31});report(e,{fleet:1,joined:true,strategy:'hold'});
  const source=slot(e,0,type),target=slot(e,1,31),kind=classOf(type);
  const radius=radiusOf(type)+radiusOf(31)+(type<27?1.25+kind.speed**2/kind.acceleration*.35:2.5);
  const f=new Float32Array(await e.read(e.state));f.set([0,0,0],target*48);
  f.set([radius+3,0,0],source*48);f.set(type<27?[-1,kind.speed*.6,side*kind.speed*.8]:[-kind.speed,0,0],source*48+4);
  e.device.queue.writeBuffer(e.state,0,f);return {e,source,target,radius};
}
async function settle(ctx,canvas,type) {
  const {e,source,target,radius}=await pair(canvas,type);
  try {
    for(let frame=1;frame<=3600;frame++)e.step(frame/120,1/120);
    const f=new Float32Array(await e.read(e.state)),speed=Math.hypot(...[0,1,2].map(a=>f[source*48+4+a]-f[target*48+4+a]));
    const distance=Math.hypot(...[0,1,2].map(a=>f[source*48+a]-f[target*48+a]));
    ctx.metric(`settled_${type}`,JSON.stringify({speed,distance,radius}));
    ctx.assert(speed<.12,`${classOf(type).name} brakes to a near-stop relative to its target`);
    ctx.assert(Math.abs(distance-radius)<1.0,`${classOf(type).name} settles at hull-aware stand-off range`);
    report(e,{strategy:'withdraw'});for(let frame=3601;frame<=4080;frame++)e.step(frame/120,1/120);
    const after=new Float32Array(await e.read(e.state));
    ctx.assert(after[source*48+4]<-.1,`${classOf(type).name} withdrawal preempts stand-off`);
  }finally{e.destroy();}
}
async function circulate(ctx,canvas,side) {
  const {e,source,target,radius}=await pair(canvas,0,side);
  try {
    let signPreserved=true,minSpeed=Infinity,minDistance=Infinity,maxDistance=0,minY=Infinity,maxY=-Infinity;
    for(let frame=1;frame<=2400;frame++) {
      e.step(frame/120,1/120);if(frame%60!==0)continue;
      const f=new Float32Array(await e.read(e.state));
      const p=[0,1,2].map(a=>f[source*48+a]-f[target*48+a]),v=[0,1,2].map(a=>f[source*48+4+a]-f[target*48+4+a]);
      signPreserved&&=(p[0]*v[2]-p[2]*v[0])*side>0;
      minSpeed=Math.min(minSpeed,Math.hypot(...v));minDistance=Math.min(minDistance,Math.hypot(...p));maxDistance=Math.max(maxDistance,Math.hypot(...p));
      minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1]);
    }
    ctx.assert(signPreserved,`small craft preserve ${side>0?'positive':'negative'} tangential approach direction`);
    ctx.assert(minSpeed>5&&minDistance>radius-3&&maxDistance<radius+5,'small craft keep flying near their target instead of stopping or escaping');
    ctx.assert(maxY-minY>10,'close passes preserve an inclined 3D flight plane');
    ctx.metric(`circulation_${side}`,JSON.stringify({minSpeed,minDistance,maxDistance,heightRange:maxY-minY}));
    const before=new Uint8Array(await e.read(e.state));report(e,{attackType:0});const after=new Uint8Array(await e.read(e.state));
    ctx.assert(before.every((x,i)=>x===after[i]),'retargeting a circulating ship never uploads its pose');
    e.step(20.01,.01);const f=new Float32Array(await e.read(e.state));ctx.assert(f[source*48+16]===0,'close-range steering releases an invalidated target');
  }finally{e.destroy();}
}
async function movingTarget(ctx,canvas) {
  const {e,source,target,radius}=await pair(canvas,27);
  try {
    report(e,{fleet:1,strategy:'withdraw'});
    for(let frame=1;frame<=3600;frame++)e.step(frame/120,1/120);
    const f=new Float32Array(await e.read(e.state));
    const relativeSpeed=Math.hypot(...[0,1,2].map(a=>f[source*48+4+a]-f[target*48+4+a]));
    const distance=Math.hypot(...[0,1,2].map(a=>f[source*48+a]-f[target*48+a]));
    ctx.assert(f[target*48+4]>.3&&relativeSpeed<.15&&Math.abs(distance-radius)<1.5,'large craft match a moving target while maintaining stand-off');
    ctx.metric('moving_target_standoff',JSON.stringify({relativeSpeed,distance,radius}));
  }finally{e.destroy();}
}
export async function validateEngagement(ctx,canvas) {
  for(const type of [27,30,31])await settle(ctx,canvas,type);
  await movingTarget(ctx,canvas);await circulate(ctx,canvas,1);await circulate(ctx,canvas,-1);
}
