import {createScopeDemo} from '../demo-ship-battle-poc/scope-demo.mjs';
import {createSequenceEngine} from '../demo-ship-battle-poc/sequence-engine.mjs';
import {createNavigationEngine} from '../demo-ship-battle-poc/navigation-engine.mjs';
import {createEngine as createBattleEngine} from '../demo-ship-battle-poc/engine.mjs';

// The scenario selector is a mock director: choosing battle explicitly admits
// both fleets. The original scripted battle kernel remains a historical test fixture.
export async function createScenarioEngine(canvas,settings) {
  if(settings.scenario===5)return createScopeDemo(canvas,settings);
  if(settings.scenario===4)return createSequenceEngine(canvas,{...settings,lifecycle:true});
  if(settings.scenario!==2)return createNavigationEngine(canvas,settings);
  const engine=await createBattleEngine(canvas,settings);
  engine.command({revision:1,fleet:0,joined:true,fire:true});
  engine.command({revision:2,fleet:1,joined:true,fire:true});
  return engine;
}

export function retargetScenario(engine,phase) {
  if(!engine)return;
  if(engine.setPhase)return engine.setPhase(phase);
  const attackClass=Math.round(phase/(Math.PI*.8))%6;
  for(let fleet=0;fleet<engine.director.fleetCount;fleet++)engine.command({revision:engine.director.revision+1,fleet,attackClass});
}

export function scenarioDistance(scenario) {
  if(scenario===5)return 640;
  if(scenario===0||scenario===4)return 440;
  if(scenario===3)return 300;
  return scenario>=2?220:360;
}
