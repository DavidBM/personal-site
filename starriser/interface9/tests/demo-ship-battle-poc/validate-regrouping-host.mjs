import assert from 'node:assert/strict';
import {createDirector} from './director.mjs';
import {exportDirector,prepareDirectorSnapshot} from './director-snapshot.mjs';
import {preparePopulationRegrouping} from './population-regrouping.mjs';
import {createSlotLayout} from './slot-layout.mjs';
import {createShipHandles} from './ship-handles.mjs';
import {regroupingRows} from './regrouping-gpu.mjs';

function logical(d){return Array.from({length:d.capacity.groups},(_,g)=>d.roster.logicalCount(g>>>5,g&31)).reduce((a,b)=>a+b,0);}
function transfer(d,rows,slots) {
  const prepared=preparePopulationRegrouping(d,rows),commit=slots?.prepareMembership(prepared.director.population);
  d.adopt(prepared.director,false);commit?.();return prepared.members;
}
function ordinary() {
  const d=createDirector(1000),slots=createSlotLayout(d,1000),ids=[...d.population.ids],total=logical(d),alive=d.alive;
  const handles=createShipHandles(d,slots,()=>1,()=>false),follow=handles.capture(0),before=exportDirector(d);
  slots.request([...ids].reverse());const packing=slots.prepare(2);slots.commit(packing);
  const physical=slots.physical.slice(),stale=slots.prepare(2);
  const rows=transfer(d,{from:0,to:1,type:0,visual:3,logical:60},slots);
  assert.deepEqual(rows.map(r=>r.id),[1,2,3]);assert.deepEqual([...d.population.ids],ids);
  assert.equal(logical(d),total);assert.equal(d.alive,alive);assert.deepEqual(slots.physical,physical);
  assert.equal(handles.resolve(follow).slot,physical[0]);assert(slots.status.pending);
  assert.throws(()=>slots.commit(stale),/Superseded/);
  assert.equal(slots.data[0],0);assert.equal(slots.data[d.population.keys[0]],physical[0]+1);
  assert(d.navigationEpochs[0]>0&&d.navigationEpochs[64]>0);
  assert.throws(()=>prepareDirectorSnapshot(d,before),/layout/);prepareDirectorSnapshot(d,exportDirector(d));
  d.apply({revision:d.revision+1,fleet:1,type:0,remaining:d.roster.logicalCount(1,0)-30});
  assert.equal(logical(d),total-30);assert(d.alive<alive);
}
function atomicExchange() {
  const d=createDirector(64);
  for(let fleet=0;fleet<2;fleet++)d.reinforce({revision:d.revision+1,fleet,type:0,visual:255,logical:5100});
  const total=logical(d),ids=[...d.population.ids],nextId=d.population.nextId;
  transfer(d,[{from:0,to:1,type:0,visual:128,logical:2560},{from:1,to:0,type:0,visual:128,logical:2560}]);
  for(let fleet=0;fleet<2;fleet++)assert.equal(d.roster.retainedFor(fleet,0),256);
  assert.equal(logical(d),total);assert.deepEqual([...d.population.ids],ids);assert.equal(d.population.nextId,nextId);
  prepareDirectorSnapshot(d,exportDirector(d));
}
function rollback() {
  const d=createDirector(1000),before=exportDirector(d),revision=d.revision;
  const valid={from:0,to:1,type:0,visual:2,logical:40};
  for(const bad of [{...valid,to:0},{...valid,visual:256},{...valid,logical:1},{...valid,logical:1e9},{...valid,effectiveAt:2},{...valid,type:33}]) {
    assert.throws(()=>transfer(d,[valid,bad]));assert.deepEqual(exportDirector(d),before);assert.equal(d.revision,revision);
  }
  const reserve=createDirector(1000,{initialFleets:[]});assert.throws(()=>transfer(reserve,valid),/live representatives/);
}
function lossesAndCycles() {
  const d=createDirector(1000),initial=d.roster.count(0,0);
  d.apply({revision:1,fleet:0,type:0,remaining:80});const alive=d.alive,total=logical(d);
  const members=transfer(d,{from:0,to:1,type:0,visual:2,logical:40});
  assert.equal(d.roster.count(0,0),2);assert.equal(d.roster.retainedFor(0,0),initial-2);
  assert.equal(d.alive,alive);assert.equal(logical(d),total);
  for(let i=0;i<300;i++) {
    transfer(d,{from:1,to:0,type:0,visual:2,logical:40});transfer(d,{from:0,to:1,type:0,visual:2,logical:40});
    assert.equal(d.alive,alive);assert.equal(logical(d),total);assert(d.roster.batches[0].length<=2);assert(d.roster.batches[32].length<=3);
  }
  assert.equal(d.population.count,1000);assert.equal(d.population.nextId,1001);assert.equal(new Set(d.population.keys).size,1000);
  for(const row of members)assert(d.population.indexOf(row.id)>=0);
  prepareDirectorSnapshot(d,exportDirector(d));
}
ordinary();atomicExchange();rollback();lossesAndCycles();
const invisible=createDirector(64);invisible.apply({revision:1,fleet:0,type:0,remaining:9});
assert.equal(invisible.roster.count(0,0),0);const invisibleTotal=logical(invisible),invisibleAlive=invisible.alive;
assert.deepEqual(transfer(invisible,{from:0,to:1,type:0,visual:0,logical:9}),[]);
assert.equal(invisible.roster.logicalCount(0,0),0);assert.equal(invisible.roster.logicalCount(1,0),29);assert.equal(invisible.alive,invisibleAlive);assert.equal(logical(invisible),invisibleTotal);
prepareDirectorSnapshot(invisible,exportDirector(invisible));
console.log('ok: regrouping preserves IDs, logical counts, poses addressing, follow handles and pending packing; atomic full-capacity exchange, snapshot boundaries, rollback and 300 bounded round trips');

const budget=createDirector(64),budgetSlots=createSlotLayout(budget,64);
const prepared=preparePopulationRegrouping(budget,{from:0,to:1,type:0,visual:1,logical:20});
const observation=new Uint32Array(64*4);budget.population.ids.forEach((id,i)=>{observation[i*4]=id;});
observation[6]=128;assert.equal(regroupingRows(budget.population,budgetSlots,prepared.members,observation),null);
observation[6]=0;observation[1]=10;observation[2]=10;assert.equal(regroupingRows(budget.population,budgetSlots,prepared.members,observation),null);
observation[3]=10;assert(regroupingRows(budget.population,budgetSlots,prepared.members,observation));
observation[0]++;assert.throws(()=>regroupingRows(budget.population,budgetSlots,prepared.members,observation),/identity/);
console.log('ok: bounded correction pool and per-ship history admission; same-boundary records can be reused at capacity');
