import {createDirectorWorker,directorError,MAX_DIRECTOR_QUEUE} from './worker-client.mjs';
import {prepareSceneRoute} from './scene-route-model.mjs';
export {SCENE_ROUTE_BODY_LIMIT} from './scene-route-model.mjs';

function validateOptions(maxQueued,timeoutMs) {
  if(!Number.isInteger(maxQueued)||maxQueued<1||maxQueued>MAX_DIRECTOR_QUEUE)throw Error('Invalid scene route queue bound');
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>120000)throw Error('Invalid scene route timeout');
}
/** One active WASM solve and a bounded superseding queue; no render-thread solve. */
export function createSceneRoutePlanner({worker=null,maxQueued=32,timeoutMs=30000}={}) {
  validateOptions(maxQueued,timeoutMs);
  let transport=null,closed=false;
  function plan(value) {
    if(closed)return Promise.reject(directorError('closed','Scene route planner closed'));
    let snapshot;
    try {
      snapshot=prepareSceneRoute(value);
      transport??=createDirectorWorker({worker:worker??new Worker(new URL('./scene-route-worker.mjs',import.meta.url),{type:'module'}),maxQueued,timeoutMs});
    }catch(error){return Promise.reject(error);}
    return transport.request('scene-route',snapshot,{key:snapshot.key});
  }
  return {plan,destroy(){closed=true;transport?.destroy();},
    get status(){return transport?.status??{closed,inFlight:0,queued:0,maxQueued};}};
}
