import assert from 'node:assert/strict';
import {createDirectorWorker,MAX_DIRECTOR_QUEUE} from './worker-client.mjs';
const observe=promise=>promise.then(value=>({value}),error=>({error:error.code??error.message}));
function fixture(options={}) {
  const timers=new Map(),sent=[];let serial=0,terminated=0;
  const clock={setTimeout(fn){timers.set(++serial,fn);return serial;},clearTimeout(id){timers.delete(id);}};
  const worker={postMessage(data){sent.push(structuredClone(data));},terminate(){terminated++;}};
  const client=createDirectorWorker({worker,clock,...options});
  return {client,worker,sent,timers,get terminated(){return terminated;},
    reply(index,value){worker.onmessage({data:{id:sent[index].id,value}});},
    timeout(){assert.equal(timers.size,1);timers.values().next().value();}};
}
async function replacement() {
  const f=fixture(),results=[];
  for(let i=0;i<1000;i++)results.push(observe(f.client.request('tactic',{revision:i},{key:'fleet:0:type:1'})));
  assert.equal(f.sent.length,1);assert.deepEqual(f.client.status,{closed:false,inFlight:1,queued:1,maxQueued:32});
  assert((await Promise.all(results.slice(0,-1))).every(x=>x.error==='superseded'));
  f.reply(0,'obsolete');assert.equal(f.sent.length,2);assert.equal(f.sent[1].tactic.revision,999);
  f.worker.onmessage({data:{id:f.sent[0].id,value:'duplicate'}});assert.equal(f.client.status.inFlight,1);
  f.reply(1,'latest');assert.deepEqual(await results.at(-1),{value:'latest'});assert.equal(f.timers.size,0);
  f.client.destroy();assert.equal(f.terminated,1);
}
async function capacity() {
  const f=fixture({maxQueued:2}),a=observe(f.client.request('a')),b=observe(f.client.request('b',{}, {key:'b'}));
  const payload={revision:1},c=observe(f.client.request('c',payload));payload.revision=7;
  assert.equal((await observe(f.client.request('overflow'))).error,'busy');
  const replacement=observe(f.client.request('b',{revision:2},{key:'b'}));assert.equal((await b).error,'superseded');
  // Rejected replacement cannot discard accepted work when no queue slot exists.
  assert.equal((await observe(f.client.request('a',{}, {key:'new'}))).error,'busy');
  f.reply(0,'a');assert.equal(f.sent[1].kind,'c');assert.equal(f.sent[1].tactic.revision,1);f.reply(1,'c');
  assert.equal(f.sent[2].kind,'b');f.reply(2,'new b');
  assert.deepEqual(await Promise.all([a,c,replacement]),[{value:'a'},{value:'c'},{value:'new b'}]);f.client.destroy();
}
async function shutdown(cause,code) {
  const f=fixture(),a=observe(f.client.request('a')),b=observe(f.client.request('b'));
  cause(f);assert.deepEqual(await Promise.all([a,b]),[{error:code},{error:code}]);
  assert.deepEqual(f.client.status,{closed:true,inFlight:0,queued:0,maxQueued:MAX_DIRECTOR_QUEUE});
  assert.equal(f.timers.size,0);assert.equal(f.terminated,1);
  assert.equal((await observe(f.client.request('after'))).error,'closed');
  f.reply(0,'after close');f.client.destroy();assert.equal(f.terminated,1);
}
async function replyErrors() {
  const f=fixture();const a=observe(f.client.request('a')),b=observe(f.client.request('b')),c=observe(f.client.request('c'));
  f.worker.onmessage({data:{id:f.sent[0].id,error:''}});assert.equal((await a).error,'remote');
  f.worker.onmessage({data:{id:f.sent[1].id}});assert.equal((await b).error,'protocol');
  f.reply(2,undefined);assert.deepEqual(await c,{value:undefined});f.client.destroy();
}
async function rejectedInputs() {
  assert.throws(()=>fixture({maxQueued:33}));assert.throws(()=>fixture({timeoutMs:0}));
  const f=fixture(),a=observe(f.client.request('a',{}, {key:'same'}));
  assert((await observe(f.client.request('invalid',{}, {key:''}))).error);
  assert((await observe(f.client.request('not cloneable',()=>{}, {key:'same'}))).error);
  assert.equal(f.sent.length,1);assert.equal(f.client.status.queued,0);f.reply(0,'retained');assert.deepEqual(await a,{value:'retained'});
  f.worker.postMessage=()=>{throw new Error('post failed');};
  assert.equal((await observe(f.client.request('bad post'))).error,'post failed');assert.equal(f.client.status.inFlight,0);assert.equal(f.timers.size,0);
  f.client.destroy();
}
await replacement();await capacity();await replyErrors();await rejectedInputs();
await shutdown(f=>f.timeout(),'timeout');await shutdown(f=>f.client.destroy(),'closed');
await shutdown(f=>f.worker.onerror({message:'crashed'}),'worker');await shutdown(f=>f.worker.onmessageerror(),'protocol');
console.log('Director worker checks passed: 1000 supersessions, actual execution bound, immutable queue, capacity, stale replies, clone/post failures, remote errors, timeout and teardown');
