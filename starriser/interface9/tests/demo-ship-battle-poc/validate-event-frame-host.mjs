import assert from 'node:assert/strict';
import {createDirector} from './director.mjs';
import {createControl} from './control.mjs';
import {createRuntimeClock} from './runtime-clock.mjs';
import {ROUTE_WORDS} from './local-routes.mjs';
import {createEventFrame,validateEventFrame,EVENT_ROW_WORDS,MAX_GROUP_EVENTS} from './event-frame.mjs';
const d=createDirector(1000,{fleetCount:8}),clock=createRuntimeClock(),control=createControl(d,null,null,null,clock);
const routes={data:new Float32Array(d.capacity.groups*2*ROUTE_WORDS),records:new Map()},frame=createEventFrame(d,control,routes,clock);
const event=(at,commands)=>({effectiveAt:at,deliveredAt:0,commands});
const report=(group)=>({fleet:Math.floor(group/32),type:group%32,fire:true});
assert.equal(frame.layout.bytes,1372176);assert.equal(MAX_GROUP_EVENTS,4);
validateEventFrame(Array.from({length:256},(_,g)=>event(g/1000,[report(g)])),0,d.capacity);
validateEventFrame(Array.from({length:100},()=>event(1,[report(0)])),0,d.capacity);
validateEventFrame(Array.from({length:100},(_,i)=>event(i/1000,[report(0)])),1,d.capacity);
assert.throws(()=>validateEventFrame(Array.from({length:5},(_,i)=>event(i,[report(0)])),0,d.capacity),/GPU event capacity/);
assert.throws(()=>validateEventFrame([...Array.from({length:4},(_,i)=>event(i,[report(0)])),event(5,[{fleet:0,cohort:1,fire:true}])],0,d.capacity),/GPU event capacity/);
frame.begin(255.5,256);
for(let row=1;row<=4;row++) {
  const time=255.5+row/8;
  d.apply({revision:row,fleet:0,type:0,journey:{revision:row,mode:'warp',at:time,end:time+2,exit:[row,2,3]}});
  frame.capture(time);
}
assert(frame.finish());assert.equal(frame.counts[0],4);assert(frame.counts.slice(1).every(n=>n===0));
const f=new Float32Array(frame.data),w=new Uint32Array(frame.data),record=frame.layout.records;
assert.equal(w[frame.layout.directory],4);
for(let row=1;row<=4;row++) {
  const at=record+row*EVENT_ROW_WORDS;
  assert.equal(f[at],255.5+row/8);assert.equal(f[at+25],row);assert.equal(f[at+26],255.5+row/8);assert.equal(f[at+28],0);
}
const before=f.slice();clock.commit(192);frame.rebase(192);
assert.equal(f[1],63.5);assert.equal(f[2],64);
for(let row=1;row<=4;row++) {
  const at=record+row*EVENT_ROW_WORDS;
  assert.equal(f[at],before[at]-192);assert.equal(f[at+1],before[at+1]-192*60);
  assert.equal(f[at+25],row);assert.equal(f[at+26],before[at+26]-192);assert.equal(f[at+27],before[at+27]-192);
}
frame.disable();assert(!frame.active);assert.equal(f[0],0);
frame.begin(256,256.1);assert(!frame.finish());assert(frame.counts.every(n=>n===0));
console.log('Event frame bounds, shared cohort accounting, overdue coalescing, immutable directive rows and epoch layout pass.');
