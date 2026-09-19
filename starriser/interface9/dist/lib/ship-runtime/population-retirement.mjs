import {maskHas} from './roster.mjs';
// Readback contains serial/expiry/record counts only. No individual pose is
// decoded on the host or uploaded to relocate a survivor.
export function preparePopulationRetirement(director,layout,metadata) {
  const n=director.population.count;
  if(metadata.length!==n*4)throw Error('Incomplete retirement observation');
  const candidates=[],counts=new Uint32Array(n);let records=0;
  for(let slot=0;slot<n;slot++) {
    const index=layout.logical[slot],id=director.population.ids[index],key=director.population.keys[index];
    if(metadata[slot*4]!==id||metadata[slot*4+3])throw Error('Invalid retirement identity or correction chain');
    counts[slot]=metadata[slot*4+2];records+=counts[slot];
    if(eligible(director,key,metadata[slot*4+1]))candidates.push(slot);
  }
  const retired=fitHistory(candidates,counts,records,n);if(!retired.size)return null;
  const keep=[],remap=new Uint32Array(n).fill(0xffffffff),ids=[];
  for(let slot=0;slot<n;slot++) {
    if(retired.has(slot)){ids.push(director.population.ids[layout.logical[slot]]);continue;}
    remap[slot]=keep.length;keep.push(slot);
  }
  const rows=new Uint32Array(keep.length*4);let offset=0;
  for(const [i,slot] of keep.entries()){rows.set([slot,offset,counts[slot],0],i*4);offset+=counts[slot];}
  const candidate=director.fork();candidate.retire(ids);
  return {director:candidate,ids,keep,rows,remap,records:offset};
}
function fitHistory(candidates,counts,total,population) {
  const retired=new Set(candidates);let kept=population-candidates.length,records=total;
  for(const slot of candidates)records-=counts[slot];
  // A shrinking journal still has two records per retained representative.
  // Keep additional expired entries temporarily if a dense historical interval
  // needs them as capacity; a later ordinary tick clears those old journals.
  for(const slot of [...candidates].sort((a,b)=>counts[a]-counts[b])) {
    if(records<=kept*2)break;retired.delete(slot);kept++;records+=counts[slot];
  }
  if(records>kept*2)throw Error('Correction pool exceeds its population budget');
  return retired;
}

function eligible(director,key,expired) {
  const group=key>>>8,ordinal=key&255;
  return expired&&maskHas(director.roster.admitted,group,ordinal)&&!director.roster.isLive(group>>>5,group&31,ordinal);
}
