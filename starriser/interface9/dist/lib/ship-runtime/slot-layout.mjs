// Stable logical ordinals and physical slots are different address spaces.
// Appending identities preserves every old physical mapping and pending order.
export const SLOT_ORDINALS=256;
export function slotLayoutWords(director){return director.capacity.groups*SLOT_ORDINALS;}
export function createSlotLayout(director,count) {
  let physical=new Uint32Array(count),logical=new Uint32Array(count),keys=director.population.keys.slice();
  const data=new Uint32Array(slotLayoutWords(director));let revision=0,target=null,swaps=0;
  let nextPhysical=new Uint32Array(count),nextLogical=new Uint32Array(count),remap=new Uint32Array(count),used=new Uint8Array(count);const pairs=new Uint32Array(256);
  function reset(){
    data.fill(0);
    for(let i=0;i<count;i++){physical[i]=i;logical[i]=i;}
    const n=Math.min(count,keys.length);
    for(let i=0;i<n;i++)data[keys[i]]=i+1;
    target=null;swaps=0;revision++;
  }
  function rebind(){keys=director.population.keys.slice();reset();}
  function request(ids) {
    if(ids.length!==count)throw new Error('Packing order must include the whole population');
    const seen=new Uint8Array(count),candidate=new Uint32Array(count);
    for(let i=0;i<count;i++){const id=director.population.indexOf(ids[i]);if(id<0||seen[id])throw new Error('Invalid or duplicate packing identity');seen[id]=1;candidate[i]=id;}
    target=candidate;revision++;return revision;
  }
  function prepare(limit=64) {
    if(!Number.isInteger(limit)||limit<1||limit>128)throw new Error('Packing batch must use 1 to 128 swaps');
    if(!target)return null;
    nextPhysical.set(physical);nextLogical.set(logical);used.fill(0);for(let i=0;i<count;i++)remap[i]=i;
    const length=selectPairs(limit);
    if(length===0){target=null;return null;}return {revision,length,pairs,remap};
  }
  function selectPairs(limit) {
    let length=0;
    for(let slot=0;slot<count&&length<limit;slot++) {
      const wanted=target[slot],other=nextPhysical[wanted];
      if(other===slot||used[slot]||used[other])continue;
      const displaced=nextLogical[slot];nextLogical[slot]=wanted;nextLogical[other]=displaced;nextPhysical[wanted]=slot;nextPhysical[displaced]=other;
      used[slot]=1;used[other]=1;remap[slot]=other;remap[other]=slot;pairs[length*2]=slot;pairs[length*2+1]=other;length++;
    }
    return length;
  }
  function commit(batch) {
    if(batch.revision!==revision)throw new Error('Superseded packing batch');
    physical.set(nextPhysical);logical.set(nextLogical);for(let id=0;id<count;id++)data[keys[id]]=physical[id]+1;
    swaps+=batch.length;revision++;
    if(logical.every((id,slot)=>id===target[slot]))target=null;
  }
  function liveFirst() {
    const ids=Array.from(director.population.ids);
    const live=id=>{const key=keys[director.population.indexOf(id)],group=key>>>8;return director.roster.isLive(Math.floor(group/32),group%32,key&255);};
    ids.sort((a,b)=>Number(live(b))-Number(live(a))||a-b);return request(ids);
  }
  function prepareExtension(population) {
    if(population.count<count||!keys.every((key,i)=>population.keys[i]===key&&population.ids[i]===director.population.ids[i]))throw Error('Catalog extension changed existing identities');
    const n=population.count,newPhysical=new Uint32Array(n),newLogical=new Uint32Array(n),newTarget=target?new Uint32Array(n):null;
    newPhysical.set(physical);newLogical.set(logical);if(target)newTarget.set(target);
    for(let i=count;i<n;i++){newPhysical[i]=i;newLogical[i]=i;if(newTarget)newTarget[i]=i;}
    const next={physical:new Uint32Array(n),logical:new Uint32Array(n),remap:new Uint32Array(n),used:new Uint8Array(n)};
    return ()=>{
      count=n;keys=population.keys.slice();physical=newPhysical;logical=newLogical;target=newTarget;
      nextPhysical=next.physical;nextLogical=next.logical;remap=next.remap;used=next.used;revision++;
      for(let id=0;id<count;id++)data[keys[id]]=physical[id]+1;
    };
  }
  function prepareRetirement(population,keep) {
    const n=population.count,newLogical=Uint32Array.from(keep,slot=>population.indexOf(director.population.ids[logical[slot]]));
    if(keep.length!==n||new Set(newLogical).size!==n||newLogical.some(i=>i>=n))throw Error('Retirement slot mapping differs from its catalog');
    const newPhysical=new Uint32Array(n);newLogical.forEach((index,slot)=>{newPhysical[index]=slot;});
    const newTarget=target?Uint32Array.from(Array.from(target,index=>population.indexOf(director.population.ids[index])).filter(i=>i>=0)):null;
    const scratch={physical:new Uint32Array(n),logical:new Uint32Array(n),remap:new Uint32Array(n),used:new Uint8Array(n)};
    return ()=>{
      count=n;keys=population.keys.slice();physical=newPhysical;logical=newLogical;target=newTarget;
      nextPhysical=scratch.physical;nextLogical=scratch.logical;remap=scratch.remap;used=scratch.used;revision++;
      data.fill(0);for(let i=0;i<n;i++)data[keys[i]]=physical[i]+1;
    };
  }
  function prepareMembership(population) {
    if(population.count!==count||!population.ids.every((id,i)=>id===director.population.ids[i]))throw Error('Regrouping changed persistent catalog identities');
    const nextKeys=population.keys.slice();
    return ()=>{keys=nextKeys;data.fill(0);for(let i=0;i<count;i++)data[keys[i]]=physical[i]+1;revision++;};
  }
  reset();
  return {data,get physical(){return physical;},get logical(){return logical;},prepareExtension,prepareRetirement,prepareMembership,reset,rebind,request,prepare,commit,liveFirst,get status(){return {pending:target!==null,revision,swaps};}};
}
export function slotLookupWgsl(capacity,read,count) {return /* wgsl */`
fn groupSlot(group:u32,ordinal:u32)->u32 {
  if(ordinal>=256u){return ${count};}
  let word=${capacity.groups*8}u+group*256u+ordinal;let value=${read};
  return select(${count},value-1u,value>0u);
}
`;}
export function simulationSlots(capacity,mapped){return mapped?/* wgsl */`
fn slotWord(word:u32)->u32{let block=orders[word/8u];return select(block.order[word%4u],block.roster[word%4u],word%8u>=4u);}
${slotLookupWgsl(capacity,'slotWord(word)','u32(u.clock.z)')}
`:'fn groupSlot(group:u32,ordinal:u32)->u32{return orders[group].roster.x+ordinal;}';}
