import {NEARBY_REPLACE} from './nearby-bodies.mjs';

// Ranking can lag ordinary motion by one simulation tick. Commands, population
// changes and discontinuities must select again before that tick is submitted.
export function createNearbySchedule(director, selector, {maxAge=1/120}={}) {
  if(!Number.isFinite(maxAge)||maxAge<=0)throw new Error('Invalid nearby refresh age');
  let time=-Infinity,revision,ordinal,population,populationOwner,bodyCount=-1;
  let geometry=new Float64Array(0);
  const encounters=new Float32Array(director.encounters.length);
  const positions=new Float64Array(director.encounters.length);
  let hullPad,replaceMargin;
  const stats={prepared:0,synchronous:0,reused:0};
  function sameOwner() {
    return revision===director.revision && ordinal===director.ordinalEpoch
      && populationOwner===director.population && population===director.population?.revision;
  }
  function remember(bodies,options) {
    if(geometry.length<bodies.length*4)geometry=new Float64Array(bodies.length*4);
    for(let i=0;i<bodies.length;i++) {
      geometry.set(bodies[i].p,i*4);geometry[i*4+3]=bodies[i].radius;
    }
    encounters.set(director.encounters);bodyCount=bodies.length;
    rememberPositions(positions,options?.positions);hullPad=options?.hullPad;replaceMargin=options?.replaceMargin;
    revision=director.revision;ordinal=director.ordinalEpoch;populationOwner=director.population;population=director.population?.revision;
  }
  function moved(bodies,options={},tolerance) {
    if(hullPad!==options.hullPad||replaceMargin!==options.replaceMargin||positionsMoved(positions,options.positions,tolerance))return true;
    for(let i=0;i<bodies.length;i++)if(bodyDisplacement(bodies[i],geometry,i*4)>tolerance)return true;
    for(let i=0;i<encounters.length;i++)if(encounterMoved(encounters[i],director.encounters[i],i,tolerance))return true;
    return false;
  }
  function prepare(at,bodies,options) {
    if(at===time && sameOwner() && bodyCount===bodies.length && !moved(bodies,options,0))return director.nearby;
    selector.select(bodies,options);remember(bodies,options);time=at;stats.prepared++;
    return director.nearby;
  }
  function ensure(at,bodies,options) {
    const recent=at>=time && at-time<=maxAge+1e-8;
    if(recent && sameOwner() && bodyCount===bodies.length && !moved(bodies,options,displacementTolerance(options)))stats.reused++;
    else {stats.synchronous++;prepare(at,bodies,options);}
    return director.nearby;
  }
  function invalidate(){time=-Infinity;selector.invalidate();}
  return {prepare,ensure,invalidate,stats};
}
function displacementTolerance(options){return (options?.replaceMargin??NEARBY_REPLACE)/2;}

function rememberPositions(previous,positions) {
  for(let i=0;i<previous.length/4;i++) {
    const point=positions?.[i],at=i*4;previous[at+3]=Number(Boolean(point));
    if(point)for(let axis=0;axis<3;axis++)previous[at+axis]=point[axis];
  }
}
function positionsMoved(previous,positions,tolerance) {
  for(let i=0;i<previous.length/4;i++) {
    const point=positions?.[i],at=i*4;
    if(Boolean(point)!==Boolean(previous[at+3]))return true;
    if(point&&positionMoved(point,previous,at,tolerance))return true;
  }
  return false;
}
function positionMoved(point,previous,at,tolerance) {
  for(let axis=0;axis<3;axis++)if(Math.abs(point[axis]-previous[at+axis])>tolerance)return true;
  return false;
}

function bodyDisplacement(body,previous,at) {
  return Math.hypot(body.p[0]-previous[at],body.p[1]-previous[at+1],body.p[2]-previous[at+2])
    +Math.abs(body.radius-previous[at+3]);
}

function encounterMoved(previous,next,index,tolerance) {
  return index%4===3 ? previous!==next : Math.abs(previous-next)>tolerance;
}
