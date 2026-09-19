import {createPopulationCatalog} from './population-catalog.mjs';
import {regroupPopulation} from './population-regrouping.mjs';
import {fleetCapacity} from './runtime-capacity.mjs';
import {createOccupancyDirector} from './sparse-identity.mjs';
import {defaultNearbySlots,NEARBY_SLOTS} from './nearby-bodies.mjs';
import {createRoster} from './roster.mjs';
import {authorTactic,validateJourney} from './tactics.mjs';
import {TYPES,CLASSES,cohortSizes,classMask} from './classes.mjs';
export {TYPES};
export const STRATEGY=Object.freeze({pass:0,pursue:1,hold:2,withdraw:3});
export function visualSurvivors(initialLogical,initialVisual,remainingLogical) {
  if(!Number.isInteger(initialLogical)||initialLogical<1)throw new Error('Invalid initial logical count');
  if(!Number.isInteger(initialVisual)||initialVisual<1||initialVisual>256)throw new Error('Invalid visual count');
  if(!Number.isInteger(remainingLogical)||remainingLogical<0||remainingLogical>initialLogical)throw new Error('Invalid remaining count');
  return Math.round(initialVisual*remainingLogical/initialLogical);
}
function validateReport(report,revision,fleetCount) {
  if(!Number.isSafeInteger(report.revision)||report.revision<=revision)return false;
  if(!Number.isInteger(report.fleet)||report.fleet<0||report.fleet>=fleetCount)throw new Error('Unknown fleet');
  if(report.type!==undefined&&(!Number.isInteger(report.type)||report.type<0||report.type>=TYPES))throw new Error('Unknown ship type');
  return true;
}
function targetMask(report,previous) {
  if(report.attackClass!==undefined) {
    if(!Number.isInteger(report.attackClass)||!CLASSES[report.attackClass])throw new Error('Unknown target class');
    return classMask(report.attackClass);
  }
  if(report.attackType===undefined)return previous;
  if(!Number.isInteger(report.attackType)||report.attackType<0||report.attackType>=TYPES)throw new Error('Unknown target type');
  return (1<<report.attackType)>>>0;
}
function membership(value){if(typeof value!=='boolean')throw new Error('Invalid membership');return Number(value);}
function updateGroup(previous,report,quota) {
  const next=[...previous];
  if(quota!==undefined)next[0]=quota;

  if(report.strategy!==undefined){if(!Object.hasOwn(STRATEGY,report.strategy))throw new Error('Unknown strategy');next[1]=STRATEGY[report.strategy];}
  next[2]=targetMask(report,previous[2]);
  if(report.joined!==undefined)next[3]=membership(report.joined);

  return next;
}
function changedRoster(roster,report) {
  if(report.admit===undefined&&report.survivalFraction===undefined&&report.remaining===undefined)return roster;
  const result=roster.clone();
  if(report.admit!==undefined)result.admit(report.fleet,report.admit);
  applyLoss(result,report);
  return result;
}
function lossCohorts(roster,report) {
  if(report.cohort!==undefined&&!roster.cohorts[report.fleet][report.cohort].admitted)throw new Error('Cannot report losses for an unadmitted cohort');
  return report.cohort===undefined?[0,1]:[report.cohort];
}
function applyLoss(roster,report) {
  if(report.survivalFraction!==undefined) {
    if(report.type!==undefined||report.remaining!==undefined)throw new Error('Fleet fraction cannot be mixed with per-type losses');
    const cohorts=lossCohorts(roster,report);
    for(const cohort of cohorts)if(roster.cohorts[report.fleet][cohort]?.admitted)roster.lose(report.fleet,cohort,report.survivalFraction);
  }
  if(report.remaining!==undefined) {
    if(report.type===undefined)throw new Error('Per-type survivor report needs a type');
    roster.remaining(report.fleet,report.type,report.remaining);
  }
}
function updateJourney(intent,report) {
  const value=validateJourney(report.journey),cohort=report.cohort??0;
  if(value.revision>(intent.journeys[cohort]?.revision??0))intent.journeys[cohort]=value;
}
function changedIntent(previous,report,type) {
  const next={...previous,journeys:[...previous.journeys]};
  if(report.tactic!==undefined){const value=authorTactic({...report.tactic,fleet:report.fleet,type});if(value.revision>(previous.tactic?.revision??0))next.tactic=value;}
  if(report.fire!==undefined)next.fire=membership(report.fire);
  if(report.journey!==undefined)updateJourney(next,report);
  return next;
}
export function createDirector(count,options={}) {
  return Array.isArray(options.occupancy)?createOccupancyDirector(options.occupancy,{...options,count}):createDenseDirector(count,options);
}
function createDenseDirector(count,options) {
  const capacity=fleetCapacity(options.fleetCount??2),{fleetCount}=capacity;
  if(!Number.isInteger(count)||count%fleetCount||count<fleetCount*32||count>10000)throw new Error('Population must fit 32 types per fleet and divide equally among fleets, up to 10000');
  const sizes=cohortSizes(count/fleetCount),groups=new Uint32Array(capacity.groups*8);
  const groupEpochs=new Float64Array(capacity.groups);
  const navigationEpochs=new Float64Array(capacity.groups*2);
  const battles=new Uint32Array(fleetCount*4),encounters=new Float32Array(fleetCount*4);
  const nearby=new Uint32Array(fleetCount*NEARBY_SLOTS);
  for(let fleet=0;fleet<fleetCount;fleet++) {
    battles.set([1,fleet,0,0],fleet*4);
    nearby.set(defaultNearbySlots(),fleet*NEARBY_SLOTS);
  }
  const intents=Array.from({length:capacity.groups},()=>({tactic:null,journeys:[null,null],fire:0}));
  let roster=createRoster(sizes,{...options,fleetCount}),slot=0,revision=0;
  for(let g=0;g<capacity.groups;g++) {
    const type=g%TYPES,n=sizes[type];groups.set([roster.count(Math.floor(g/TYPES),type),0,(1<<type)>>>0,0,slot,n,n*20,0],g*8);slot+=n;
  }
  let population=createPopulationCatalog(groups,roster,options.identityStart??1);
  function apply(report) {
    if(!validateReport(report,revision,fleetCount))return false;
    if(report.cohort!==undefined&&![0,1].includes(report.cohort))throw new Error('Unknown cohort');
    const battle=validateBattle(battles,report),center=validateCenter(report);
    const candidate=changedRoster(roster,report),pending=[];
    for(let type=0;type<TYPES;type++) {
      if(report.type!==undefined&&report.type!==type)continue;
      const g=report.fleet*TYPES+type,offset=g*8;
      const value=updateGroup(groups.slice(offset,offset+8),report,candidate.count(report.fleet,type));
      pending.push({g,offset,value,intent:changedIntent(intents[g],report,type)});
    }
    for(const {g,offset,value,intent} of pending){groups.set(value,offset);groupEpochs[g]=report.revision;stampNavigation(navigationEpochs,g,report,intents[g],intent);intents[g]=intent;}
    if(center)encounters.set(center,report.fleet*4);
    battles.set(battle,report.fleet*4);roster=candidate;revision=report.revision;return true;
  }
  const director={capacity,fleetCount,groupEpochs,navigationEpochs,battles,encounters,nearby,canTarget:(a,b)=>a!==b&&battles[a*4]!==0&&battles[a*4]===battles[b*4]&&battles[a*4+1]!==battles[b*4+1],groups,intents,apply,fork,adopt,reinforce,retire,regroup,get population(){return population;},get roster(){return roster;},get revision(){return revision;},get alive(){return groups.filter((_,i)=>i%8===0).reduce((a,b)=>a+b,0);}};
  function regroup(requests) {
    const next=regroupPopulation(roster,population,requests);
    roster=next.roster;population=next.population;revision++;
    for(const group of next.groups) {
      const fleet=group>>>5,type=group&31;
      groups[group*8]=roster.count(fleet,type);groups[group*8+5]=roster.sizeFor(fleet,type);groups[group*8+6]=roster.logicalCapacity(fleet,type);
      groupEpochs[group]=revision;navigationEpochs[group*2]=revision;navigationEpochs[group*2+1]=revision;
    }
    return next.members;
  }
  function reinforce(report) {
    if(!validateReport(report,revision,fleetCount))return false;
    if(report.type===undefined)throw Error('Reinforcement needs a ship type');
    const candidate=roster.clone(),batch=candidate.reinforce(report.fleet,report.type,report.visual,report.logical,report.cohort??0);
    const next=population.append(report.fleet,report.type,batch),group=report.fleet*32+report.type;
    groups[group*8]=candidate.count(report.fleet,report.type);groups[group*8+5]=candidate.sizeFor(report.fleet,report.type);groups[group*8+6]=candidate.logicalCapacity(report.fleet,report.type);
    const firstId=population.nextId,firstIndex=population.count;population=next;roster=candidate;revision=report.revision;
    groupEpochs[group]=revision;navigationEpochs[group*2+(report.cohort??0)]=revision;
    return {...batch,firstId,firstIndex,fleet:report.fleet,type:report.type};
  }
  function retire(ids) {
    const indices=ids.map(id=>population.indexOf(id));
    if(indices.some(i=>i<0)||new Set(indices).size!==indices.length)throw Error('Unknown or duplicate retirement identity');
    const removed=new Set(indices),candidate=roster.clone(),keys=indices.map(i=>population.keys[i]);candidate.retire(keys);
    const kept=Array.from({length:population.count},(_,i)=>i).filter(i=>!removed.has(i));
    population=population.retain(kept);roster=candidate;revision++;
    for(const key of keys) {
      const group=key>>>8,fleet=group>>>5,type=group&31;
      groups[group*8+5]=roster.sizeFor(fleet,type);groups[group*8+6]=roster.logicalCapacity(fleet,type);groupEpochs[group]=revision;
    }
    return kept;
  }
  function fork() {
    const copy=createDirector(count,options);copy.adopt(director,false);return copy;
  }
  // Internal commit seam: external payloads are validated into a detached
  // director first. Live typed-array identities remain stable for consumers.
  function adopt(candidate,invalidate=true) {
    if(candidate.fleetCount!==fleetCount||candidate.groups.length!==groups.length)throw new Error('Snapshot population layout differs');
    groups.set(candidate.groups);battles.set(candidate.battles);encounters.set(candidate.encounters);nearby.set(candidate.nearby);
    for(let g=0;g<intents.length;g++)intents[g]=structuredClone(candidate.intents[g]);
    roster=candidate.roster.clone();population=candidate.population.clone();revision=Math.max(revision,candidate.revision)+Number(invalidate);
    groupEpochs.set(candidate.groupEpochs);navigationEpochs.set(candidate.navigationEpochs);
    if(invalidate)groupEpochs.fill(revision);
  }
  return director;
}

