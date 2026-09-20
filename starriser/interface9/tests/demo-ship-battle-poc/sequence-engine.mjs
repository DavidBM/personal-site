import {LIFECYCLE_DURATION} from './lifecycle-sequence.mjs';
import {createEngine} from './engine.mjs';
import {SEQUENCE_DURATION} from './sequence.mjs';
import {createDirectorWorker} from './worker-client.mjs';
export async function createSequenceEngine(canvas,settings) {
  const worker=createDirectorWorker();let engine;
  try {
    engine=await createEngine(canvas,{...settings,scenario:4,sequence:true,reserveFraction:.2,...(settings.lifecycle?{navigation:true,initialScenario:0,cellSize:8,pressurePlanet:1}:{})});
    const authored=await authorSequence(worker,engine,settings),{events}=authored;
    const queue=engine.events.replay(events),destroy=engine.destroy;
    let closed=false;
    engine.sequence={...authored,history:queue.history};
    engine.authorTactic=async options=>{
      if(closed)return;const {fleet,type}=options,lifetime=engine.lifetime;
      try{const tactic=await worker.request('tactic',options,{key:`tactic:${fleet}:${type??'all'}`});if(!closed&&engine.lifetime===lifetime)engine.enqueueEvent({commands:[{fleet,type,tactic}]});}
      catch(error){if(!closed&&error.code!=='superseded')throw error;}
    };
    engine.destroy=()=>{closed=true;worker.destroy();destroy();};
    return engine;
  }catch(error){worker.destroy();engine?.destroy();throw error;}
}
async function authorSequence(worker,engine,settings) {
  if(engine.director.fleetCount!==2)throw new Error('The authored lifecycle and battle replay require exactly two fleets');
  if(settings.lifecycle&&!settings.legacyLifecycle)return worker.request('lifecycle-plan',{definition:engine.solar.definition,sceneEpochMs:engine.solar.sceneEpochMs});
  return {events:await worker.request(settings.lifecycle?'lifecycle':'sequence'),duration:settings.lifecycle?LIFECYCLE_DURATION:SEQUENCE_DURATION};
}
