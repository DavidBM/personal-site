import assert from 'node:assert/strict';
import {NEARBY_EMPTY,NEARBY_SLOTS,defaultNearbySlots,selectNearbyBodies} from './nearby-bodies.mjs';
import {fleetCapacity} from './runtime-capacity.mjs';
import {simulation} from './shaders.mjs';
import {SOLAR_BODY_CAPACITY,RUNTIME_SOLAR_WGSL} from './solar-runtime.mjs';

function fixture(nearby=defaultNearbySlots()) {
  const slots=new Uint32Array(NEARBY_SLOTS*2);
  slots.set(nearby,0);slots.set(nearby,NEARBY_SLOTS);
  return {fleetCount:2,nearby:slots,encounters:new Float32Array(8),intents:Array.from({length:64},()=>({journeys:[null,null]}))};
}
const bodies=rows=>rows.map(([x,radius])=>({p:[x,0,0],radius}));

assert.deepEqual(Array.from(defaultNearbySlots()),[0,1,2,NEARBY_EMPTY]);
const ranked=fixture(new Uint32Array(NEARBY_SLOTS).fill(NEARBY_EMPTY));
selectNearbyBodies(ranked,bodies([[0,10],[50,5],[400,5],[80,5],[2000,5]]),{positions:[[0,0,0],[0,0,0]]});
const slots=Array.from(ranked.nearby.subarray(0,4));
assert.ok(slots.includes(0)&&slots.includes(1)&&slots.includes(3));
assert.ok(!slots.includes(2)&&!slots.includes(4));

const sticky=fixture(new Uint32Array([2,NEARBY_EMPTY,NEARBY_EMPTY,NEARBY_EMPTY]));
selectNearbyBodies(sticky,bodies([[0,10],[40,5],[250,5]]),{positions:[[0,0,0],[0,0,0]]});
assert.ok(Array.from(sticky.nearby.subarray(0,4)).includes(2));

const pinned=fixture(new Uint32Array(NEARBY_SLOTS).fill(NEARBY_EMPTY));
pinned.intents[0].journeys[0]={planet:3};
selectNearbyBodies(pinned,bodies([[0,10],[40,5],[80,5],[4000,5]]),{positions:[[0,0,0],[0,0,0]]});
assert.ok(Array.from(pinned.nearby.subarray(0,4)).includes(3));

const code=simulation(4,fleetCapacity(2),null,true);
assert.match(code,/for\(var b=0u;b<4u;b\+\+\)/);
assert.doesNotMatch(code,/for\(var b=0u;b<3u;b\+\+\)/);
assert.match(code,/nearby:array<vec4<u32>,2>/);
assert.equal(SOLAR_BODY_CAPACITY,16);
assert.match(RUNTIME_SOLAR_WGSL,/array<SolarOrbit,16>/);
assert.equal(fleetCapacity(2).words-fleetCapacity(2).nearbyBase,8);
console.log('Nearby ranking is four sticky slots; avoidBodies loops those slots; SolarControl holds 16 orbits.');
