import {
  SCENE_LAB_SCALE,
  COMPACT_SYSTEM_SPAN,
  compactToLab,
  labToCompact,
  compactOrbitPad,
} from "../../../lib/ship-runtime/kepler-solar.mjs";
import { SCENE_CLASS_TYPES, distributeFlightTypes, orbitRadius, orbitTilt } from "../../../lib/ship-runtime/flight-layout.mjs";
import { classOf } from "../../../lib/ship-runtime/classes.mjs";
export { SCENE_LAB_SCALE, compactToLab, labToCompact, compactOrbitPad, COMPACT_SYSTEM_SPAN, SCENE_CLASS_TYPES };
/** Hulls replace triangles when camera distance ≤ jewel span × this. No pixel test. */
export const SCENE_HULL_ZOOM = 0.5;
export const FLEET_MODEL_LOD_LOW = 1 << 9;
export const FLEET_MODEL_LOD_HIGH = 1 << 10;
export const DIRECTED_PRESENT_WORKGROUP = 64;
export const MAX_SCENE_FLEETS = 128;
/**
 * Max simulated ships in one SCENE fleet. Occupancy director live bits stay
 * 256 ordinals (GPU `director.live`); extra kernel rows share those bits.
 */
export const MAX_GROUP_VISUAL = 4096;
/** CPU join/leave seed and zero work per timed chunk. */
export const SCENE_SHIP_CHUNK = 500;
/** Take another ship chunk in the same frame while under this many ms. */
export const SCENE_CHUNK_BUDGET_MS = 1;
export const SCENE_VISUAL_CAP = 10_000;
export const SCENE_KERNEL_COUNT = SCENE_VISUAL_CAP;
export const WARP_ENTER_SEC = 3;
/** Inbound/outbound chord length as a multiple of the compact field. */
export const WARP_FAR_SPAN_MUL = 8;
/** Visible outbound warp before ships hide (seconds). */
export const WARP_OUT_SEC = 8;
/** Compact cruise (field / 60s). Staging uses this, not a short kinematic hop. */
export const SCENE_CRUISE_COMPACT = COMPACT_SYSTEM_SPAN / 60;
/** Leave planet orbit this long before the next domain hop. */
export const STAGE_LEAD_MS = 30_000;
/** Jump-ray start ≈ outer Kepler orbit × 1.2, as a span multiple. */
export const SCENE_RIM_SPAN_MUL = 1.11;
export const PRESENTATION_FREEZE = 0.3;
export const DIRECTED_SHIP_STRIDE = 192;
export const DIRECTED_SHIP_FLOATS = DIRECTED_SHIP_STRIDE / 4;
export const SCENE_TYPES_PER_FLEET = SCENE_CLASS_TYPES.length;

export function occupancyForScene(fleetCount = MAX_SCENE_FLEETS, visual = 0) {
  const list = Array.isArray(visual) ? visual : null;
  return Array.from({ length: fleetCount }, (_, slot) => {
    const n = Math.max(0, Math.min(MAX_GROUP_VISUAL, (list ? list[slot] : visual) | 0));
    return { slot, type: 0, visual: n, logical: Math.max(n, MAX_GROUP_VISUAL * 20), id: slot };
  });
}

function visualWant(fleet) {
  return Math.max(0, Math.min(MAX_GROUP_VISUAL, fleet.shipCount | 0));
}

function fillUniform(wants, cap) {
  const n = wants.length;
  if (n === 0) return [];
  const share = Math.floor(cap / n);
  return wants.map((w) => Math.min(w, share));
}

function giveRemainder(counts, wants, order, left) {
  for (const i of order) {
    if (left <= 0) break;
    const add = Math.min(left, wants[i] - counts[i]);
    counts[i] += add;
    left -= add;
  }
}

export function sceneMembershipKey(fleets) {
  return fleets.map((f) => `${f.id ?? ""}:${(f.slot ?? 0) | 0}`).sort().join("|");
}

export function sceneHullsOn(distance, span = COMPACT_SYSTEM_SPAN, zoom = SCENE_HULL_ZOOM) {
  return Number.isFinite(distance) && Number.isFinite(span) && span > 0 && distance <= span * zoom;
}

/** Exclusive jewel draw: triangle XOR hull, never both, never neither while SCENE is open. */
export function sceneDrawBand(sceneOpen, distance, span = COMPACT_SYSTEM_SPAN, zoom = SCENE_HULL_ZOOM) {
  if (!sceneOpen) return "none";
  return sceneHullsOn(distance, span, zoom) ? "hull" : "triangle";
}

