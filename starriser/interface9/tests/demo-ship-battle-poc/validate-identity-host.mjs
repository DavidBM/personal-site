import assert from 'node:assert/strict';
import {createDirector} from './director.mjs';
import {createSlotLayout} from './slot-layout.mjs';
import {createShipHandles} from './ship-handles.mjs';
import {preparePopulationAdmission} from './population-admission.mjs';
import {exportDirector,prepareDirectorSnapshot} from './director-snapshot.mjs';
const start=0xffff0001,d=createDirector(64,{identityStart:start}),layout=createSlotLayout(d,64);
let lifetime={},closed=false;
const handles=createShipHandles(d,layout,()=>lifetime,()=>closed),handle=handles.capture(3);
assert.equal(handle.id,start+3);assert.equal(d.population.indexOf(start+3),3);
assert.equal(d.population.indexOf(3),-1);assert.equal(d.population.indexOf(String(start)),-1);
assert.equal(handles.capture(-1),null);assert.equal(handles.capture(64),null);assert.equal(handles.capture(.5),null);
layout.request([...d.population.ids].reverse());while(layout.status.pending){const batch=layout.prepare(7);if(batch)layout.commit(batch);}
assert.deepEqual(handles.resolve(handle),{id:start+3,index:3,slot:60});
const prepared=preparePopulationAdmission(d,{fleet:0,type:0,visual:3,logical:60,position:[0,0,0]});
assert.equal(prepared.batches[0].firstId,start+64);assert.equal(prepared.batches[0].firstIndex,64);
const commit=layout.prepareExtension(prepared.director.population);d.adopt(prepared.director,false);commit();
assert.equal(handles.resolve(handle).slot,60);assert.equal(handles.capture(66).id,start+66);
const snapshot=exportDirector(d);assert.equal(snapshot.version,4);assert.equal(snapshot.population.nextId,start+67);
prepareDirectorSnapshot(d,snapshot);
for(const edit of [s=>s.population.ids[0]++,s=>s.population.nextId--,s=>s.version=2]) {
  const bad=structuredClone(snapshot);edit(bad);assert.throws(()=>prepareDirectorSnapshot(d,bad),/layout/);
}
const otherLifetime={},other=createShipHandles(d,layout,()=>otherLifetime,()=>false);
assert(other.resolve(other.capture(3)));assert.equal(other.resolve(handle),null);
lifetime={};assert.equal(handles.resolve(handle),null);const fresh=handles.capture(3);assert.equal(fresh.id,handle.id);
closed=true;assert.equal(handles.resolve(fresh),null);assert.equal(handles.capture(0),null);
const full=createDirector(64,{identityStart:0xffffffff-63}),before=exportDirector(full);
assert.throws(()=>preparePopulationAdmission(full,{fleet:0,type:0,visual:1,logical:20,position:[0,0,0]}),/identity range/);
assert.deepEqual(exportDirector(full),before);assert.equal(full.population.nextId,0x100000000);
for(const identityStart of [0,-1,1.5,0xffffffff-62])assert.throws(()=>createDirector(64,{identityStart}),/identity range/);
console.log('ok: u32 serial IDs independent of indices, packing and growth; scoped handles; snapshot identity and allocator validation; fail-closed exhaustion');
