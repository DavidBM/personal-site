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

// Hash collisions only add distance tests; they never discard a neighbor.
function cellKey(x, y, z, mask) {
  return (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
}

/**
 * Admission-only hard-sphere sampling. No grid positions or spiral phases reach
 * the renderer: the hash grid only accelerates rejection of random candidates.
 * advance() is bounded by the caller's existing join deadline. A dense sample
 * waits for another frame rather than weakening spacing or expanding its bubble.
 */
export class WarpLayout {
  constructor(fleet, tuning, reservations, contactPad = 0.01) {
    this.key = sceneFleetLifetimeKey(fleet);
    this.seedPlan = classSeedPlan(fleet, fleet.shipCount);
    this.baseCount = fleet.shipCount;
    this.extensions = [];
    this.reservationKeys = [this.key];
    this.runs = classRuns(fleet, tuning, contactPad);
    // Coordinate-frame ownership must not change the authored random layout.
    this.random = randomStream(`${fleet.id}:${fleet.generation ?? 0}`);
    this.maxRadius = Math.max(...this.runs.map(row => row.radius));
    this.cell = this.maxRadius * 2;
    const volume = this.runs.reduce((sum, row) => sum + row.count * row.radius ** 3, 0);
    this.radius = 3 * Math.cbrt(volume) + this.maxRadius;
    this.birthRadius = this.radius;
    this.center = reserveCloud(this.key, this.radius, reservations, this.random);
    this.offsets = new Float32Array(fleet.shipCount * 4);
    const bucketCount = 2 ** Math.ceil(Math.log2(Math.max(16, fleet.shipCount * 2)));
    this.bucketHeads = new Int32Array(bucketCount).fill(-1);
    this.bucketNext = new Int32Array(fleet.shipCount);
    this.bucketMask = bucketCount - 1;
    this.done = 0;
    this.run = 0;
    this.candidates = 0;
  }

  clearInBucket(key, point, radius) {
    for (let ship = this.bucketHeads[key]; ship !== -1; ship = this.bucketNext[ship]) {
      const offset = ship * 4;
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
          if (!this.clearInBucket(cellKey(c[0] + x, c[1] + y, c[2] + z, this.bucketMask), point, radius)) return false;
        }
      }
    }
    return true;
  }

  place(radius) {
    const local = randomBall(this.random, this.birthRadius - this.maxRadius);
    // Reject the actual float32 coordinates that will be uploaded to the GPU.
    const point = local.map((value, axis) => Math.fround(value + this.center[axis]));
    this.candidates++;
    if (!this.clear(point, radius)) return false;
    const offset = this.done * 4;
    this.offsets.set([...point, radius], offset);
    const key = cellKey(Math.floor(point[0] / this.cell), Math.floor(point[1] / this.cell),
      Math.floor(point[2] / this.cell), this.bucketMask);
    this.bucketNext[this.done] = this.bucketHeads[key];
    this.bucketHeads[key] = this.done;
    this.done++;
    return true;
  }

  /** Append a disjoint cloud and class runs; existing ordinals never change type. */
  grow(fleet, tuning, reservations, contactPad = 0.01) {
    const previous = this.offsets.length / 4;
    if (fleet.shipCount <= previous) return;
    const count = fleet.shipCount - previous;
    const plan = classSeedPlan(fleet, count);
    const extra = new WarpLayout({ ...fleet, id: `${fleet.id}:growth:${previous}`,
      shipCount: count, seedPlan: plan }, tuning, reservations, contactPad);
    const offsets = new Float32Array(fleet.shipCount * 4);
    offsets.set(this.offsets); this.offsets = offsets;
    this.seedPlan = { types: [...this.seedPlan.types, ...plan.types],
      parts: [...this.seedPlan.parts, ...plan.parts], groups: [...this.seedPlan.groups, ...plan.groups] };
    this.radius = Math.max(this.radius, Math.hypot(...extra.center.map((v,i) => v-this.center[i])) + extra.radius);
    this.orbitBirth = null; // Only future seed rows need a new, large-enough clearance reservation.
    this.reservationKeys.push(extra.key);
    this.extensions.push({ start: previous, layout: extra });
  }

  advanceOwn(end, deadline) {
    const limit = Math.min(end, this.baseCount);
    let attempts = 0;
    while (this.done < limit) {
      if ((attempts++ & 15) === 0 && performance.now() >= deadline) break;
      while (this.done >= this.runs[this.run].end) this.run++;
      this.place(this.runs[this.run].radius);
    }
    if (this.done === this.baseCount && this.bucketHeads.length) {
      this.bucketHeads = new Int32Array(0); this.bucketNext = new Int32Array(0);
    }
    return this.done;
  }

  advance(end, deadline = Infinity) {
    if (this.done < this.baseCount) this.advanceOwn(end, deadline);
    for (const chunk of this.extensions) {
      if (this.done >= end || this.done < chunk.start) break;
      if (!chunk.layout) continue;
      const before = chunk.layout.done;
      const ready = chunk.layout.advanceOwn(end-chunk.start, deadline);
      this.offsets.set(chunk.layout.offsets.subarray(before*4,ready*4), (chunk.start+before)*4);
      this.done = chunk.start + ready;
      if (ready === chunk.layout.baseCount) chunk.layout = null;
    }
    return this.done;
  }
}
