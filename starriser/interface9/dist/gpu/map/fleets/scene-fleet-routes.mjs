import {automaticRouteKey, automaticRouteIntent, automaticRouteDeadline, arrivalPorts} from './automatic-route.mjs';
import { createSceneRoutePlanner } from '../../../lib/ship-runtime/scene-route-planner.mjs';
import { packSceneRoute } from '../../../lib/ship-runtime/scene-route.mjs';
import { packSceneRouteSamples, unpackRoutePoints, writeRouteCorrespondences } from '../../../lib/ship-runtime/route-cache.mjs';
import { routeCornerDeviation } from '../../../lib/ship-runtime/route-curve.mjs';
import { packClassTuning } from '../../../lib/ship-runtime/class-tuning.mjs';
import { SCENE_LAB, SCENE_TRAVEL_ADAPT } from '../../../lib/ship-runtime/flight-layout.mjs';
import { fleetComposition } from '../../../lib/ship-runtime/fleet-mix.mjs';
import { CLASSES, CLASS_BY_TYPE } from '../../../lib/ship-runtime/classes.mjs';
import { sceneRouteIngress, sceneRouteStart } from '../../../lib/ship-runtime/scene-route-start.mjs';

const WINDOW_SECONDS = 30;
const REFRESH_MARGIN = 8;
const EMPTY = packSceneRoute([]);
const PENDING_AUTO=packSceneRoute([]);PENDING_AUTO[3]=-1;

/** Fleet-bounded planning. GPU poses stay authoritative; no ship enumeration/readback. */
export function routeCapability(fleet, frame = null) {
  const tuning = packClassTuning();
  const kinds = fleet.type == null ? fleetComposition(fleet.id).classes.map(row => row.kind)
    : [CLASS_BY_TYPE[fleet.type & 31] ?? 0];
  const minimum = column => Math.min(...kinds.map(kind => tuning[kind * 8 + column]));
  const maximum = column => Math.max(...kinds.map(kind => tuning[kind * 8 + column]));
  const width = Math.max(.12, maximum(4) * 2, (frame?.radius ?? 0) * 2);
  // The visual formation reserves its lateral envelope once in the planner.
  // Legacy pilots retain their narrower corridor and independent body avoidance.
  // Orbit capture uses a separate radial transition outside this corridor.
  const margin = Math.max(.12, frame?.visualFormation ? width * .5 : Math.min(width, 1.5)) + .08;
  // The normalized mesh bounding radius is 0.004 lab per visual size unit.
  const hull = Math.max(.004, maximum(5) * .004);
  return { type: [0,12,22,27,30,31][Math.max(...kinds)], width, speed: minimum(0) * SCENE_TRAVEL_ADAPT,
    bodyHull: Math.max(...kinds.map(kind => Math.hypot(...CLASSES[kind].extent))),
    values: [minimum(0) * SCENE_TRAVEL_ADAPT, minimum(1) * SCENE_TRAVEL_ADAPT,
      minimum(2) * SCENE_TRAVEL_ADAPT, Math.max(.001, minimum(3)), hull, margin]
      .map((value, i) => i === 3 ? value : value / SCENE_LAB) };
}

/** Match the existing GPU body exclusion shell, not just the visible surface. */
export function routeObstacles(bodies, bodyHull) {
  return bodies.map(body => {
    const radius = body.radius * SCENE_LAB, adapt = Math.min(1, Math.max(.02, radius / 45));
    const shell = radius + (bodyHull + .3) * adapt;
    return { ...body, radius: (adapt < .99 ? Math.max(radius * 3, shell) : shell) / SCENE_LAB };
  });
}
function entryObstacles(bodies) {
  return bodies.map(body => ({ ...body, radius: body.radius + .003 / SCENE_LAB
    + Math.min(2, Math.abs(body.rate ?? 0) * WINDOW_SECONDS) * (body.orbitRadius ?? 0) }));
}
/** Shared interception envelope: planning and capture must agree on how close
 * a complete formation can approach a centroid inside a protected body. */
