import {compactToLab} from '../../../lib/ship-runtime/kepler-solar.mjs';

function activeMove(fleet) {
  return fleet.state?.state==='awaiting'&&fleet.state.localMove&&fleet.shipCount>0;
}
function validAnchor(anchor) {
  return anchor&&anchor.n>0&&Number.isFinite(anchor.x)&&Number.isFinite(anchor.y)&&Number.isFinite(anchor.z);
}

/** Reused fleet-only origins. Missing observations keep the selector fallback;
 * leaving a local order clears its override without touching individual ships. */
export function createSceneNearbyPositions(capacity=128) {
  const positions=new Array(capacity).fill(null),scratch=Array.from({length:capacity},()=>new Float64Array(3));
  return (fleets,anchorFor)=>{
    positions.fill(null);
    for(const fleet of fleets) {
      if(!activeMove(fleet))continue;
      const slot=fleet.slot;
      if(!Number.isInteger(slot)||slot<0||slot>=capacity)continue;
      const anchor=anchorFor(slot);
      if(!validAnchor(anchor))continue;
      const point=scratch[slot];point[0]=compactToLab(anchor.x);point[1]=compactToLab(anchor.y);point[2]=compactToLab(anchor.z);
      positions[slot]=point;
    }
    return positions;
  };
}
