import assert from 'node:assert/strict';
import {createFrameStepper,PRESENTATION_TICK,PRESENTATION_FREEZE} from './frame-stepper.mjs';
import {createRuntimeClock} from './runtime-clock.mjs';

function fixture(start=0,dt=PRESENTATION_TICK) {
  let time=start,steps=0;
  const engine={clock:createRuntimeClock(),closed:false,simDt:dt,get now(){return time;},step(next,delta){assert(next>time);assert(Math.abs(delta-dt)<1e-9);time=next;steps++;}};
  return {engine,driver:createFrameStepper(engine),get steps(){return steps;}};
}

let skips=0,ticks=0;
const high=fixture(0,1/120);
for(let frame=1;frame<=480;frame++) {
  const state=high.driver.advance(frame/240);
  if(state.steps===0)skips++;else ticks++;
  assert(state.steps<=1);
}
assert(skips>=ticks,'240 Hz present × High 1/120 skips at least half of advances');

let lowSkips=0,lowTicks=0;
const low=fixture(0,1/30);
for(let frame=1;frame<=480;frame++) {
  const state=low.driver.advance(frame/240);
  if(state.steps===0)lowSkips++;else lowTicks++;
  assert(state.steps<=1);
}
assert(lowSkips>lowTicks,'240 Hz present × Low 1/30 skips most advances');

const mid=fixture(0,1/30);
for(let frame=1;frame<=60;frame++) {
  const state=mid.driver.advance(frame/30);
  assert.equal(state.steps,1);
}
assert.equal(mid.steps,60);

const slow=fixture(0,1/30);
for(let frame=1;frame<=10;frame++) {
  const state=slow.driver.advance(frame/10);
  assert.equal(state.steps,1);
}
assert.equal(slow.steps,10);

const freeze=fixture();
const frozen=freeze.driver.advance(0.4);
assert.equal(frozen.steps,0);
assert.equal(frozen.reason,'suspension');
assert.equal(freeze.engine.now,0);

const jump=fixture();
jump.engine.step(255.99,1/120);
let n=0;
while(jump.engine.now<256.09&&jump.driver.state.reason==null&&n++<64)jump.driver.advance(Math.min(256.09,jump.engine.now+1/120));
assert.equal(jump.driver.state.reason,null);
assert.ok(jump.engine.now>=256.09-1e-9);

const dup=fixture();
dup.driver.advance(1/120);
assert.equal(dup.driver.advance(1/120).steps,0);

for(const time of [NaN,Infinity,-1])assert.throws(()=>dup.driver.advance(time));

const broken=fixture();broken.engine.step=()=>{throw new Error('GPU failure');};assert.throws(()=>broken.driver.advance(.02),/GPU failure/);
console.log('Frame stepping skips faster presents, takes one preset tick, and freezes gaps over 300 ms.');

const due=fixture();let packets=1;due.engine.flushEvents=()=>{const n=packets;packets=0;return n;};
const activation=due.driver.advance(0);assert.equal(activation.steps,0);assert.equal(activation.activations,1);assert.equal(due.driver.advance(0).activations,0);
due.engine.flushEvents=()=>{throw Object.assign(new Error('pressure bound'),{code:'event-frame-capacity'});};
assert.equal(due.driver.advance(0).status,'needs-reconciliation');
console.log('Zero-time directed activation is counted and resource-budget failures enter the same recovery boundary.');
assert.ok(PRESENTATION_FREEZE===.3);
