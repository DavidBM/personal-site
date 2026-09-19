import {createSequence} from './sequence.mjs';
export const LIFECYCLE_DURATION=100;
const journey=(mode,revision,at,end,exit=[0,0,0])=>({mode,revision,at,end,exit,...(['orbit','approach'].includes(mode)?{planet:1}:{})});
const event=(id,at,label,commands)=>({id,effectiveAt:at,deliveredAt:at,label,commands});
function shiftReport(command,offset) {
  const copy=structuredClone(command);
  if(copy.journey){copy.journey.revision+=3;copy.journey.at+=offset;copy.journey.end+=offset;if(copy.journey.mode==='approach')copy.journey.planet=1;}
  if(copy.tactic)copy.tactic.at+=offset;
  return copy;
}
export function createLifecycleSequence() {
  const fleets=[0,1],offset=22;
  const prefix=[
    event('initial-orbit',0,'Fleets orbit the moving planet',fleets.map(fleet=>({fleet,journey:journey('orbit',1,0,0)}))),
    event('departure',6,'Director orders departure',fleets.map(fleet=>({fleet,journey:journey('departure',2,6,14,[-80,60,0])}))),
    event('outbound-warp',14,'Clear-corridor warp',fleets.map(fleet=>({fleet,journey:journey('warp',3,14,21,[-20,40,80])}))),
  ];
  const battle=createSequence().map(e=>({...e,effectiveAt:e.effectiveAt+offset,deliveredAt:e.deliveredAt+offset,commands:e.commands.map(c=>shiftReport(c,offset))}));
  const suffix=[
    event('recall',82,'Director recalls escaped fleet',[0,1].map(cohort=>({fleet:0,cohort,journey:journey('warp',9,82,86,[-20,40,80])}))),
    event('recall-approach',86,'Returning fleet approaches planet',[0,1].map(cohort=>({fleet:0,cohort,journey:journey('approach',10,86,92)}))),
    event('final-orbit',92,'Survivors settle into class-specific rings',fleets.flatMap(fleet=>[0,1].map(cohort=>({fleet,cohort,joined:false,fire:false,journey:journey('orbit',11,92,92)})))),
  ];
  return [...prefix,...battle,...suffix];
}
