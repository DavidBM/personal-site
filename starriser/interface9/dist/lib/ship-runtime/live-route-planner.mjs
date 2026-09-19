import {validateRouteBasis} from './route-basis.mjs';
import {createDirectorWorker} from './worker-client.mjs';
import {validateJourney} from './tactics.mjs';

export function routeJourney(plan) {
  const {planet,at,end,planeShift=0}=plan.request;
  return validateJourney({mode:'approach',revision:plan.revision,planet,at,end,planeShift,exit:[0,0,0]});
}
function snapshot(engine,value) {
  const plan=structuredClone({...value,cohort:value.cohort??0});
  const {fleet,type,cohort}=plan;
  if(!Number.isInteger(fleet)||fleet<0||fleet>=engine.director.fleetCount)throw new Error('Invalid route fleet');
  if(!Number.isInteger(type)||type<0||type>=32||![0,1].includes(cohort))throw new Error('Invalid route group');
  routeJourney(plan);validateRouteBasis(plan);
  if(plan.request.at>engine.now)throw new Error('Live planning needs an active local window; schedule future admission separately');
  return plan;
}
// A bounded lane per fleet/type/cohort, with one shared bounded worker transport.
// Planning leaves accepted GPU guidance in place until a complete route is ready.
export function createLiveRoutePlanner(engine,{workerFactory=createDirectorWorker}={}) {
  const lanes=Array(engine.director.capacity.groups*2).fill(null);let worker=null;
  const status=(name,plan)=>({status:name,revision:plan.revision});
  function current(ticket) {
    return !engine.closed&&!ticket.signal?.aborted&&engine.lifetime===ticket.lifetime&&lanes[ticket.index]===ticket
      &&engine.director.navigationEpochs[ticket.index]===ticket.epoch;
  }
  function admit(ticket,result) {
    const {plan}=ticket;
    if(!current(ticket))return status('superseded',plan);
    if(engine.now>=plan.request.end)return status('expired',plan);
    if(result.columns?.[1]===0)return status('no-route',plan);
    if(result.columns?.[3]===0)return status('infeasible',plan);
    const accepted=engine.admitRoute({...plan,result},{lifetime:ticket.lifetime,epoch:ticket.epoch});
    return status(accepted?'admitted':'superseded',plan);
  }
  async function execute(ticket) {
    try {
      if(worker?.status?.closed)worker=null;
      worker??=workerFactory();
      const {plan}=ticket;
      const result=await worker.request('route',{definition:engine.solar.definition,sceneEpochMs:engine.solar.sceneEpochMs,request:plan.request},{key:`route:${ticket.index}`});
      return admit(ticket,result);
    }catch(error){if(!current(ticket)||error.code==='superseded')return status('superseded',ticket.plan);ticket.failed=true;throw error;}
    finally{ticket.pending=false;}
  }
  function request(value,{signal}={}) {
    if(engine.closed)return Promise.resolve(status('closed',value));
    if(signal?.aborted)return Promise.resolve(status('superseded',value));
    let plan;try{plan=snapshot(engine,value);}catch(error){return Promise.reject(error);}
    const index=(plan.fleet*32+plan.type)*2+plan.cohort;
    let previous;try{previous=reuse(plan,index);}catch(error){return Promise.reject(error);}
    if(previous)return previous;
    const ticket={plan,index,signal,epoch:engine.director.navigationEpochs[index],lifetime:engine.lifetime,pending:true};
    lanes[index]=ticket;ticket.promise=execute(ticket);return ticket.promise;
  }
  function obsolete(plan,lane) {
    const accepted=engine.director.intents[plan.fleet*32+plan.type].journeys[plan.cohort]?.revision??0;
    return plan.revision<=accepted||plan.revision<(lane?.plan.revision??0);
  }
  function reuse(plan,index) {
    const lane=lanes[index];
    if(obsolete(plan,lane))return Promise.resolve(status('superseded',plan));
    if(lane?.plan.revision!==plan.revision)return null;
    if(JSON.stringify(lane.plan)!==JSON.stringify(plan))throw new Error('Conflicting route request under the same revision');
    if(lane.signal?.aborted)return null;
    if(lane.pending)return lane.promise;
    return lane.failed?null:Promise.resolve(status('superseded',plan));
  }
  function reset(){worker?.destroy();worker=null;lanes.fill(null);}
  return {request,reset,get pending(){return lanes.filter(ticket=>ticket?.pending).length;}};
}
