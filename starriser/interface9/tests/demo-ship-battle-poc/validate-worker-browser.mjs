import {createSequenceEngine} from './sequence-engine.mjs';
import {createDirectorWorker} from './worker-client.mjs';
const outcome=promise=>promise.then(value=>({value}),error=>({error:error.code}));
export async function validateDirectorWorker(ctx) {
  const worker=createDirectorWorker({maxQueued:2});
  try {
    const replies=[];
    for(let revision=1;revision<=100;revision++)replies.push(outcome(worker.request('tactic',{fleet:0,type:1,revision,name:'pincer',splits:2},{key:'fleet:0:type:1'})));
    ctx.assert(worker.status.inFlight===1&&worker.status.queued===1,'rapid revisions retain one actual worker job and one latest queued request');
    const result=await Promise.all(replies);
    ctx.assert(result.slice(0,-1).every(row=>row.error==='superseded'),'superseded worker results cannot be admitted as successful plans');
    ctx.assert(result.at(-1).value?.revision===100,'actual browser worker authors the latest queued revision');
    ctx.assert(worker.status.inFlight===0&&worker.status.queued===0,'actual replies release all worker capacity');
    const requests=Array.from({length:4},()=>outcome(worker.request('sequence'))),status=worker.status;
    ctx.assert(status.inFlight===1&&status.queued===2,'unkeyed browser work respects the configured queue bound');
    const bounded=await Promise.all(requests);
    ctx.assert(bounded.slice(0,3).every(row=>Array.isArray(row.value))&&bounded[3].error==='busy','queue overflow is explicit while admitted sequence jobs finish');
    const stopped=outcome(worker.request('lifecycle'));worker.destroy();
    ctx.assert((await stopped).error==='closed','closing a real worker rejects unfinished work');
  }finally{worker.destroy();}
}

export async function validateWorkerAdmission(ctx,canvas) {
  const e=await createSequenceEngine(canvas,{count:64,period:30,lifecycle:true});
  try {
    const before=new Uint8Array(await e.read(e.state)),history=e.history,replies=[];
    for(let revision=1;revision<=100;revision++)replies.push(e.authorTactic({fleet:0,type:1,revision,name:'pincer',splits:2}));
    await Promise.all(replies);
    ctx.assert(e.events.inbox.status.pending===1&&equal(before,await e.read(e.state)),'latest authored tactic queues without changing live GPU state');
    e.flushEvents();
    ctx.assert(e.director.intents[1].tactic?.revision===100&&e.events.history.length===1,'sequence runtime admits only the latest authored tactic from a rapid burst');
    const admitted=new Uint8Array(await e.read(e.state));
    const options={fleet:0,type:2,revision:101,name:'vertical-pincer'},request=e.authorTactic(options);options.fleet=1;options.type=3;
    await request;
    ctx.assert(equal(admitted,await e.read(e.state))&&e.history===history,'worker tactic receipt preserves live GPU state and trail resources');
    e.flushEvents();
    ctx.assert(e.director.intents[2].tactic?.revision===101&&!e.director.intents[35].tactic,'worker admission keeps the fleet and type snapshot captured with the request');
    const resetting=e.authorTactic({fleet:0,type:1,revision:102});e.reset();await resetting;
    ctx.assert(e.events.inbox.empty&&e.director.intents[1].tactic.revision===100,'reset prevents an old authoring result from entering the new live event lifetime');
    const pending=e.authorTactic({fleet:0,type:1,revision:103});e.destroy();await pending;
    ctx.assert(e.errors.length===0,'closing the sequence runtime with pending authoring is safe');
  }finally{e.destroy();}
}
function equal(a,b){return a.every((x,i)=>x===new Uint8Array(b)[i]);}