export function routeInterception(position,target,obstacles,capability) {
  const padding=capability.values[4]+capability.values[5];
  const destination=sceneRouteStart(target,position,entryObstacles(obstacles),padding);
  if(!destination)return null;
  const standoff=Math.hypot(...destination.map((v,i)=>v-target[i]));
  return {destination,reach:standoff+capability.width/SCENE_LAB+.003};
}
function sameOwner(previous, fleet, move) {
  return previous?.orderId === (move.orderId ?? move.revision) && previous.slot === fleet.slot && (move.automatic || previous.memberCount === fleet.shipCount) && previous.generation === (fleet.generation ?? 0);
}

function applyIntent(row, move) {
  row.revision = move.revision; row.orderId = move.orderId ?? move.revision;
  row.destination = [move.destination.x, move.destination.y, move.destination.z];
  row.waypoints = move.waypoints?.map(p => [p.x, p.y, p.z]) ?? null;
  row.closed = Boolean(move.closed); row.pending = false; row.retryAt = 0; row.status = 'pending';
}

function routeRow(fleet, move, frame, token) {
  return { fleet, memberCount: fleet.shipCount, id: fleet.id, slot: fleet.slot,
    generation: fleet.generation ?? 0, revision: move.revision, orderId: move.orderId ?? move.revision,
    waypoints: move.waypoints?.map(p => [p.x, p.y, p.z]) ?? null, closed: Boolean(move.closed),
    destination: [move.destination.x, move.destination.y, move.destination.z],
    automatic: move.automatic ?? null, deadline: null,
    color: fleet.marker ?? [.45, .78, 1], capability: routeCapability(fleet, frame), bias: null, token,
    firstDue:null,points: [], status: 'pending', validUntil: 0, retryAt: 0, pending: false };
}

function routeIntent(row) {
  return row.rejectedRevision===row.revision&&row.acceptedIntent ? row.acceptedIntent
    : {revision:row.revision,destination:row.destination,waypoints:row.waypoints,closed:row.closed};
}
function planningProgram(row,intent) {
  if(!intent.waypoints)return null;
  const toPlanner=p=>p.map((v,i)=>v+row.bias[i]);
  const retained=row.acceptedIntent?.revision===intent.revision&&row.program
    ? {points:row.program.points.map(toPlanner),cycleStart:row.program.cycleStart} : null;
  const extension=!retained&&row.program&&row.acceptedIntent&&!row.activeClosed
    ? {points:row.program.points.map(toPlanner),waypointCount:row.acceptedIntent.waypoints.length} : null;
  return {waypoints:intent.waypoints.map(toPlanner),closed:intent.closed,retained,extension};
}

function preservesProgress(result) {
  return result.curve==='retained'||result.program?.retained||(result.program?.extended&&!result.program?.correspondence);
}
function installCorrespondences(row,result,cache) {
  if(result.program?.correspondence&&row.cacheRevision){
    row.correspondences??=[];
    row.correspondences.push({revision:row.cacheRevision,...result.program.correspondence});
  }
  writeRouteCorrespondences(cache,row.correspondences??[]);
}
function acceptedCache(row,result,revision) {
  if(result.cache)return result.cache;
  const points=result.points.map(point=>point.map((value,axis)=>(value-row.bias[axis])*SCENE_LAB));
  const pack=result.program?packSceneRouteSamples:packSceneRoute;
  return pack(points,row.capability.width,row.capability.speed,row.token,{
    cycleStart:result.program?.cycleStart??-1,ordered:(row.waypoints?.length??0)>1,deviation:routeCornerDeviation(row.capability.values[5])*SCENE_LAB,
    acceleration:row.capability.values[1]*SCENE_LAB,turnRate:row.capability.values[3],revision});
}
function acceptProgramMetadata(row,program,intent) {
  if(!program)return;
  row.program={points:row.points,cycleStart:program.cycleStart};
  row.acceptedIntent=intent;
  row.activeClosed=program.cycleStart>=0;
  if(row.rejectedRevision===row.revision)row.status=`Following previous path: ${row.error}`;
}

