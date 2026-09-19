import {createDirectorWorker} from './worker-client.mjs';
import {approachRequest} from './local-routes.mjs';
import {CLASS_BY_TYPE} from './classes.mjs';

function startGuide(type,fleet,warp) {
  if(warp)return [-20,type===31?50:0,0];
  if(type>=30)return [-20,(fleet*2-1)*40,(type===31?-1:1)*80];
  return [-20,0,0];
}
// Initial demo authoring knows its coarse entry region. Ordinary retargeting
// accepts a director-supplied guide; it must not read/upload individual poses.
export async function prepareApproaches(engine,{warp=false,at=0,revision=1}={}) {
  const worker=createDirectorWorker(),prepared=[];
  try {
    for(let fleet=0;fleet<engine.director.fleetCount;fleet++) {
      const plans=new Map();
      for(let type=0;type<32;type++) {
        const kind=CLASS_BY_TYPE[type];
        if(!plans.has(kind)) {
          const request=approachRequest(engine.solar,{type,at,start:startGuide(type,fleet,warp)});
          const result=await worker.request('route',{definition:engine.solar.definition,sceneEpochMs:engine.solar.sceneEpochMs,request},{key:`route:${fleet}:${kind}`});
          if(result.columns[1]!==1||result.columns[3]!==1)throw new Error(`No feasible demo approach for fleet ${fleet} class ${kind}`);
          plans.set(kind,{request,result});
        }
        prepared.push({fleet,type,revision,...plans.get(kind)});
      }
    }
    return prepared;
  }finally{worker.destroy();}
}
export function admitApproach(engine,plan,expectedRevision=null) {
  const current=engine.director.intents[plan.fleet*32+plan.type].journeys[0];
  if(expectedRevision!==null&&current?.revision!==expectedRevision)return false;
  return engine.admitRoute(plan);
}