export function fleetModelLodHigh(input = {}) {
  if (input.selected) return true;
  const focus = input.focusedBodyIndex | 0;
  return focus > 0 && (input.bodyIndex | 0) === focus;
}

export function fleetModelLodBits(input = {}) {
  return fleetModelLodHigh(input) ? FLEET_MODEL_LOD_HIGH : FLEET_MODEL_LOD_LOW;
}

/**
 * Per-fleet instanced draws. Kernel `instance_index` is the map slot.
 * Consecutive same-LOD ranges merge. Empty bucket → that mesh is not submitted.
 */
export function hullDrawRanges(fleets, rangeOf, options = {}) {
  const high = [];
  const low = [];
  const selectedId = options.selectedId;
  const focusedBodyIndex = options.focusedBodyIndex;
  for (const fleet of fleets) {
    const range = typeof rangeOf === "function" ? rangeOf(fleet) : null;
    if (!range) continue;
    const count = Math.min(Math.max(0, fleet.shipCount | 0), range.cap | 0);
    if (count <= 0) continue;
    const first = range.start | 0;
    const bucket = fleetModelLodHigh({
      selected: selectedId != null && fleet.id === selectedId,
      bodyIndex: fleet.bodyIndex,
      focusedBodyIndex,
    }) ? high : low;
    const last = bucket[bucket.length - 1];
    if (last && last.first + last.count === first) last.count += count;
    else bucket.push({ first, count });
  }
  return { high, low };
}

function occupancyFromCounts(fleets, counts, requested, cap, key) {
  const byId = new Map(fleets.map((f, i) => [f.id, counts[i]]));
  return {
    fleets: fleets.map((f, i) => ({ ...f, shipCount: counts[i] })),
    shown: counts.reduce((sum, n) => sum + n, 0),
    requested,
    cap,
    key,
    counts,
    byId,
  };
}

function splitWants(wants, cap) {
  const counts = fillUniform(wants, cap);
  const used = counts.reduce((sum, n) => sum + n, 0);
  giveRemainder(counts, wants, wants.map((_, i) => i), Math.max(0, cap - used));
  return counts;
}

export function allocateSceneVisuals(fleets, options = {}) {
  const cap = options.cap ?? SCENE_VISUAL_CAP;
  const wants = fleets.map(visualWant);
  const requested = wants.reduce((sum, w) => sum + w, 0);
  const key = sceneMembershipKey(fleets);
  const previous = options.previous;
  if (previous && previous.key === key) {
    const byId = previous.byId instanceof Map ? previous.byId : new Map();
    const counts = fleets.map((f, i) => {
      const kept = f.id != null && byId.has(f.id) ? byId.get(f.id) : previous.counts?.[i];
      return kept | 0;
    });
    return occupancyFromCounts(fleets, counts, requested, cap, key);
  }
  const prevById = previous?.byId instanceof Map ? previous.byId : null;
  if (!prevById) {
    return occupancyFromCounts(fleets, splitWants(wants, cap), requested, cap, key);
  }
  const counts = fleets.map((f) => (f.id != null && prevById.has(f.id) ? prevById.get(f.id) | 0 : 0));
  const staying = counts.reduce((sum, n) => sum + n, 0);
  const leftover = Math.max(0, cap - staying);
  const joiners = [];
  for (let i = 0; i < fleets.length; i++) {
    if (fleets[i].id == null || !prevById.has(fleets[i].id)) joiners.push(i);
  }
  if (joiners.length > 0 && leftover === 0 && staying > 0) {
    return occupancyFromCounts(fleets, splitWants(wants, cap), requested, cap, key);
  }
  const joinerWants = joiners.map((i) => wants[i]);
  const given = splitWants(joinerWants, leftover);
  for (let k = 0; k < joiners.length; k++) counts[joiners[k]] = given[k] | 0;
  return occupancyFromCounts(fleets, counts, requested, cap, key);
}

export function occupancyVisuals(allocation, fleetCount = MAX_SCENE_FLEETS) {
  const visuals = new Array(fleetCount).fill(0);
  for (const fleet of allocation.fleets) {
    const slot = (fleet.slot ?? 0) | 0;
    if (slot >= 0 && slot < fleetCount) visuals[slot] = fleet.shipCount | 0;
  }
  return visuals;
}

