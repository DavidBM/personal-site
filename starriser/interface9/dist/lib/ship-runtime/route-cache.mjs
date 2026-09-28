import { brakingSpeed } from './braking.mjs';
import { roundedRoutePoints } from './route-curve.mjs';
import { TURN_ACCEL_SHARE } from './forward-motion.mjs';

export const SCENE_ROUTE_KNOTS = 16;
export const SCENE_ROUTE_POINTS = 128;
export const ROUTE_BLOCK_SIZE = 8;
export const ROUTE_BLOCKS = 16;
// Header, metadata, position/arc samples, packed speed limits, block bounds.
export const SCENE_ROUTE_EDITS = 32;
export const SCENE_ROUTE_EDIT_OFFSET = 8 + SCENE_ROUTE_POINTS * 6 + ROUTE_BLOCKS * 8;
export const SCENE_ROUTE_WORDS = SCENE_ROUTE_EDIT_OFFSET + 4 + SCENE_ROUTE_EDITS * 4;
const SPEEDS = 8 + SCENE_ROUTE_POINTS * 4;
const BOUNDS = SPEEDS + SCENE_ROUTE_POINTS * 2;
const delta = (a, b) => b.map((v, i) => v - a[i]);
const length = v => Math.hypot(...v);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);

function speedProfile(points, arcs, speed, acceleration, turnRate, cycleStart) {
  const caps = points.map(() => speed), bends = points.map(() => arcs.at(-1));
  for (let i = 1; i + 1 < points.length; i++) {
    const previous = i === cycleStart ? points.at(-2) : points[i - 1];
    const a = delta(previous, points[i]), b = delta(points[i], points[i + 1]);
    const before = length(a), after = length(b);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot(a, b) / Math.max(1e-12, before * after))));
    const curvature = angle / Math.max(.00001, Math.min(before, after));
    if (angle > .001) bends[i] = arcs[i];
    if (curvature > .000001) caps[i] = Math.min(speed,
      turnRate * TURN_ACCEL_SHARE / curvature, Math.sqrt(acceleration * TURN_ACCEL_SHARE / curvature));
  }
  // Evaluate each future restriction over its whole distance. Repeatedly charging
  // a thrust ramp per sample would make the result depend on curve tessellation.
  const raw = caps.slice();
  for (let i = 0; i < caps.length; i++) {
    for (let j = i + 1; j < caps.length; j++) {
      if (raw[j] < caps[i]) caps[i] = Math.min(caps[i], brakingSpeed(arcs[j] - arcs[i], raw[j], acceleration, acceleration / .35));
    }
    if (cycleStart >= 0) for (let j = cycleStart; j <= i; j++) {
      const distance = arcs.at(-1) - arcs[i] + arcs[j] - arcs[cycleStart];
      if (raw[j] < caps[i]) caps[i] = Math.min(caps[i], brakingSpeed(distance, raw[j], acceleration, acceleration / .35));
    }
  }
  if (cycleStart >= 0) caps[caps.length - 1] = caps[cycleStart];
  for (let i = bends.length - 2; i >= 0; i--) bends[i] = Math.min(bends[i], bends[i + 1]);
  return { caps, bends };
}

function packBounds(data, points) {
  for (let block = 0; block * ROUTE_BLOCK_SIZE + 1 < points.length; block++) {
    const start = block * ROUTE_BLOCK_SIZE, end = Math.min(start + ROUTE_BLOCK_SIZE, points.length - 1);
    for (let axis = 0; axis < 3; axis++) {
      const values = points.slice(start, end + 1).map(p => p[axis]);
      data[BOUNDS + block * 8 + axis] = Math.min(...values);
      data[BOUNDS + block * 8 + 4 + axis] = Math.max(...values);
    }
  }
}

function validateRoute(knots, width, speed) {
  if (knots.length > SCENE_ROUTE_KNOTS || knots.some(p => p.length !== 3 || !p.every(Number.isFinite))) throw new Error('Invalid scene corridor');
  if (!(width > 0) || !(speed > 0) || !Number.isFinite(width + speed)) throw new Error('Invalid scene corridor limits');
}

function routeOptions(options, token) {
  const { deviation = 0, acceleration = 1, turnRate = 1, revision = 1 } = options;
  if (![token, revision].every(n => Number.isInteger(n) && n >= 0 && n <= 0xffffff)) throw new Error('Invalid scene order capture token or revision');
  if (!(acceleration > 0 && turnRate > 0) || !Number.isFinite(acceleration + turnRate)) throw new Error('Invalid scene route dynamics');
  return { deviation, acceleration, turnRate, revision };
}

