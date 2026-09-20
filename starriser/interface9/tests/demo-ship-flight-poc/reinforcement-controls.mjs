import {recoveryPlacements} from './recovery-placement.mjs';
import {radiusOf} from '../demo-ship-battle-poc/classes.mjs';
// A mock director action: request coarse cohort regions, then admit a mixed fleet
// batch. GPU initialization owns individual placement and every existing pose.
const MIX=[[0,50],[12,30],[22,12],[27,4],[30,2],[31,1]];
export function bindReinforcements(getEngine,onError) {
  const button=document.getElementById('reinforce');let pending=false;
  button.onclick=async()=>{
    const engine=getEngine();if(!engine||pending)return;pending=true;button.disabled=true;
    const lifetime=engine.lifetime,fleet=Number(document.getElementById('fleet').value);
    try {
      const progress=await engine.readProgress();if(progress.status!=='ready'||getEngine()!==engine)return;
      if(engine.shipStorage.pending)await engine.shipStorage.pending;
      const requests=reinforcementBatch(engine,progress,fleet);const result=engine.reinforce(requests,{lifetime,populationRevision:engine.director.population.revision});
      if(result.status!=='applied')throw Error(`Reinforcement ${result.status}`);onError('');
    }catch(error){if(getEngine()===engine)onError(error.message);}
    finally{pending=false;button.disabled=false;}
  };
}
function reinforcementBatch(engine,progress,fleet) {
  const requests=[];let free=10000-engine.count,placements=null;
  for(const [type,wanted] of MIX) {
    const visual=Math.min(wanted,free,256-engine.director.roster.retainedFor(fleet,type));if(visual===0)continue;
    const group=progress.groups.find(row=>row.fleet===fleet&&row.type===type&&row.cohort===0);
    const current=group?.anchor&&!group.stale&&group.epoch===engine.director.groupEpochs[fleet*32+type];
    if(!current)placements??=recoveryPlacements(engine,engine.director,engine.routes,engine.now);
    const position=current?group.anchor:placements[(fleet*32+type)*2].position;
    requests.push({fleet,type,cohort:0,visual,logical:visual*20,position,spread:Math.max(8,radiusOf(type)*2)});free-=visual;
  }
  if(requests.length===0)throw Error('The visible population is at capacity');
  return requests;
}
