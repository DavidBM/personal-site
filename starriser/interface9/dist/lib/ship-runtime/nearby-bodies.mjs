// CPU ranks four sticky body indices per fleet (not per ship). GPU avoid/separate
// loop those four slots only — never every planet × every ship.
export const NEARBY_SLOTS=4;
export const NEARBY_EMPTY=0xffffffff;
export const NEARBY_ENTER=200;
export const NEARBY_EXIT=280;
export const NEARBY_REPLACE=40;
export const NEARBY_HULL_PAD=3;

export function defaultNearbySlots() {
  return new Uint32Array([0,1,2,NEARBY_EMPTY]);
}

export function bodyClearance(position,body,hullPad=NEARBY_HULL_PAD) {
  return Math.hypot(position[0]-body.p[0],position[1]-body.p[1],position[2]-body.p[2])-body.radius-hullPad;
}

function fleetOrigin(director,fleet,positions,bodies) {
  if(positions?.[fleet])return positions[fleet];
  const at=fleet*4;
  if(director.encounters[at+3]>0)return [director.encounters[at],director.encounters[at+1],director.encounters[at+2]];
  const pins=pinnedIndices(director,fleet,bodies.length);
  for(const index of pins) {
    if(index===0)continue;
    const body=bodies[index];
    if(body?.p)return body.p;
  }
  return bodies[0]?.p ?? [0,0,0];
}

function intentBelongsToFleet(director,index,fleet) {
  if(director.occupied)return director.occupied[index]?.slot===fleet;
  return Math.floor(index/32)===fleet;
}
function collectJourneyPlanets(intent,bodyCount,seen,pins) {
  for(const journey of intent.journeys) {
    const planet=journey?.planet;
    if(!Number.isInteger(planet)||planet<0||planet>=bodyCount||seen.has(planet))continue;
    seen.add(planet);pins.push(planet);
  }
}
function pinnedIndices(director,fleet,bodyCount) {
  const pins=[],seen=new Set(),intents=director.intents??[];
  if(bodyCount>0){seen.add(0);pins.push(0);}
  for(let i=0;i<intents.length;i++) {
    if(!intentBelongsToFleet(director,i,fleet)||!intents[i])continue;
    collectJourneyPlanets(intents[i],bodyCount,seen,pins);
  }
  return pins;
}

function placePins(pins,clearances,used) {
  const kept=[];
  for(const index of [...pins].sort((a,b)=>clearances[a]-clearances[b]||a-b)) {
    if(kept.length===NEARBY_SLOTS)break;
    kept.push(index);used.add(index);
  }
  return kept;
}

function keepPrevious(previous,clearances,pins,used) {
  const kept=[];
  for(const index of previous) {
    if(index===NEARBY_EMPTY||used.has(index)||index<0||index>=clearances.length)continue;
    if(pins.has(index)||clearances[index]<=NEARBY_EXIT) {
      kept.push(index);used.add(index);
      if(kept.length===NEARBY_SLOTS)break;
    }
  }
  return kept;
}

function rankUnused(clearances,used) {
  return Array.from({length:clearances.length},(_,i)=>i).filter(i=>!used.has(i)).sort((a,b)=>clearances[a]-clearances[b]||a-b);
}

function fillEnter(kept,ranked,clearances,used) {
  for(const index of ranked) {
    if(kept.length===NEARBY_SLOTS)break;
    if(clearances[index]>=NEARBY_ENTER)continue;
    kept.push(index);used.add(index);
  }
}

function replaceWorse(kept,ranked,clearances,pins,used) {
  for(const index of ranked) {
    if(used.has(index)||clearances[index]>=NEARBY_ENTER)continue;
    let worst=-1,worstC=-Infinity;
    for(let slot=0;slot<kept.length;slot++) {
      if(pins.has(kept[slot]))continue;
      if(clearances[kept[slot]]>worstC){worstC=clearances[kept[slot]];worst=slot;}
    }
    if(worst<0||worstC-clearances[index]<NEARBY_REPLACE)break;
    used.delete(kept[worst]);kept[worst]=index;used.add(index);
  }
}

function packSlots(kept) {
  const slots=new Uint32Array(NEARBY_SLOTS).fill(NEARBY_EMPTY);
  for(let i=0;i<kept.length&&i<NEARBY_SLOTS;i++)slots[i]=kept[i];
  return slots;
}

function selectFleetNearby(director,fleet,bodies,options) {
  const origin=fleetOrigin(director,fleet,options.positions,bodies);
  const hullPad=options.hullPad??NEARBY_HULL_PAD;
  const clearances=bodies.map(body=>bodyClearance(origin,body,hullPad));
  const pinList=pinnedIndices(director,fleet,bodies.length),pins=new Set(pinList),used=new Set();
  const kept=placePins(pinList,clearances,used);
  if(kept.length<NEARBY_SLOTS) {
    const previous=director.nearby.subarray(fleet*NEARBY_SLOTS,fleet*NEARBY_SLOTS+NEARBY_SLOTS);
    for(const index of keepPrevious(previous,clearances,pins,used)) {
      if(kept.length===NEARBY_SLOTS)break;
      kept.push(index);
    }
  }
  const ranked=rankUnused(clearances,used);
  fillEnter(kept,ranked,clearances,used);
  replaceWorse(kept,ranked,clearances,pins,used);
  director.nearby.set(packSlots(kept),fleet*NEARBY_SLOTS);
}

export function selectNearbyBodies(director,bodies,options={}) {
  if(!Array.isArray(bodies))throw new Error('Nearby ranking needs a body list');
  for(let fleet=0;fleet<director.fleetCount;fleet++)selectFleetNearby(director,fleet,bodies,options);
  return director.nearby;
}
