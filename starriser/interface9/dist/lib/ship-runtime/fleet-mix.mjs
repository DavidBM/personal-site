// Jewel class mix. The domain roll decides that a fleet exists. This decides
// which of the six classes it shows, once, from its id.

export const JEWEL_CLASS_TYPES = Object.freeze([0, 12, 22, 27, 30, 31]);
export const JEWEL_CLASS_WEIGHT = Object.freeze([40, 24, 12, 6, 3, 1]);

export function mixHash(id) {
  let h = 2166136261;
  const text = String(id ?? "");
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mixer(seed) {
  let v = seed >>> 0 || 1;
  return () => {
    v = (Math.imul(v, 1664525) + 1013904223) >>> 0;
    return v;
  };
}

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  let c = 1;
  for (let i = 0; i < k; i++) c = Math.round((c * (n - i)) / (i + 1));
  return c;
}

/** Combination `index` of k items from n, in increasing order. */
export function combination(n, k, index) {
  const out = [];
  let remaining = index | 0;
  let start = 0;
  for (let left = k; left > 0; left--) {
    for (let i = start; i < n; i++) {
      const room = choose(n - i - 1, left - 1);
      if (remaining < room) {
        out.push(i);
        start = i + 1;
        break;
      }
      remaining -= room;
    }
  }
  return out;
}

/** Largest remainder. Counts add up to `total`. Lower index wins a tie. */
export function apportion(total, weights) {
  const n = weights.length;
  const parts = new Array(n).fill(0);
  const sum = weights.reduce((a, b) => a + b, 0);
  const count = total | 0;
  if (n === 0 || sum <= 0 || count <= 0) return parts;
  const exact = weights.map((w) => (w / sum) * count);
  let used = 0;
  const order = [];
  for (let i = 0; i < n; i++) {
    parts[i] = Math.floor(exact[i]);
    used += parts[i];
    order.push({ i, rem: exact[i] - parts[i] });
  }
  order.sort((a, b) => b.rem - a.rem || a.i - b.i);
  let left = count - used;
  for (let k = 0; k < left; k++) parts[order[k % n].i]++;
  return parts;
}

export function fleetComposition(id) {
  const roll = mixer(mixHash(id));
  const k = 1 + (roll() % 6);
  const picked = combination(6, k, roll() % choose(6, k));
  const classes = picked.map((index) => ({
    type: JEWEL_CLASS_TYPES[index],
    kind: index,
    weight: JEWEL_CLASS_WEIGHT[index],
  }));
  const logical = 70000 + (roll() % 60001);
  return {
    classes,
    logical,
    logicalParts: apportion(logical, classes.map((c) => c.weight)),
  };
}

/**
 * Drawn sample of a composition. Same weights as the logical population.
 * When the sample can hold every chosen class, each of them gets a hull.
 */
export function visualParts(composition, visualCount) {
  const classes = composition?.classes ?? [];
  const n = Math.max(0, visualCount | 0);
  const k = classes.length;
  if (n <= 0 || k === 0) return classes.map(() => 0);
  const parts = apportion(n, classes.map((c) => c.weight));
  if (n >= k) {
    for (let guard = 0; guard < k; guard++) {
      const empty = parts.findIndex((part) => part === 0);
      if (empty < 0) break;
      let donor = 0;
      for (let i = 1; i < k; i++) if (parts[i] > parts[donor]) donor = i;
      if (parts[donor] <= 1) break;
      parts[donor]--;
      parts[empty]++;
    }
  }
  return parts;
}
