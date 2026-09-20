import {createEngine,seedShips} from './engine.mjs';
import {CLASS_BY_TYPE,classOf,radiusOf} from '../demo-ship-battle-poc/classes.mjs';
import {FLIGHT_CELL_SIZE,FLIGHT_GRID_SIDE,orbitRadius,orbitTilt,flightType} from './flight-layout.mjs';
import {bodyAt} from './solar-layout.mjs';

function seedLayout(ctx) {
  ctx.assert(FLIGHT_GRID_SIDE<=64,'planet pressure grid never exceeds 64 cells per axis');
  ctx.assert(new Set(Array.from({length:6},(_,i)=>CLASS_BY_TYPE[flightType(i,6)])).size===6,'six-ship roster includes each class');
  for(const scenario of [0,1,2,3]) {
    const count=1000,data=seedShips(count,scenario),f=new Float32Array(data),w=new Uint32Array(data);
    const kinds=new Set(Array.from({length:count},(_,i)=>CLASS_BY_TYPE[(w[i*24+20]>>8)&255]));
    ctx.assert(kinds.size===6,`scenario ${scenario} includes all six physical ship classes`);
    if(scenario!==0)continue;
    const planet=bodyAt(1,0,1800);let radiusError=0,planeError=0,margin=Infinity;
    for(let i=0;i<count;i++) {
      const type=flightType(i,count),tilt=orbitTilt(type),p=[0,1,2].map(a=>f[i*24+a]-planet[a]);
      radiusError=Math.max(radiusError,Math.abs(Math.hypot(...p)-orbitRadius(type,planet[3])));
      planeError=Math.max(planeError,Math.abs(p[1]*Math.cos(tilt)-p[2]*Math.sin(tilt)));
      margin=Math.min(margin,FLIGHT_GRID_SIDE*FLIGHT_CELL_SIZE/2-Math.hypot(...p)-radiusOf(type));
    }
    ctx.assert(radiusError<2e-5&&planeError<2e-5,'each class starts on its own radius and inclined plane');
    ctx.assert(orbitRadius(12,planet[3])-planet[3]===12&&orbitRadius(31,planet[3])-planet[3]===120,'fighter and colossus surface clearances are exactly 5x and 50x');
    ctx.assert(margin>FLIGHT_CELL_SIZE*4,'planet field covers every ring and full hull with more than four cells of margin');
  }
}
async function denseApproach(ctx,canvas) {
  const count=10000,e=await createEngine(canvas,{count,scenario:1});
  try {
    let previous=new Uint32Array(await e.read(e.state)),regressions=0;
    for(let frame=1;frame<=3600;frame++) {
      e.step(frame/120,1/120);
      if(frame%120!==0)continue;
      const words=new Uint32Array(await e.read(e.state));
      for(let i=0;i<count;i++)if(words[i*24+22]<previous[i*24+22])regressions++;
      previous=words;
    }
    const data=await e.read(e.state),f=new Float32Array(data),w=new Uint32Array(data);let crossed=0,light=0,lightCrossed=0;
    for(let i=0;i<count;i++) {
      const type=(w[i*24+20]>>8)&255;
      if(w[i*24+22]===2)crossed++;
      if(classOf(type).speed>=4){light++;if(w[i*24+22]===2)lightCrossed++;}
    }
    ctx.assert(regressions===0,'10k mixed ships never re-enter a completed corridor stage');
    ctx.assert(lightCrossed/light>.98,'more than 98 percent of small ships clear the approach without queue recapture');
    ctx.assert(f.every(Number.isFinite),'10k mixed approach state remains finite');
    ctx.metric('mixed_approach_crossed_30s',crossed);ctx.metric('mixed_approach_small_fraction_30s',lightCrossed/light);
    ctx.assert(e.errors.length===0,'10k mixed approach shaders validate');
  }finally{e.destroy();}
}
export async function validateLayout(ctx,canvas){seedLayout(ctx);await denseApproach(ctx,canvas);}
