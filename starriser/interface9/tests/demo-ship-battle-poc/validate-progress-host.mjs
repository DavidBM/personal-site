import assert from 'node:assert/strict';
import {createDirector} from './director.mjs';
import {createLiveRoutePlanner} from './live-route-planner.mjs';
import {createProgressRetargeter,planFromProgress,progressCurrent} from './progress-navigation.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture() {
  const director=createDirector(64),calls=[];
  const engine={director,lifetime:{},now:2,closed:false,solar:{bodyAt:()=>[1000,0,0,10]},
    planApproach:async(plan,context)=>{calls.push({plan,context});return {status:'admitted'};}};
  const summary={status:'ready',time:2,lifetime:engine.lifetime,groups:Array.from({length:128},(_,index)=>({fleet:Math.floor(index/64),type:Math.floor(index/2)%32,cohort:index%2,epoch:0,live:Number(index===0),anchor:[900,5,3],minimum:[890,0,0],maximum:[910,10,10]}))};
  engine.readProgress=async()=>summary;
  return {engine,summary,calls};
}
async function sources() {
  const {engine,summary,calls}=fixture(),options={fleet:0,type:0,revision:1,planet:1,end:100};
  assert(!progressCurrent(engine,summary,undefined));
  assert.equal((await planFromProgress(engine,options)).status,'admitted');
  assert.deepEqual(calls[0].plan.request.start,[-100,5,3]);assert.equal(calls[0].plan.request.end,100);
  // The centroid could be inside a planet: planning uses an occupied anchor.
  summary.groups[0].meanPosition=[1000,0,0];
  assert.equal((await planFromProgress(engine,options,summary)).status,'admitted');
  assert.deepEqual(calls[1].plan.request.start,[-100,5,3]);
  engine.now=2.251;assert.equal((await planFromProgress(engine,options,summary)).status,'stale-progress');
  engine.now=1.9;assert.equal((await planFromProgress(engine,options,summary)).status,'stale-progress');
  engine.now=2;engine.director.groupEpochs[0]=1;
  assert.equal((await planFromProgress(engine,options,summary)).status,'stale-progress');
  engine.director.groupEpochs[0]=0;engine.lifetime={};
  assert.equal((await planFromProgress(engine,options,summary)).status,'stale-progress');
  engine.lifetime=summary.lifetime;summary.groups[0].live=0;
  assert.equal((await planFromProgress(engine,options,summary)).status,'empty');assert.equal(calls.length,2);
  const gate=deferred();engine.readProgress=()=>gate.promise;summary.groups[0].live=1;
  const pending=planFromProgress(engine,options);options.fleet=1;options.type=4;gate.resolve(summary);
  await pending;assert.equal(calls[2].plan.fleet,0);assert.equal(calls[2].plan.type,0);
}
async function batches() {
  const {engine,summary}=fixture(),entered=deferred(),release=deferred(),refresh=deferred();
  const calls=[];engine.planApproach=async(plan,{signal})=>{
    calls.push({plan,signal});if(calls.length===1){entered.resolve();await release.promise;}
    return {status:signal.aborted?'superseded':'admitted'};
  };
  const target=createProgressRetargeter(engine),first=target.retarget(.2);await entered.promise;
  engine.readProgress=()=>refresh.promise;const second=target.retarget(.5);
  assert(calls[0].signal.aborted);release.resolve();await first;
  assert(target.status.pending);assert.equal(calls.length,1);
  refresh.resolve(summary);await second;
  assert.equal(calls.length,2);assert(calls[1].plan.revision>calls[0].plan.revision);
  assert.deepEqual(target.status,{pending:false,admitted:1,deferred:0});
}
async function refreshRace() {
  const {engine,summary}=fixture(),entered=deferred(),release=deferred();
  engine.readProgress=async()=>{entered.resolve();return release.promise;};
  const target=createProgressRetargeter(engine),old=target.retarget(.1);await entered.promise;
  const latest=target.retarget(.3);engine.lifetime={};release.resolve(summary);
  await Promise.all([old,latest]);assert.deepEqual(target.status,{pending:false,admitted:0,deferred:0});
}
async function cancellationAdmission() {
  const {engine}=fixture(),jobs=[],admitted=[];
  engine.admitRoute=plan=>{admitted.push(plan);return true;};
  const planner=createLiveRoutePlanner(engine,{workerFactory:()=>({request:()=>{const job=deferred();jobs.push(job);return job.promise;},destroy(){}})});
  const plan={fleet:0,type:0,revision:1,request:{planet:1,at:2,end:100,planeShift:0}};
  const controller=new AbortController(),pending=planner.request(plan,{signal:controller.signal});
  controller.abort();jobs[0].resolve({columns:[1,1,2,1]});
  assert.equal((await pending).status,'superseded');assert.equal(admitted.length,0);
  const retry=planner.request(plan);jobs[1].resolve({columns:[1,1,2,1]});
  assert.equal((await retry).status,'admitted');assert.equal(admitted.length,1);
  planner.reset();
}
await sources();await batches();await refreshRace();await cancellationAdmission();
console.log('Progress sources: age, epoch, lifetime, empty groups, immutable inputs and occupied anchors; retarget batches cancel pending admission and permit safe retry.');
