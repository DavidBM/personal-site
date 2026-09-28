import { CLASS_BY_TYPE } from '../../../lib/ship-runtime/classes.mjs';
import { mixHash } from '../../../lib/ship-runtime/fleet-mix.mjs';
import { classSeedPlan, sceneFleetLifetimeKey } from './directed-map.mjs';

/** Extra room above contact radii; quantization and the first local step have slack. */
export const WARP_CLEARANCE_MUL = 1.15;

function randomStream(key) {
  let value = mixHash(key) || 1;
  return () => {
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}

function randomBall(random, radius) {
  const y = random() * 2 - 1, angle = random() * Math.PI * 2;
  const r = Math.cbrt(random()) * radius, ring = Math.sqrt(1 - y * y);
  return [Math.cos(angle) * ring * r, y * r, Math.sin(angle) * ring * r];
}

function intersects(point, radius, reservations) {
  for (const row of reservations.values()) {
    if (Math.hypot(point[0] - row.center[0], point[1] - row.center[1], point[2] - row.center[2]) < radius + row.radius) return true;
  }
  return false;
}

/** Fleet bubbles are disjoint even when multiple fleets use the exact same chord. */
function reserveCloud(key, radius, reservations, random) {
  let volume = radius ** 3, reach = 0;
  for (const row of reservations.values()) {
    volume += row.radius ** 3;
    reach = Math.max(reach, Math.hypot(...row.center) + row.radius);
  }
  const envelope = 2 * Math.cbrt(volume);
  let center;
  for (let attempt = 0; attempt < 64; attempt++) {
    center = randomBall(random, envelope);
    if (!intersects(center, radius, reservations)) break;
    center = null;
  }
  // Bounded fallback outside every existing bubble, along a random bearing.
  if (!center) {
    center = randomBall(random, 1);
    const scale = (reach + radius * 1.01) / Math.max(Math.hypot(...center), 1e-9);
    center = center.map(value => value * scale);
  }
  reservations.set(key, { center, radius });
  return center;
}

function classRuns(fleet, tuning, contactPad) {
  const plan = classSeedPlan(fleet, fleet.shipCount);
  let end = 0;
  return plan.types.map((type, index) => {
    const count = plan.parts[index], kind = CLASS_BY_TYPE[type];
    end += count;
    const radius = Math.max(0.005, tuning[kind * 8 + 4]) * WARP_CLEARANCE_MUL + contactPad;
    return { count, end, radius };
  });
}

function cellKey(x, y, z) { return `${x},${y},${z}`; }

/**
 * Admission-only hard-sphere sampling. No grid positions or spiral phases reach
 * the renderer: the hash grid only accelerates rejection of random candidates.
 * advance() is bounded by the caller's existing join deadline. A dense sample
 * waits for another frame rather than weakening spacing or expanding its bubble.
 */
export class WarpLayout {
  constructor(fleet, tuning, reservations, contactPad = 0.01) {
    this.key = sceneFleetLifetimeKey(fleet);
    this.runs = classRuns(fleet, tuning, contactPad);
    // Coordinate-frame ownership must not change the authored random layout.
    this.random = randomStream(`${fleet.id}:${fleet.generation ?? 0}`);
    this.maxRadius = Math.max(...this.runs.map(row => row.radius));
    this.cell = this.maxRadius * 2;
    const volume = this.runs.reduce((sum, row) => sum + row.count * row.radius ** 3, 0);
    this.radius = 3 * Math.cbrt(volume) + this.maxRadius;
    this.center = reserveCloud(this.key, this.radius, reservations, this.random);
    this.offsets = new Float32Array(fleet.shipCount * 4);
    this.buckets = new Map();
    this.done = 0;
    this.run = 0;
    this.candidates = 0;
  }

  clearInBucket(key, point, radius) {
    const entries = this.buckets.get(key);
    if (!entries) return true;
    for (const offset of entries) {
      const gap = radius + this.offsets[offset + 3];
      const dx = point[0] - this.offsets[offset], dy = point[1] - this.offsets[offset + 1], dz = point[2] - this.offsets[offset + 2];
      if (dx * dx + dy * dy + dz * dz < gap * gap) return false;
    }
    return true;
  }

  clear(point, radius) {
    const c = point.map(value => Math.floor(value / this.cell));
    for (let z = -1; z <= 1; z++) {
      for (let y = -1; y <= 1; y++) {
        for (let x = -1; x <= 1; x++) {
          if (!this.clearInBucket(cellKey(c[0] + x, c[1] + y, c[2] + z), point, radius)) return false;
        }
      }
    }
    return true;
  }

  place(radius) {
    const local = randomBall(this.random, this.radius - this.maxRadius);
    // Reject the actual float32 coordinates that will be uploaded to the GPU.
    const point = local.map((value, axis) => Math.fround(value + this.center[axis]));
    this.candidates++;
    if (!this.clear(point, radius)) return false;
    const offset = this.done * 4;
    this.offsets.set([...point, radius], offset);
    const key = cellKey(...point.map(value => Math.floor(value / this.cell)));
    let entries = this.buckets.get(key);
    if (!entries) this.buckets.set(key, entries = []);
    entries.push(offset);
    this.done++;
    return true;
  }

  advance(end, deadline = Infinity) {
    const limit = Math.min(end, this.offsets.length / 4);
    let attempts = 0;
    while (this.done < limit) {
      if ((attempts++ & 15) === 0 && performance.now() >= deadline) break;
      while (this.done >= this.runs[this.run].end) this.run++;
      this.place(this.runs[this.run].radius);
    }
    if (this.done === this.offsets.length / 4) this.buckets.clear();
    return this.done;
  }
}
