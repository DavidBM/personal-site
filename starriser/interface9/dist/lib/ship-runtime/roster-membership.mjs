export function batchOrdinals(first,count){return Array.from({length:count},(_,i)=>first+i);}
export function availableOrdinals(batches,number) {
  const occupied=new Uint8Array(256);for(const batch of batches)for(const ordinal of batch.ordinals)occupied[ordinal]=1;
  const free=[];for(let ordinal=0;ordinal<256&&free.length<number;ordinal++)if(!occupied[ordinal])free.push(ordinal);
  if(free.length!==number)throw Error('Reinforcement exceeds the type ordinal capacity');return free;
}
export function ordinalCapacity(batches) {
  let highest=-1;for(const batch of batches)for(const ordinal of batch.ordinals)highest=Math.max(highest,ordinal);return highest+1;
}
export function retireOrdinals(batches,ordinals,residual) {
  const retired=new Set(ordinals),kept=[];
  for(const batch of batches) {
    batch.ordinals=batch.ordinals.filter(n=>!retired.has(n));
    if(batch.ordinals.length){kept.push(batch);continue;}
    if(batch.admitted)residual[batch.cohort]+=batch.logical;
  }
  return kept;
}
