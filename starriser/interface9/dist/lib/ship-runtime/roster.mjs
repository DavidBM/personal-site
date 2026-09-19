import {availableOrdinals,ordinalCapacity,retireOrdinals} from './roster-membership.mjs';
import {departingBatches} from './roster-transfer.mjs';
import {initialBatches,logicalInteger,MAX_LOGICAL,removeLogical,visualQuota} from './population-accounting.mjs';
export const MASK_WORDS=8;
const bit=ordinal=>(1<<(ordinal%32))>>>0;
const key=(fleet,type)=>fleet*32+type;
export function maskHas(masks,group,ordinal){return (masks[group*MASK_WORDS+Math.floor(ordinal/32)]&bit(ordinal))!==0;}
function setBit(masks,group,ordinal,value) {
  const index=group*MASK_WORDS+Math.floor(ordinal/32),flag=bit(ordinal);
  masks[index]=value?(masks[index]|flag)>>>0:(masks[index]&~flag)>>>0;
}
function validateFleet(fleet,count){if(!Number.isInteger(fleet)||fleet<0||fleet>=count)throw new Error('Unknown fleet');}
function validateFraction(fraction){if(!Number.isFinite(fraction)||fraction<0||fraction>1)throw new Error('Invalid survivor fraction');}
function validateType(type){if(!Number.isInteger(type)||type<0||type>=32)throw new Error('Unknown type');}
function rankedEntries(batches,cohort) {
  const entries=[];
  for(let type=0;type<32;type++) {
    const ordinals=batches[type].filter(b=>b.cohort===cohort).flatMap(b=>b.ordinals);
    for(const [index,ordinal] of ordinals.entries())entries.push({type,ordinal,rank:(index+.5)/ordinals.length});
  }
  return entries.sort((a,b)=>a.rank-b.rank||a.type-b.type);
}
export function createRoster(sizes,{reserveFraction=0,fleetCount=2,initialFleets=Array.from({length:fleetCount},(_,i)=>i)}={}) {
  validateInitial(sizes,reserveFraction,initialFleets,fleetCount);
  const live=new Uint32Array(fleetCount*32*MASK_WORDS),admitted=new Uint32Array(live.length);
  const split=sizes.map(n=>Math.max(1,n-Math.floor(n*reserveFraction)));
  const capacities=Uint32Array.from({length:fleetCount*32},(_,g)=>sizes[g%32]);
  let batches=initialBatches(sizes,split,fleetCount);
  const residual=new Uint32Array(fleetCount*64);
  const ranksByFleet=Array.from({length:fleetCount},()=>[[],[]]);
  function rebuild(fleet){for(let cohort=0;cohort<2;cohort++)ranksByFleet[fleet][cohort]=rankedEntries(batches.slice(fleet*32,fleet*32+32),cohort);}
  for(let f=0;f<fleetCount;f++)rebuild(f);
  const cohorts=Array.from({length:fleetCount},(_,f)=>[0,1].map(c=>({admitted:false,quota:0,baseline:0})));
  const retainedFor=(fleet,type)=>batches[key(fleet,type)].reduce((sum,b)=>sum+b.ordinals.length,0);
  const sizeFor=(fleet,type)=>capacities[key(fleet,type)];
  const cohortOf=(fleet,type,ordinal)=>batches[key(fleet,type)].find(b=>b.ordinals.includes(ordinal))?.cohort;
  const cohortSize=(fleet,type,cohort)=>batches[key(fleet,type)].filter(b=>b.cohort===cohort).reduce((sum,b)=>sum+b.ordinals.length,0);
  const entries=(fleet,cohort)=>ranksByFleet[fleet][cohort];
  const isLive=(fleet,type,ordinal)=>maskHas(live,key(fleet,type),ordinal);
  const batchLive=(group,batch)=>batch.ordinals.filter(n=>maskHas(live,group,n));
  const activeBatches=group=>batches[group].filter(b=>b.admitted);
  const hidden=group=>residual[group*2]+residual[group*2+1];
  const logicalCount=(fleet,type)=>activeBatches(key(fleet,type)).reduce((sum,b)=>sum+b.logical,hidden(key(fleet,type)));
  const logicalCapacity=(fleet,type)=>batches[key(fleet,type)].reduce((sum,b)=>sum+b.initialLogical,hidden(key(fleet,type)));
  function admit(fleet,cohort) {
    validateFleet(fleet,fleetCount);const state=cohorts[fleet][cohort];if(!state)throw new Error('Unknown cohort');
    let changed=0;
    for(const {type,ordinal} of entries(fleet,cohort)) {
      const group=key(fleet,type);if(maskHas(admitted,group,ordinal))continue;
      setBit(admitted,group,ordinal,true);setBit(live,group,ordinal,true);changed++;
    }
    for(let type=0;type<32;type++)for(const batch of batches[key(fleet,type)])if(batch.cohort===cohort)batch.admitted=true;
    state.admitted=true;state.quota+=changed;state.baseline+=changed;return changed>0;
  }
  function lose(fleet,cohort,fraction) {
    validateFleet(fleet,fleetCount);validateFraction(fraction);const state=cohorts[fleet][cohort];
    if(!state?.admitted)throw new Error('Cannot report losses for an unadmitted cohort');
    const allowed=entries(fleet,cohort).filter(({type,ordinal})=>maskHas(admitted,key(fleet,type),ordinal));
    const quota=Math.round(state.baseline*fraction);
    if(quota>state.quota)throw new Error('Loss report cannot resurrect identities');
    const survivors=allowed.filter(({type,ordinal})=>isLive(fleet,type,ordinal));
    for(const {type,ordinal} of survivors.slice(quota))setBit(live,key(fleet,type),ordinal,false);
    state.quota=quota;
    if(fraction===0)for(let type=0;type<32;type++)residual[key(fleet,type)*2+cohort]=0;
    for(let type=0;type<32;type++)for(const batch of activeBatches(key(fleet,type)).filter(b=>b.cohort===cohort)) {
      batch.logical=Math.min(batch.logical,Math.round(batch.initialLogical*batchLive(key(fleet,type),batch).length/batch.count));
    }
  }
  function remaining(fleet,type,logical) {
    validateFleet(fleet,fleetCount);validateType(type);
    const group=key(fleet,type),active=activeBatches(group);
    const hidden=[0,1].map(cohort=>({logical:residual[group*2+cohort]}));removeLogical([...active,...hidden],logical);
    for(let cohort=0;cohort<2;cohort++)residual[group*2+cohort]=hidden[cohort].logical;
    for(const batch of active) {
      const lost=batchLive(group,batch).slice(visualQuota(batch));
      for(const ordinal of lost)setBit(live,group,ordinal,false);
      cohorts[fleet][batch.cohort].quota-=lost.length;
    }
  }
  function count(fleet,type){return Array.from({length:sizeFor(fleet,type)},(_,ordinal)=>Number(isLive(fleet,type,ordinal))).reduce((a,b)=>a+b,0);}
  function reinforce(fleet,type,visual,logical,cohort=0) {
    validateFleet(fleet,fleetCount);validateType(type);
    if(![0,1].includes(cohort)||!Number.isInteger(visual)||visual<1||visual>256)throw Error('Reinforcement exceeds the type ordinal capacity');
    if(!logicalInteger(logical)||logical<visual||logicalCapacity(fleet,type)+logical>MAX_LOGICAL)throw Error('Invalid reinforcement logical count');
    const group=key(fleet,type),ordinals=availableOrdinals(batches[group],visual),first=ordinals[0],batch={first,count:visual,cohort,initialLogical:logical,logical,ordinals,admitted:true};
    batches[group].push(batch);capacities[group]=ordinalCapacity(batches[group]);
    for(const ordinal of ordinals){setBit(admitted,group,ordinal,true);setBit(live,group,ordinal,true);}
    cohorts[fleet][cohort].admitted=true;cohorts[fleet][cohort].quota+=visual;cohorts[fleet][cohort].baseline+=visual;rebuild(fleet);return batch;
  }
  function retire(keys) {
    const grouped=new Map();
    for(const value of keys) {
      const group=value>>>8,ordinal=value&255;
      if(maskHas(live,group,ordinal)||!maskHas(admitted,group,ordinal))throw Error('Only admitted casualties can retire');
      const list=grouped.get(group)??[];list.push(ordinal);grouped.set(group,list);
    }
    for(const [group,ordinals] of grouped) {
      batches[group]=retireOrdinals(batches[group],ordinals,residual.subarray(group*2,group*2+2));
      for(const ordinal of ordinals)setBit(admitted,group,ordinal,false);
      capacities[group]=ordinalCapacity(batches[group]);rebuild(Math.floor(group/32));
    }
  }
  function depart(fleet,type,ordinals,logical,cohort=0) {
    validateFleet(fleet,fleetCount);validateType(type);
    if(![0,1].includes(cohort))throw Error('Unknown cohort');
    const group=key(fleet,type),state=cohorts[fleet][cohort];
    const liveOrdinals=activeBatches(group).filter(b=>b.cohort===cohort).flatMap(b=>batchLive(group,b));
    const next=departingBatches(batches[group],cohort,liveOrdinals,ordinals,logical,residual[group*2+cohort]);
    batches[group]=next.batches;residual[group*2+cohort]=next.residual;
    for(const ordinal of ordinals){setBit(live,group,ordinal,false);setBit(admitted,group,ordinal,false);}
    state.quota-=ordinals.length;state.baseline-=ordinals.length;
    capacities[group]=ordinalCapacity(batches[group]);rebuild(fleet);
  }
  function receiveLogical(fleet,type,logical,cohort=0) {
    validateFleet(fleet,fleetCount);validateType(type);
    if(![0,1].includes(cohort)||!logicalInteger(logical)||logical<1||logicalCapacity(fleet,type)+logical>MAX_LOGICAL)throw Error('Invalid unrepresented transfer count');
    residual[key(fleet,type)*2+cohort]+=logical;cohorts[fleet][cohort].admitted=true;
    return {ordinals:[]};
  }
  function clone() {
    const copy=createRoster(sizes,{reserveFraction,fleetCount,initialFleets:[]});copy.restore(roster);return copy;
  }
  function restore(other) {
    live.set(other.live);admitted.set(other.admitted);residual.set(other.residual);capacities.set(other.capacities);batches=structuredClone(other.batches);
    for(let f=0;f<fleetCount;f++){for(let c=0;c<2;c++)Object.assign(cohorts[f][c],other.cohorts[f][c]);rebuild(f);}
  }
  for(const fleet of initialFleets)admit(fleet,0);
  const roster={fleetCount,live,admitted,residual,retire,depart,receiveLogical,cohorts,capacities,split,sizes,count,admit,lose,remaining,clone,restore,isLive,reinforce,entries,cohortSize,sizeFor,retainedFor,cohortOf,logicalCount,logicalCapacity,
    get batches(){return batches;},get ranks(){return ranksByFleet[0];}};
  return roster;
}

function validateInitial(sizes,reserveFraction,initialFleets,fleetCount) {
  validateFraction(reserveFraction);
  if(!Array.isArray(initialFleets))throw new Error('Invalid initial fleets');
  for(const fleet of initialFleets)validateFleet(fleet,fleetCount);
  if(sizes.length!==32||sizes.some(n=>!Number.isInteger(n)||n<1||n>256))throw new Error('Invalid type capacities');
}
