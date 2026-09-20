import {createLabPresentation} from './lab-presentation.mjs';
import { createScenarioEngine, retargetScenario, scenarioDistance } from './scenarios.mjs';
import { bindDirectorControls } from './director-controls.mjs';
const params=new URLSearchParams(location.search), canvas=document.querySelector('#scene');
const status=document.querySelector('#status'), error=document.querySelector('#error');
if(params.get('test')==='1') {
  document.querySelector('#panel').style.display='none';
  const [{createHarness},{validate}]=await Promise.all([import('../common/harness.mjs'),import('./validate.mjs')]);
  createHarness({name:'demo-ship-flight-poc',run:ctx=>validate(ctx,canvas)});
} else {
  let engine, presentation, previous=null, time=0, paused=false, follow=0, phase=0, busy=false,resetGeneration=0,resetQueue=Promise.resolve();
  let lastRuntimeError='';
  let yaw=.25,pitch=.5,distance=46,drag=null,frames=0,reportAt=performance.now();
  const controls=Object.fromEntries(['scenario','count','period','follow','emit'].map(k=>[k,document.getElementById(k)]));
  const directorControls=bindDirectorControls(()=>engine,message=>{error.textContent=message;});
  if(params.has('scenario'))controls.scenario.value=params.get('scenario');
  if(params.has('count'))controls.count.value=params.get('count');
  function reset() {
    const generation=++resetGeneration;
    busy=true;
    const settings={count:Number(controls.count.value),scenario:Number(controls.scenario.value),period:Number(controls.period.value)};
    const work=async()=>{
      if(generation!==resetGeneration)return;
      engine?.destroy();engine=null;error.textContent='';
      try {
        const created=await createScenarioEngine(canvas,settings);
        if(generation!==resetGeneration){created.destroy();return;}
        engine=created;directorControls.reset(engine);
        time=0;previous=null;phase=0;frames=0;reportAt=performance.now();status.textContent='Starting…';presentation=createLabPresentation(engine);presentation.setPaused(paused);distance=scenarioDistance(engine.scenario);
        window.flightLab={get engine(){return engine;},get time(){return time;},get presentation(){return presentation;}};
      } catch(e){if(generation===resetGeneration)error.textContent=String(e.stack||e);}finally{if(generation===resetGeneration)busy=false;}
    };
    resetQueue=resetQueue.then(work,work);return resetQueue;
  }
  for(const key of ['scenario','count'])controls[key].onchange=reset;
  controls.period.onchange=reset;
  document.querySelector('#reset').onclick=reset;
  document.querySelector('#grow-storage').onclick=()=>{if(engine&&!busy)engine.resizeStorage(Math.min(10000,engine.shipStorage.status.capacity*2));};
  document.querySelector('#trim-storage').onclick=()=>{if(engine&&!busy)engine.resizeStorage(Math.max(1,engine.count));};
  document.querySelector('#pack-storage').onclick=()=>{if(engine&&!busy)engine.packing.request();};
  document.querySelector('#retarget').onclick=async()=>{
    if(!engine||busy)return;
    const target=engine;phase+=Math.PI*.8;
    try{await retargetScenario(target,phase);}catch(e){if(engine===target)error.textContent=String(e.message??e);}
  };
  document.querySelector('#pause').onclick=e=>{
    paused=!paused;presentation?.setPaused(paused);e.target.textContent=paused?'Resume':'Pause';
    if(engine&&!busy){presentation.frame(performance.now(),{emitting:controls.emit.checked});time=engine.now;}
  };
  canvas.onpointerdown=e=>{drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);};
  canvas.onpointerup=()=>{drag=null;};
  canvas.onpointermove=e=>{if(drag){yaw-=(e.clientX-drag[0])*.005;pitch=Math.max(-1.3,Math.min(1.3,pitch+(e.clientY-drag[1])*.005));drag=[e.clientX,e.clientY];}};
  canvas.onwheel=e=>{e.preventDefault();distance=Math.max(3,Math.min(1600,distance*Math.exp(e.deltaY*.001)));};
  function updateTimings() {
    const profile=engine.profiler,clockMs=engine.clockGpu?.latestMs,pack=engine.packing.status;
    const storage=engine.shipStorage.status;
    document.querySelector('#grow-storage').disabled=Boolean(storage.pending)||storage.capacity===10000;
    document.querySelector('#trim-storage').disabled=Boolean(storage.pending)||storage.capacity===Math.max(1,engine.count);
    document.querySelector('#storage').textContent=`${storage.capacity.toLocaleString()} allocated slots · ${(storage.residentBytes/1048576).toFixed(1)} MiB ship buffers`+(storage.pending?' · retiring previous buffers':'');
    const stages=profile.latest?'GPU ms · '+profile.latest.map(x=>`${x.label}: ${x.ms.toFixed(3)}`).join(' · '):profile.supported?'GPU timing warming up…':'GPU timestamps unavailable on this adapter';
    document.querySelector('#timings').textContent=stages+(clockMs==null?'':` · Last clock rebase: ${clockMs.toFixed(3)}`)+(pack.latestMs==null?'':` · Last pack batch: ${pack.latestMs.toFixed(3)} (${pack.sampledSwaps} swaps)`);
  }
  function updateStatus(now) {
    frames++;
    if(now-reportAt>500) {
      const alive=engine.director?engine.director.alive:engine.count;
      const planning=engine.navigationStatus?.pending?' · planning local approach':'';
      const pressure=engine.pressure?` · ${engine.pressure.activeCount} active pressure fields / ${engine.pressure.layout.fields} slots`:"";
      status.textContent=`${alive.toLocaleString()} live / ${engine.count.toLocaleString()} representatives · ${Math.round(frames*1000/(now-reportAt))} display FPS · ${time.toFixed(1)}s${pressure}${planning}${engine.packing.status.pending?' · packing storage':''} · ${presentation.status.recoveries} recoveries${presentation.status.clock.holding?' · aligning clock':''}`;
      updateTimings();
      frames=0;reportAt=now;
    }
    updateErrors();
  }
  function updateErrors() {
    const recovery=presentation.status;
    const message=[...engine.errors,engine.events.lastFailure?.error,recovery.error,recovery.rejected.at(-1)?.error].filter(Boolean).join('\n');
    if(message||error.textContent===lastRuntimeError)error.textContent=message;
    lastRuntimeError=message;
  }
  function frame() {
    const now=performance.now(),dt=previous===null?0:(now-previous)/1000;previous=now;
    if(engine&&!busy) {
      engine.packing.advance();
      const state=presentation.frame(now,{emitting:controls.emit.checked});time=engine.now;
      follow+=(Number(controls.follow.checked)-follow)*(1-Math.exp(-dt*7));
      directorControls.update(time);
      engine.render({follow,yaw,pitch,distance,alpha:state.alpha});
      updateStatus(now);
    }
    requestAnimationFrame(frame);
  }
  await reset();requestAnimationFrame(frame);
}
