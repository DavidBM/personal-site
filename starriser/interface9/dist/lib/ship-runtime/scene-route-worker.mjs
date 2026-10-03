import {loadPlanetaryRules} from './solar-runtime.mjs';
import {solveSceneRoute} from './scene-route-model.mjs';

self.onmessage=async({data})=>{
  try {
    if(data.kind!=='scene-route')throw Error('Unknown scene route request');
    const rules=await loadPlanetaryRules();
    const value=solveSceneRoute(data.tactic,rules);
    // The transferred cache already contains the exact display/GPU points.
    // Consumers expand them only if needed; do not clone a duplicate point tree.
    if(value.cache){delete value.points;if(value.program)delete value.program.points;}
    self.postMessage({id:data.id,value},value.cache?[value.cache.buffer]:[]);
  }catch(error){self.postMessage({id:data.id,error:String(error?.message??error)});}
};
