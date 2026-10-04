import {SCENE_LAB_SCALE} from './kepler-solar.mjs';
import {directorError} from './worker-client.mjs';
import {prepareFlightCurve} from './flight-curve.mjs';
import {packSceneRouteSamples,unpackRoutePoints} from './route-cache.mjs';
import {solveRouteProgram,MAX_ROUTE_WAYPOINTS,MAX_ROUTE_PROGRAM_POINTS} from './scene-route-program.mjs';

export const SCENE_ROUTE_BODY_LIMIT=16;
const linear=value=>value*SCENE_LAB_SCALE;
function invalid(message){throw directorError('input',message);}
function vector(value,length,label) {
  if(!Array.isArray(value)||value.length!==length||!value.every(Number.isFinite))invalid(`Invalid ${label}`);
  return value.slice();
}
function validateOrbit(body) {
  if(!body||![body.orbitRadius??0,body.rate??0].every(v=>Number.isFinite(v)&&v>=0))invalid('Invalid orbit radius or rate; negative rates are unsupported');
  if(!Number.isFinite(body.radius)||body.radius<=0)invalid('Invalid body radius');
}
function staticBody(body,position) {
  if(position.some(value=>value!==0))invalid('Stationary off-origin bodies are unsupported by the shared ephemeris');
  return [0,linear(body.radius),0,0,1,0,0,0,0,0,1,0];
}
function movingBody(body) {
  const u=vector(body.uAxis,3,'orbit U axis'),v=vector(body.vAxis,3,'orbit V axis');
  if(!Number.isFinite(body.phase)||!u.some(Boolean)||!v.some(Boolean))invalid('Invalid moving orbit');
  return [linear(body.orbitRadius),linear(body.radius),Math.PI*2/body.rate,body.phase,...u,0,...v,0];
}
function bodyRecord(body) {
  validateOrbit(body);
  const position=vector([body.x,body.y,body.z],3,'body position');
  const moving=!body.isSun&&body.orbitRadius>0&&body.rate>0;
  return moving?movingBody(body):staticBody(body,position);
}
function capability(value) {
  const result=vector(value,6,'route capability');
  for(const i of [0,1,2,4,5])result[i]=linear(result[i]);
  if(!result.slice(0,4).every(v=>v>=1e-6&&v<=1e6)||!result.slice(4).every(v=>v>=0&&v<=1e6))invalid('Route capability exceeds shared solver limits');
  return result;
}
function validateWindow(at,duration) {
  if(!Number.isFinite(at)||Math.abs(at*1000)>Number.MAX_SAFE_INTEGER)invalid('Invalid scene route epoch');
  if(!Number.isFinite(duration)||duration<.001||duration>86400)invalid('Invalid scene route validity interval');
  if(Math.abs((at+duration)*1000)>Number.MAX_SAFE_INTEGER)invalid('Scene route validity exceeds the ephemeris time range');
}
function validateCatalog(bodies) {
  if(!Array.isArray(bodies)||bodies.length<1)invalid('A scene route needs its complete body catalogue');
  if(bodies.length>SCENE_ROUTE_BODY_LIMIT)throw directorError('capacity',`Scene route catalogue has ${bodies.length} bodies; shared planner supports ${SCENE_ROUTE_BODY_LIMIT}`);
}
function cacheOptions(value) {
  if(value==null)return null;
  if(!Number.isFinite(value.width)||value.width<=0)invalid('Invalid route cache width');
  if(![value.token,value.revision].every(v=>Number.isInteger(v)&&v>=0&&v<=0xffffff))invalid('Invalid route cache identity');
  const retained=value.retained??[];
  if(!Array.isArray(retained)||retained.length>128)invalid('Invalid retained route');
  return {width:value.width,token:value.token,revision:value.revision,bias:vector(value.bias,3,'route frame bias'),
    retained:retained.map(p=>vector(p,3,'retained route point').map(linear))};
}
function routeProgram(value) {
  if(value==null)return null;
  if(!Array.isArray(value.waypoints)||value.waypoints.length<1||value.waypoints.length>MAX_ROUTE_WAYPOINTS)invalid('Invalid waypoint capacity');
  if(value.closed&&value.waypoints.length<3)invalid('A patrol needs at least three waypoints');
  const waypoints=value.waypoints.map(p=>vector(p,3,'authored waypoint').map(linear));
  return {waypoints,closed:Boolean(value.closed),replan:value.replan===true,retained:retainedProgram(value.retained),extension:extensionProgram(value.extension,waypoints.length)};
}
function retainedProgram(value) {
  if(!value)return null;
  const {points,cycleStart}=value;
  if(!Array.isArray(points)||points.length>MAX_ROUTE_PROGRAM_POINTS||!Number.isInteger(cycleStart)||cycleStart < -1||cycleStart>=points.length-1)invalid('Invalid retained route program');
  return {points:points.map(p=>vector(p,3,'program point').map(linear)),cycleStart};
}
function extensionProgram(value,count) {
  if(!value)return null;
  const {points,waypointCount}=value;
  if(!Array.isArray(points)||points.length<2||points.length>MAX_ROUTE_PROGRAM_POINTS)invalid('Invalid extension prefix');
  if(!Number.isInteger(waypointCount)||waypointCount<1||waypointCount>count)invalid('Invalid extension waypoint count');
  return {points:points.map(p=>vector(p,3,'extension prefix point').map(linear)),waypointCount};
}
/** Own an immutable planning snapshot; all incoming linear units are compact. */
export function prepareSceneRoute(value) {
  if(!value||typeof value.key!=='string'||value.key.length<1||value.key.length>128)invalid('Invalid scene route key');
  validateCatalog(value.bodies);validateWindow(value.at,value.durationSeconds);
  const bodies=value.bodies.flatMap(bodyRecord);
  const frameBody=value.bodies.findIndex(b=>b.isSun);
  if(frameBody<0)invalid('Scene route requires its stationary sun reference');
  const start=vector(value.start,3,'route start').map(linear),destination=vector(value.destination,3,'route destination').map(linear);
  return {key:value.key,at:value.at,durationSeconds:value.durationSeconds,frameBody,start,destination,
    alternatives:(value.alternatives??[]).slice(0,3).map(p=>vector(p,3,'arrival port').map(linear)),
    capability:capability(value.capability),cache:cacheOptions(value.cache),program:routeProgram(value.program),definition:{epochMs:value.at*1000,origin:[0,0,0],bodies}};
}

