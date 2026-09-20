import assert from 'node:assert/strict';
import {createDirector} from './director.mjs';
import {createSlotLayout} from './slot-layout.mjs';
import {preparePopulationAdmission} from './population-admission.mjs';
import {preparePopulationRetirement} from './population-retirement.mjs';
import {exportDirector,prepareDirectorSnapshot} from './director-snapshot.mjs';
function admit(d,slots,visual,logical) {
  const prepared=preparePopulationAdmission(d,{fleet:0,type:0,visual,logical,position:[0,0,0]});
  const commit=slots.prepareExtension(prepared.director.population);d.adopt(prepared.director,false);commit();return prepared.batches[0];
}
function metadata(d,slots,ids,records=[]) {
  const data=new Uint32Array(d.population.count*4);
  for(let slot=0;slot<d.population.count;slot++){const id=d.population.ids[slots.logical[slot]];data.set([id,Number(ids.includes(id)),records[slot]??0,0],slot*4);}
  return data;
}
function retire(d,slots,ids) {
  const plan=preparePopulationRetirement(d,slots,metadata(d,slots,ids));assert(plan);
  const commit=slots.prepareRetirement(plan.director.population,plan.keep);d.adopt(plan.director,false);commit();return plan;
}
const d=createDirector(64),slots=createSlotLayout(d,64);
const remaining=logical=>d.apply({revision:d.revision+1,fleet:0,type:0,remaining:logical});
remaining(0);retire(d,slots,[1]);assert.equal(d.population.count,63);assert.equal(d.population.indexOf(1),-1);
const born=admit(d,slots,4,80);assert.equal(born.firstId,65);assert.deepEqual(born.ordinals,[0,1,2,3]);
remaining(31);retire(d,slots,[67,68]);assert.equal(d.roster.batches[0][0].count,4);assert.deepEqual(d.roster.batches[0][0].ordinals,[0,1]);
remaining(9);retire(d,slots,[65,66]);assert.equal(d.roster.batches[0].length,0);assert.equal(d.roster.residual[0],9);assert.equal(d.roster.logicalCount(0,0),9);
prepareDirectorSnapshot(d,exportDirector(d));
const next=admit(d,slots,1,20);remaining(14);assert.equal(d.roster.logicalCount(0,0),14);assert.equal(d.roster.residual[0],4);assert.equal(d.roster.count(0,0),1);
remaining(0);retire(d,slots,[next.firstId]);assert.equal(d.roster.batches[0].length,0);assert.equal(d.roster.residual[0],0);
assert.throws(()=>d.apply({revision:d.revision+1,fleet:0,survivalFraction:1}),/resurrect/);
for(let cycle=0;cycle<300;cycle++) {
  const batch=admit(d,slots,1,20);remaining(0);retire(d,slots,[batch.firstId]);
  assert.equal(d.population.count,63);assert.equal(d.roster.batches[0].length,0);assert.equal(slots.data[0],0);
}
assert.equal(d.population.nextId,370);
const hole=createDirector(64),layout=createSlotLayout(hole,64);
hole.apply({revision:1,fleet:0,type:0,remaining:0});admit(hole,layout,255,5100);retire(hole,layout,[1]);
assert.equal(hole.roster.sizeFor(0,0),256);assert.equal(hole.roster.retainedFor(0,0),255);assert.deepEqual(admit(hole,layout,1,20).ordinals,[0]);
const bad=metadata(hole,layout,[]);bad[0]++;assert.throws(()=>preparePopulationRetirement(hole,layout,bad),/identity/);
const snapshot=exportDirector(hole),broken=structuredClone(snapshot);broken.groups[0].residual[0]=1;assert.throws(()=>prepareDirectorSnapshot(hole,broken),/unrepresented/);
const all=createDirector(64),allSlots=createSlotLayout(all,64);for(let fleet=0;fleet<2;fleet++)all.apply({revision:all.revision+1,fleet,survivalFraction:0});
const ids=[...all.population.ids];allSlots.request([...ids].reverse());retire(all,allSlots,ids);
assert.equal(all.population.count,0);assert.equal(allSlots.data.some(Boolean),false);prepareDirectorSnapshot(all,exportDirector(all));
assert.equal(admit(all,allSlots,2,40).firstId,65);assert.deepEqual([...all.population.ids],[65,66]);
console.log('ok: partial-batch retirement, residual logical accounting, hole reuse, 300 bounded cycles, stale metadata, snapshots, empty population and non-reused serials');

const constrained=createDirector(64),bounded=createSlotLayout(constrained,64);
for(let fleet=0;fleet<2;fleet++)constrained.apply({revision:constrained.revision+1,fleet,survivalFraction:0});
const data=metadata(constrained,bounded,[...constrained.population.ids].slice(0,63));data[63*4+2]=4;
const delayed=preparePopulationRetirement(constrained,bounded,data);assert.equal(delayed.keep.length,2);assert.equal(delayed.records,4);
const reserve=createDirector(1000,{initialFleets:[]}),reservedSlots=createSlotLayout(reserve,1000);
assert.equal(preparePopulationRetirement(reserve,reservedSlots,metadata(reserve,reservedSlots,[...reserve.population.ids])),null);
console.log('ok: journal capacity can defer retirement; unadmitted reserves never retire');
