/** Occupancy identity on the live director ABI: O(occupied groups + ships), not O(F²). */
import {TYPES} from "./classes.mjs";
import {createPopulationCatalog} from "./population-catalog.mjs";
import {defaultNearbySlots, NEARBY_SLOTS} from "./nearby-bodies.mjs";
import {distributeFlightTypes} from "./flight-layout.mjs";

export const LOCAL_FLEET_SLOTS = 128;
export const MAX_OCCUPIED_GROUPS = 512;
export const MAX_VISUAL_SHIPS = 10_000;
/** Occupancy group visual cap (SCENE kernel may pack more rows per fleet). */
export const MAX_GROUP_VISUAL = 4096;
/** GPU `director.live` words per group stay 8 (256 ordinals). */
const LIVE_ORDINALS = 256;
export const MAX_BATTLES = 32;
export const SPARSE_GROUP_RECORD_BYTES = 16;
export const SPARSE_BATTLE_BYTES = 64;

export function sparseIdentityBytes(occupiedGroups, battles = 0) {
  const groups = Math.max(0, occupiedGroups | 0);
  if (groups > MAX_OCCUPIED_GROUPS) throw new Error("Occupied groups exceed 512");
  return groups * SPARSE_GROUP_RECORD_BYTES + Math.max(0, battles | 0) * SPARSE_BATTLE_BYTES;
}

function occupancyCapacity(fleetCount, occupied) {
  const groups = occupied.length;
  const targetStride = 1 + Math.ceil(Math.max(1, groups) / 4);
  const ordinalWords = groups * 64, targetWords = groups * targetStride;
  const groupBase = 8 + groups * 8, tableBase = groupBase + groups * 96;
  const battleBase = tableBase + ordinalWords + targetWords;
  const encounterBase = battleBase + fleetCount * 4, nearbyBase = encounterBase + fleetCount * 4;
  return {
    fleetCount, groups, targetStride, groupBase, tableBase, ordinalWords, targetWords,
    battleBase, encounterBase, nearbyBase, occupancy: true,
    identityBytes: sparseIdentityBytes(groups, MAX_BATTLES),
    words: nearbyBase + fleetCount * 4,
  };
}

function occupancyRoster(occupied, fleetCount) {
  const find = (slot, type) => occupied.find((g) => g.slot === slot && g.type === type);
  const live = new Uint32Array(occupied.length * 8);
  const split = new Uint32Array(32);
  for (let i = 0; i < occupied.length; i++) {
    const n = Math.min(occupied[i].visual, LIVE_ORDINALS);
    split[occupied[i].type] = Math.max(split[occupied[i].type], n);
    for (let ordinal = 0; ordinal < n; ordinal++) live[i * 8 + (ordinal >> 5)] |= 1 << (ordinal & 31);
  }
  return {
    fleetCount,
    live,
    split,
    isLive: (slot, type, ordinal) => {
      const g = find(slot, type);
      return Boolean(g && ordinal >= 0 && ordinal < g.visual);
    },
    count: (slot, type) => find(slot, type)?.visual ?? 0,
    sizeFor: (slot, type) => find(slot, type)?.visual ?? 0,
    logicalCount: (slot, type) => find(slot, type)?.logical ?? 0,
    logicalCapacity: (slot, type) => find(slot, type)?.logical ?? 0,
    cohortOf: () => 0,
    clone() { return occupancyRoster(occupied.map((g) => ({ ...g })), fleetCount); },
  };
}

function syncRecords(groups, occupied) {
  for (let i = 0; i < occupied.length; i++) {
    const g = occupied[i];
    groups.set([g.visual, 0, (1 << g.type) >>> 0, Number(g.joined), 0, g.visual, g.logical, 0], i * 8);
  }
}
function refreshSlotCombat(slotJoined, slotBattle, slotTeam, occupied) {
  slotJoined.fill(0);
  slotBattle.fill(0);
  slotTeam.fill(0);
  for (const g of occupied) {
    if (!g.joined) continue;
    slotJoined[g.slot] = 1;
    slotBattle[g.slot] = g.battle | 0;
    slotTeam[g.slot] = g.team | 0;
  }
}

