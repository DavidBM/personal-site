// Independent identity ledger for the authored lifecycle: only declared transfers
// may change fleet/type addresses; serials and types remain immutable.
export async function regroupLifecycle(ctx,e,storage) {
  const population=e.director.population,requests=[0,30,31].map(type=>({from:0,to:1,type,cohort:0,visual:type===0?2:1,logical:type===0?40:20}));
  const expected=new Map();
  for(const row of requests) {
    const indices=Array.from({length:population.count},(_,i)=>i).filter(i=>population.keys[i]>>>8===row.type&&population.cohorts[i]===0).sort((a,b)=>population.ids[a]-population.ids[b]).slice(0,row.visual);
    const occupied=new Set(Array.from(population.keys).filter(key=>key>>>8===32+row.type).map(key=>key&255));
    const ordinals=Array.from({length:256},(_,i)=>i).filter(i=>!occupied.has(i)).slice(0,row.visual);
    indices.forEach((index,i)=>expected.set(population.ids[index],[(row.type<<8)|ordinals[i],1]));
  }
  const alive=e.director.alive,count=e.count,result=await e.regroup(requests);
  ctx.assert(result.status==='applied'&&result.transferred===4&&e.count===count&&e.director.alive===alive,'planned lifecycle transfers fighters and capitals during battle without changing the population or outcomes');
  for(const [id,identity] of expected)storage.ownership.set(id,identity);
  ctx.metric('planned_lifecycle_regroup',{at:e.now,result,expected:[...expected]});
}
