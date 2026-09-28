import {loadPlanetaryRules} from './solar-runtime.mjs';
import {solveSceneRoute} from './scene-route-model.mjs';

self.onmessage=async({data})=>{
  try {
    if(data.kind!=='scene-route')throw Error('Unknown scene route request');
    const rules=await loadPlanetaryRules();
    self.postMessage({id:data.id,value:solveSceneRoute(data.tactic,rules)});
  }catch(error){self.postMessage({id:data.id,error:String(error?.message??error)});}
};
