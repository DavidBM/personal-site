import assert from 'node:assert/strict';
import {createPressureScopes,PRESSURE_SIDE} from './pressure-scopes.mjs';
import {createDirector} from './director.mjs';
import {createControl} from './control.mjs';
const p=createPressureScopes(4),a=p.create({center:[-100,0,0]}),b=p.create({center:[100,0,0]});
for(let fleet=0;fleet<4;fleet++)p.assign({fleet,scope:fleet<2?a:b,revision:1,blend:0});
p.retire(p.shared);p.tick(0);assert.equal(p.allocated,2);assert.equal(p.activeCount,2);
assert.equal(p.affinity(0,1),1);assert.equal(p.affinity(0,2),0);
p.assign({fleet:1,scope:b,revision:2,blend:2});p.tick(1);assert.equal(p.affinity(0,1),.5);
const weights=p.members[1].weights.slice();p.assign({fleet:1,scope:a,revision:3,blend:1});assert.deepEqual(p.members[1].weights,weights);
p.assign({fleet:1,scope:b,revision:4,at:3,blend:1});assert.equal(p.assign({fleet:1,scope:a,revision:3}),false);
p.tick(2);assert.equal(p.affinity(0,1),1);p.tick(4);assert.equal(p.affinity(0,1),0);
assert.throws(()=>p.retire(b),/destination/);
p.assign({fleet:0,scope:b,revision:2,blend:0});p.retire(a);p.tick(4);
const reused=p.create({center:[5,6,7],halfExtent:160});assert.equal(reused.slot,p.shared.slot);
assert.throws(()=>p.assign({fleet:0,scope:p.shared,revision:9}),/Stale/);
assert.equal(p.assign({fleet:0,scope:reused,revision:3,blend:0}),true);
const planet=p.create({planet:1,halfExtent:16});assert.ok(p.resolve(planet).halfExtent>200);
const missing=createPressureScopes(2,{sampleBody:()=>[]});
assert.doesNotThrow(()=>missing.prepareOrder(0,{planet:5,halfExtent:4,blend:0},0));
assert.ok(missing.prepareOrder(0,{planet:8,halfExtent:4,blend:0},0).definition.halfExtent>=0.25);
assert.equal(PRESSURE_SIDE,64);assert.equal(p.bytes,8*64**3*4);
let past=null;
for(let i=0;i<40;i++) {
 const next=p.create({center:[i,0,0]});p.assign({fleet:0,scope:next,revision:10+i,blend:0});
 if(i===0)p.retire(reused);else p.retire(past);
 p.tick(5+i);past=next;
 assert.ok(p.allocated<=3);
}
for(let fleet=0;fleet<4;fleet++)p.assign({fleet,scope:null,revision:100,blend:0});
for(const scope of [...p.slots].filter(Boolean))p.retire(scope);p.tick(50);assert.equal(p.allocated,0);assert.equal(p.activeCount,0);
const d=createDirector(1024,{fleetCount:8});
for(let fleet=0;fleet<8;fleet++)d.apply({revision:fleet+1,fleet,joined:true,battle:1,team:fleet,attackClass:0});
let c=createControl(d),w=new Uint32Array(c.data),at=d.capacity.tableBase+d.capacity.ordinalWords;
assert.equal(w[at]&65535,84); // seven enemy fleets, twelve interceptor types
assert.equal(d.canTarget(0,7),true);
d.apply({revision:9,fleet:7,battle:2});c.sync();assert.equal(w[at]&65535,72);
d.apply({revision:10,fleet:6,team:0});c.sync();assert.equal(w[at]&65535,60);
const before=d.groups.slice();assert.throws(()=>d.apply({revision:11,fleet:0,battle:3,type:2}),/fleet-level/);assert.deepEqual(d.groups,before);
console.log('Pressure pool blending, pending replacement, retirement/reuse, planetary coverage and 8-fleet target permissions passed');

const bounded=createPressureScopes(2);
while(bounded.allocated<bounded.layout.fields)bounded.create({});
assert.throws(()=>bounded.create({}),/exhausted/);
assert.equal(bounded.bytes,8*64**3*4);
const mutable={...bounded.shared};bounded.assign({fleet:0,scope:mutable,revision:1,at:2});mutable.slot=5;
bounded.tick(3);assert.equal(bounded.members[0].weights[bounded.shared.slot],1);
console.log('Pool exhaustion is explicit and pending pressure commands own immutable handles');
const directed=createPressureScopes(2),directedBefore=directed.data.slice(0);
for(const bad of [true,42,[],null,{blend:NaN},{frame:'screen'},{halfExtent:1e300}])assert.throws(()=>directed.prepareOrder(0,bad,0));
assert.deepEqual(directed.data,directedBefore);
directed.applyOrder(directed.prepareOrder(0,{name:'one',center:[5,0,0],blend:0},0));
directed.applyOrder(directed.prepareOrder(1,{name:'one',center:[5,0,0],blend:0},0));
assert.deepEqual(directed.members[0].target,directed.members[1].target);
for(let n=1;n<=40;n++) {
 const time=n/10;
 for(let fleet=0;fleet<2;fleet++)directed.applyOrder(directed.prepareOrder(fleet,{name:n%2?'two':'one',center:n%2?[10,0,0]:[5,0,0],blend:1},time));
 directed.tick(time);
 assert(directed.allocated<=3);
}
directed.tick(6);assert.equal(directed.activeCount,1);assert.equal(directed.layout.fields,8);
console.log('Directed pressure validates before mutation, shares explicit regions and reuses retiring blend destinations under rapid revisions.');
const eight=createPressureScopes(8);
for(let fleet=0;fleet<8;fleet++)eight.applyOrder(eight.prepareOrder(fleet,{name:`old-${fleet}`,blend:0},0));
eight.tick(0);assert.equal(eight.allocated,8);
for(let fleet=0;fleet<8;fleet++)eight.applyOrder(eight.prepareOrder(fleet,{name:`new-${fleet}`,blend:1},0));
eight.tick(.5);assert.equal(eight.activeCount,16);eight.tick(1);assert.equal(eight.allocated,8);
console.log('Eight independent pressure transitions fit exactly sixteen fields and retire their previous destinations.');
