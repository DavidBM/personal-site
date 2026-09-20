import {exportDirector} from '../demo-ship-battle-poc/director-snapshot.mjs';
import {createLocalRoutes,modelKey} from '../demo-ship-battle-poc/local-routes.mjs';
import {applySnapshotEvent} from '../demo-ship-battle-poc/runtime-snapshot.mjs';
import {fleetPressure,packPressure} from '../demo-ship-battle-poc/pressure-orders.mjs';
import {recoveryPlacements} from './recovery-placement.mjs';
function routesOf(routes,director) {
  return [...routes.records].filter(([index,record])=>{
    const journey=director.intents[Math.floor(index/2)].journeys[index%2];
    return journey?.mode==='approach'&&journey.revision===record.revision;
  }).map(([index,record])=>({fleet:Math.floor(index/64),type:Math.floor(index/2)%32,cohort:index%2,...structuredClone(record)}));
}
function missedEvents(source) {
  const rows=[...source.replay.map(event=>({event,replay:true})),...source.due.map(event=>({event,replay:false}))];
  return rows.sort((a,b)=>Math.max(a.event.effectiveAt,a.event.deliveredAt)-Math.max(b.event.effectiveAt,b.event.deliveredAt)||Number(b.replay)-Number(a.replay));
}
// The lab itself authors every packet. It can reconstruct known logical orders,
// but it must reject an actual receipt gap instead of inventing missing facts.
export function createDirectorRecovery(engine,time) {
  const source=engine.events.projectionSource(time),director=engine.director.fork(),routes=createLocalRoutes(director,engine.solar),rejected=[];
  routes.data.set(engine.routes.data);for(const [index,record] of engine.routes.records)routes.records.set(index,structuredClone(record));
  const view={director,routes,pressure:engine.pressure,pressureDefinitions:fleetPressure(engine.pressure)};
  for(const {event,replay} of missedEvents(source)) {
    const at=Math.max(engine.now,event.effectiveAt,event.deliveredAt);
    try{applySnapshotEvent(event,view,at);}catch(error){if(replay)throw error;rejected.push({id:event.id,error:error.message});}
  }
  const snapshot={version:1,revision:engine.events.recovery.revision+1,at:time,model:modelKey(engine.solar),director:exportDirector(director),
    routes:routesOf(routes,director),placements:recoveryPlacements(engine,director,routes,time),pressure:packPressure(view.pressureDefinitions),stream:source.stream,
    ...(source.hasReplay?{replayAt:time}:{})};
  return {snapshot,rejected};
}
