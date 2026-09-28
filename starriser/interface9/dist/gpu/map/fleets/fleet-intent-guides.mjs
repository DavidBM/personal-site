import { fleetRingGeometry } from '../../../lib/ship-runtime/fleet-orbit.mjs';
import { SCENE_LAB_SCALE } from '../../../lib/ship-runtime/kepler-solar.mjs';

/** Automatic guides are command geometry, not collision-free predicted tracks.
 * A ring shows the core class's middle holding lane. Individual ships acquire
 * nearby persistent radii/heights; this is not a live predicted trajectory. */
export function automaticFleetGuide(fleet, body, representative, layout) {
  const plan=fleet.plan;
  if (!plan || !representative || plan.phase==='hide') return [];
  const base=guideMetadata(fleet);
  if (plan.phase==='stage' && plan.exit) return []; // Host uses the observed center, not the original parked point.
  if (plan.exit && plan.origin) return [{...base,points:[xyz(plan.origin),xyz(plan.exit)]}];
  if (!body || !(body.radius>0))return [];
  return [ringGuide(base,body,representative,layout)];
}
function ringGuide(base,body,representative,layout) {
  const radiusLab=body.radius*SCENE_LAB_SCALE;
  const {radius,tilt}=fleetRingGeometry(representative.type,radiusLab,layout?.radius??0);
  const center=[body.x,body.y,body.z];
  const points=Array.from({length:49},(_,i)=>{
    const phase=i/48*Math.PI*2,r=radius/SCENE_LAB_SCALE;
    return [center[0]+Math.cos(phase)*r,center[1]+Math.sin(phase)*Math.sin(tilt)*r,center[2]+Math.sin(phase)*Math.cos(tilt)*r];
  });
  return {...base,points};
}
function xyz(value){return [value.x,value.y,value.z];}

function guideMetadata(fleet){return {slot:fleet.slot??0,color:fleet.marker??[.45,.78,1],status:'guide',destination:[0,0,0],guide:true};}
