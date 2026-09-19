import {populationIdentity} from './population-catalog.mjs';
import {restoreGroupPopulation,validatePopulationCohorts,newAdmissions} from './population-snapshot.mjs';
import {STRATEGY} from './director.mjs';
import {authorTactic,validateJourney} from './tactics.mjs';
const STRATEGIES=Object.keys(STRATEGY);
const uint=(value,max=0xffffffff)=>Number.isInteger(value)&&value>=0&&value<=max;
function canonical(value) {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export function exportDirector(director) {
  const fleets=Array.from({length:director.fleetCount},(_,fleet)=>({
    battle:director.battles[fleet*4],team:director.battles[fleet*4+1],
    center:director.encounters[fleet*4+3]?Array.from(director.encounters.slice(fleet*4,fleet*4+3)):null,
    cohorts:structuredClone(director.roster.cohorts[fleet]),
  }));
  const groups=director.intents.map((intent,group)=>({
    strategy:STRATEGIES[director.groups[group*8+1]],targets:director.groups[group*8+2],joined:Boolean(director.groups[group*8+3]),
    ...structuredClone(intent),residual:Array.from(director.roster.residual.slice(group*2,group*2+2)),admitted:Array.from(director.roster.admitted.slice(group*8,group*8+8)),batches:structuredClone(director.roster.batches[group]),live:Array.from(director.roster.live.slice(group*8,group*8+8)),
  }));
  return {version:4,population:populationIdentity(director.population),sizes:[...director.roster.sizes],split:[...director.roster.split],fleets,groups};
}
function layout(value,current) {
  if(value.version!==4||!same(value.population,populationIdentity(current.population))||!same(value.sizes,[...current.roster.sizes])||!same(value.split,[...current.roster.split]))throw new Error('Snapshot population layout differs');
  if(!Array.isArray(value.fleets)||value.fleets.length!==current.fleetCount||!Array.isArray(value.groups)||value.groups.length!==current.capacity.groups)throw new Error('Incomplete director snapshot');
}
function unadmitted(row,previous){if(previous.admitted||row.quota!==previous.quota)throw new Error('Snapshot cannot revoke admission');}
function admission(candidate,fleet,cohorts,groups) {
  if(!Array.isArray(cohorts)||cohorts.length!==2)throw new Error('Invalid snapshot cohorts');
  for(let cohort=0;cohort<2;cohort++) {
    const row=cohorts[cohort],previous=candidate.roster.cohorts[fleet][cohort],size=candidate.roster.entries(fleet,cohort).length;
    if(row.baseline!==previous.baseline+newAdmissions(candidate,fleet,cohort,groups))throw new Error('Snapshot cohort admission baseline differs');
    if(typeof row.admitted!=='boolean'||!uint(row.quota,size))throw new Error('Invalid snapshot cohort state');
    if(!row.admitted){unadmitted(row,previous);continue;}
    if(row.quota>previous.quota+newAdmissions(candidate,fleet,cohort,groups))throw new Error('Snapshot cannot restore cohort casualties');
    Object.assign(previous,row);
  }
}
function journey(value,previous) {
  if(value===null){if(previous!==null)throw new Error('Snapshot cannot regress an accepted journey');return null;}
  const result=validateJourney(value);
  sceneJourney(result);
  if(previous&&result.revision<previous.revision)throw new Error('Snapshot journey revision regressed');
  if(previous&&result.revision===previous.revision&&!same(result,previous))throw new Error('Conflicting snapshot journey');
  return result;
}
function tactic(value,previous,fleet,type) {
  if(value===null){if(previous!==null)throw new Error('Snapshot cannot regress an accepted tactic');return null;}
  const result=authorTactic({...value,fleet,type});
  if(previous&&result.revision<previous.revision)throw new Error('Snapshot tactic revision regressed');
  if(previous&&result.revision===previous.revision&&!same(result,previous))throw new Error('Conflicting snapshot tactic');
  return result;
}
function groupState(candidate,group,row) {
  if(!Object.hasOwn(STRATEGY,row.strategy)||!uint(row.targets)||typeof row.joined!=='boolean'||![0,1].includes(row.fire))throw new Error('Invalid snapshot group order');
  if(!Array.isArray(row.journeys)||row.journeys.length!==2)throw new Error('Incomplete snapshot journeys');
  const fleet=Math.floor(group/32),type=group%32,previous=candidate.intents[group];
  const journeys=row.journeys.map((value,cohort)=>journey(value,previous.journeys[cohort]));
  const nextTactic=tactic(row.tactic,previous.tactic,fleet,type);
  restoreGroupPopulation(candidate,group,row);
  candidate.apply({revision:candidate.revision+1,fleet,type,strategy:row.strategy,joined:row.joined,fire:Boolean(row.fire)});
  candidate.groups[group*8+2]=row.targets;
  candidate.intents[group]={fire:row.fire,tactic:nextTactic,journeys};
}
// No live state mutates while decoding/validating an authoritative snapshot.
// Snapshot identity membership is presentation-owned; slots are never imported.
export function prepareDirectorSnapshot(current,input) {
  const serialized=JSON.stringify(input);
  if(typeof serialized!=='string'||new TextEncoder().encode(serialized).length>2*1024*1024)throw new Error('Director snapshot exceeds size limit');
  const value=structuredClone(input);layout(value,current);const candidate=current.fork();
  for(const [fleet,row] of value.fleets.entries()) {
    fleetState(row);
    admission(candidate,fleet,row.cohorts,value.groups);
    candidate.apply({revision:candidate.revision+1,fleet,battle:row.battle,team:row.team,battleCenter:row.center});
  }
  for(const [group,row] of value.groups.entries())groupState(candidate,group,row);
  validatePopulationCohorts(candidate);retainNavigationEpochs(current,candidate);return candidate;
}

function navigationKey(director,group,cohort) {
  const fleet=Math.floor(group/32);
  return [director.groups[group*8+1],director.groups[group*8+3],...director.battles.slice(fleet*4,fleet*4+2),...director.encounters.slice(fleet*4,fleet*4+4),director.intents[group].journeys[cohort]];
}
function retainNavigationEpochs(current,candidate) {
  for(let group=0;group<current.capacity.groups;group++)for(let cohort=0;cohort<2;cohort++) {
    const index=group*2+cohort;
    if(same(navigationKey(current,group,cohort),navigationKey(candidate,group,cohort)))candidate.navigationEpochs[index]=current.navigationEpochs[index];
  }
}

function sceneJourney(result) {
  if(result.exit.some(x=>Math.abs(x)>1e9)||Math.abs(result.planeShift??0)>1e6)throw new Error('Snapshot journey exceeds scene bounds');
}
function fleetState(row) {
  if(!uint(row.battle)||!uint(row.team)||!Object.hasOwn(row,'center'))throw new Error('Incomplete snapshot fleet state');
  if(row.center!==null&&(!Array.isArray(row.center)||row.center.some(x=>Math.abs(x)>1e9)))throw new Error('Snapshot encounter exceeds scene bounds');
}