function routeDestination(row,intent,bodies,obstacles,position,now){
  if(row.automatic&&row.deadline==null)row.deadline=automaticRouteDeadline(row.fleet,now);
  const ports=row.automatic==='arrival'?arrivalPorts(row.fleet,bodies,obstacles,row.capability,position,row.deadline-now):null;
  const destination=ports?.[0]??intent.destination.map((v,i)=>v+row.bias[i]);
  if(ports?.length)row.destination=destination;
  return {destination,alternatives:ports?.slice(1)};
}
function routeEndpoints(row,intent,bodies,pose,now){
  const obstacles=routeObstacles(bodies,row.capability.bodyHull),position=[pose.x,pose.y,pose.z];
  const target=routeDestination(row,intent,bodies,obstacles,position,now);
  let destination=target.destination;
  const shells=entryObstacles(obstacles),padding=row.capability.values[4]+row.capability.values[5];
  // A fleet's centroid can be inside its planet. Approach the near edge of
  // that shell; battle capture still tests the actual observed centers.
  if(row.fleet.state?.battle?.stage==='pursuit')destination=routeInterception(position,destination,obstacles,row.capability)?.destination;
  if(!destination)throw Error('no-interception-entry');
  const start=sceneRouteIngress(position,destination,shells,padding);
  if(!start)throw Error('no-entry');
  return {bodies:obstacles,start,destination,alternatives:target.alternatives};
}
function plannedWarpExit(row){
  const plan=row.fleet.plan;
  return row.automatic&&(plan?.phase==='inbound'||plan?.phase==='retained-warp')?{...plan.exit,n:1}:null;
}
function retainedCache(row,intent,revision){
  return {width:row.capability.width,token:row.token,revision,bias:row.bias,
    retained:row.cacheIntentRevision===intent.revision?row.points.map(p=>p.map((v,i)=>v+row.bias[i])):[]};
}