function requireRange(value, min, max, label) {
  if (value < min || value > max) throw new Error(label);
  return value;
}
function parseEntry(entry, fallbackId) {
  const slot = requireRange(entry.slot | 0, 0, LOCAL_FLEET_SLOTS - 1, "Unknown fleet slot");
  const type = requireRange(entry.type | 0, 0, TYPES - 1, "Unknown ship type");
  const n = requireRange(entry.visual | 0, 0, MAX_GROUP_VISUAL, "Invalid visual count");
  const log = entry.logical ?? n;
  if (log < n) throw new Error("Logical count cannot be below visual reps");
  const id = requireRange(entry.id ?? fallbackId, 0, 0xffff, "Group id exceeds u16");
  return {
    id, slot, type, visual: n, logical: log,
    joined: entry.joined === true, battle: entry.battle ?? 0, team: entry.team ?? 0,
  };
}
function parseOccupancy(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("Sparse director needs an occupancy list");
  if (entries.length > MAX_OCCUPIED_GROUPS) throw new Error("Occupied groups exceed 512");
  const occupied = [];
  let visual = 0, nextId = 0;
  for (const entry of entries) {
    const g = parseEntry(entry, nextId);
    if (entry.id === undefined) nextId++;
    visual += g.visual;
    occupied.push(g);
  }
  if (visual > MAX_VISUAL_SHIPS) throw new Error("Visual ships exceed 10000");
  return occupied;
}

function requireReport(report, fleetCount, revision) {
  if (!Number.isSafeInteger(report.revision) || report.revision <= revision) return false;
  requireRange(report.fleet, 0, fleetCount - 1, "Unknown fleet");
  if (report.type !== undefined) requireRange(report.type, 0, TYPES - 1, "Unknown ship type");
  return true;
}
function acceptJourney(intent, report) {
  const j = report.journey;
  if (!j) return;
  const cohort = report.cohort ?? 0;
  if (cohort !== 0 && cohort !== 1) throw new Error("Unknown cohort");
  const prev = intent.journeys[cohort];
  if (prev && !(j.revision > (prev.revision ?? 0))) return;
  intent.journeys[cohort] = {
    mode: j.mode,
    at: j.at,
    end: j.end,
    exit: Array.from(j.exit ?? [0, 0, 0]),
    revision: j.revision,
    planet: j.planet,
    planeShift: j.planeShift,
  };
}

function patchOccupied(g, intents, i, report) {
  if (g.slot !== report.fleet) return;
  if (report.type !== undefined && g.type !== report.type) return;
  if (report.joined !== undefined) g.joined = report.joined;
  if (report.battle !== undefined) g.battle = report.battle;
  if (report.team !== undefined) g.team = report.team;
  if (report.fire !== undefined) intents[i].fire = Number(report.fire);
  if (report.journey !== undefined) acceptJourney(intents[i], report);
}
function applyOccupancy(occupied, intents, fleetCount, report, revision) {
  if (!requireReport(report, fleetCount, revision)) return revision;
  for (let i = 0; i < occupied.length; i++) patchOccupied(occupied[i], intents, i, report);
  return report.revision;
}

function shrinkVisuals(occupied, visualCap) {
  const cap = visualCap | 0;
  if (cap < 0) throw new Error("Invalid visual cap");
  let remaining = cap;
  for (const g of occupied) {
    const next = Math.min(g.visual, Math.max(0, remaining));
    remaining -= next;
    g.visual = next;
  }
}

