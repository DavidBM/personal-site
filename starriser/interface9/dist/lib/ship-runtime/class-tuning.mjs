import { CLASSES, CLASS_REPEL_SCALE, CLASS_VISUAL_SCALE } from "./classes.mjs";

/** Six hull classes. Each row is two vec4s: motion, then repel / visual / weight. */
export const CLASS_TUNING_FLOATS = 48;
export const CLASS_NAMES = Object.freeze(CLASSES.map((row) => row.name));

const FIELDS = Object.freeze(["speed", "acceleration", "jerk", "turn", "repel", "visual", "weight"]);

function rowFromClass(kind, index) {
  return {
    speed: kind.speed,
    acceleration: kind.acceleration,
    jerk: kind.jerk,
    turn: kind.turn,
    repel: CLASS_REPEL_SCALE[index] ?? 1,
    visual: CLASS_VISUAL_SCALE[index] ?? 1,
    weight: kind.weight,
  };
}

export function defaultClassTuning() {
  return CLASSES.map(rowFromClass);
}

function clampField(field, value) {
  if (!Number.isFinite(value)) return null;
  if (field === "turn") return Math.max(0, value);
  if (field === "repel") return Math.max(0.005, value);
  if (field === "visual") return Math.max(0.05, value);
  if (field === "weight") return Math.max(0, value);
  return Math.max(0.05, value);
}

let current = defaultClassTuning();
let dirty = false;

export function resetClassTuning() {
  current = defaultClassTuning();
  dirty = false;
}

/** Coalesce edits. The GPU buffer is written once, on the next frame, if this is dirty. */
export function scheduleShipTuning(patch) {
  const index = patch?.index | 0;
  if (index < 0 || index >= current.length) return false;
  const row = current[index];
  let changed = false;
  for (const field of FIELDS) {
    if (patch[field] == null) continue;
    const value = clampField(field, Number(patch[field]));
    if (value == null || value === row[field]) continue;
    row[field] = value;
    changed = true;
  }
  if (changed) dirty = true;
  return changed;
}

export function packClassTuning(rows = current) {
  const out = new Float32Array(CLASS_TUNING_FLOATS);
  for (let i = 0; i < rows.length && i < 6; i++) {
    const row = rows[i];
    const o = i * 8;
    out[o] = row.speed;
    out[o + 1] = row.acceleration;
    out[o + 2] = row.jerk;
    out[o + 3] = row.turn;
    out[o + 4] = row.repel;
    out[o + 5] = row.visual;
    out[o + 6] = row.weight;
  }
  return out;
}

/** One snapshot per frame. Null when nothing changed since the last consume. */
export function consumeShipTuning() {
  if (!dirty) return null;
  dirty = false;
  return packClassTuning(current);
}
