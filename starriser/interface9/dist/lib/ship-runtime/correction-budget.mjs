import {CORRECTIONS_PER_POPULATION} from './correction-gpu.mjs';
import {eventFrameOverflow} from './event-frame.mjs';
// Conservative admission bound: count even already-arrived and dead members.
// A cohort can correct once for its current intent and once per replacement.
// A primary replacement also bounds the reserved ordinals: an absent second
// intent falls back to the primary on GPU, including after admission.
// No GPU readback or individual pose inspection is needed in the frame path.
function mayCorrect(journey,start,end,origin) {
  if(!journey)return false;
  if(journey.mode==='approach')return Math.fround(journey.end-origin)<=Math.fround(end-origin);
  return ['warp','escape'].includes(journey.mode)&&Math.fround(journey.end-origin)<=Math.fround(start-origin);
}
function cohortSize(director,fleet,type,cohort,fallback=false) {
  if(cohort===0&&fallback)return director.roster.sizeFor(fleet,type);
  return director.roster.cohortSize(fleet,type,cohort);
}
export function validateCorrectionBudget(events,start,end,director,count,origin=0) {
  let records=currentCorrections(director,start,end,origin);
  for(const event of events) {
    const at=Math.max(start,event.effectiveAt,event.deliveredAt);
    for(const command of event.commands) {
      if(!mayCorrect(command.journey,at,end,origin))continue;
      records+=command.type===undefined?director.roster.sizes.reduce((n,_,type)=>n+cohortSize(director,command.fleet,type,command.cohort??0,true),0):cohortSize(director,command.fleet,command.type,command.cohort??0,true);
    }
    records+=routeCorrections(event,at,end,director,origin);
  }
  if(records>count*CORRECTIONS_PER_POPULATION)throw eventFrameOverflow('Correction history budget exhausted; reconcile the interval');
  return records;
}

function routeCorrections(event,at,end,director,origin) {
  let count=0;
  for(const plan of event.routes??[]) {
    if(!mayCorrect({mode:'approach',end:plan.request.end},at,end,origin))continue;
    const covered=event.commands.some(command=>coversRoute(command,plan));
    if(!covered)count+=cohortSize(director,plan.fleet,plan.type,plan.cohort??0,true);
  }
  return count;
}
function coversRoute(command,plan) {
  return command.fleet===plan.fleet&&(command.type===undefined||command.type===plan.type)&&(command.cohort??0)===(plan.cohort??0)&&command.journey?.mode==='approach'&&command.journey.revision===plan.revision&&command.journey.end===plan.request.end;
}

function currentCorrections(director,start,end,origin) {
  let records=0;
  for(let group=0;group<director.capacity.groups;group++) {
    for(let cohort=0;cohort<2;cohort++) {
      if(mayCorrect((director.intents[group].journeys[cohort]??director.intents[group].journeys[0]),start,end,origin))records+=cohortSize(director,Math.floor(group/32),group%32,cohort);
    }
  }
  return records;
}
