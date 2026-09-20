import assert from 'node:assert/strict';
import {createRuntimeClock} from './runtime-clock.mjs';
const clock=createRuntimeClock();assert.equal(clock.shiftFor(255.999),0);assert.equal(clock.shiftFor(256),192);
const phases=clock.phases(256.125);clock.commit(192);assert.equal(clock.local(256),64);assert.deepEqual(clock.phases(256.125),phases);
assert.equal(clock.shiftFor(447.999),0);assert.equal(clock.shiftFor(448),192);
for(const time of [448,4096,86400,31536000,100000000.125]) {
  const shift=clock.shiftFor(time);clock.commit(shift);
  assert(clock.local(time)>=64&&clock.local(time)<256);
  assert.equal((clock.origin*60)%16,0);
  const [low,high,phase]=clock.phases(time);
  assert.equal((low+(high*65536))>>>0,Math.floor(time*30)>>>0);assert.equal(phase,Math.floor(time*8)%8);
}
assert.throws(()=>clock.shiftFor(NaN));assert.throws(()=>clock.shiftFor(-1));assert.throws(()=>clock.commit(1));
clock.reset();assert.equal(clock.origin,0);assert.equal(clock.rebases,0);
console.log('GPU epoch bounds, trail-ring alignment, global tactical phases, large scene times, invalid clocks and reset pass.');
