import assert from 'node:assert/strict';
import {createDirector} from './director.mjs';
import {createSlotLayout} from './slot-layout.mjs';
const d=createDirector(1000),layout=createSlotLayout(d,1000);
function converge(limit) {
  let batches=0;
  while(layout.status.pending) {
    const batch=layout.prepare(limit);if(!batch)break;
    const pairs=Array.from(batch.pairs.slice(0,batch.length*2));assert.equal(new Set(pairs).size,pairs.length);
    assert(batch.length<=limit);layout.commit(batch);assert(++batches<=1000);
  }
  assert(layout.logical.every((id,slot)=>layout.physical[id]===slot));return batches;
}
layout.request(Array.from({length:1000},(_,i)=>1000-i));assert(converge(7)>1);
assert(layout.logical.every((id,slot)=>id===999-slot));
const revision=layout.status.revision;assert.throws(()=>layout.request(Array(1000).fill(1)),/duplicate/);assert.equal(layout.status.revision,revision);
layout.request(Array.from({length:1000},(_,i)=>(i+31)%1000+1));const stale=layout.prepare(1);
layout.request(Array.from({length:1000},(_,i)=>i+1));assert.throws(()=>layout.commit(stale),/Superseded/);converge(64);
d.apply({revision:1,fleet:0,survivalFraction:.5});layout.liveFirst();converge(64);
const alive=d.alive;assert(layout.logical.slice(0,alive).every(id=>{const group=Array.from({length:64},(_,g)=>g).find(g=>id>=d.groups[g*8+4]&&id<d.groups[g*8+4]+d.groups[g*8+5]);return d.roster.isLive(Math.floor(group/32),group%32,id-d.groups[group*8+4]);}));
layout.reset();assert(layout.physical.every((slot,id)=>slot===id));assert(!layout.status.pending);
console.log('ok: bounded disjoint swaps, arbitrary permutations, supersession, live-first packing and reset');
