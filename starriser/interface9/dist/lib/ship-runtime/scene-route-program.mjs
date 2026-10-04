import { flightCurvePoints } from './flight-curve.mjs';
import { SCENE_LAB_SCALE } from './kepler-solar.mjs';

export const MAX_ROUTE_WAYPOINTS = 32;
export const MAX_ROUTE_PROGRAM_POINTS = 128;
export const WAYPOINT_PASSAGE_FRACTION = .125;
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const subtract = (a,b) => a.map((v,i)=>v-b[i]);
const dot = (a,b) => a.reduce((sum,v,i)=>sum+v*b[i],0);

/** WASM accepts at most 128 samples per validation, with one shared seam sample. */
export function programIsClear(model, request, points, error = 0) {
  for (let first = 0; first + 1 < points.length; first += 127) {
    const chunk = points.slice(first, first + 128);
    if (!model.route_is_clear(request.frameBody, request.at * 1000, request.durationSeconds,
      Float64Array.from(chunk.flat()), request.capability[4] + request.capability[5] + error)) return false;
  }
  return points.length >= 2;
}
function leg(model, request, start, destination) {
  const data = model.plan_route(request.frameBody, request.at * 1000, request.durationSeconds,
    Float64Array.from(start), Float64Array.from(destination), Float64Array.from(request.capability));
  if (!data[1] || data[2] < 1) throw Error('No safe route to an authored waypoint');
  return Array.from({ length: data[2] }, (_, i) => Array.from(data.subarray(12 + 4 * i, 15 + 4 * i)));
}
function joinLegs(model, request, points) {
  const knots = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (distance(points[i - 1], points[i]) < 1e-8) continue;
    knots.push(...leg(model, request, points[i - 1], points[i]).slice(1));
  }
  return knots;
}
function smoothSamples(points) {
  for(let i=1;i+1<points.length;i++) {
    const a=subtract(points[i],points[i-1]),b=subtract(points[i+1],points[i]);
    const lengths=Math.hypot(...a)*Math.hypot(...b);
    if(lengths>1e-14&&dot(a,b)/lengths<Math.cos(Math.PI/8))return false;
  }
  return true;
}
function authoredPassage(request,point) {
  const program=request.program,waypoints=program.waypoints;
  const index=waypoints.findIndex(p=>distance(p,point)<1e-5);
  if(index<0)return Infinity;
  const origin=program.extension?.points[0]??request.start;
  const before=waypoints[index-1]??(program.closed?waypoints.at(-1):origin);
  const after=waypoints[index+1]??(program.closed?waypoints[0]:point);
  return Math.min(distance(before,point),distance(point,after))*WAYPOINT_PASSAGE_FRACTION;
}
function curve(model, request, knots, capacity = MAX_ROUTE_PROGRAM_POINTS) {
  if(knots.length<2)return {points:knots,spans:[]};
  const [speed, acceleration, , turn] = request.capability, cruise = speed * .65;
  const radius = Math.max(cruise / (turn * .65), cruise * cruise / (acceleration * .65));
  const passageLimits=knots.map(point=>authoredPassage(request,point));
  for (const factor of [1,.5,.25,.125]) for (const samples of [8,12,16,24,32]) {
    const value = flightCurvePoints(knots,radius,factor,samples,WAYPOINT_PASSAGE_FRACTION,passageLimits);
    if (value.points.length <= capacity && smoothSamples(value.points) && programIsClear(model,request,value.points,value.error)) return value;
  }
  throw Error('Path too complex for 128 safe GPU samples; use fewer waypoints or wider turns');
}
function arcAt(points,end) {
  let result=0;for(let i=1;i<=end;i++)result+=distance(points[i-1],points[i]);
  return result;
}
/** Only the old final straight segment is replaced. Its earlier prefix is exact. */
function appendCurve(model,request,prefix,knots,capacity) {
  const fixed=prefix.slice(0,-2),tail=curve(model,request,[prefix.at(-2),...knots],capacity-fixed.length);
  const points=[...fixed,...tail.points],seam=tail.spans.find(span=>span.knot===1);
  if(!seam)return {points,correspondence:null};
  const first=fixed.length+seam.first,middle=fixed.length+seam.middle;
  // Old incoming arc and new half-corner arc share the same semantic waypoint.
  // A one-time GPU map preserves each ship's ordered progress through this edit.
  return {points,correspondence:{start:arcAt(points,first),oldEnd:arcAt(prefix,prefix.length-1),newEnd:arcAt(points,middle)}};
}
function cycleJoinAt(knots,index) {
  if(!knots[index+1]||distance(knots[index],knots[index+1])<1e-8)throw Error('Patrol needs distinct waypoints and a nonzero closing leg');
  const point=knots[index].map((v,axis)=>(v+knots[index+1][axis])*.5);
  return [point,...knots.slice(index+1,-1),...knots.slice(0,index+1),point];
}
function patrol(model,request,prefix) {
  const waypoints=request.program.waypoints;
  const open=joinLegs(model,request,waypoints);
  const closing=leg(model,request,waypoints.at(-1),waypoints[0]);
  const knots=cycleJoinAt([...open,...closing.slice(1)],open.length-1);
  const cycle=curve(model,request,knots,MAX_ROUTE_PROGRAM_POINTS-prefix.length-8);
  const entry=prefix.length<2?curve(model,request,[prefix[0],knots[0]]):appendCurve(model,request,prefix,[prefix.at(-1),knots[0]],MAX_ROUTE_PROGRAM_POINTS-cycle.points.length+1);
  return {...entry,points:[...entry.points.slice(0,-1),...cycle.points],cycleStart:entry.points.length-1};
}
/** Generated loops have no authored first waypoint. Join their nearest edge
 * tangentially, keeping the approach and repeating cycle in the same cache. */