function hashedRing(slot, radius, y) {
  const a = (slot * 2.39996323) % (Math.PI * 2);
  return [radius * Math.sin(a), y, radius * Math.cos(a)];
}
/** PoC seedNavigation: one ship on its class-tilted ring around the live body. */
export function labClassRing(body, type, index) {
  const labR = compactToLab(body?.radius ?? 0);
  const r = orbitRadius(type & 31, labR);
  const tilt = orbitTilt(type & 31);
  const phase = (index * 2.39996323) % (Math.PI * 2);
  return [
    compactToLab(body?.x ?? 0) + r * Math.cos(phase),
    compactToLab(body?.y ?? 0) + r * Math.sin(phase) * Math.sin(tilt),
    compactToLab(body?.z ?? 0) + r * Math.sin(phase) * Math.cos(tilt),
  ];
}
export function labOrbitExit(body, slot) {
  return labClassRing(body, 0, slot);
}

/** Start on the class ring. Jump-in is CPU; kernel only circulates. */
export function labApproach(body, slot, type = 0, index = slot) {
  return labClassRing(body, type, index);
}

function warpPoint(slot, toward, spanMul) {
  const r = compactToLab(COMPACT_SYSTEM_SPAN * spanMul);
  const y = compactToLab(toward?.y ?? 0.002);
  const tx = toward?.x ?? 0, tz = toward?.z ?? 0;
  const len = Math.hypot(tx, tz);
  if (len > 1e-9) return [(tx / len) * r, y, (tz / len) * r];
  return hashedRing(slot, r, y);
}

/** Start outside the jewel, on the destination planet's bearing. */
export function labWarpOrigin(slot, toward = null) {
  return warpPoint(slot, toward, 0.85);
}

/** Warp chord ends at the jewel rim on that bearing; local orbit then cruises in. */
export function labWarpGate(slot, toward = null) {
  return warpPoint(slot, toward, 0.48);
}

export function warpEnterCommand(now, slot, planet, exit, revision, warpSec = WARP_ENTER_SEC) {
  const journey = {
    mode: "warp",
    at: now,
    end: now + Math.max(0.05, warpSec),
    exit,
    revision,
  };
  if (planet != null && planet > 0) journey.planet = planet;
  return { fleet: slot, journey };
}

function clamp01(u) {
  return u < 0 ? 0 : u > 1 ? 1 : u;
}

function bearingCompact(dirX, dirZ, radius, fallbackSlot = 0) {
  const r = Math.max(0, radius);
  const len = Math.hypot(dirX, dirZ);
  if (len > 1e-9) return { x: (dirX / len) * r, y: 0, z: (dirZ / len) * r };
  const a = (fallbackSlot * 2.39996323) % (Math.PI * 2);
  return { x: Math.sin(a) * r, y: 0, z: Math.cos(a) * r };
}

