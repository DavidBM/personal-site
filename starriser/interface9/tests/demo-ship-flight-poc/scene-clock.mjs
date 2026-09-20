function finite(value,name){if(!Number.isFinite(value))throw new Error(`Invalid ${name}`);}
// One monotonic host clock maps to one authoritative scene epoch. Clock-offset
// estimates may change; event epoch conversion never changes with the estimate.
export function createSceneClock({epochMs=0,hostMs=0,sceneSeconds=0}={}) {
  finite(epochMs,'scene epoch');finite(hostMs,'host clock');finite(sceneSeconds,'scene clock');
  let anchorHost=hostMs,anchorScene=sceneSeconds,lastHost=hostMs,lastScene=sceneSeconds,paused=false,revision=0,uncertaintyMs=0;
  function sample(host) {
    finite(host,'host clock');if(host<lastHost)throw new Error('Host clock cannot rewind');
    lastHost=host;
    if(!paused)lastScene=Math.max(lastScene,anchorScene+(host-anchorHost)/1000);
    return lastScene;
  }
  function setSourcePaused(value,host) {
    if(typeof value!=='boolean')throw new Error('Invalid source pause');
    sample(host);anchorHost=host;anchorScene=lastScene;paused=value;
  }
  function synchronize(value) {
    if(!Number.isSafeInteger(value.revision)||value.revision<1)throw new Error('Invalid clock revision');
    if(value.revision<=revision)return {status:'superseded'};
    const {serverMs,sentAt,receivedAt}=value;
    for(const n of [serverMs,sentAt,receivedAt])finite(n,'clock sample');
    if(paused||sentAt>receivedAt||receivedAt<lastHost)throw new Error('Invalid clock synchronization interval');
    sample(receivedAt);uncertaintyMs=(receivedAt-sentAt)/2;
    anchorHost=receivedAt;anchorScene=(serverMs-epochMs+uncertaintyMs)/1000;revision=value.revision;
    const correction=anchorScene-lastScene;sample(receivedAt);
    return {status:correction<0?'holding':'synchronized',correction,uncertaintyMs,scene:lastScene};
  }
  return {sample,synchronize,setSourcePaused,timeOf(serverMs){finite(serverMs,'event epoch');return (serverMs-epochMs)/1000;},
    get state(){return {scene:lastScene,host:lastHost,paused,revision,uncertaintyMs,holding:!paused&&anchorScene+(lastHost-anchorHost)/1000<lastScene};}};
}
