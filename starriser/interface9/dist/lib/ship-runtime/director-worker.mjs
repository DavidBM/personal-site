import {createSolarRuntime} from './solar-runtime.mjs';
import {createLifecycleSequence} from './lifecycle-sequence.mjs';
import {createPlannedLifecycle} from './planned-lifecycle.mjs';
import {createSequence} from './sequence.mjs';
import {authorTactic} from './tactics.mjs';
self.onmessage=async({data})=>{
  try {
    const value=await request(data);
    self.postMessage({id:data.id,value});
  }catch(error){self.postMessage({id:data.id,error:String(error?.message??error)});}
};

function staticRequest(data) {
  if(data.kind==='sequence')return createSequence();
  if(data.kind==='lifecycle')return createLifecycleSequence();
  if(data.kind==='tactic')return authorTactic(data.tactic);
  throw new Error('Unknown director request');
}
async function ephemeris(request) {
  if(!Array.isArray(request.times)||request.times.length<1||request.times.length>64||!request.times.every(Number.isFinite))throw new Error('Invalid ephemeris sample batch');
  const model=await createSolarRuntime(request);
  try{return request.times.map(time=>({time,poses:[0,1,2].map(i=>model.bodyAt(i,time)),velocities:[0,1,2].map(i=>model.velocityAt(i,time))}));}
  finally{model.destroy();}
}

async function request(data) {
  if(data.kind==='ephemeris')return ephemeris(data.tactic);
  if(data.kind==='lifecycle-plan') {
    const model=await createSolarRuntime(data.tactic);
    try{return createPlannedLifecycle(model);}finally{model.destroy();}
  }
  if(data.kind==='route') {
    const model=await createSolarRuntime(data.tactic);
    try{return {request:data.tactic.request,columns:Array.from(model.plan(data.tactic.request)),definition:model.definition,sceneEpochMs:model.sceneEpochMs};}
    finally{model.destroy();}
  }
  return staticRequest(data);
}
