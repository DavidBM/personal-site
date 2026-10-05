import { WARP_PLANET_ARRIVAL_SECONDS } from '../../../lib/ship-runtime/arrival-deadline.mjs';
import { fleetRingGeometry } from '../../../lib/ship-runtime/fleet-orbit.mjs';
import { SCENE_LAB } from '../../../lib/ship-runtime/flight-layout.mjs';

/** Stable authority phase identity. No clock, allocation, or pose work per ship. */
export function automaticRouteKey(fleet) {
  const state=fleet.state, phase=fleet.plan?.phase;
  if (!state) return null;
  switch(state.state) {
    case 'awaiting':
      return state.orbit ? `orbit:${state.orbit.revision}:${state.orbit.startTime}` : null;
    case 'jumping':
      return isInboundPhase(phase,fleet.systemId,state.endNode?.solarSystemId)
        ? `in:${state.startTime+state.durationMs}` : null;
    case 'cooldown':
      return cooldownRouteKey(fleet,phase);
    default: return null;
  }
}
function cooldownRouteKey(fleet,phase) {
  const state=fleet.state;
  if (phase==='stage') return `out:${state.startTime}`;
  return isArrivalPhase(phase,fleet.systemId,state.node?.solarSystemId) ? `in:${state.startTime}` : null;
}
function isArrivalPhase(phase,systemId,destination) {
  return phase==='orbit' || isInboundPhase(phase,systemId,destination);
}
function isInboundPhase(phase,systemId,destination) {
  return phase==='inbound' || phase==='retained-warp' && systemId===destination;
}

export function automaticRouteIntent(fleet,key) {
  const outbound=key.startsWith('out:');
  return {revision:1,orderId:key,automatic:outbound?'departure':'arrival',
    destination:outbound?fleet.plan.exit:{x:0,y:0,z:0}};
}
export function automaticRouteDeadline(fleet,now) {
  if (!Number.isFinite(fleet.nowMs)) return null;
  const state=fleet.state;
  const epoch=state.orbit?.startTime ?? (state.state==='jumping' || fleet.plan.phase==='stage'
    ? state.startTime+state.durationMs : state.startTime);
  return now+(epoch-fleet.nowMs)/1000+(fleet.plan.phase==='stage'?0:WARP_PLANET_ARRIVAL_SECONDS);
}

/** Component/lab hosts may not supply a domain clock. Without that mapping,
 * preserve untimed orbit instead of uploading a NaN journey that never starts. */
export function automaticArrivalAt(fleet,now) {
  const state=fleet.state;
  const start=state?.state==='awaiting'?state.orbit?.startTime:state?.state==='cooldown'?state.startTime:undefined;
  if (!Number.isFinite(start) || !Number.isFinite(fleet.nowMs)) return undefined;
  const at=now+(start-fleet.nowMs)/1000;
  return Number.isFinite(at)?at:undefined;
}

/** Four bounded candidates in the representative's orbit plane. Ports are
 * outside the complete planning-window body sweep; the GPU owns final capture. */
export function arrivalPorts(fleet,bodies,obstacles,capability,start,seconds) {
  const body=bodies[fleet.bodyIndex];
  if(!body)return [];
  const t=Math.max(0,Math.min(30,seconds)),phase=body.phase+(body.rate??0)*t;
  const center=body.orbitRadius>0
    ? [0,1,2].map(i=>body.orbitRadius*(body.uAxis[i]*Math.cos(phase)+body.vAxis[i]*Math.sin(phase)))
    : [body.x,body.y,body.z];
  const ring=fleetRingGeometry(capability.type,body.radius*SCENE_LAB,0);
  const sweep=Math.min(2,Math.abs(body.rate??0)*30)*(body.orbitRadius??0);
  const r=Math.max(ring.radius/SCENE_LAB,obstacles[fleet.bodyIndex].radius+sweep
    +capability.values[4]+capability.values[5]+.001);
  const axis=[0,Math.sin(ring.tilt),Math.cos(ring.tilt)];
  const delta=start.map((v,i)=>v-center[i]);
  const angle=Math.atan2(delta[1]*axis[1]+delta[2]*axis[2],delta[0]);
  return [0,Math.PI/2,-Math.PI/2,Math.PI].map(offset=>{
    const a=angle+offset;
    return center.map((v,i)=>v+r*((i===0?1:0)*Math.cos(a)+axis[i]*Math.sin(a)));
  });
}
