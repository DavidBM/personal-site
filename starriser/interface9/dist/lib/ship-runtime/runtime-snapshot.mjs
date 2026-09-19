import {pressureDefinition,packPressure} from './pressure-orders.mjs';
import {prepareDirectorSnapshot} from './director-snapshot.mjs';
import {createLocalRoutes,modelKey} from './local-routes.mjs';
import {routeJourney} from './live-route-planner.mjs';
import {validateLiveEvent,routeIsNewer} from './event-validation.mjs';
const LIMIT_BYTES=8*1024*1024;
function vector(value,bound) {return Array.isArray(value)&&value.length===3&&value.every(n=>Number.isFinite(n)&&Math.abs(n)<=bound);}
function placements(input,groups) {
  if(!Array.isArray(input)||input.length!==groups*2)throw new Error('Incomplete snapshot placements');
  const data=new Float32Array(groups*2*8);
  for(const [index,row] of input.entries()) {
    if(!vector(row.position,1e9)||!vector(row.velocity,1e5)||!Number.isFinite(row.spread)||row.spread<0||row.spread>1e6)throw new Error('Invalid snapshot placement');
    data.set([...row.position,row.spread,...row.velocity,0],index*8);
  }
  return data;
}
function header(input,engine,previous,replay) {
  if(input.version!==1||!Number.isSafeInteger(input.revision)||input.revision<=previous)throw new Error('Invalid or superseded snapshot revision');
  if(!Number.isFinite(input.at)||input.at<engine.now)throw new Error('Snapshot cannot rewind the scene');
  engine.clock.shiftFor(input.at);
  if(input.model!==modelKey(engine.solar))throw new Error('Snapshot solar model differs');
  if(replay&&input.replayAt!==input.at)throw new Error('Snapshot must explicitly cover startup replay at its scene time');
}
function seedRoutes(routes,director,plans,time) {
  if(!Array.isArray(plans)||plans.length>director.capacity.groups*2)throw new Error('Invalid snapshot route count');
  for(const plan of plans) {
    const prepared=routes.prepare(plan,Math.min(time,plan.request.end));
    if(!prepared)throw new Error('Snapshot route conflicts with current journey');routes.commit(prepared);
  }
  requireCurrentRoutes(routes,director,time);
}
function requireCurrentRoutes(routes,director,time) {
  for(const [group,intent] of director.intents.entries())for(const [cohort,journey] of intent.journeys.entries()) {
    if(!journey)continue;
    if(journey.at>time)throw new Error('Snapshot current journey is scheduled in the future');
    if(missingRoute(journey,routes.records.get(group*2+cohort)))throw new Error('Snapshot approach lacks its current route');
  }
}
export function applySnapshotEvent(event,view,time) {
  const {director,routes}=view,plans=(event.routes??[]).filter(plan=>routeIsNewer(plan,view));
  for(const command of event.commands) {
    director.apply({revision:director.revision+1,...command});
    if(command.pressure)view.pressureDefinitions[command.fleet]=pressureDefinition(view.pressure,command.pressure).definition;
  }
  for(const plan of plans) {
    if(!routeIsNewer(plan,view))throw new Error('Retained route superseded by its preceding commands');
    const journey=routeJourney(plan),prepared=routes.prepare(plan,Math.max(time,plan.request.at),journey);
    if(!prepared)throw new Error('Retained local route expired or was superseded');
    director.apply({revision:director.revision+1,fleet:plan.fleet,type:plan.type,cohort:plan.cohort??0,journey});
    routes.commit(prepared);
    if(plan.basis)director.navigationEpochs[(plan.fleet*32+plan.type)*2+(plan.cohort??0)]=plan.basis.epoch;
  }
  return retainedStatus(event,plans);
}
// Prepare a complete detached CPU candidate. Live state and GPU resources are
// touched only after the entire snapshot and the retained inbox fit their bounds.
export function prepareRuntimeSnapshot(engine,input,inbox,{revision=0,replay=false}={}) {
  const encoded=JSON.stringify(input);
  if(typeof encoded!=='string'||new TextEncoder().encode(encoded).length>LIMIT_BYTES)throw new Error('Runtime snapshot exceeds size limit');
  const value=structuredClone(input);header(value,engine,revision,replay);
  const director=prepareDirectorSnapshot(engine.director,value.director),routes=createLocalRoutes(director,engine.solar);
  const placement=placements(value.placements,director.capacity.groups),pressure=engine.pressure.prepareSnapshot(value.pressure);
  seedRoutes(routes,director,value.routes,value.at);
  const view={director,routes,pressure:engine.pressure,pressureDefinitions:pressure.members.map(index=>pressure.definitions[index])};let validator=view;
  const restored=inbox.restore(value.stream,value.at,event=>validateLiveEvent(event,validator));
  restored.drain(value.at,event=>applySnapshotEvent(event,view,value.at));
  requireCurrentRoutes(routes,director,value.at);
  const finalPressure=engine.pressure.prepareSnapshot(packPressure(view.pressureDefinitions));
  return {at:value.at,revision:value.revision,director,routes,placement,pressure:finalPressure,inbox:restored,
    activate(){validator=engine;}};
}

function retainedStatus(event,plans){return event.routes?.length&&!event.commands.length&&!plans.length?'superseded':'applied';}

function missingRoute(journey,record){return journey.mode==='approach'&&journey.planet!==undefined&&record?.revision!==journey.revision;}
