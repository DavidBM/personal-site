// CPU ranks four sticky bodies per fleet. GPU avoidance remains four slots/ship.
import {createNearbyBodyIndex} from './nearby-body-index.mjs';
export const NEARBY_SLOTS=4;
export const NEARBY_EMPTY=0xffffffff;
export const NEARBY_ENTER=200;
export const NEARBY_EXIT=280;
export const NEARBY_REPLACE=40;
// Compact systems span roughly 56 lab units; 40 would retain obsolete bodies
// across most of a local route. Half a unit still exceeds observation noise.
export const SCENE_NEARBY_REPLACE=0.5;
export const NEARBY_HULL_PAD=3;
export const NEARBY_INDEX_THRESHOLD=128;
export function defaultNearbySlots(){return new Uint32Array([0,1,2,NEARBY_EMPTY]);}
export function bodyClearance(position,body,hullPad=NEARBY_HULL_PAD) {
  return Math.hypot(position[0]-body.p[0],position[1]-body.p[1],position[2]-body.p[2])-body.radius-hullPad;
}
function cacheKey(director,count,key) {
  key[0]=director.revision;key[1]=director.ordinalEpoch;key[2]=director.population;key[3]=director.population?.revision;
  key[4]=director.occupied;key[5]=director.occupied?.length;key[6]=director.intents;key[7]=director.intents?.length;
  key[8]=director.fleetCount;key[9]=count;return key;
}
function sameKey(a,b){if(!a)return false;for(let i=0;i<b.length;i++)if(a[i]!==b[i])return false;return true;}
function appendPins(intent,pins,seen,count) {
  for(const journey of intent.journeys) {
    // A local route retains planet only as its physics-scale reference.
    if(journey?.mode==='route')continue;
    const planet=journey?.planet;
    if(Number.isInteger(planet)&&planet>=0&&planet<count&&!seen.has(planet)){seen.add(planet);pins.push(planet);}
  }
}
function pinLists(director,count) {
  const pins=Array.from({length:director.fleetCount},()=>count?[0]:[]);
  const seen=pins.map(p=>new Set(p)),intents=director.intents??[];
  for(let i=0;i<intents.length;i++) {
    const fleet=director.occupied?director.occupied[i]?.slot:Math.floor(i/32);
    if(!seen[fleet]||!intents[i])continue;
    appendPins(intents[i],pins[fleet],seen[fleet],count);
  }
  return pins;
}
const ZERO_ORIGIN=[0,0,0];
function fallbackOrigin(pins,bodies) {
  for(const index of pins)if(index!==0&&bodies[index]?.p)return bodies[index].p;
  return bodies[0]?.p??ZERO_ORIGIN;
}
function originFor(state,fleet,positions) {
  const {director,pins,bodies,origin}=state,at=fleet*4;
  if(positions?.[fleet]){origin.set(positions[fleet]);return;}
  if(director.encounters[at+3]>0) {
    for(let d=0;d<3;d++)origin[d]=director.encounters[at+d];return;
  }
  origin.set(fallbackOrigin(pins[fleet],bodies));
}
function better(score,id,otherScore,otherId){return score<otherScore||(score===otherScore&&id<otherId);}
function insertBest(ids,scores,count,id,score) {
  let at=count;
  while(at>0&&better(score,id,scores[at-1],ids[at-1]))at--;
  if(at>=NEARBY_SLOTS)return count;
  for(let i=Math.min(count,NEARBY_SLOTS-1);i>at;i--){ids[i]=ids[i-1];scores[i]=scores[i-1];}
  ids[at]=id;scores[at]=score;return Math.min(NEARBY_SLOTS,count+1);
}
function contains(ids,count,id){for(let i=0;i<count;i++)if(ids[i]===id)return true;return false;}
function scoreOf(state,index) {
  if(state.stamps[index]!==state.generation) {
    state.stamps[index]=state.generation;
    state.scores[index]=bodyClearance(state.origin,state.bodies[index],state.hullPad);state.stats.bodyTests++;
  }
  return state.scores[index];
}
function keepPrevious(state,fleet) {
  const {director,kept,keptScores,bodies}=state;
  for(let i=0;i<NEARBY_SLOTS;i++) {
    const id=director.nearby[fleet*NEARBY_SLOTS+i];
    if(id>=bodies.length||contains(kept,state.keptCount,id))continue;
    const score=scoreOf(state,id);
    if(!(score<=NEARBY_EXIT)||contains(state.previousUsed,state.previousCount,id))continue;
    // Prior valid IDs remain excluded from newcomer ranking even when pins
    // leave insufficient room to retain them: preserve the existing slot order.
    state.previousUsed[state.previousCount++]=id;
    if(state.keptCount<NEARBY_SLOTS){kept[state.keptCount]=id;keptScores[state.keptCount++]=score;}
  }
}
function acceptCandidates(state,pinCount) {
  // At most four newcomers can enter. Later, worse newcomers cannot replace an
  // already accepted better one, so sorting the complete catalog is unnecessary.
  let next=0;
  while(state.keptCount<NEARBY_SLOTS&&next<state.candidateCount) {
    state.kept[state.keptCount]=state.candidates[next];state.keptScores[state.keptCount++]=state.candidateScores[next++];
  }
  for(;next<state.candidateCount;next++) {
    let worst=-1,worstScore=-Infinity;
    for(let slot=pinCount;slot<state.keptCount;slot++) {
      if(state.keptScores[slot]>worstScore){worst=slot;worstScore=state.keptScores[slot];}
    }
    if(worst<0||worstScore-state.candidateScores[next]<state.replaceMargin)break;
    state.kept[worst]=state.candidates[next];state.keptScores[worst]=state.candidateScores[next];
  }
}
function selectFleet(state,fleet,positions,index) {
  originFor(state,fleet,positions);
  state.generation=(state.generation+1)>>>0;
  if(!state.generation){state.stamps.fill(0);state.generation=1;}
  state.keptCount=0;state.candidateCount=0;state.previousCount=0;
  for(const id of state.pins[fleet])state.keptCount=insertBest(state.kept,state.keptScores,state.keptCount,id,scoreOf(state,id));
  const pinCount=state.keptCount;
  if(pinCount<NEARBY_SLOTS) {
    keepPrevious(state,fleet);
    if(index)index.query(state.origin,state.queryRadius,state.visit);
    else for(let id=0;id<state.bodies.length;id++)state.visit(id);
    acceptCandidates(state,pinCount);
  }
  const at=fleet*NEARBY_SLOTS;
  for(let i=0;i<NEARBY_SLOTS;i++)state.director.nearby[at+i]=i<state.keptCount?state.kept[i]:NEARBY_EMPTY;
}
function createState(director) {
  const state={director,bodies:[],pins:[],origin:new Float64Array(3),hullPad:NEARBY_HULL_PAD,replaceMargin:NEARBY_REPLACE,
    kept:new Uint32Array(4),keptScores:new Float64Array(4),candidates:new Uint32Array(4),candidateScores:new Float64Array(4),
    scores:new Float64Array(0),stamps:new Uint32Array(0),generation:0,keptCount:0,candidateCount:0,
    previousUsed:new Uint32Array(4),previousCount:0,key:null,nextKey:new Array(10),queryRadius:null,
    stats:{mode:'linear',bodyTests:0,nodeTests:0,pinRebuilds:0,indexRebuilds:0},visit:null};
  state.visit=id=>{
    if(contains(state.kept,state.keptCount,id)||contains(state.previousUsed,state.previousCount,id))return;
    const score=scoreOf(state,id);
    if(score<NEARBY_ENTER)state.candidateCount=insertBest(state.candidates,state.candidateScores,state.candidateCount,id,score);
  };
  state.queryRadius=()=>state.hullPad+(state.candidateCount===4?Math.min(NEARBY_ENTER,state.candidateScores[3]):NEARBY_ENTER);
  return state;
}
function prepareState(state,bodies,selection) {
  const next=cacheKey(state.director,bodies.length,state.nextKey);
  if(!Number.isFinite(state.director.revision)||!sameKey(state.key,next)) {
    state.pins=pinLists(state.director,bodies.length);state.key=next.slice();state.stats.pinRebuilds++;
  }
  if(state.scores.length!==bodies.length){state.scores=new Float64Array(bodies.length);state.stamps=new Uint32Array(bodies.length);}
  state.bodies=bodies;state.hullPad=selection.hullPad??NEARBY_HULL_PAD;state.stats.bodyTests=0;state.stats.nodeTests=0;
  state.replaceMargin=selection.replaceMargin??NEARBY_REPLACE;
  if(!Number.isFinite(state.replaceMargin)||state.replaceMargin<0)throw Error('Invalid nearby replacement margin');
}
/** One selector belongs to one director lifetime. Scratch and spatial topology are reused. */
export function createNearbySelector(director,options={}) {
  const mode=options.index??'auto',threshold=options.indexThreshold??NEARBY_INDEX_THRESHOLD;
  if(!['auto','linear','bvh'].includes(mode))throw Error('Unknown nearby body index mode');
  const state=createState(director),index=createNearbyBodyIndex();
  function select(bodies,selection={}) {
    if(!Array.isArray(bodies))throw Error('Nearby ranking needs a body list');
    prepareState(state,bodies,selection);
    const indexed=mode==='bvh'||(mode==='auto'&&bodies.length>=threshold);
    if(indexed)index.update(bodies);
    state.stats.mode=indexed?'bvh':'linear';
    for(let fleet=0;fleet<director.fleetCount;fleet++)selectFleet(state,fleet,selection.positions,indexed?index:null);
    state.stats.nodeTests=indexed?index.stats.nodeTests:0;state.stats.indexRebuilds=index.stats.rebuilds;
    return director.nearby;
  }
  return {select,invalidate(){state.key=null;},stats:state.stats};
}
/** Compatibility entrypoint: mutable fixtures without revision ownership stay fresh. */
export function selectNearbyBodies(director,bodies,options={}) {
  return createNearbySelector(director,{index:'linear'}).select(bodies,options);
}
