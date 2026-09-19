// One actual worker job plus a bounded host queue. Superseding a result does not
// cancel worker execution or release its slot; only a reply or termination does.
export const MAX_DIRECTOR_QUEUE=32;
export function directorError(code,message) {return Object.assign(new Error(message),{code});}
function validateOptions(maxQueued,timeoutMs) {
  if(!Number.isInteger(maxQueued)||maxQueued<1||maxQueued>MAX_DIRECTOR_QUEUE)throw new Error('Invalid director queue bound');
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>120000)throw new Error('Invalid director timeout');
}
function validateKey(key) {
  if(key!==null&&(typeof key!=='string'||key.length<1||key.length>128))throw new Error('Invalid director request key');
}
function settle(job,error,value) {
  if(!job.resolve)return;
  if(error)job.reject(error);else job.resolve(value);
  job.resolve=null;job.reject=null;
}
export function createDirectorWorker({worker:suppliedWorker=null,maxQueued=MAX_DIRECTOR_QUEUE,timeoutMs=30000,clock=globalThis}={}) {
  validateOptions(maxQueued,timeoutMs);
  const worker=suppliedWorker??new Worker(new URL('./director-worker.mjs',import.meta.url),{type:'module'});
  const queued=[];let active=null,serial=0,timer=null,closed=false;
  function stop(error) {
    if(closed)return;closed=true;clock.clearTimeout(timer);worker.terminate();
    if(active)settle(active,error);for(const job of queued)settle(job,error);
    active=null;queued.length=0;
  }
  function pump() {
    if(closed||active||queued.length===0)return;
    active=queued.shift();
    try{worker.postMessage({id:active.id,kind:active.kind,tactic:active.payload});active.payload=null;}
    catch(error){settle(active,error);active=null;pump();return;}
    timer=clock.setTimeout(()=>stop(directorError('timeout','Director worker timed out; create a new worker to retry')),timeoutMs);
  }
  function supersede(key) {
    const error=directorError('superseded','Director request superseded');
    if(active?.key===key)settle(active,error);
    const index=queued.findIndex(job=>job.key===key);
    if(index>=0)settle(queued.splice(index,1)[0],error);
  }
  function validateAdmission(key) {
    validateKey(key);
    const replaces=key!==null&&queued.some(job=>job.key===key);
    if(queued.length>=maxQueued&&!replaces)throw directorError('busy','Director request queue full');
    if(serial===Number.MAX_SAFE_INTEGER)throw new Error('Director request IDs exhausted');
  }
  function request(kind,payload,{key=null}={}) {
    if(closed)return Promise.reject(directorError('closed','Director worker closed'));
    let snapshot;try{validateAdmission(key);snapshot=structuredClone(payload);}catch(error){return Promise.reject(error);}
    if(key!==null)supersede(key);
    return new Promise((resolve,reject)=>{queued.push({id:++serial,kind,payload:snapshot,key,resolve,reject});pump();});
  }
  worker.onmessage=({data})=>{
    if(!active||data?.id!==active.id)return;
    clock.clearTimeout(timer);const finished=active;active=null;
    if(Object.hasOwn(data,'error'))settle(finished,directorError('remote',String(data.error)));
    else if(Object.hasOwn(data,'value'))settle(finished,null,data.value);
    else settle(finished,directorError('protocol','Malformed director reply'));
    pump();
  };
  worker.onerror=event=>stop(directorError('worker',event.message||'Director worker failed'));
  worker.onmessageerror=()=>stop(directorError('protocol','Director reply could not be decoded'));
  return {request,destroy(){stop(directorError('closed','Director worker closed'));},
    get status(){return {closed,inFlight:Number(active!==null),queued:queued.length,maxQueued};}};
}