function validateBattle(battles,report) {
  const result=battles.slice(report.fleet*4,report.fleet*4+4);
  for(const [index,key] of ['battle','team'].entries()) {
    if(report[key]===undefined)continue;
    if(report.type!==undefined)throw new Error('Battle and team membership are fleet-level commands');
    if(!Number.isSafeInteger(report[key])||report[key]<0||report[key]>0xffffffff)throw new Error(`Invalid ${key}`);
    result[index]=report[key];
  }
  return result;
}

function validateCenter(report) {
  if(report.battleCenter===undefined)return null;
  if(report.type!==undefined)throw new Error('Battle center is fleet-level');
  const value=report.battleCenter;
  if(value===null)return [0,0,0,0];
  if(!Array.isArray(value)||value.length!==3||!value.every(Number.isFinite))throw new Error('Invalid battle center');
  return [...value,1];
}

// Casualties, target filtering and fire reports do not revoke a pending journey.
// Navigation/role orders do; epochs also distinguish change-away-and-back races.
function stampNavigation(epochs,group,report,before,after) {
  const role=['joined','strategy','battle','team','battleCenter'].some(key=>report[key]!==undefined);
  if(role){epochs[group*2]=report.revision;epochs[group*2+1]=report.revision;}
  const cohort=report.cohort??0;
  if(after.journeys[cohort]!==before.journeys[cohort])epochs[group*2+cohort]=report.revision;
}