export function createSceneFleetRoutes({ center, install, changed = () => {}, createPlanner = createSceneRoutePlanner, formationFrame = null, requireFormationFrame = false, priority = () => false }) {
  const rows = new Map();
  let planner = null, closed = false, currentSystem = null, latestTime = 0, nextToken = 1, nextRevision = 1;
  function remove(id, row) {
    rows.delete(id); install(row.slot, EMPTY); changed();
  }
  function sync(fleets, system) {
    if (closed) return;
    if (system !== currentSystem) {
      for (const [id, row] of rows) remove(id, row);
      planner?.destroy(); planner = null; currentSystem = system;
    }
    const live = new Set();
    for (const fleet of fleets) {
      const id = syncFleet(fleet);
      if (id) live.add(id);
    }
    for (const [id, row] of rows) if (!live.has(id)) remove(id, row);
  }
  function syncFleet(fleet) {
      const key=automaticRouteKey(fleet);
      const previousRow=rows.get(fleet.id);
      const move = fleet.state?.state === 'awaiting' && fleet.state.localMove
        || (key && (previousRow?.orderId===key ? previousRow.intent : automaticRouteIntent(fleet,key)));
      if (!move || fleet.shipCount <= 0) return null;
      const previous = rows.get(fleet.id);
      if (sameOwner(previous, fleet, move)) {
        previous.fleet = fleet;
        if (previous.revision !== move.revision) { applyIntent(previous, move); changed(); }
        return fleet.id;
      }
      if (previous) remove(fleet.id, previous);
      const frame = formationFrame?.(fleet);
      const row=routeRow(fleet, move, frame, move.automatic?0:formationFrame ? nextToken++ : 0);
      row.intent=move;
      rows.set(fleet.id, row);
      install(fleet.slot, row.automatic?PENDING_AUTO:EMPTY); changed();
      return fleet.id;
  }
  function accept(row, result, intent) {
    if (closed || rows.get(row.id) !== row) return;
    row.pending = false;
    if ((result.cache?.[0] ?? result.points?.length ?? 0) < 1 || result.validUntil <= latestTime) { fail(row, result.status); return; }
    // Infeasible means the conservative timetable does not fit. Spatial safety
    // still covers the validity window; automatic deadlines are separate.
    row.validUntil = result.validUntil;
    row.retryAt = result.validUntil - REFRESH_MARGIN - (row.slot % 8) * .35; row.status = 'ready';
    const cache = acceptedCache(row,result,nextRevision++);
    row.points = unpackRoutePoints(cache, SCENE_LAB);
    row.corridorRadius = cache[1] / (2 * SCENE_LAB);
    // An unchanged, revalidated curve keeps its progress coordinate. The pose,
    // captured formation frame and departure history already persist on GPU.
    if(preservesProgress(result)&&row.cacheRevision)cache[7]=row.cacheRevision;
    installCorrespondences(row,result,cache);
    row.cacheRevision=cache[7];
    row.cacheIntentRevision=intent.revision;
    acceptProgramMetadata(row,result.program,intent);
    install(row.slot, cache);
    changed();
  }
  function fail(row, reason) {
    if (closed || rows.get(row.id) !== row) return;
    row.pending = false; row.retryAt = latestTime + 5; row.status = String(reason);
    if(row.acceptedIntent&&row.acceptedIntent.revision!==row.revision){
      row.rejectedRevision=row.revision;row.error=String(reason);
      row.status=`Edit rejected; previous path retained: ${reason}`;
    }
    if (row.validUntil <= latestTime) { row.points = []; install(row.slot, row.automatic?PENDING_AUTO:EMPTY); }
    changed();
  }
  function captureFrame(row) {
    const frame = formationFrame?.(row.fleet);
    if (formationFrame && !frame && (requireFormationFrame || !row.automatic)) return false;
    if (!row.bias) {
      row.bias = row.automatic ? [0, 0, 0] : frame?.bias ?? [0, 0, 0];
      row.capability = routeCapability(row.fleet, frame);
    }
    return true;
  }
  function request(row, bodies, now) {
    const pose=plannedWarpExit(row)??center(row.id);
    if (!pose || pose.n <= 0) return;
    if (!captureFrame(row)) return;
    row.pending = true;
    try {
      const intent = routeIntent(row);
      const endpoints=routeEndpoints(row,intent,bodies,pose,now);
      if (planner?.status?.closed) { planner.destroy(); planner = null; }
      planner ??= createPlanner();
      const revision = row.revision;
      const current = () => rows.get(row.id) === row && row.revision === revision;
      const program = planningProgram(row,intent);
      void planner.plan({key:row.id,...endpoints,at:now,capability:row.capability.values,durationSeconds:WINDOW_SECONDS,
        program,cache:retainedCache(row,intent,nextRevision++)})
        .then(result => { if (current()) accept(row, result, intent); }, error => { if (current()) fail(row, error.message); });
    } catch (error) { fail(row, error.message); }
  }
  function requestDue(row,bodies,now) {
    if(row.pending||now<row.retryAt)return false;
    const status=planner?.status;
    if(status && status.queued>=status.maxQueued)return false;
    request(row,bodies,now);
    return row.pending;
  }
  const skipped=[null,null];
  function advance(bodies, now) {
    if (closed || rows.size === 0) return;
    latestTime = now;
    for (const row of rows.values()) {
      if (row.points.length && now >= row.validUntil) {
        row.points = [];
        row.status = row.status==='ready' ? 'Route expired · awaiting safe refresh' : `${row.status} · safe route expired`;
        install(row.slot, row.automatic?PENDING_AUTO:EMPTY); changed();
      }
    }
    skipped.fill(null);
    for(let submitted=0;submitted<2;submitted++){
      const row=nextDue(now,skipped);if(!row)break;skipped[submitted]=row;
      if(requestDue(row,bodies,now))row.firstDue=null;
    }
  }
    // Choose at most two fleet jobs. Deadline urgency plus age keeps renewal
    // bursts from starving an older job; this scan is bounded by scene fleets.
  function nextDue(now, skipped) {
    let chosen=null,best=Infinity;
    for(const row of rows.values()){
      if(row.pending||now<row.retryAt||skipped.includes(row))continue;
      // Establish the original deadline before admission: a new burst must be
      // ordered by urgency too, not just renewals that already had a solve.
      if(row.automatic && row.deadline==null)row.deadline=automaticRouteDeadline(row.fleet,now);
      row.firstDue??=now;
      const score=(row.deadline??now+60)-Math.min(120,now-row.firstDue)*2-(priority(row.id)?30:0);
      if(score<best){best=score;chosen=row;}
    }
    return chosen;
  }
  function invalidate() {
    for (const [id, row] of rows) remove(id, row);
    planner?.destroy(); planner = null;
  }
  return { sync, advance, rows, invalidate,
    destroy() { closed = true; rows.clear(); planner?.destroy(); planner = null; } };
}
