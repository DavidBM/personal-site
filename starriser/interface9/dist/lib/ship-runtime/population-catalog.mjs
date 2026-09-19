// Serial identity is independent of catalog index, fleet/type ordinal and GPU
// slot. IDs never wrap: exhausting u32 rejects admission before live mutation.
export function createPopulationCatalog(groups,roster,firstId=1) {
  const keys=[],cohorts=[];
  for(let group=0;group<groups.length/8;group++)for(let ordinal=0;ordinal<groups[group*8+5];ordinal++) {
    keys.push(group*256+ordinal);cohorts.push(roster.cohortOf(Math.floor(group/32),group%32,ordinal));
  }
  const ids=identityRange(firstId,keys.length);
  return catalog(Uint32Array.from(keys),Uint8Array.from(cohorts),ids,firstId+keys.length,0);
}
function identityRange(first,count) {
  if(!Number.isSafeInteger(first)||first<1||first+count-1>0xffffffff)throw Error('Ship identity range exhausted');
  return Uint32Array.from({length:count},(_,i)=>first+i);
}
function catalog(keys,cohorts,ids,nextId,revision) {
  const indices=new Map(Array.from(ids,(id,index)=>[id,index]));
  function append(fleet,type,batch) {
    const count=keys.length+batch.count;if(count>10000)throw Error('Visible population exceeds 10000 representatives');
    const born=identityRange(nextId,batch.count);
    const nextKeys=new Uint32Array(count),nextCohorts=new Uint8Array(count),nextIds=new Uint32Array(count);
    nextKeys.set(keys);nextCohorts.set(cohorts);nextIds.set(ids);nextIds.set(born,ids.length);
    for(let i=keys.length;i<count;i++){nextKeys[i]=(fleet*32+type)*256+batch.ordinals[i-keys.length];nextCohorts[i]=batch.cohort;}
    return catalog(nextKeys,nextCohorts,nextIds,nextId+batch.count,revision+1);
  }
  function retain(indices) {
    return catalog(Uint32Array.from(indices,i=>keys[i]),Uint8Array.from(indices,i=>cohorts[i]),Uint32Array.from(indices,i=>ids[i]),nextId,revision+1);
  }
  function reassign(rows) {
    const nextKeys=keys.slice(),nextCohorts=cohorts.slice();
    for(const {index,key,cohort} of rows){nextKeys[index]=key;nextCohorts[index]=cohort;}
    if(new Set(nextKeys).size!==nextKeys.length)throw Error('Regrouping assigned a duplicate fleet/type ordinal');
    return catalog(nextKeys,nextCohorts,ids.slice(),nextId,revision+1);
  }
  return {keys,cohorts,ids,nextId,revision,append,retain,reassign,indexOf:id=>indices.get(id)??-1,get count(){return keys.length;},
    clone:()=>catalog(keys.slice(),cohorts.slice(),ids.slice(),nextId,revision)};
}
export function populationIdentity(population) {
  return {keys:Array.from(population.keys),cohorts:Array.from(population.cohorts),ids:Array.from(population.ids),nextId:population.nextId};
}
