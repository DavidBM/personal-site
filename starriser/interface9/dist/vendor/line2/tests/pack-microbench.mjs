/**
 * Pure-CPU microbench: packSegmentPositions + polylineToSegments + computeLineDistances.
 *
 * Run after `./build.sh`:
 *   node js/vendor/line2/tests/pack-microbench.mjs
 *
 * No GPU. Prints ns/seg and MiB/s-style bandwidth for host packing only
 * (does not include queue.writeBuffer).
 *
 * Sizes match Cycle 2 Agent P1 brief: 100 / 1k / 8k / 50k
 * (plus suite midpoints 1500 / 2000 for P05/P04 cross-ref).
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LINE2_POS_FLOATS,
  computeLineDistances,
  packSegmentPositions,
  polylineToSegments,
} from "../../../../dist/vendor/line2/line-geometry.js";

/** Primary brief sizes + suite midpoints. */
const SIZES = [100, 1000, 1500, 2000, 8000, 50000];
/** Brief-only subset for the markdown summary table. */
const BRIEF_SIZES = new Set([100, 1000, 8000, 50000]);
const WARMUP = 50;
const ITERS = 400;
/** Fewer iters at 50k so wall time stays reasonable. */
const ITERS_LARGE = 80;
const LARGE_N = 20000;

function itersFor(n) {
  return n >= LARGE_N ? ITERS_LARGE : ITERS;
}

function makeSegments(n) {
  const out = new Float32Array(n * LINE2_POS_FLOATS);
  for (let i = 0; i < out.length; i++) out[i] = i * 0.001;
  return out;
}

/** Polyline with nSeg segments → nSeg+1 vertices. */
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
  const mibs = bytesPerCall / (1024 * 1024);
  const thr = mibs / (r.msPerCall / 1000); // MiB/s of packed output touched
  return { ...r, segs, bytesPerCall, nsPerSeg, thrMiBps: thr };
}

function printRow(m) {
  console.log(
    `  ${m.label.padEnd(36)} ${m.msPerCall.toFixed(4).padStart(10)} ms/call  ` +
      `${m.nsPerSeg.toFixed(1).padStart(8)} ns/seg  ~${m.thrMiBps.toFixed(0)} MiB/s` +
      `  (iters=${m.iters})`,
  );
}

/** Collect rows for markdown dump. */
const tableRows = [];

function record(kind, m) {
  tableRows.push({ kind, n: m.n, msPerCall: m.msPerCall, nsPerSeg: m.nsPerSeg, thrMiBps: m.thrMiBps });
}

console.log("Line2 pack microbench (pure CPU)\n");
console.log(
  `warmup=${WARMUP}  iters=${ITERS} (N≥${LARGE_N}: ${ITERS_LARGE})  sizes=${SIZES.join(",")}\n`,
);

console.log("packSegmentPositions (Float32Array alias — should be ~free):");
for (const n of SIZES) {
  const src = makeSegments(n);
  const r = bench(`alias N=${n}`, n, () => {
    const p = packSegmentPositions(src);
    if (p.length !== n * 6) throw new Error("len");
    // Touch one float so V8 cannot DCE the call entirely at large N.
    if (p[0] !== src[0]) throw new Error("alias");
  });
  const m = metrics(r, n, n * 6 * 4);
  printRow(m);
  record("pack alias (Float32Array)", m);
}

console.log("\npackSegmentPositions (number[] copy):");
for (const n of SIZES) {
  const src = Array.from(makeSegments(n));
  const r = bench(`copy N=${n}`, n, () => {
    const p = packSegmentPositions(src);
    if (p.length !== n * 6) throw new Error("len");
    if (p[0] !== src[0]) throw new Error("copy");
  });
  const m = metrics(r, n, n * 6 * 4);
  printRow(m);
  record("pack copy (number[])", m);
}

