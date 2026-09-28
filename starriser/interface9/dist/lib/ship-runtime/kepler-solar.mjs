import { SYSTEM_SPAN, BODY_UNIT_SCALE, SUN_RADIUS } from './scene-scale.mjs';
/** Upload Kepler bodies into the owning SolarControl storage capacity. */
import { PLANET_SCALE } from "./solar-layout.mjs";
import { SOLAR_BODY_CAPACITY, SOLAR_ORBIT_WORDS, solarWords } from "./solar-capacity.mjs";
import { orbitRadius, SCENE_CLASS_TYPES } from "./flight-layout.mjs";
import { radiusOf } from "./classes.mjs";

/** Legacy default, not a catalog limit; the destination buffer owns capacity. */
export const KEPLER_SOLAR_SLOTS = SOLAR_BODY_CAPACITY;
/** Compact Kepler sun radius (world). PoC sun is 1.7 × PLANET_SCALE. */
export const COMPACT_SUN_RADIUS = SUN_RADIUS;
/** System field extent; independent of the fixed compact-to-lab conversion. */
export const COMPACT_SYSTEM_SPAN = SYSTEM_SPAN;
/**
 * Compact → PoC lab. Do not retune PoC accel/orbit multipliers; adapt Kepler
 * body radii into this space and shrink the orbit pad when the body is small.
 */
export const SCENE_LAB_SCALE = 1 / BODY_UNIT_SCALE;
export const POC_PLANET_RADIUS = 0.9 * PLANET_SCALE;
/** Must match `SOLAR_ORBIT_SPEED_SCALE` in `js/gpu/planet-lib/solar-bodies.ts`. */
export const KEPLER_PHASE_SPEED = 0.01;

/** Reuse owned snapshot storage; callers may mutate their catalog after copying. */
export function copyKeplerCatalog(bodies, previous = null) {
  const snapshot = previous && previous !== bodies ? previous : [];
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const row = snapshot[i] === body ? {} : snapshot[i] ?? {};
    row.x = body.x; row.y = body.y; row.z = body.z; row.radius = body.radius;
    row.orbitRadius = body.orbitRadius; row.rate = body.rate; row.phase = body.phase; row.isSun = body.isSun;
    row.uAxis = copyAxis(body.uAxis, row.uAxis);
    row.vAxis = copyAxis(body.vAxis, row.vAxis);
    snapshot[i] = row;
  }
  snapshot.length = bodies.length;
  return snapshot;
}

function copyAxis(source, previous) {
  if (!Array.isArray(source)) return undefined;
  const result = previous === source ? [] : previous ?? [];
  result.length = source.length;
  for (let i = 0; i < source.length; i++) result[i] = source[i];
  return result;
}

export function compactToLab(value) {
  return value * SCENE_LAB_SCALE;
}

export function labToCompact(value) {
  return value / SCENE_LAB_SCALE;
}

/** Shrink PoC `2.4 * multiplier` when the compact body is much smaller than a PoC planet. */
export function planetOrbitAdapt(labRadius) {
  const r = Math.max(0, labRadius);
  if (!(r > 0)) return 0.02;
  return Math.min(1, Math.max(0.02, r / POC_PLANET_RADIUS));
}

export function compactOrbitPad(multiplier = 4, bodyRadius = COMPACT_SUN_RADIUS) {
  return (2.4 * multiplier * planetOrbitAdapt(compactToLab(bodyRadius))) / SCENE_LAB_SCALE;
}

export function keplerOrbitRate(periodSec) {
  return (KEPLER_PHASE_SPEED / Math.max(1e-6, periodSec)) * Math.PI * 2;
}

/**
 * Cells of dead pressure at the cube face. The gradient is zero for edge≤2
 * and fades until 4; class rings must sit past that or a sector of the orbit
 * never repels.
 */
export const PRESSURE_CLEAR_CELLS = 5;
/** Shader orbit adds 2× hull on top of the CPU ring. Envelope must match. */
function shaderOrbitRadius(type, labRadius) {
  const ring = orbitRadius(type, labRadius);
  const adapt = Math.min(1, Math.max(0.02, labRadius / 45));
  return ring + radiusOf(type) * adapt * 2;
}
/** 64³ brick half-extent so every class ring is inside the live pressure core. */
export function labPressureHalfExtent(labRadius) {
  const r = Number.isFinite(labRadius) ? Math.max(0, labRadius) : 0;
  let outer = r;
  for (const type of SCENE_CLASS_TYPES) outer = Math.max(outer, shaderOrbitRadius(type, r));
  const extent = Math.max(outer / (1 - PRESSURE_CLEAR_CELLS / 32), r / 0.35, 0.25);
  return Number.isFinite(extent) ? extent : 0.25;
}

function writeStaticOrbit(f, at, b) {
  const x = compactToLab(b.x || 0), y = compactToLab(b.y || 0), z = compactToLab(b.z || 0);
  const len = Math.hypot(x, y, z);
  f[at] = len;
  f[at + 1] = compactToLab(b.radius || 0);
  f[at + 2] = 0;
  f[at + 3] = 0;
  if (len > 1e-8) {
    f[at + 4] = x / len; f[at + 5] = y / len; f[at + 6] = z / len; f[at + 7] = 0;
  } else {
    f[at + 4] = 1; f[at + 5] = 0; f[at + 6] = 0; f[at + 7] = 0;
  }
  f[at + 8] = 0; f[at + 9] = 0; f[at + 10] = 1; f[at + 11] = 0;
}

function writeMovingOrbit(f, at, b) {
  const u = b.uAxis || [1, 0, 0];
  const v = b.vAxis || [0, 0, 1];
  f[at] = compactToLab(b.orbitRadius);
  f[at + 1] = compactToLab(b.radius || 0);
  f[at + 2] = b.rate;
  f[at + 3] = b.phase || 0;
  f[at + 4] = u[0] || 0; f[at + 5] = u[1] || 0; f[at + 6] = u[2] || 0; f[at + 7] = 0;
  f[at + 8] = v[0] || 0; f[at + 9] = v[1] || 0; f[at + 10] = v[2] || 0; f[at + 11] = 0;
}

function hasKeplerElements(b) {
  return !b.isSun && b.orbitRadius > 0 && b.rate > 0 && Array.isArray(b.uAxis) && Array.isArray(b.vAxis);
}

export function writeKeplerSolar(data, bodies, time) {
  const f = solarFloatView(data);
  const capacity = (f.length - 8) / SOLAR_ORBIT_WORDS;
  solarWords(capacity);
  if (bodies.length > capacity) throw new RangeError(`Kepler catalog has ${bodies.length} bodies; SolarControl capacity is ${capacity}`);
  f[0] = time;
  f[1] = bodies.length;
  f[4] = 0; f[5] = 0; f[6] = 0; f[7] = 1;
  for (let i = 0; i < capacity; i++) {
    const at = 8 + i * SOLAR_ORBIT_WORDS;
    const b = bodies[i];
    if (!b || !(b.radius > 0 || b.x || b.y || b.z || b.orbitRadius > 0)) {
      f.fill(0, at, at + 12);
      continue;
    }
    if (hasKeplerElements(b)) writeMovingOrbit(f, at, b);
    else writeStaticOrbit(f, at, b);
  }
  return f;
}

function solarFloatView(data) {
  if (data instanceof Float32Array) return data;
  if (ArrayBuffer.isView(data)) {
    if (data.byteLength % 4 !== 0) throw new RangeError('SolarControl view must contain complete float words');
    return new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
  }
  return new Float32Array(data);
}
