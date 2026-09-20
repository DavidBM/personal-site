import {classOf,radiusOf} from '../demo-ship-battle-poc/classes.mjs';
import {orbitRadius} from './flight-layout.mjs';
const add=(a,b)=>a.map((x,i)=>x+b[i]);
function routePosition(route,time) {
  const rows=route.result.columns,n=rows[2],elapsed=Math.max(0,time-route.request.at);
  let index=0;while(index+1<n-1&&rows[15+(index+1)*4]<elapsed)index++;
  const at=12+index*4,next=at+4,t=Math.max(0,Math.min(1,(elapsed-rows[at+3])/Math.max(.000001,rows[next+3]-rows[at+3])));
  return [0,1,2].map(axis=>rows[at+axis]+(rows[next+axis]-rows[at+axis])*t);
}
function encounter(engine,director,fleet,time) {
  const offset=fleet*4;
  if(director.encounters[offset+3])return Array.from(director.encounters.slice(offset,offset+3));
  return engine.sequence?engine.solar.encounterAt(time):[0,0,0];
}
function anchor(engine,director,routes,group,cohort,time) {
  const fleet=Math.floor(group/32),type=group%32,journey=director.intents[group].journeys[cohort];
  if(!journey)return encounter(engine,director,fleet,time);
  if(journey.mode==='approach'&&journey.planet!==undefined) {
    const route=routes.records.get(group*2+cohort);
    if(!route)throw new Error('Current approach has no reconstruction route');
    return add(engine.solar.bodyAt(journey.planet,time).slice(0,3),routePosition(route,time));
  }
  if(journey.mode==='orbit') {
    const p=engine.solar.bodyAt(journey.planet,time);return add(p.slice(0,3),[orbitRadius(type,p[3]),0,0]);
  }
  if(['warp','escape'].includes(journey.mode))return warpRegion(journey,time);
  if(journey.mode==='departure')return [...journey.exit];
  return add(encounter(engine,director,fleet,time),journey.exit);
}
// The mock director supplies current group regions after missed history. Only
// the GPU distributes representatives and resolves local obstacle clearance.
export function recoveryPlacements(engine,director,routes,time) {
  return Array.from({length:director.capacity.groups*2},(_,index)=>{
    const group=Math.floor(index/2),type=group%32,cohort=index%2,journey=director.intents[group].journeys[cohort];
    const position=anchor(engine,director,routes,group,cohort,time);
    const velocity=journey?.planet===undefined?[0,0,0]:engine.solar.velocityAt(journey.planet,time);
    return {position,velocity,spread:Math.max(radiusOf(type)*2,Math.min(40,classOf(type).speed))};
  });
}

function warpRegion(journey,time) {
  // A coarse remaining warp corridor is enough for exceptional reconstruction;
  // the individual GPU trajectory still ends on the original deadline.
  const remaining=Math.max(0,journey.end-time);
  return journey.exit.map((x,axis)=>x+(axis===0?-remaining*120:0));
}
