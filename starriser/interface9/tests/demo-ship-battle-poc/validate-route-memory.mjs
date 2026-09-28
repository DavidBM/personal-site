import {createEngine} from './engine.mjs';

async function capture(e) {
  const rows=[];
  for(const buffer of e.inspection.agents){
    const f=new Float32Array(await e.read(buffer)),w=new Uint32Array(f.buffer),map=new Map();
    for(let i=0;i<e.count;i++)if(w[i*48+22])map.set(w[i*48+23],Array.from(f.slice(i*48+24,i*48+28)));
    rows.push(map);
  }
  return rows;
}
async function seed(e) {
  for(const buffer of e.inspection.agents){
    const f=new Float32Array(await e.read(buffer)),w=new Uint32Array(f.buffer);
    for(let i=0;i<e.count;i++)if(w[i*48+22])f.set([w[i*48+23]+.125,7,-1,1],i*48+24);
    e.device.queue.writeBuffer(buffer,0,f);
  }
  return capture(e);
}
function retained(before,after) {
  return after.every((map,i)=>[...map].every(([id,row])=>row.every((v,k)=>v===before[i].get(id)?.[k])));
}
export async function validateRouteMemory(ctx,canvas) {
  const e=await createEngine(canvas,{count:64,autoRebase:false});
  try{
    e.setPlanetsEnabled(false);e.setDensityEnabled(false);e.step(256,0);
    const before=await seed(e);
    ctx.assert(e.rebaseClock(),'tagged route fixture changes the runtime epoch');
    ctx.assert(retained(before,await capture(e)),'clock rebasing preserves route progress, revision and tag in both pose buffers');
    e.packing.requestOrder([...e.director.population.ids].reverse());
    while(e.packing.status.pending)e.packing.advance(64);
    ctx.assert(retained(before,await capture(e)),'physical packing does not remap route arc distance as a ship handle');
    const transfer=await e.regroup({from:0,to:1,type:0,visual:1,logical:20});
    ctx.assert(transfer.status==='applied','fixture transfers an actual ship to a different fleet');
    const moved=await capture(e),current=e.inspection.agents.indexOf(e.state);
    const changed=[...moved[current]].filter(([id,row])=>row.some((v,k)=>v!==before[current].get(id)?.[k]));
    ctx.metric('transfer',{transfer,changed});
    ctx.check('transferred ownership has a cleared progress cache',changed.some(([,row])=>row.slice(0,3).every(v=>v===0)));
    ctx.check('only transferred ownership clears route progress; unrelated arcs survive',changed.length===1&&changed[0][1].slice(0,3).every(v=>v===0));
    e.command({revision:e.director.revision+1,fleet:0,survivalFraction:0});e.step(e.now,0);e.step(e.now+2.1,.01);
    const survivors=await seed(e),result=await e.reclaim();await e.shipStorage.pending;
    ctx.assert(result.status==='applied'&&result.retired>0,'fixture reclaims expired ships');
    ctx.assert(retained(survivors,await capture(e)),'GPU reclamation preserves surviving arc coordinates in both pose buffers');
    ctx.assert(e.errors.length===0,'route progress lifecycle has no GPU errors');
  }finally{e.destroy();}
}