/** Live occupancy director. `createDirector(..., { occupancy })` uses this. */
export function createOccupancyDirector(entries, options = {}) {
  const occupied = parseOccupancy(entries);
  const fleetCount = Math.min(LOCAL_FLEET_SLOTS, Math.max(options.fleetCount ?? 0, ...occupied.map((g) => g.slot + 1), 1));
  const capacity = occupancyCapacity(fleetCount, occupied);
  const groups = new Uint32Array(occupied.length * 8);
  const groupIds = new Uint16Array(occupied.map((g) => g.id));
  syncRecords(groups, occupied);
  const nearby = new Uint32Array(fleetCount * NEARBY_SLOTS);
  for (let slot = 0; slot < fleetCount; slot++) nearby.set(defaultNearbySlots(), slot * NEARBY_SLOTS);
  const intents = occupied.map(() => ({ tactic: null, journeys: [null, null], fire: 0 }));
  const battles = new Uint32Array(fleetCount * 4);
  const encounters = new Float32Array(fleetCount * 4);
  for (let fleet = 0; fleet < fleetCount; fleet++) battles.set([0, fleet, 0, 0], fleet * 4);
  let roster = occupancyRoster(occupied, fleetCount);
  let population = createPopulationCatalog(groups, roster, options.identityStart ?? 1);
  let revision = 0;
  let ordinalEpoch = 1;
  let permissionEpoch = 1;
  const slotJoined = new Uint8Array(fleetCount);
  const slotBattle = new Uint32Array(fleetCount);
  const slotTeam = new Uint32Array(fleetCount);
  refreshSlotCombat(slotJoined, slotBattle, slotTeam, occupied);

  function battle(id) {
    const groupIdsFor = occupied.filter((g) => g.joined && g.battle === id).map((g) => g.id);
    return { groupCount: groupIdsFor.length, groupIds: groupIdsFor };
  }
  function capitalGroups() {
    return occupied.filter((g) => g.type >= 30);
  }
  function bumpOccupancyTables() {
    ordinalEpoch++;
    permissionEpoch++;
    refreshSlotCombat(slotJoined, slotBattle, slotTeam, occupied);
  }
  function unrepresent(visualCap) {
    shrinkVisuals(occupied, visualCap);
    syncRecords(groups, occupied);
    roster = occupancyRoster(occupied, fleetCount);
    population = createPopulationCatalog(groups, roster, options.identityStart ?? 1);
    bumpOccupancyTables();
    return director;
  }
  function compactVisuals(visuals) {
    const list = Array.isArray(visuals) ? visuals : [];
    let remaining = MAX_VISUAL_SHIPS;
    let i = 0;
    while (i < occupied.length) {
      const slot = occupied[i].slot;
      let j = i + 1;
      while (j < occupied.length && occupied[j].slot === slot) j++;
      const run = occupied.slice(i, j);
      const types = run.map((g) => g.type);
      const want = Math.max(0, (list[slot] ?? run.reduce((n, g) => n + g.visual, 0)) | 0);
      const parts = distributeFlightTypes(want, types);
      for (let k = 0; k < run.length; k++) {
        const next = Math.min(run[k].logical, parts[k], remaining, LIVE_ORDINALS);
        remaining -= next;
        run[k].visual = next;
      }
      i = j;
    }
    syncRecords(groups, occupied);
    roster = occupancyRoster(occupied, fleetCount);
    population = createPopulationCatalog(groups, roster, options.identityStart ?? 1);
    bumpOccupancyTables();
    return director;
  }
  function apply(report) {
    const next = applyOccupancy(occupied, intents, fleetCount, report, revision);
    if (next === revision) return false;
    if (report.battle !== undefined) battles[report.fleet * 4] = report.battle;
    if (report.team !== undefined) battles[report.fleet * 4 + 1] = report.team;
    const occupancy = report.joined !== undefined || report.battle !== undefined || report.team !== undefined;
    if (occupancy) {
      syncRecords(groups, occupied);
      roster = occupancyRoster(occupied, fleetCount);
      bumpOccupancyTables();
    }
    revision = next;
    return true;
  }
  function adopt(candidate) {
    if (!candidate?.occupancy || candidate.groups.length !== groups.length) throw new Error("Snapshot population layout differs");
    groups.set(candidate.groups);
    battles.set(candidate.battles);
    encounters.set(candidate.encounters);
    nearby.set(candidate.nearby);
    occupied.splice(0, occupied.length, ...candidate.occupied.map((g) => ({ ...g })));
    groupIds.set(candidate.groupIds);
    roster = occupancyRoster(occupied, fleetCount);
    population = candidate.population.clone();
    revision = Math.max(revision, candidate.revision) + 1;
    bumpOccupancyTables();
  }

  const director = {
    occupancy: true,
    occupied,
    groupIds,
    capacity,
    fleetCount,
    groups,
    nearby,
    intents,
    battles,
    encounters,
    apply,
    adopt,
    battle,
    capitalGroups,
    unrepresent,
    compactVisuals,
    groupEpochs: new Float64Array(occupied.length),
    navigationEpochs: new Float64Array(occupied.length * 2),
    canTarget: (a, b) => Boolean(
      slotJoined[a] && slotJoined[b] && slotBattle[a]
      && slotBattle[a] === slotBattle[b] && slotTeam[a] !== slotTeam[b],
    ),
    get ordinalEpoch() { return ordinalEpoch; },
    get permissionEpoch() { return permissionEpoch; },
    get population() { return population; },
    get roster() { return roster; },
    get revision() { return revision; },
    get alive() { return occupied.reduce((n, g) => n + g.visual, 0); },
    get visual() { return occupied.reduce((n, g) => n + g.visual, 0); },
    get logical() { return occupied.reduce((n, g) => n + g.logical, 0); },
    get groupCount() { return occupied.length; },
    get slots() { return new Set(occupied.map((g) => g.slot)).size; },
    get identityBytes() { return capacity.identityBytes; },
  };
  return director;
}

export function createSparseDirector(entries, options) {
  return createOccupancyDirector(entries, options);
}

export function battleGroupIds(director, battleId) {
  if (typeof director.battle === "function") return director.battle(battleId).groupIds;
  return director.occupied.filter((g) => g.joined && g.battle === battleId).map((g) => g.id);
}

export function capitalGroups(director) {
  if (typeof director.capitalGroups === "function") return director.capitalGroups();
  return director.occupied.filter((g) => g.type >= 28);
}

export function unrepresent(director, visualCap) {
  if (typeof director.unrepresent === "function") return director.unrepresent(visualCap);
  throw new Error("Director has no unrepresent");
}