export function mixCompact(a, b, u) {
  const t = clamp01(u);
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export function compactCruiseSec(from, to) {
  const dx = (to?.x ?? 0) - (from?.x ?? 0);
  const dy = (to?.y ?? 0) - (from?.y ?? 0);
  const dz = (to?.z ?? 0) - (from?.z ?? 0);
  const d = Math.hypot(dx, dy, dz);
  return Math.max(0.05, d / Math.max(SCENE_CRUISE_COMPACT, 1e-9));
}

/**
 * Domain jump/cooldown → SCENE warp/orbit/stage/hide.
 * Coordinates are sun-local compact. Far inbound/outbound stay timed warp.
 * In-system stage is local cruise toward the rim (avoidBodies runs).
 */
export function sceneMotionPlan(input) {
  const span = COMPACT_SYSTEM_SPAN;
  const farR = (input?.farR > 0 ? input.farR : span * WARP_FAR_SPAN_MUL);
  const rimR = (input?.outerR > 0 ? input.outerR : span * SCENE_RIM_SPAN_MUL);
  const slot = (input?.slot ?? 0) | 0;
  const from = bearingCompact(input?.fromX ?? 0, input?.fromZ ?? 0, 1, slot);
  const to = bearingCompact(input?.toX ?? 0, input?.toZ ?? 0, 1, slot + 1);
  const farIn = { x: from.x * farR, y: 0, z: from.z * farR };
  const rimIn = { x: from.x * rimR, y: 0, z: from.z * rimR };
  const farOut = { x: to.x * farR, y: 0, z: to.z * farR };
  const rimOut = { x: to.x * rimR, y: 0, z: to.z * rimR };
  const state = input?.state;
  const nowMs = Number(input?.nowMs) || 0;
  const systemId = input?.systemId;
  if (!state || state.state === "awaiting") {
    return { phase: "orbit", seed: "orbit", paused: false };
  }
  if (state.state === "jumping") {
    const dur = Math.max(1, state.durationMs || 1);
    const elapsed = nowMs - state.startTime;
    const left = Math.max(0, dur - elapsed);
    const startId = state.startNode?.solarSystemId;
    const endId = state.endNode?.solarSystemId;
    if (endId === systemId) {
      const u = clamp01(elapsed / dur);
      return {
        phase: "inbound",
        seed: "warp",
        paused: false,
        planet: true,
        warpSec: Math.max(0.05, left / 1000),
        origin: farIn,
        exit: rimIn,
        u,
      };
    }
    if (startId === systemId) {
      if (elapsed < WARP_OUT_SEC * 1000) {
        return {
          phase: "outbound",
          seed: "warp",
          paused: false,
          planet: false,
          warpSec: Math.max(0.05, WARP_OUT_SEC - elapsed / 1000),
          origin: rimOut,
          exit: farOut,
          u: clamp01(elapsed / (WARP_OUT_SEC * 1000)),
        };
      }
      return { phase: "hide", seed: "orbit", paused: true };
    }
    return { phase: "hide", seed: "orbit", paused: true };
  }
  const left = Math.max(0, (state.startTime || 0) + (state.durationMs || 0) - nowMs);
  if (left > STAGE_LEAD_MS) {
    return { phase: "orbit", seed: "orbit", paused: false };
  }
  const park = input?.fromPos || { x: 0, y: 0, z: 0 };
  return {
    phase: "stage",
    seed: "local",
    paused: false,
    planet: true,
    warpSec: compactCruiseSec(park, rimOut),
    origin: park,
    exit: rimOut,
    u: 0,
  };
}

export function stageCommand(now, slot, exit, revision, planet) {
  const journey = {
    mode: "departure",
    at: now,
    end: now + 1e6,
    exit,
    revision,
  };
  if (planet != null && planet > 0) journey.planet = planet;
  return { fleet: slot, journey };
}

export function orbitCommand(now, slot, planet, revision) {
  return {
    fleet: slot,
    journey: {
      mode: "orbit",
      planet,
      at: now,
      end: now + 1e6,
      exit: [0, 0, 0],
      revision,
    },
  };
}

export function pressurePlanetCommand(slot, planet, halfExtent, revision) {
  return {
    fleet: slot,
    revision,
    pressure: { planet, halfExtent, blend: 0 },
  };
}

/** 64³ brick half-extent in the same units as `field.cell`. */
export function densityFieldReach(field) {
  const cell = field?.cell ?? 0;
  return cell > 0 ? 32 * cell : 0;
}

export function densityFieldCovers(field, body) {
  const reach = densityFieldReach(field);
  if (!(reach > 0) || !body) return false;
  const dx = (field.x || 0) - (body.x || 0);
  const dy = (field.y || 0) - (body.y || 0);
  const dz = (field.z || 0) - (body.z || 0);
  return dx * dx + dy * dy + dz * dz <= reach * reach;
}

/** Focused planet only. Sun / no focus keeps every planet-sized brick. */
export function pickDensityFields(fields, body) {
  const list = Array.isArray(fields) ? fields : [];
  if (!body || body.isSun) return list;
  return list.filter((field) => densityFieldCovers(field, body));
}

export function directedTickDecision(wallGap, simGap, dt, freeze = PRESENTATION_FREEZE) {
  if (wallGap > freeze) return "freeze";
  if (simGap < dt - 1e-9) return "skip";
  return "tick";
}

export function sceneFleetFingerprint(fleets, poses) {
  const map = fleets.map((f) => `${f.id ?? ""}:${f.slot ?? 0}:${f.instanceStart}:${f.shipCount}:${Number(f.paused)}`).join("|");
  if (!poses || fleets.length === 0 || !fleets.every((f) => f.paused)) return map;
  const f = new Float32Array(poses);
  const n = Math.min(
    Math.floor(f.length / DIRECTED_SHIP_FLOATS),
    fleets.reduce((s, x) => s + Math.max(0, x.shipCount | 0), 0),
  );
  let p = "";
  for (let i = 0; i < n; i++) {
    const o = i * DIRECTED_SHIP_FLOATS;
    p += `${f[o]}:${f[o + 1]}:${f[o + 2]};`;
  }
  return `${map}#${p}`;
}

function bySlot(fleets) {
  return fleets.slice().sort((a, b) => ((a.slot ?? 0) | 0) - ((b.slot ?? 0) | 0));
}

export function buildInstanceMap(fleets, kernelCount, ranges = null) {
  const map = new Uint32Array(kernelCount).fill(0xffffffff);
  if (!ranges) {
    let k = 0;
    for (const fleet of bySlot(fleets)) {
      const n = Math.max(0, fleet.shipCount | 0);
      for (let i = 0; i < n && k < kernelCount; i++, k++) map[k] = (fleet.instanceStart + i) >>> 0;
    }
    return map;
  }
  for (const fleet of bySlot(fleets)) {
    const slot = (fleet.slot ?? 0) | 0;
    const r = ranges.get(slot);
    if (!r) continue;
    const n = Math.min(Math.max(0, fleet.shipCount | 0), r.cap);
    for (let i = 0; i < n; i++) map[r.start + i] = (fleet.instanceStart + i) >>> 0;
  }
  return map;
}

export function holesFromRanges(ranges, kernelCount) {
  const used = [...ranges.values()].sort((a, b) => a.start - b.start);
  const holes = [];
  let at = 0;
  for (const r of used) {
    if (r.start > at) holes.push({ start: at, cap: r.start - at });
    at = Math.max(at, r.start + r.cap);
  }
  if (at < kernelCount) holes.push({ start: at, cap: kernelCount - at });
  return holes;
}

function takeKernelHole(holes, n) {
  for (let i = 0; i < holes.length; i++) {
    const h = holes[i];
    if (h.cap < n) continue;
    const placed = { start: h.start, cap: n };
    if (h.cap > n) holes[i] = { start: h.start + n, cap: h.cap - n };
    else holes.splice(i, 1);
    return placed;
  }
  return null;
}

export function allocateKernelRanges(fleets, kernelCount, previous = null) {
  const prev = previous instanceof Map ? previous : new Map();
  const live = new Set(fleets.map((f) => (f.slot ?? 0) | 0));
  const ranges = new Map();
  const abandoned = [];
  for (const [slot, r] of prev) {
    if (!live.has(slot)) {
      abandoned.push({ start: r.start, cap: r.cap, slot });
      continue;
    }
    ranges.set(slot, { start: r.start, cap: r.cap });
  }
  const grown = [];
  for (const fleet of bySlot(fleets)) {
    const slot = (fleet.slot ?? 0) | 0;
    const n = Math.max(0, fleet.shipCount | 0);
    const have = ranges.get(slot);
    if (have) {
      if (n < have.cap) {
        abandoned.push({ start: have.start + n, cap: have.cap - n, slot });
        ranges.set(slot, { start: have.start, cap: n });
      }
      continue;
    }
    const placed = n > 0 ? takeKernelHole(holesFromRanges(ranges, kernelCount), n) : null;
    if (!placed) continue;
    ranges.set(slot, placed);
    grown.push(slot);
  }
  return { ranges, grown, abandoned };
}

export function lowestHole(ranges, kernelCount) {
  const holes = holesFromRanges(ranges, kernelCount);
  return holes.length ? holes[0] : null;
}

export function rangesOverlap(a, b) {
  return a.start < b.start + b.cap && b.start < a.start + a.cap;
}

/** Highest live fleet that fits in the lowest hole (move down only). */
export function pickCompactMove(ranges, kernelCount) {
  const hole = lowestHole(ranges, kernelCount);
  if (!hole || hole.cap <= 0) return null;
  let best = null;
  for (const [slot, r] of ranges) {
    if (!r || r.cap <= 0 || r.cap > hole.cap) continue;
    if (r.start <= hole.start) continue;
    const dest = { start: hole.start, cap: r.cap };
    const row = {
      slot,
      oldStart: r.start,
      newStart: hole.start,
      cap: r.cap,
      overlap: rangesOverlap(r, dest),
    };
    if (!best || row.oldStart > best.oldStart) best = row;
  }
  return best;
}

function classSeedPlan(fleet, n) {
  const groupId = (fleet.groupId ?? fleet.slot ?? 0) >>> 0;
  if (fleet.type != null) {
    return { types: [fleet.type & 31], parts: [n], groups: [groupId] };
  }
  const types = SCENE_CLASS_TYPES;
  return {
    types,
    parts: distributeFlightTypes(n, types),
    groups: types.map(() => groupId),
  };
}

function hopSeedPose(plan) {
  if (!plan?.origin || !plan.exit) return null;
  if (plan.phase !== "inbound" && plan.phase !== "outbound") return null;
  const p = mixCompact(plan.origin, plan.exit, plan.u ?? 0);
  return [compactToLab(p.x), compactToLab(p.y), compactToLab(p.z)];
}

function stageSeedPose(fleet, index, poseAt, poseScale, plan) {
  const pose = poseAt(fleet.instanceStart + index);
  if (Number.isFinite(pose?.x) && (pose.x || pose.y || pose.z)) {
    return [pose.x * poseScale, pose.y * poseScale, pose.z * poseScale];
  }
  if (!plan.origin) return null;
  return [compactToLab(plan.origin.x), compactToLab(plan.origin.y), compactToLab(plan.origin.z)];
}

function planSeedPose(fleet, index, poseAt, poseScale) {
  const plan = fleet.plan;
  if (!plan || fleet.paused) return null;
  return hopSeedPose(plan) ?? (plan.phase === "stage"
    ? stageSeedPose(fleet, index, poseAt, poseScale, plan)
    : null);
}

function arrivalSeedPose(fleet, index, arrival, type) {
  if (fleet.paused || (arrival !== "warp" && arrival !== "orbit")) return null;
  if (arrival === "orbit") {
    const body = fleet.toward ? { ...fleet.toward, radius: fleet.bodyRadius } : null;
    return labClassRing(body, type ?? 0, index);
  }
  return labWarpOrigin((fleet.slot ?? 0) | 0, fleet.toward);
}

function seedPose(fleet, index, poseAt, poseScale, arrival, type) {
  const planned = planSeedPose(fleet, index, poseAt, poseScale);
  if (planned) return planned;
  const arrivalPose = arrivalSeedPose(fleet, index, arrival, type);
  if (arrivalPose) return arrivalPose;
  const pose = poseAt(fleet.instanceStart + index);
  return [pose.x * poseScale, pose.y * poseScale, pose.z * poseScale];
}

function writeFleetSeed(f, w, fleet, start, n, poseAt, poseScale, arrival, kernelCount, from = 0, limit = n, rowBase = start) {
  const slot = (fleet.slot ?? start) >>> 0;
  const plan = classSeedPlan(fleet, n);
  const end = Math.min(n, from + Math.max(0, limit));
  let i = 0;
  for (let ti = 0; ti < plan.types.length; ti++) {
    const type = plan.types[ti], groupId = plan.groups[ti];
    for (let part = 0; part < plan.parts[ti]; part++, i++) {
      if (i < from || i >= end) continue;
      const k = start + i;
      if (k >= kernelCount) return;
      const o = (rowBase + (i - from)) * DIRECTED_SHIP_FLOATS;
      if (o + DIRECTED_SHIP_FLOATS > w.length) return;
      const p = seedPose(fleet, i, poseAt, poseScale, arrival, type);
      // Rest on seed: reused kernel slices must not keep a previous occupant's v/a.
      f.fill(0, o, o + DIRECTED_SHIP_FLOATS);
      f[o] = p[0]; f[o + 1] = p[1]; f[o + 2] = p[2];
      f[o + 7] = classOf(type).speed;
      f[o + 15] = 1;
      w[o + 20] = (i & 255) | (type << 8) | (groupId << 18);
      w[o + 21] = slot;
      w[o + 22] = 1;
      w[o + 23] = k + 1;
    }
  }
}

export function seedDirectedShips(kernelCount, fleets, poseAt, poseScale = 1, options = {}) {
  const data = options.into ?? new ArrayBuffer(kernelCount * DIRECTED_SHIP_STRIDE);
  const f = new Float32Array(data);
  const w = new Uint32Array(data);
  const ranges = options.ranges;
  const only = options.onlySlots;
  const arrival = options.arrival;
  const seedFrom = options.seedFrom | 0;
  const seedCount = options.seedCount;
  const rowBase = options.rowBase;
  let k = 0;
  for (const fleet of bySlot(fleets)) {
    const n = Math.max(0, fleet.shipCount | 0);
    const slot = (fleet.slot ?? k) >>> 0;
    const start = ranges?.get(slot)?.start ?? k;
    const cap = ranges?.get(slot)?.cap ?? n;
    const count = Math.min(n, cap);
    if (!only || only.has(slot)) {
      const limit = seedCount == null ? count - seedFrom : seedCount;
      const base = rowBase == null ? start + seedFrom : rowBase;
      writeFleetSeed(f, w, fleet, start, count, poseAt, poseScale, arrival, kernelCount, seedFrom, limit, base);
    }
    if (!ranges) k += n;
  }
  return data;
}

export function drainDirectedEncodeTick(runtime, time) {
  if (!runtime || typeof runtime.applyDueEvents !== "function") return 0;
  return runtime.applyDueEvents(time ?? runtime.now);
}

export function kernelSlotForId(fleets, id) {
  if (id == null) return -1;
  const fleet = fleets.find((f) => f.id === id);
  return fleet ? (fleet.slot ?? -1) : -1;
}

export function resolveLocalShowAttack(map, selectedId, target) {
  if (!selectedId || !target || selectedId === target.id) return null;
  const attacker = kernelSlotForId(map, selectedId);
  const targetSlot = target.slot ?? kernelSlotForId(map, target.id);
  if (attacker < 0 || targetSlot < 0 || attacker === targetSlot) return null;
  return { attacker, target: targetSlot };
}

export const KERNEL_TRAIL_RING = 16;
export const KERNEL_TRAIL_EMITTERS = 3;
export const KERNEL_TRAIL_CENTER = 1;
/** Production expand ring (power of 2). */
export const PRODUCTION_TRAIL_RING = 8;
/** Live history samples copied into the production ring (newest = hull every frame). */
export const TRAIL_COPY_SAMPLES = 6;
/** Drop history knots whose lab offset from the hull head is not a trail. */
export const TRAIL_LAB_LIMIT = 20;
/**
 * Compact distance that starts a new ribbon instead of connecting samples.
 * Local cruise is ~0.0017 span/s; a warp tick is ~0.009. Occupancy teleports
 * are planet-scale. Present-copy appends compact poses and breaks on this.
 */
export const TRAIL_BREAK_COMPACT = 0.012;

/** 1 at the sun, 0.5 at half a compact span, and 0.5 beyond. */
export function trailViewIntensity(distance, span = COMPACT_SYSTEM_SPAN) {
  const far = span * 0.5;
  if (!(far > 0) || !(distance > 0)) return 1;
  return Math.max(0.5, 1 - 0.5 * Math.min(1, distance / far));
}

export function sceneFleetCentroid(count, readPos) {
  let x = 0, y = 0, z = 0, n = 0;
  const total = Math.max(0, count | 0);
  for (let i = 0; i < total; i++) {
    const p = readPos(i);
    if (!p) continue;
    x += p.x; y += p.y; z += p.z; n++;
  }
  return n > 0 ? { x: x / n, y: y / n, z: z / n, n } : null;
}

export function presentKernelHistoryToTrailRing(
  history,
  kernelIndex,
  trails,
  simIndex,
  nowMs,
  prodRing = PRODUCTION_TRAIL_RING,
) {
  const histBase = (kernelIndex * KERNEL_TRAIL_EMITTERS + KERNEL_TRAIL_CENTER) * KERNEL_TRAIL_RING;
  let newest = 0;
  let newestBirth = -1;
  let live = 0;
  for (let k = 0; k < KERNEL_TRAIL_RING; k++) {
    const birth = history[(histBase + k) * 4 + 3];
    if (birth >= 0) live++;
    if (birth > newestBirth) {
      newestBirth = birth;
      newest = k;
    }
  }
  if (newestBirth < 0 || live < 2) return 0;
  const destBase = simIndex * prodRing * 4;
  let copied = 0;
  for (let s = 0; s < prodRing; s++) {
    const src = (newest + KERNEL_TRAIL_RING - (prodRing - 1 - s)) % KERNEL_TRAIL_RING;
    const ho = (histBase + src) * 4;
    const birth = history[ho + 3];
    const dest = destBase + s * 4;
    const ageSec = Math.max(0, newestBirth - birth);
    trails[dest] = history[ho];
    trails[dest + 1] = history[ho + 2];
    trails[dest + 2] = birth >= 0 ? nowMs - ageSec * 1000 : -1;
    trails[dest + 3] = history[ho + 1];
    if (birth >= 0) copied++;
  }
  return copied;
}
