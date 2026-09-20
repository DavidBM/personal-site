// Repeated combined resource lifetime, rather than independent growth and
// transfer loops: every round transfers, loses, reclaims, admits and packs.
const command=(e,fields)=>e.command({revision:e.director.revision+1,...fields});
const batchCount=e=>e.director.roster.batches.reduce((sum,b)=>sum+b.length,0);
function finishPacking(e){while(e.packing.status.pending)e.packing.advance(64);}
export async function populationCycles(ctx,e) {
  const count=e.count,firstId=e.director.population.nextId,initialBatches=batchCount(e),samples=[];
  e.resizeStorage(count);await e.shipStorage.pending;const resident=e.shipStorage.status.residentBytes;
  for(let cycle=0;cycle<12;cycle++) {
    const transferred=await e.regroup({from:0,to:2,type:3,visual:1,logical:20});
    if(transferred.status!=='applied')throw Error(`Cycle transfer ${transferred.status}`);
    const remaining=e.director.roster.logicalCount(2,3)-20;command(e,{fleet:2,type:3,remaining});e.step(e.now,0);e.step(e.now+2.1,.01);
    const retired=await e.reclaim();await e.shipStorage.pending;
    if(retired.status!=='applied'||retired.retired!==1)throw Error('Cycle did not retire exactly its declared representative loss');
    e.reinforce({fleet:2,type:3,visual:1,logical:20,position:[0,30,0],spread:1});await e.shipStorage.pending;
    const returned=await e.regroup({from:2,to:0,type:3,visual:1,logical:20});
    if(returned.status!=='applied')throw Error(`Cycle return ${returned.status}`);
    e.packing.requestOrder([...e.director.population.ids].reverse());finishPacking(e);
    e.resizeStorage(count);await e.shipStorage.pending;e.step(e.now+.01,.01);
    samples.push({cycle,count:e.count,alive:e.director.alive,capacity:e.shipStorage.status.capacity,resident:e.shipStorage.status.residentBytes,retired:e.shipStorage.status.retiredBytes,batches:batchCount(e),nextId:e.director.population.nextId});
  }
  ctx.assert(samples.every(s=>s.count===count&&s.alive===count&&s.capacity===count&&s.resident===resident&&s.retired===0),'12 combined transfer/loss/reclamation/birth/packing cycles return to the same bounded resident allocation');
  ctx.assert(samples.every(s=>s.batches<=initialBatches+2)&&e.director.population.nextId===firstId+12,'combined cycles reclaim batch metadata and allocate fresh serials without unbounded identity storage');
  const state=new Float32Array(await e.read(e.state,e.count*192));
  ctx.assert(state.every(Number.isFinite)&&e.errors.length===0,'combined cycles leave finite GPU state and no resource validation errors');
  ctx.metric('population_lifecycle_cycles',{samples,storage:e.shipStorage.status});
}