function generatedLoop(model,request){
  const points=request.program.waypoints;
  const closed=joinLegs(model,request,[...points,points[0]]);
  let best=0,nearest=Infinity;
  for(let i=0;i+1<closed.length;i++){
    const midpoint=closed[i].map((v,k)=>(v+closed[i+1][k])*.5),d=distance(midpoint,request.start);
    if(dot(subtract(midpoint,request.start),subtract(closed[i+1],closed[i]))<0)continue;
    if(d<nearest){nearest=d;best=i;}
  }
  const knots=cycleJoinAt(closed,best),cycle=curve(model,request,knots);
  const before=closed[best].map((v,k)=>(v+knots[0][k])*.5);
  const ingress=joinLegs(model,request,[request.start,before]);
  const entry=curve(model,request,[...ingress,knots[0]],MAX_ROUTE_PROGRAM_POINTS-cycle.points.length+1);
  return {points:[...entry.points.slice(0,-1),...cycle.points],cycleStart:entry.points.length-1,correspondence:null};
}
function newProgram(model,request) {
  if(request.program.closed&&request.program.replan)return generatedLoop(model,request);
  // A new patrol needs an ingress to its first waypoint, not an entire extra
  // lap copied into the prefix. Keep the shared cache for the repeating loop.
  const entry=request.program.closed?request.program.waypoints.slice(0,1):request.program.waypoints;
  const prefix=curve(model,request,joinLegs(model,request,[request.start,...entry])).points;
  if(request.program.closed)return {...patrol(model,request,prefix),correspondence:null};
  return {points:prefix,cycleStart:-1};
}
function extendProgram(model,request,extension) {
  const prefix=extension.points;
  if(!programIsClear(model,request,prefix))throw Error('Existing ordered path is blocked by a moving body; replace the route');
  if(request.program.closed)return patrol(model,request,prefix);
  const additions=request.program.waypoints.slice(extension.waypointCount);
  const knots=joinLegs(model,request,[prefix.at(-1),...additions]);
  return {...appendCurve(model,request,prefix,knots,MAX_ROUTE_PROGRAM_POINTS),cycleStart:-1};
}
function retainedProgram(model,request) {
  const old=request.program.retained;
  if(!old)return null;
  if(programIsClear(model,request,old.points))return {...old,retained:true};
  if(request.program.waypoints.length>1&&!request.program.replan)throw Error('Ordered path is blocked by a moving body; replace the route');
  return null;
}
export function solveRouteProgram(model,request) {
  const retained=retainedProgram(model,request);
  if(retained)return {...retained,points:retained.points.map(p=>p.map(v=>v/SCENE_LAB_SCALE))};
  const extension=request.program.extension;
  const result=extension?extendProgram(model,request,extension):newProgram(model,request);
  return {...result,points:result.points.map(p=>p.map(v=>v/SCENE_LAB_SCALE)),retained:false,extended:Boolean(extension)};
}