function plannerPoints(data,bias){
  // Public result points stay in the planner's sun-local frame. Only the GPU
  // cache subtracts the captured formation bias; the host owns that transform.
  return unpackRoutePoints(data,SCENE_LAB_SCALE).map(p=>p.map((v,i)=>v+bias[i]));
}
function prepareCache(model,request,points) {
  const options=request.cache;
  const knots=points.map(p=>p.map(linear));
  const isClear=(samples,error)=>model.route_is_clear(request.frameBody,request.at*1000,request.durationSeconds,
    Float64Array.from(samples.flat()),request.capability[4]+request.capability[5]+error);
  const curve=prepareFlightCurve(knots,request.capability,isClear);
  const samples=curve.points.map(p=>p.map((v,i)=>v-options.bias[i]*SCENE_LAB_SCALE));
  const data=packSceneRouteSamples(samples,options.width,request.capability[0],options.token,
    {acceleration:request.capability[1],turnRate:request.capability[3],revision:options.revision});
  return {cache:data,points:plannerPoints(data,options.bias),curve:curve.status};
}
function retainedRoute(model,request) {
  const points=request.cache?.retained;
  if(!points||points.length<2)return null;
  if(!model.route_is_clear(request.frameBody,request.at*1000,request.durationSeconds,
    Float64Array.from(points.flat()),request.capability[4]+request.capability[5]))return null;
  const options=request.cache;
  const data=packSceneRouteSamples(points.map(p=>p.map((v,i)=>v-options.bias[i]*SCENE_LAB_SCALE)),
    options.width,request.capability[0],options.token,{acceleration:request.capability[1],turnRate:request.capability[3],revision:options.revision});
  return {status:'retained',cache:data,points:plannerPoints(data,options.bias),curve:'retained',
    validUntil:request.at+request.durationSeconds,nominalSeconds:0};
}
function solveProgram(model,request) {
  const program=solveRouteProgram(model,request),options=request.cache;
  let cache;
  if(options){
    cache=packSceneRouteSamples(program.points.map(p=>p.map((v,i)=>(v-options.bias[i])*SCENE_LAB_SCALE)),
      options.width,request.capability[0],options.token,{acceleration:request.capability[1],turnRate:request.capability[3],revision:options.revision,cycleStart:program.cycleStart,ordered:request.program.waypoints.length>1});
    program.points=plannerPoints(cache,options.bias);
  }
  return {status:'planned',points:program.points,cache,program,validUntil:request.at+request.durationSeconds,nominalSeconds:0};
}

/** Runs only inside the worker in production; rules injection permits real WASM tests. */
export function solveSceneRoute(request,rules) {
  const definition=request.definition;
  const model=new rules.PlanetaryModel(rules.ephemeris_version(),definition.epochMs,Float64Array.from(definition.origin),Float64Array.from(definition.bodies));
  try {
    if(request.program)return solveProgram(model,request);
    const retained=retainedRoute(model,request);if(retained)return retained;
    let columns;
    // First acceptable port wins. One prepared ephemeris, at most four solves.
    for(const destination of [request.destination,...(request.alternatives??[])]) {
      columns=model.plan_route(request.frameBody,request.at*1000,request.durationSeconds,
        Float64Array.from(request.start),Float64Array.from(destination),Float64Array.from(request.capability));
      if(columns[2]>1)break;
    }
    const points=[];
    for(let i=0;i<columns[2];i++)points.push(Array.from(columns.subarray(12+i*4,15+i*4),v=>v/SCENE_LAB_SCALE));
    const prepared=request.cache&&points.length>1?prepareCache(model,request,points):{};
    return {status:columns[1]===0?'no-route':columns[3]===0?'infeasible':'planned',points,...prepared,
      validUntil:request.at+request.durationSeconds,nominalSeconds:columns[4]};
  }finally{model.free();}
}
