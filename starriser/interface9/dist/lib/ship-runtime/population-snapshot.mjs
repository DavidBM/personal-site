import {maskHas} from './roster.mjs';
import {logicalInteger,visualQuota} from './population-accounting.mjs';
const uint=value=>Number.isInteger(value)&&value>=0&&value<=0xffffffff;
function masks(value){if(!Array.isArray(value)||value.length!==8||!value.every(uint))throw Error('Invalid snapshot population mask');}
export function restoreGroupPopulation(candidate,group,row) {
  masks(row.admitted);masks(row.live);
  const roster=candidate.roster,owned=new Set(roster.batches[group].flatMap(b=>b.ordinals));
  for(let word=0;word<8;word++) {
    const at=group*8+word,old=roster.admitted[at],next=row.admitted[word];
    if((old&~next)!==0)throw Error('Snapshot cannot revoke admission');
    for(let bit=0;bit<32;bit++)if(!owned.has(word*32+bit)&&(next&(1<<bit))!==0)throw Error('Snapshot invents an ordinal');
    const allowed=roster.live[at]|(next&~old);
    if((row.live[word]&~allowed)!==0)throw Error('Snapshot cannot resurrect or invent identities');
    roster.admitted[at]=next;roster.live[at]=row.live[word];
  }
  restoreResidual(roster,group,row.residual);
  const batches=roster.batches[group];
  if(!Array.isArray(row.batches)||row.batches.length!==batches.length)throw Error('Snapshot admission batches differ');
  for(let i=0;i<batches.length;i++)restoreBatch(roster,group,batches[i],row.batches[i]);
}
function restoreBatch(roster,group,previous,row) {
  if(!sameBatchLayout(previous,row))throw Error('Snapshot admission batch identity differs');
  if(!logicalInteger(row.logical)||row.logical>previous.logical)throw Error('Snapshot cannot restore logical casualties');
  let live=0;const admitted=row.admitted;
  if(typeof admitted!=='boolean'||(previous.admitted&&!admitted))throw Error('Snapshot cannot revoke batch admission');
  for(const i of previous.ordinals) {
    if(maskHas(roster.admitted,group,i)!==admitted)throw Error('Snapshot partially admits a logical batch');
    live+=Number(maskHas(roster.live,group,i));
  }
  if(live>visualQuota(row))throw Error('Snapshot visual survivors exceed the logical batch');
  previous.logical=row.logical;previous.admitted=admitted;
}

export function newAdmissions(candidate,fleet,cohort,groups) {
  return candidate.roster.entries(fleet,cohort).filter(({type,ordinal})=>{
    const group=fleet*32+type;const mask=groups[group].admitted;masks(mask);
    return !maskHas(candidate.roster.admitted,group,ordinal)&&(mask[ordinal>>>5]&(1<<(ordinal%32)))!==0;
  }).length;
}
export function validatePopulationCohorts(candidate) {
  for(let fleet=0;fleet<candidate.fleetCount;fleet++)for(let cohort=0;cohort<2;cohort++) {
    const rows=candidate.roster.entries(fleet,cohort),state=candidate.roster.cohorts[fleet][cohort];
    const admitted=rows.some(({type,ordinal})=>maskHas(candidate.roster.admitted,fleet*32+type,ordinal));
    const alive=rows.filter(({type,ordinal})=>candidate.roster.isLive(fleet,type,ordinal)).length;
    if((admitted&&!state.admitted)||alive!==state.quota)throw Error('Snapshot cohort accounting differs from its membership');
  }
}

function restoreResidual(roster,group,value) {
  if(!Array.isArray(value)||value.length!==2||value.some((n,c)=>!uint(n)||n>roster.residual[group*2+c]))throw Error('Snapshot cannot restore unrepresented logical casualties');
  roster.residual.set(value,group*2);
}
function sameBatchLayout(a,b) {
  return ['first','count','cohort','initialLogical'].every(key=>a[key]===b[key])&&JSON.stringify(a.ordinals)===JSON.stringify(b.ordinals);
}
