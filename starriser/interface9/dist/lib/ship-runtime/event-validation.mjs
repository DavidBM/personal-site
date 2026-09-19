import {pressureDefinition} from './pressure-orders.mjs';
import {validateRouteBasis,routeBasisMatches} from './route-basis.mjs';
import {STRATEGY} from './director.mjs';
import {CLASSES,TYPES} from './classes.mjs';
import {authorTactic,validateJourney} from './tactics.mjs';
import {routeJourney} from './live-route-planner.mjs';
const FIELDS=new Set(['fleet','type','cohort','strategy','attackClass','attackType','joined','fire','battle','team','battleCenter','admit','survivalFraction','remaining','tactic','journey','pressure']);
function integer(value,min,max,name){if(!Number.isInteger(value)||value<min||value>max)throw new Error(`Invalid live ${name}`);}
function address(value,engine) {
  integer(value.fleet,0,engine.director.fleetCount-1,'fleet');
  if(value.type!==undefined)integer(value.type,0,TYPES-1,'ship type');
  if(value.cohort!==undefined)integer(value.cohort,0,1,'cohort');
}
function intent(value) {
  if(value.strategy!==undefined&&!Object.hasOwn(STRATEGY,value.strategy))throw new Error('Invalid live strategy');
  if(value.attackClass!==undefined)integer(value.attackClass,0,CLASSES.length-1,'target class');
  if(value.attackType!==undefined)integer(value.attackType,0,TYPES-1,'target type');
  for(const key of ['joined','fire'])if(value[key]!==undefined&&typeof value[key]!=='boolean')throw new Error(`Invalid live ${key}`);
  if(value.tactic!==undefined)authorTactic({...value.tactic,fleet:value.fleet,type:value.type});
  if(value.journey!==undefined)validateJourney(value.journey);
}
function membership(value) {
  for(const key of ['battle','team'])if(value[key]!==undefined){integer(value[key],0,0xffffffff,key);if(value.type!==undefined)throw new Error('Battle membership is fleet-level');}
  if(value.battleCenter!==undefined) {
    if(value.type!==undefined)throw new Error('Battle center is fleet-level');
    const center=value.battleCenter;
    if(center!==null&&(!Array.isArray(center)||center.length!==3||!center.every(Number.isFinite)))throw new Error('Invalid live battle center');
  }
}
function population(value,engine) {
  if(value.admit!==undefined)integer(value.admit,0,1,'cohort admission');
  if(value.survivalFraction!==undefined) {
    if(!Number.isFinite(value.survivalFraction)||value.survivalFraction<0||value.survivalFraction>1)throw new Error('Invalid live survivor fraction');
    if(value.type!==undefined||value.remaining!==undefined)throw new Error('Fleet fraction cannot be mixed with per-type losses');
  }
  if(value.remaining!==undefined){integer(value.type,0,TYPES-1,'loss ship type');integer(value.remaining,0,engine.director.roster.logicalCapacity(value.fleet,value.type),'survivors');}
}
export function validateLiveEvent(event,engine) {
  const limit=engine.director.capacity.groups*2;
  if(event.commands.length>limit+engine.director.fleetCount||(event.routes?.length??0)>limit)throw new Error('Live event exceeds runtime command capacity');
  for(const command of event.commands)validateCommand(command,event.lane,engine);
  for(const plan of event.routes??[])validateRoute(plan,event.effectiveAt,engine);
  return onlyOldRoutes(event,engine)?'superseded':undefined;
}
function onlyOldRoutes(event,engine){return event.commands.length===0&&event.routes?.length&&event.routes.every(plan=>!routeIsNewer(plan,engine));}
export function routeIsNewer(plan,engine){return routeBasisMatches(engine.director,plan)&&plan.revision>(engine.director.intents[plan.fleet*32+plan.type].journeys[plan.cohort??0]?.revision??0);}
function validateCommand(command,lane,engine) {
  if(!command||Object.keys(command).some(key=>!FIELDS.has(key)))throw new Error('Invalid live command fields');
  if(lane!==undefined&&['admit','survivalFraction','remaining'].some(key=>command[key]!==undefined))throw new Error('Population facts cannot use replacement lanes');
  address(command,engine);intent(command);membership(command);population(command,engine);
  if(command.pressure!==undefined){if(command.type!==undefined)throw new Error('Pressure orders are fleet-level');pressureDefinition(engine.pressure,command.pressure);}
}
function validateRoute(plan,at,engine) {
  address(plan,engine);integer(plan.type,0,TYPES-1,'route ship type');
  routeJourney(plan);validateRouteBasis(plan);
  if(at<plan.request.at||at>=plan.request.end)throw new Error('Live route effect time must lie inside its local window');
  if(!engine.routes.validate(plan))throw new Error('Invalid live route model, revision or capability');
}