console.log("\npolylineToSegments (expand n verts → n-1 segs):");
for (const n of SIZES) {
  const poly = makePolyline(n);
  const r = bench(`polyline segs=${n}`, n, () => {
    const p = polylineToSegments(poly);
    if (p.length !== n * 6) throw new Error("len");
    if (p[0] !== poly[0]) throw new Error("poly");
  });
  const m = metrics(r, n, n * 6 * 4);
  printRow(m);
  record("polylineToSegments", m);
}

console.log("\ncomputeLineDistances (dash distances from packed segs):");
for (const n of SIZES) {
  const src = makeSegments(n);
  const r = bench(`distances N=${n}`, n, () => {
    const d = computeLineDistances(src);
    if (d.length !== n * 2) throw new Error("len");
    if (d[1] < 0) throw new Error("dist");
  });
  const m = metrics(r, n, n * 2 * 4); // 2 f32 per seg output
  printRow(m);
  record("computeLineDistances", m);
}

console.log("\nTheoretical GPU pos writeBuffer (not timed):");
console.log("  bytes = N × 6 × 4 = N × 24");
for (const n of SIZES) {
  const kb = (n * 24) / 1024;
  console.log(
    `  N=${String(n).padStart(5)}  ${kb.toFixed(2).padStart(8)} KB/frame if setPositions every frame`,
  );
}

console.log("\nTriangle / index counts (drawIndexed 18 × N):");
for (const n of SIZES) {
  console.log(
    `  N=${String(n).padStart(5)}  tris=${n * 6}  indices=${n * 18}  VS≈${n * 8}`,
  );
}

// ── Markdown table for VISUAL-REVIEW paste ─────────────────────────────────
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

console.log("\n── Markdown (brief sizes 100 / 1k / 8k / 50k) ──\n");
const kinds = [
  "pack alias (Float32Array)",
  "pack copy (number[])",
  "polylineToSegments",
  "computeLineDistances",
];
const briefNs = SIZES.filter((n) => BRIEF_SIZES.has(n));
const header =
  "| Path | " + briefNs.map((n) => `N=${n} ms`).join(" | ") + " | " + briefNs.map((n) => `N=${n} ns/seg`).join(" | ") + " |";
const sep =
  "|------|" + briefNs.map(() => "---------:").join("|") + "|" + briefNs.map(() => "-------------:").join("|") + "|";
console.log(header);
console.log(sep);
for (const kind of kinds) {
  const byN = new Map(tableRows.filter((r) => r.kind === kind).map((r) => [r.n, r]));
  const msCells = briefNs.map((n) => fmtMs(byN.get(n).msPerCall));
  const nsCells = briefNs.map((n) => fmtNs(byN.get(n).nsPerSeg));
  console.log(`| ${kind} | ${msCells.join(" | ")} | ${nsCells.join(" | ")} |`);
}

console.log("\n── Full size matrix (ms/call) ──\n");
console.log(
  "| Path | " + SIZES.map((n) => String(n)).join(" | ") + " |",
);
console.log("|------|" + SIZES.map(() => "------:").join("|") + "|");
for (const kind of kinds) {
  const byN = new Map(tableRows.filter((r) => r.kind === kind).map((r) => [r.n, r]));
  console.log(
    `| ${kind} | ${SIZES.map((n) => fmtMs(byN.get(n).msPerCall)).join(" | ")} |`,
  );
}

// Machine stamp for the review doc.
const meta = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  date: new Date().toISOString(),
  warmup: WARMUP,
  iters: ITERS,
  itersLarge: ITERS_LARGE,
};
console.log("\n── meta ──");
console.log(`node ${meta.node}`);
console.log(`platform ${meta.platform} ${meta.arch}`);
console.log(`date ${meta.date}`);

// Write JSON for review-doc automation (same dir as this script).
const outPath = join(dirname(fileURLToPath(import.meta.url)), "pack-microbench-results.json");
writeFileSync(
  outPath,
  JSON.stringify({ meta, rows: tableRows, sizes: SIZES, briefSizes: [...BRIEF_SIZES] }, null, 2) + "\n",
);
console.log(`\nwrote ${outPath}`);
