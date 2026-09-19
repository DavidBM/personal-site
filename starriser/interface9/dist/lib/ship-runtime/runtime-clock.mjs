// Scene seconds stay double precision on the host. GPU epochs shift by 192 s:
// an exact integer and a multiple of the trail ring period (6 samples / 30 Hz).
export const GPU_CLOCK_LIMIT=256,GPU_CLOCK_SPAN=192;
export const TRAIL_EMIT_HZ=30;
export function createRuntimeClock() {
  let origin=0,rebases=0;
  function local(time){return time-origin;}
  function shiftFor(time) {
    if(!Number.isFinite(time)||time<0||time>Number.MAX_SAFE_INTEGER/1000)throw new Error('Invalid scene clock');
    return local(time)>=GPU_CLOCK_LIMIT?Math.floor((local(time)-64)/GPU_CLOCK_SPAN)*GPU_CLOCK_SPAN:0;
  }
  function commit(shift) {
    if(!Number.isSafeInteger(shift)||shift<=0||shift%GPU_CLOCK_SPAN!==0)throw new Error('Invalid GPU epoch shift');
    origin+=shift;rebases++;
  }
  function phases(time){const value=Math.floor(time*30)>>>0;return [value&65535,value>>>16,Math.floor(time*8)%8];}
  function trailTick(time){return Math.floor(time*TRAIL_EMIT_HZ+1e-7)-origin*TRAIL_EMIT_HZ;}
  return {local,shiftFor,commit,phases,trailTick,reset(){origin=0;rebases=0;},get origin(){return origin;},get rebases(){return rebases;}};
}