/** Built once per changed fleet route, in lab units. No per-ship CPU work. */
export function packSceneRoute(knots, width = 1, speed = 1, token = 0, options = {}) {
  validateRoute(knots, width, speed);
  return packSceneRouteSamples(roundedRoutePoints(knots, options.deviation??0),width,speed,token,options);
}
function validateSamples(samples,width,speed) {
  if(samples.length>SCENE_ROUTE_POINTS)throw new Error('Scene curve exceeds shared cache capacity');
  if(samples.some(p=>p.length!==3||!p.every(Number.isFinite)))throw new Error('Invalid scene curve samples');
  if(!(width>0&&speed>0)||!Number.isFinite(width+speed))throw new Error('Invalid scene curve limits');
}

function patrolMetadata(cycleStart, points, arcs, turnRate, ordered) {
  if (!Number.isInteger(cycleStart) || cycleStart < -1 || (cycleStart >= 0 && cycleStart >= points.length - 1)) throw new Error('Invalid scene patrol seam');
  if (cycleStart >= 0 && (!(arcs.at(-1) - arcs[cycleStart] > 1e-6) || length(delta(points[cycleStart], points.at(-1))) > 1e-6)) throw new Error('Scene patrol must close at its seam');
  return {cycleStart, metadata:cycleStart >= 0 ? -(arcs[cycleStart] + 1) : ordered ? 0 : turnRate};
}

/** Prepared worker samples are already smoothed and validated. */
export function packSceneRouteSamples(samples,width=1,speed=1,token=0,options={}) {
  validateSamples(samples,width,speed);
  const { acceleration, turnRate, revision } = routeOptions(options, token);
  // Derive arc lengths and speed limits from the positions the GPU receives.
  // Otherwise the first retained refresh remeasures rounded positions and
  // changes the progress metric despite keeping identical geometry.
  const points=samples.map(p=>p.map(Math.fround));
  if (points.length === 1) points.push([...points[0]]);
  const arcs = points.map(() => 0);
  for (let i = 1; i < points.length; i++) arcs[i] = arcs[i - 1] + length(delta(points[i - 1], points[i]));
  const {cycleStart, metadata} = patrolMetadata(options.cycleStart ?? -1, points, arcs, turnRate, options.ordered);
  const { caps, bends } = speedProfile(points, arcs, speed, acceleration, turnRate, cycleStart);
  const data = new Float32Array(SCENE_ROUTE_WORDS);
  // info.y was unused turn-rate metadata. A negative value encodes the periodic
  // seam arc plus one, preserving the buffer layout and open-route encoding.
  data.set([points.length, width, speed, token, arcs.at(-1) ?? 0, metadata, acceleration, revision]);
  for (let i = 0; i < points.length; i++) { data.set([...points[i], arcs[i]], 8 + i * 4); data.set([caps[i], bends[i]], SPEEDS + i * 2); }
  packBounds(data, points);
  writeRouteCorrespondences(data,options.correspondences);
  return data;
}

/** Exactly the uploaded samples, converted for the sun-local overlay. */
export function unpackRoutePoints(data, scale = 1) {
  return Array.from({ length: data[0] }, (_, i) => Array.from(data.subarray(8 + i * 4, 11 + i * 4), v => v / scale));
}

/** Revision lineage is fleet-bounded and consumed only when a ship adopts an edit. */
export function writeRouteCorrespondences(data,entries=[]) {
  if(entries.length>SCENE_ROUTE_EDITS)throw Error('Route edit history exceeds authored waypoint capacity');
  data.fill(0,SCENE_ROUTE_EDIT_OFFSET);data[SCENE_ROUTE_EDIT_OFFSET]=entries.length;
  entries.forEach((entry,index)=>{
    const {revision,start,oldEnd,newEnd}=entry;
    if(!Number.isInteger(revision)||revision<1||revision>0xffffff)throw Error('Invalid route edit revision');
    if(![start,oldEnd,newEnd].every(Number.isFinite)||start<0||oldEnd<=start||newEnd<start)throw Error('Invalid route edit correspondence');
    data.set([revision,start,oldEnd,newEnd],SCENE_ROUTE_EDIT_OFFSET+4+index*4);
  });
}
