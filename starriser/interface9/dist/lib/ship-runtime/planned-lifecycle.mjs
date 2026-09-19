import {createSequence} from './sequence.mjs';
import {approachRequest} from './local-routes.mjs';
import {CLASS_BY_TYPE} from './classes.mjs';
const event=(id,at,label,commands=[],routes=[])=>({id,effectiveAt:at,deliveredAt:at,label,commands,routes});
const journey=(mode,revision,at,end,exit=[0,0,0])=>({mode,revision,at,end,exit,...(['orbit','approach'].includes(mode)?{planet:1}:{})});
function entry(model,type,fleet,at) {
  const body=model.bodyAt(1,at),large=type>=30;
  const offset=[-20,100+(large?(fleet*2-1)*40:0),large?(type===31?-1:1)*80:0];
  return offset.map((x,i)=>x+body[i]);
}
function planEntry(model,type,fleet,at,revision) {
  const start=entry(model,type,fleet,at),request=approachRequest(model,{type,at,start});
  request.end=Math.max(at+120,request.end);
  const result={request,columns:Array.from(model.plan(request)),definition:model.definition,sceneEpochMs:model.sceneEpochMs};
  if(result.columns[1]!==1||result.columns[3]!==1)throw new Error(`No feasible lifecycle approach: fleet ${fleet}, type ${type}, time ${at}`);
  // Warp's deterministic colossus offset is part of the coarse formation rule.
  // Subtract it from the command endpoint; no individual live pose is read/written.
  const exit=start.map((x,i)=>x-(type===31&&i===1?50:0));
  return {revision,request,result,exit};
}
function approachPhase(model,at,revision,cohorts) {
  const routes=[],warps=[];
  for(const fleet of [0,1]) {
    const classes=new Map();
    for(let type=0;type<32;type++) {
      const kind=CLASS_BY_TYPE[type];
      if(!classes.has(kind))classes.set(kind,planEntry(model,type,fleet,at,revision));
      const plan=classes.get(kind);
      for(const cohort of cohorts) {
        routes.push({fleet,type,cohort,revision,request:plan.request,result:plan.result});
        warps.push({fleet,type,cohort,journey:journey('warp',revision-1,at-7,at,plan.exit)});
      }
    }
  }
  return {routes,warps,end:Math.ceil(Math.max(...routes.map(p=>p.request.end)))+2};
}
function battleEvents(model,start) {
  return createSequence().filter(e=>e.effectiveAt>=12&&e.id!=='battle-end').map(source=>{
    const e=structuredClone(source),offset=start-12;
    e.effectiveAt+=offset;e.deliveredAt+=offset;
    for(const c of e.commands)shiftCommand(c,offset,model);
    return e;
  });
}
function shiftCommand(command,offset,model) {
  if(command.journey) {
    command.journey.revision+=3;command.journey.at+=offset;command.journey.end+=offset;
    // Withdrawal is a directed local departure, not a planetary arrival claim.
    if(command.journey.mode==='approach')command.journey.mode='departure';
    if(['warp','escape','departure'].includes(command.journey.mode)) {
      const center=model.encounterAt(command.journey.end);
      command.journey.exit=command.journey.exit.map((x,i)=>x+center[i]);
    }
  }
  if(command.tactic)command.tactic.at+=offset;
}
// Mock director authoring: plan both local approach phases before publishing the
// finite replay. The same worker/native model supplies the paths and their times.
export function createPlannedLifecycle(model) {
  const inbound=approachPhase(model,21,4,[0]),battleAt=inbound.end;
  const returnAt=battleAt+47,returning=approachPhase(model,returnAt,10,[0,1]);
  const fleets=[0,1],stop=fleets.map(fleet=>({fleet,joined:false,fire:false,strategy:'hold'}));
  const events=[
    event('initial-orbit',0,'Fleets orbit the moving planet',fleets.map(fleet=>({fleet,journey:journey('orbit',1,0,0)}))),
    event('departure',6,'Director orders departure',fleets.map(fleet=>({fleet,journey:journey('departure',2,6,14,[-80,60,0])}))),
    event('outbound-warp',14,'Clear-corridor warp to approach entries',inbound.warps),
    event('planned-approach',21,'Worker-planned local approaches',[],inbound.routes),
    ...battleEvents(model,battleAt),
    event('recall',returnAt-7,'Battle ends; director recalls both fleets',[...stop,...returning.warps]),
    event('recall-approach',returnAt,'Worker-planned return approaches',[],returning.routes),
    event('final-orbit',returning.end,'Survivors settle into class rings',fleets.flatMap(fleet=>[0,1].map(cohort=>({fleet,cohort,joined:false,fire:false,journey:journey('orbit',11,returning.end,returning.end)})))),
  ];
  return {events,duration:returning.end+8,battleAt,approaches:[{at:21,end:inbound.end,routes:inbound.routes},{at:returnAt,end:returning.end,routes:returning.routes}],planningCalls:24};
}
