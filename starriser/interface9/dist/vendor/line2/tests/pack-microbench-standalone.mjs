/**
 * Standalone pure-CPU microbench (inlines pack algorithms — no dist import).
 * Useful if dist/ is stale; production bench is pack-microbench.mjs.
 *
 *   node js/vendor/line2/tests/pack-microbench-standalone.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LINE2_POS_FLOATS = 6;
const LINE2_DIST_FLOATS = 2;
const SIZES = [100, 1000, 1500, 2000, 8000, 50000];
const BRIEF_SIZES = new Set([100, 1000, 8000, 50000]);
const WARMUP = 50;
const ITERS = 400;
const ITERS_LARGE = 80;
const LARGE_N = 20000;

function itersFor(n) {
  return n >= LARGE_N ? ITERS_LARGE : ITERS;
}

function packSegmentPositions(array) {
  if (array instanceof Float32Array) {
    if (array.length % LINE2_POS_FLOATS !== 0) {
      throw new Error(`packSegmentPositions: length ${array.length} is not a multiple of 6`);
    }
    return array;
  }
  const out = new Float32Array(array.length);
  out.set(array);
  if (out.length % LINE2_POS_FLOATS !== 0) {
    throw new Error(`packSegmentPositions: length ${out.length} is not a multiple of 6`);
  }
  return out;
}

function expandPolylineTriples(src) {
  if (src.length % 3 !== 0) throw new Error("bad polyline");
  if (src.length < 3) throw new Error("empty");
  if (src.length === 3) return new Float32Array(0);
  const length = src.length - 3;
  const points = new Float32Array(2 * length);
  for (let i = 0; i < length; i += 3) {
    points[2 * i] = src[i];
    points[2 * i + 1] = src[i + 1];
    points[2 * i + 2] = src[i + 2];
    points[2 * i + 3] = src[i + 3];
    points[2 * i + 4] = src[i + 4];
    points[2 * i + 5] = src[i + 5];
  }
  return points;
}

function polylineToSegments(polyline) {
  const src =
    polyline instanceof Float32Array ? polyline : Float32Array.from(polyline);
  return expandPolylineTriples(src);
}

function computeLineDistances(positions) {
  const segmentCount = positions.length / LINE2_POS_FLOATS;
  if (!Number.isInteger(segmentCount)) throw new Error("bad positions");
  const lineDistances = new Float32Array(segmentCount * LINE2_DIST_FLOATS);
  for (let i = 0, j = 0; i < segmentCount; i++, j += 2) {
    const o = i * LINE2_POS_FLOATS;
    const dx = positions[o + 3] - positions[o];
    const dy = positions[o + 4] - positions[o + 1];
    const dz = positions[o + 5] - positions[o + 2];
    const len = Math.hypot(dx, dy, dz);
    lineDistances[j] = j === 0 ? 0 : lineDistances[j - 1];
    lineDistances[j + 1] = lineDistances[j] + len;
  }
  return lineDistances;
}

function makeSegments(n) {
  const out = new Float32Array(n * LINE2_POS_FLOATS);
  for (let i = 0; i < out.length; i++) out[i] = i * 0.001;
  return out;
}

function makePolyline(nSeg) {
  const verts = nSeg + 1;
  const out = new Float32Array(verts * 3);
  for (let i = 0; i < verts; i++) {
    const o = i * 3;
    out[o] = i;
    out[o + 1] = 0;
    out[o + 2] = Math.sin(i * 0.1);
  }
  return out;
}

function bench(label, n, fn) {
  const iters = itersFor(n);
  for (let i = 0; i < WARMUP; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const ms = performance.now() - t0;
  return { label, ms, iters, msPerCall: ms / iters, n };
}

function metrics(r, segs, bytesPerCall) {
  const nsPerSeg = (r.msPerCall * 1e6) / segs;
  const thr = bytesPerCall / (1024 * 1024) / (r.msPerCall / 1000);
  return { ...r, segs, bytesPerCall, nsPerSeg, thrMiBps: thr };
}

const tableRows = [];
function record(kind, m) {
  tableRows.push({
    kind,
    n: m.n,
    msPerCall: m.msPerCall,
    nsPerSeg: m.nsPerSeg,
    thrMiBps: m.thrMiBps,
  });
}

console.log("Line2 pack microbench STANDALONE (pure CPU)\n");

for (const n of SIZES) {
  const src = makeSegments(n);
  const r = bench(`alias N=${n}`, n, () => {
    const p = packSegmentPositions(src);
    if (p[0] !== src[0]) throw new Error("alias");
  });
  record("pack alias (Float32Array)", metrics(r, n, n * 6 * 4));
}

for (const n of SIZES) {
  const src = Array.from(makeSegments(n));
  const r = bench(`copy N=${n}`, n, () => {
    const p = packSegmentPositions(src);
    if (p[0] !== src[0]) throw new Error("copy");
  });
  record("pack copy (number[])", metrics(r, n, n * 6 * 4));
}

for (const n of SIZES) {
  const poly = makePolyline(n);
  const r = bench(`polyline segs=${n}`, n, () => {
    const p = polylineToSegments(poly);
    if (p.length !== n * 6) throw new Error("len");
  });
  record("polylineToSegments", metrics(r, n, n * 6 * 4));
}

for (const n of SIZES) {
  const src = makeSegments(n);
  const r = bench(`distances N=${n}`, n, () => {
    const d = computeLineDistances(src);
    if (d.length !== n * 2) throw new Error("len");
  });
  record("computeLineDistances", metrics(r, n, n * 2 * 4));
}

function fmtMs(x) {
  if (x < 0.001) return x.toExponential(2);
  if (x < 0.1) return x.toFixed(4);
  return x.toFixed(3);
}
function fmtNs(x) {
  if (x < 0.1) return x.toFixed(2);
  if (x < 10) return x.toFixed(1);
  return x.toFixed(0);
}

const kinds = [
  "pack alias (Float32Array)",
  "pack copy (number[])",
  "polylineToSegments",
  "computeLineDistances",
];
const briefNs = SIZES.filter((n) => BRIEF_SIZES.has(n));

console.log("\n── Markdown brief ──\n");
console.log(
  "| Path | " +
    briefNs.map((n) => `N=${n} ms`).join(" | ") +
    " | " +
    briefNs.map((n) => `N=${n} ns/seg`).join(" | ") +
    " |",
);
console.log(
  "|------|" +
    briefNs.map(() => "---------:").join("|") +
    "|" +
    briefNs.map(() => "-------------:").join("|") +
    "|",
);
for (const kind of kinds) {
  const byN = new Map(tableRows.filter((r) => r.kind === kind).map((r) => [r.n, r]));
  console.log(
    `| ${kind} | ${briefNs.map((n) => fmtMs(byN.get(n).msPerCall)).join(" | ")} | ${briefNs.map((n) => fmtNs(byN.get(n).nsPerSeg)).join(" | ")} |`,
  );
}

const meta = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  date: new Date().toISOString(),
  warmup: WARMUP,
  iters: ITERS,
  itersLarge: ITERS_LARGE,
  standalone: true,
};
const outPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "pack-microbench-results.json",
);
writeFileSync(
  outPath,
  JSON.stringify({ meta, rows: tableRows, sizes: SIZES, briefSizes: [...BRIEF_SIZES] }, null, 2) +
    "\n",
);
console.log(`\nwrote ${outPath}`);
console.log(JSON.stringify({ meta, rows: tableRows }, null, 2));
