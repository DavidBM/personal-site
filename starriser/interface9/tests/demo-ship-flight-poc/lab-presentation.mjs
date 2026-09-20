import {createSceneClock} from './scene-clock.mjs';
import {createDirectorRecovery} from './director-recovery.mjs';
// The lab is its own mock server. Source pause stops that clock; a real server
// adapter supplies clock samples/snapshots independently of presentation pause.
export function createLabPresentation(engine,{hostNow=()=>performance.now()}={}) {
  const clock=createSceneClock({epochMs:engine.solar.sceneEpochMs,hostMs:hostNow(),sceneSeconds:engine.now}),enqueue=engine.enqueueEvent;
  let nextAttempt=0,lastError=null,rejected=[];
  engine.enqueueEvent=event=>{const at=clock.sample(hostNow());return enqueue({effectiveAt:at,...event},at);};
  function recover(state,host) {
    if(host<nextAttempt)return state;
    nextAttempt=host+250;
    try {
      const current=createDirectorRecovery(engine,state.target);engine.installSnapshot(current.snapshot,engine.lifetime);
      rejected=current.rejected;lastError=null;return {...engine.presentation.state,alpha:1};
    }catch(error){lastError=String(error.message??error);return state;}
  }
  function frame(host,options={}) {
    const target=clock.sample(host);let state=engine.advanceTo(target,options);
    if(state.status==='needs-reconciliation')state=recover(state,host);
    if((clock.state.paused||clock.state.holding)&&state.status==='ready')state=settle(state,target,host,options);
    return state;
  }
  function settle(state,target,host,options) {
    try {if(state.debt>0)engine.step(target,state.debt,options);return {...engine.presentation.state,steps:state.steps,activations:state.activations,partialSteps:Number(state.debt>0),alpha:1};}
    catch(error){if(error.code!=='event-frame-capacity')throw error;return recover({...state,status:'needs-reconciliation',target},host);}
  }
  return {clock,frame,setPaused:(value,host=hostNow())=>clock.setSourcePaused(value,host),
    get status(){return {error:lastError,rejected,recoveries:engine.events.recovery.count,clock:clock.state};}};
}
