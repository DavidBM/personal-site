import {createSequenceEngine} from './sequence-engine.mjs';
export async function validateSequence(ctx,canvas,count=1000) {
  const e=await createSequenceEngine(canvas,{count,period:30});
  try {
    const initial=e.director.alive,identities=new Uint32Array(await e.read(e.state));let peak=initial,finite=true,transition;
    let earlier=new Float32Array(await e.read(e.state));
    for(let frame=1;frame<=7200;frame++) {
      const now=frame/120;
      if(frame===480)transition={state:await e.read(e.state),history:await e.read(e.history)};
      e.step(now,1/120,{emitting:true});
      if(frame===480)await transitionCheck(ctx,e,transition);
      peak=Math.max(peak,e.director.alive);
      if(frame%120!==0)continue;
      const data=await e.read(e.state),f=new Float32Array(data),w=new Uint32Array(data);
      finite&&=f.every(Number.isFinite);
      eventChecks(ctx,e,now,f,w,identities,initial);
      earlier=f;
    }
    ctx.assert(finite,'the full 60-second sequence remains finite');
    ctx.assert(peak>initial&&e.sequence.history.length===e.sequence.events.length,'complete replay executes every event once including reinforcement');
    ctx.assert(earlier.filter((_,i)=>i%48===16).every(x=>x===0),'battle end releases all attack targets');
    e.setDensityVisible(true);e.render();await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'sequence rendering and moving pressure frame validate');
    ctx.metric(`sequence_${count}_initial_live`,initial);ctx.metric(`sequence_${count}_peak_live`,peak);ctx.metric(`sequence_${count}_final_live`,e.director.alive);
  }finally{e.destroy();}
}

function eventChecks(ctx,e,now,f,w,identities,initial) {
  if(now===10)ctx.assert(f.filter((_,i)=>i%48===16).every(x=>x===0),'arrival cannot start an unreported battle');
  if(now===12)ctx.assert(e.director.groups[3]===1&&e.director.groups[32*8+3]===1,'battle begins from its scheduled backend event');
  if(now===22)ctx.assert(e.director.alive>initial,'reinforcement admits previously pending representatives');
  if(now===28)ctx.assert(e.sequence.history.find(x=>x.id==='late-loss').late,'late casualty report is admitted at delivery time');
  if(now===36)ctx.assert(w.filter((_,i)=>i%48===20).every((x,i)=>x===identities[i*48+20]),'losses and reinforcement preserve stable type/ordinal identities');
  if(now===52)ctx.assert(e.director.groups[3]===0&&e.director.groups[32*8+3]===0,'director ends the encounter after escape');
}

async function transitionCheck(ctx,e,before) {
  const after=new Float32Array(await e.read(e.state)),old=new Float32Array(before.state),words=new Uint32Array(before.state);
  let residual=0;
  for(let i=0;i<e.count/2;i++)if(words[i*48+22]===1)for(let a=0;a<3;a++)residual=Math.max(residual,Math.abs(after[i*48+a]-old[i*48+a]-after[i*48+a+4]/120));
  ctx.assert(residual<2e-5,'moving pressure frame and in-flight route replacement preserve integrated displacement');
  const previous=new Float32Array(before.history),history=new Float32Array(await e.read(e.history));let retained=0,unchanged=true;
  for(let i=0;i<history.length;i+=4)if(previous[i+3]>=0&&previous[i+3]===history[i+3]){retained++;unchanged&&=[0,1,2].every(a=>previous[i+a]===history[i+a]);}
  ctx.assert(unchanged&&retained>e.director.alive*3*12,'route replacement retains existing world-space emitter history');
}
