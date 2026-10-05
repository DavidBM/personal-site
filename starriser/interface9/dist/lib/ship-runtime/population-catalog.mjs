import {MAX_SHIP_CAPACITY} from './ship-capacity.mjs';
// Serial identity is independent of catalog index, fleet/type ordinal and GPU
// slot. IDs never wrap: exhausting u32 rejects admission before live mutation.
export function createPopulationCatalog(groups,roster,firstId=1) {
  let count=0;
  for(let group=0;group<groups.length/8;group++)count+=groups[group*8+5];
  const keys=new Uint32Array(count),cohorts=new Uint8Array(count),ids=identityRange(firstId,count);
  let index=0;
  for(let group=0;group<groups.length/8;group++)for(let ordinal=0;ordinal<groups[group*8+5];ordinal++) {
    keys[index]=group*256+ordinal;cohorts[index]=roster.cohortOf(Math.floor(group/32),group%32,ordinal);index++;
  }
  return catalog(keys,cohorts,ids,firstId+count,0,true);
}
function identityRange(first,count) {
  if(!Number.isSafeInteger(first)||first<1||first+count-1>0xffffffff)throw Error('Ship identity range exhausted');
  const ids=new Uint32Array(count);
  for(let index=0;index<count;index++)ids[index]=first+index;
  return ids;
}
function catalog(keys,cohorts,ids,nextId,revision,contiguous=false) {
  // Ordinary scene occupancy assigns a consecutive serial range. It needs no
  // per-ship JS lookup objects. Retained/reordered catalogs build their lookup
  // only when requested; each immutable catalog owns that lazy index.
  let indices=null;
  function indexOf(id) {
    if(contiguous){const index=id-ids[0];return Number.isInteger(index)&&ids[index]===id?index:-1;}
    if(!indices){indices=new Map();for(let index=0;index<ids.length;index++)indices.set(ids[index],index);}
    return indices.get(id)??-1;
  }
  function append(fleet,type,batch) {
    const count=keys.length+batch.count;if(count>MAX_SHIP_CAPACITY)throw Error('Visible population exceeds 200000 representatives');
    const born=identityRange(nextId,batch.count);
    const nextKeys=new Uint32Array(count),nextCohorts=new Uint8Array(count),nextIds=new Uint32Array(count);
    nextKeys.set(keys);nextCohorts.set(cohorts);nextIds.set(ids);nextIds.set(born,ids.length);
    for(let i=keys.length;i<count;i++){nextKeys[i]=(fleet*32+type)*256+batch.ordinals[i-keys.length];nextCohorts[i]=batch.cohort;}
    return catalog(nextKeys,nextCohorts,nextIds,nextId+batch.count,revision+1,
      contiguous&&(ids.length===0||nextId===ids[0]+ids.length));
  }
  function retain(indices) {
    return catalog(Uint32Array.from(indices,i=>keys[i]),Uint8Array.from(indices,i=>cohorts[i]),Uint32Array.from(indices,i=>ids[i]),nextId,revision+1);
  }
  function reassign(rows) {
    const nextKeys=keys.slice(),nextCohorts=cohorts.slice();
    for(const {index,key,cohort} of rows){nextKeys[index]=key;nextCohorts[index]=cohort;}
    if(new Set(nextKeys).size!==nextKeys.length)throw Error('Regrouping assigned a duplicate fleet/type ordinal');
    return catalog(nextKeys,nextCohorts,ids.slice(),nextId,revision+1,contiguous);
  }
  return {keys,cohorts,ids,nextId,revision,append,retain,reassign,indexOf,get count(){return keys.length;},
    clone:()=>catalog(keys.slice(),cohorts.slice(),ids.slice(),nextId,revision,contiguous)};
}
export function populationIdentity(population) {
  return {keys:Array.from(population.keys),cohorts:Array.from(population.cohorts),ids:Array.from(population.ids),nextId:population.nextId};
}
