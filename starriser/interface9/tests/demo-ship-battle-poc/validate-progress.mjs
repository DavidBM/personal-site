import {createEngine} from './engine.mjs';
import {classOf,radiusOf} from './classes.mjs';
import {orbitRadius,orbitTilt} from '../demo-ship-flight-poc/flight-layout.mjs';
const close=(a,b)=>a.length===b.length&&a.every((x,i)=>Math.abs(x-b[i])<.002);
function command(e,value){e.command({revision:e.director.revision+1,...value});}
function orbitPoint(e,type,phase) {
  const p=e.solar.bodyAt(1,e.now),radius=orbitRadius(type,p[3]),tilt=orbitTilt(type);
  return [p[0]+radius*Math.cos(phase),p[1]+radius*Math.sin(phase)*Math.sin(tilt),p[2]+radius*Math.sin(phase)*Math.cos(tilt)];
}
async function seed(e) {
  command(e,{fleet:0,type:0,journey:{mode:'approach',revision:1,planet:1,at:0,end:40,exit:[0,0,0]}});
  command(e,{fleet:0,type:1,journey:{mode:'warp',revision:1,at:0,end:5,exit:[-20,0,0]}});
  command(e,{fleet:1,type:0,journey:{mode:'orbit',revision:1,planet:1,at:0,end:0,exit:[0,0,0]}});
  const data=await e.read(e.state),f=new Float32Array(data),w=new Uint32Array(data);
  for(let i=0;i<e.count;i++) {
    const at=i*48,type=(w[at+20]>>8)&255,fleet=w[at+21],ordinal=w[at+20]&255,c=classOf(type);
    f.set([i*.003,20+Math.sin(i),9+Math.cos(i)],at);
    f.set([c.speed*Math.sin(i)*.3,c.speed*Math.cos(i)*.2,c.speed*.1],at+4);
    f.set([c.acceleration*.1,c.acceleration*Math.sin(i)*.2,0],at+8);
    if(fleet===0&&type===0){f[at+28]=ordinal%2;f[at+31]=1;f[at+35]=1;}
    if(fleet===0&&type===1){f[at+28]=1;f[at+31]=2;}
    if(fleet===1&&type===0){f[at+28]=1;f[at+31]=-1;if(ordinal%2===0)f.set(orbitPoint(e,type,ordinal),at);}
  }
  e.device.queue.writeBuffer(e.state,0,data);return data;
}
function onOrbit(e,type,position) {
  const p=e.solar.bodyAt(1,e.now),tilt=orbitTilt(type),delta=position.map((x,i)=>x-p[i]);
  const phase=Math.atan2(delta[1]*Math.sin(tilt)+delta[2]*Math.cos(tilt),delta[0]);
  const point=orbitPoint(e,type,phase);return Math.hypot(...point.map((x,i)=>x-position[i]))<=Math.max(3,radiusOf(type)*1.5);
}
function reference(e,data) {
  const f=new Float32Array(data),w=new Uint32Array(data),rows=Array.from({length:e.director.capacity.groups*2},()=>({live:0,arrived:0,warp:0,unapplied:0,minimum:[Infinity,Infinity,Infinity],maximum:[-Infinity,-Infinity,-Infinity],meanPosition:[0,0,0],meanVelocity:[0,0,0],maximumSpeed:0,maximumAcceleration:0,anchor:null}));
  for(let i=0;i<e.count;i++) {
    const at=i*48,type=(w[at+20]>>8)&255,fleet=w[at+21],ordinal=w[at+20]&255;
    if(!e.director.roster.isLive(fleet,type,ordinal))continue;
    const cohort=Number(ordinal>=e.director.roster.split[type]),row=rows[(fleet*32+type)*2+cohort];
    collect(row,f,at);countModes(row,e,f,w,at,fleet,type,cohort);
  }
  for(const row of rows)if(row.live){row.meanPosition=row.meanPosition.map(x=>x/row.live);row.meanVelocity=row.meanVelocity.map(x=>x/row.live);}
  return rows;
}
function collect(row,f,at) {
  row.live++;row.anchor??=Array.from(f.slice(at,at+3));
  for(let axis=0;axis<3;axis++) {
    row.minimum[axis]=Math.min(row.minimum[axis],f[at+axis]);row.maximum[axis]=Math.max(row.maximum[axis],f[at+axis]);
    row.meanPosition[axis]+=f[at+axis];row.meanVelocity[axis]+=f[at+4+axis];
  }
  row.maximumSpeed=Math.max(row.maximumSpeed,Math.hypot(...f.slice(at+4,at+7)));
  row.maximumAcceleration=Math.max(row.maximumAcceleration,Math.hypot(...f.slice(at+8,at+11)));
}
function countModes(row,e,f,w,at,fleet,type,cohort) {
  const intent=e.director.intents[fleet*32+type],journey=intent.journeys[cohort]??intent.journeys[0];
  const matched=w[at+22]===1&&f[at+28]===(journey?.revision??0);
  row.warp+=Number(f[at+31]>=2);row.unapplied+=Number(!matched);
  const orbit=f[at+31]===-1&&onOrbit(e,type,Array.from(f.slice(at,at+3)));
  row.arrived+=Number(matched&&(orbit||(f[at+31]===1&&f[at+35]===1)));
}
function compare(ctx,actual,expected) {
  const counts=actual.every((row,i)=>['live','arrived','warp','unapplied'].every(key=>row[key]===expected[i][key]));
  const geometry=actual.every((row,i)=>!row.live||['minimum','maximum','meanPosition','meanVelocity','anchor'].every(key=>close(row[key],expected[i][key])));
  const dynamics=actual.every((row,i)=>Math.abs(row.maximumSpeed-expected[i].maximumSpeed)<.002&&Math.abs(row.maximumAcceleration-expected[i].maximumAcceleration)<.002);
  ctx.assert(counts,'GPU cohort counts distinguish current admission, arrival, warp and unapplied intent');
  ctx.assert(geometry&&dynamics,'GPU bounds, means, occupied anchor and dynamics bounds match independent full-state inspection');
  ctx.assert(actual.filter(r=>!r.live).every(r=>r.anchor===null&&r.meanPosition===null),'empty cohorts never invent a planning position');
}
async function lifetime(ctx,e) {
  const capture=e.readProgress();command(e,{fleet:1,type:2,remaining:0});
  const stale=await capture;
  ctx.assert(stale.groups.filter(g=>g.stale).every(g=>g.fleet===1&&g.type===2)&&stale.groups.filter(g=>g.stale).length===2,'an intervening report marks only its type cohorts stale');
  const fresh=await e.readProgress();ctx.assert(fresh.groups.filter(g=>g.fleet===1&&g.type===2).every(g=>g.live===0&&!g.stale),'fresh summaries honor casualties before another movement step');
  const prior=e.readProgress();e.reset();ctx.assert((await prior).status==='superseded','reset cannot expose a summary from the old state lifetime');
  ctx.assert((await e.readProgress()).status==='ready','new lifetime reuses the bounded readback resources');
  const closing=e.readProgress();e.destroy();ctx.assert((await closing).status==='closed','teardown safely closes an in-flight progress readback');
}
export async function validateProgress(ctx,canvas) {
  const count=Number(ctx.params.count??10000),fleetCount=Number(ctx.params.fleets??2),e=await createEngine(canvas,{count,fleetCount,reserveFraction:.2});
  try {
    const data=await seed(e),expected=reference(e,data),before=new Uint8Array(data),history=new Uint8Array(await e.read(e.history));
    const first=e.readProgress(),second=e.readProgress();
    ctx.assert(first===second&&e.progress.stats.inFlight===1&&e.progress.stats.reads===1,'concurrent callers share one actual GPU progress readback');
    const result=await first;compare(ctx,result.groups,expected);
    ctx.assert(result.groups[64].arrived<result.groups[64].live,'an orbit command alone does not report off-ring ships as arrived');
    const after=new Uint8Array(await e.read(e.state)),trails=new Uint8Array(await e.read(e.history));
    ctx.assert(before.every((x,i)=>x===after[i])&&history.every((x,i)=>x===trails[i]),'progress observation never changes ship state or trail history');
    ctx.metric('progress_resources',{count,...e.progress.stats});
    await lifetime(ctx,e);ctx.assert(e.errors.length===0,'progress reduction and teardown produce no GPU validation errors');
  }finally{e.destroy();}
}
