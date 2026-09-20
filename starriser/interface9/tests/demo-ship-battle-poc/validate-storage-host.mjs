import assert from 'node:assert/strict';
import {createShipStorage,shipStorageSizes} from './ship-storage.mjs';
globalThis.GPUBufferUsage={STORAGE:1,COPY_SRC:2,COPY_DST:4};
const buffers=[],copies=[];let finish;
const device={createBuffer({size}){const buffer={size,destroys:0,destroy(){this.destroys++;}};buffers.push(buffer);return buffer;},
  createCommandEncoder(){return {copyBufferToBuffer(...args){copies.push(args);},finish(){return {};}};},
  queue:{submit(){},onSubmittedWorkDone(){return new Promise(resolve=>{finish=resolve;});}}};
const storage=createShipStorage(device,1000),initial=storage.current;let installed=null;
assert.throws(()=>storage.resize(999,()=>()=>{}),/capacity/);
assert.throws(()=>storage.resize(10001,()=>()=>{}),/capacity/);
assert.throws(()=>storage.resize(2000,()=>{throw Error('bind failure');}),/bind failure/);
assert.equal(storage.current,initial);assert(buffers.slice(6).every(b=>b.destroys===1));
assert(storage.resize(2000,next=>()=>{installed=next;}));assert.equal(storage.current,installed);
assert.equal(storage.current.bindings.a.size,192000);assert.equal(storage.current.buffers.a.size,384000);
assert.equal(copies.length,6);assert.deepEqual(copies.map(c=>c[4]),Object.values(shipStorageSizes(1000)));
assert(Object.values(initial.buffers).every(b=>b.destroys===0));
assert(!storage.resize(4000,()=>()=>{}));assert.equal(storage.status.pending,1);
finish();await storage.pending;assert(Object.values(initial.buffers).every(b=>b.destroys===1));assert.equal(storage.status.retiredBytes,0);
assert(storage.resize(1000,()=>()=>{}));const pending=storage.pending;storage.destroy();storage.destroy();finish();await pending;
assert(buffers.every(b=>b.destroys===1));assert(!storage.resize(2000,()=>()=>{}));
console.log('ok: bounded allocation and retirement, active binding ranges, GPU copy sizes, failed preparation and pending teardown');
