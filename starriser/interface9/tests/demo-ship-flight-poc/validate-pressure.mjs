import {createEngine} from './engine.mjs';
export async function validatePressure(ctx,canvas) {
  for(const scenario of [0,1,3]) {
    const e=await createEngine(canvas,{count:2,scenario,warpEnd:2});
    try {
      const seed=new Float32Array(await e.read(e.state));seed.set(seed.slice(0,20),24);
      e.device.queue.writeBuffer(e.state,0,seed);
      e.step(.01,.01);const field=new Uint32Array(await e.read(e.density));
      ctx.assert(field.reduce((a,b)=>a+b,0)>2000,`scenario ${scenario} builds shared occupancy for both fleets`);
      for(let step=2;step<=120;step++)e.step(step/120,1/120);
      const readDistance=async()=>{const f=new Float32Array(await e.read(e.state));return Math.hypot(...[0,1,2].map(a=>f[a]-f[24+a]));};
      if(scenario===3) {
        ctx.assert(await readDistance()<.0001,'active warp preserves directed transit despite coincident density');
        for(let step=121;step<=600;step++)e.step(step/120,1/120);
      }
      ctx.assert(await readDistance()>.1,`scenario ${scenario} local flight separates coincident opposing fleet representatives`);
      e.setDensityVisible(true);e.render();await e.device.queue.onSubmittedWorkDone();
      ctx.assert(e.errors.length===0,`scenario ${scenario} density overlay validates`);
    }finally{e.destroy();}
  }
}

export async function validateMovingField(ctx,canvas) {
  const [{bodyAt},{flightType,orbitRadius},{classOf}]=await Promise.all([
    import('./solar-layout.mjs'),import('./flight-layout.mjs'),import('../demo-ship-battle-poc/classes.mjs')]);
  const e=await createEngine(canvas,{count:6,scenario:1,period:30});
  try {
    const data=new Float32Array(await e.read(e.state)),planet=bodyAt(1,300,30);let expected=0;
    for(let i=0;i<6;i++) {
      const type=flightType(i,6);data.set([planet[0]+orbitRadius(type,planet[3]),planet[1],planet[2]],i*24);
      expected+=classOf(type).weight;
    }
    e.device.queue.writeBuffer(e.state,0,data);e.step(300,0);
    const field=new Uint32Array(await e.read(e.density)),mass=field.reduce((a,b)=>a+b,0)/1024;
    ctx.assert(Math.abs(mass-expected)<.04,'arrival field follows a distant moving planet and covers the full outer-ring hull');
  }finally{e.destroy();}
}
