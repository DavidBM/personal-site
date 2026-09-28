import {SHIP_BYTES} from '../ship-runtime/ship-layout.mjs';
import {createPilotRuntime,readPilotBuffer} from './runtime.mjs';
const element=id=>document.getElementById(id),canvas=element('scene');
let device,runtime,paused=false,loading=false,last=0,accumulator=0,frames=0,lastReport=0,readPending=false;
const status=message=>{element('status').textContent=message;};
async function restart(){
  if(loading)return;loading=true;runtime?.destroy();runtime=null;
  try{
    const start=performance.now();
    runtime=await createPilotRuntime({device,canvas,format:navigator.gpu.getPreferredCanvasFormat(),count:Number(element('count').value),kind:element('kind').value,onStatus:message=>status(`${message} · ${((performance.now()-start)/1000).toFixed(1)}s`)});
    overview();status(`Ready · setup ${((performance.now()-start)/1000).toFixed(2)}s · click a dart to follow`);
    console.table(runtime.timings);accumulator=0;
  }catch(error){status(String(error));}finally{loading=false;}
}
function overview(){if(!runtime)return;runtime.settings.selected=-1;runtime.settings.center=[0,0,0];runtime.settings.zoom=Math.ceil(Math.sqrt(runtime.data.fleetCount))*75;}
function resize(){
  const ratio=Math.min(window.devicePixelRatio||1,2),width=Math.round(innerWidth*ratio),height=Math.round(innerHeight*ratio);
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  if(runtime){runtime.settings.aspect=width/height;runtime.settings.height=innerHeight;}
}
async function report(now){
  if(!runtime||readPending||now-lastReport<1000)return;readPending=true;
  const target=runtime,elapsed=(now-lastReport)/1000,fps=frames/Math.max(elapsed,.01);lastReport=now;frames=0;
  try{
    const stats=new Uint32Array(await readPilotBuffer(device,target.stats,64));
    if(runtime===target)element('metrics').textContent=`${fps.toFixed(0)} rendered frames/s · 30 Hz flight\n${target.data.count.toLocaleString()} ships · ${target.data.fleetCount} fleets\n${(target.memoryBytes/1048576).toFixed(1)} MiB buffers\nLast tick: ${stats[0]} pilot updates\n${stats[1]} candidates · ${stats[3]} overflow\n${stats[5]} capped queries · ${stats[6]} lost threats\nFollow: ${target.settings.selected<0?'none':100001+target.settings.selected}\nGPU utilization is not measured here.`;
  }catch(error){if(runtime===target)status(String(error));}finally{readPending=false;}
}
function frame(now){
  const dt=Math.min((now-last)/1000,.1);last=now;resize();
  if(runtime){
    Object.assign(runtime.settings,{fullRate:element('cadence').value==='full',delayed:element('delay').checked,micro:element('micro').checked});
    if(!paused){accumulator+=dt;while(accumulator>=1/30){runtime.step();accumulator-=1/30;}}
    runtime.draw(paused?1:accumulator*30);frames++;void report(now);
  }requestAnimationFrame(frame);
}
function screenPoint(event){const box=canvas.getBoundingClientRect();return [(event.clientX-box.left)/box.width*2-1,1-(event.clientY-box.top)/box.height*2];}
function inputs(){
  let drag=null;
  canvas.addEventListener('pointerdown',event=>{if(event.button!==0)return;drag={x:event.clientX,y:event.clientY,moved:0};canvas.setPointerCapture(event.pointerId);});
  canvas.addEventListener('pointermove',event=>{
    if(!drag||!runtime)return;const x=event.clientX-drag.x,y=event.clientY-drag.y;drag.moved+=Math.hypot(x,y);drag.x=event.clientX;drag.y=event.clientY;
    const settings=runtime.settings;
    if(event.altKey){settings.yaw+=x*.006;settings.pitch=Math.max(.15,Math.min(1.5,settings.pitch+y*.006));return;}
    if(settings.selected>=0)return;
    const scale=settings.zoom*2/innerHeight;settings.center[0]-=x*scale*Math.cos(settings.yaw);settings.center[2]+=x*scale*Math.sin(settings.yaw)-y*scale/Math.sin(settings.pitch);
  });
  canvas.addEventListener('pointerup',async event=>{const click=drag&&drag.moved<4;drag=null;if(click&&runtime){const target=runtime;const selected=await target.select(screenPoint(event));if(runtime===target){target.settings.selected=selected;if(selected>=0)target.settings.zoom=3;}}});
  canvas.addEventListener('pointercancel',()=>{drag=null;});
  canvas.addEventListener('wheel',event=>{event.preventDefault();if(runtime)runtime.settings.zoom=Math.max(.5,Math.min(1500,runtime.settings.zoom*Math.exp(event.deltaY*.001)));},{passive:false});
  canvas.addEventListener('contextmenu',event=>{event.preventDefault();void moveOrder(event);});
  window.addEventListener('keydown',event=>{if(event.key==='Escape')overview();});
  element('reset').onclick=restart;element('overview').onclick=overview;
  element('pause').onclick=()=>{paused=!paused;element('pause').textContent=paused?'Resume':'Pause';};
}
async function moveOrder(event){
  const target=runtime;if(!target||target.settings.selected<0)return;
  // One selected pose read only on a user command, never in the frame loop.
  const index=target.settings.selected,pose=await readPilotBuffer(device,target.state,SHIP_BYTES,index*SHIP_BYTES);
  if(runtime!==target)return;
  const s=new Float32Array(pose),ids=new Uint32Array(pose),point=screenPoint(event),view=target.settings;
  const x=point[0]*view.zoom*view.aspect,z=point[1]*view.zoom/Math.sin(view.pitch);
  target.order(ids[21],[s[0]+x*Math.cos(view.yaw)+z*Math.sin(view.yaw),0,s[2]-x*Math.sin(view.yaw)+z*Math.cos(view.yaw)]);
  status('Fleet order uploaded · the GPU owns subsequent progress');
}
async function start(){
  try{
    const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw Error('WebGPU is unavailable');
    device=await adapter.requestDevice();device.addEventListener('uncapturederror',event=>status(event.error.message));
    device.lost.then(info=>{runtime?.destroy();runtime=null;paused=true;status(`GPU device lost: ${info.message}. Reload to restart.`);});
    inputs();await restart();requestAnimationFrame(frame);
  }catch(error){status(String(error));}
}
void start();
