/**
 * Line2 visual case definitions: geometry + material + camera mode.
 *
 * kind: "good" | "residual" | "degen" | "perf" | "integration"
 */

/** @typedef {"good"|"residual"|"degen"|"perf"|"integration"} CaseKind */

/**
 * @typedef {object} VisualCase
 * @property {string} id
 * @property {string} title
 * @property {string} hint
 * @property {CaseKind} kind
 * @property {object} material
 * @property {"ortho"|"perspective"|"nearClip"|"extremeFov"|"worldNear"|"dolly"|"orbit"} camera
 * @property {(t: number) => { positions: Float32Array, polyline?: boolean, colors?: Float32Array, colorsPolyline?: boolean, computeDistances?: boolean, churn?: boolean }} build
 * @property {boolean} [depth]
 * @property {boolean} [animateGeometry]
 */

function segs(...pairs) {
  // pairs: [x0,y0,z0, x1,y1,z1, ...]
  return new Float32Array(pairs.flat());
}

function polyline(points) {
  return new Float32Array(points.flat());
}

function circlePoly(cx, cy, cz, r, n, plane = "xz") {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    if (plane === "xz") pts.push([cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r]);
    else pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz]);
  }
  return polyline(pts);
}

function zigZag(n, span = 8, amp = 2) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    pts.push([(u - 0.5) * span, 0, ((i % 2) * 2 - 1) * amp * 0.5]);
  }
  return polyline(pts);
}

function manyDiagonals(count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.push(-c * 4, 0, -s * 4, c * 4, 0, s * 4);
  }
  return new Float32Array(out);
}

function randomSegments(count, seed = 1) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s & 0xffff) / 0xffff;
  };
  const out = new Float32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const o = i * 6;
    const x = (rnd() - 0.5) * 10;
    const z = (rnd() - 0.5) * 10;
    const dx = (rnd() - 0.5) * 1.2;
    const dz = (rnd() - 0.5) * 1.2;
    out[o] = x;
    out[o + 1] = 0;
    out[o + 2] = z;
    out[o + 3] = x + dx;
    out[o + 4] = 0;
    out[o + 5] = z + dz;
  }
  return out;
}

function gradientColorsForSegments(segmentCount) {
  const out = new Float32Array(segmentCount * 6);
  for (let i = 0; i < segmentCount; i++) {
    const t = segmentCount <= 1 ? 0 : i / (segmentCount - 1);
    const o = i * 6;
    out[o] = 1;
    out[o + 1] = t;
    out[o + 2] = 0.1;
    out[o + 3] = 0.1;
    out[o + 4] = 0.4;
    out[o + 5] = 1;
  }
  return out;
}

/** @type {VisualCase[]} */
export const ALL_CASES = [
  // ── Happy path ──────────────────────────────────────────────────────────
  {
    id: "H01",
    title: "Axis-aligned H/V",
    hint: "Width constancy + round endcaps",
    kind: "good",
    material: { color: [0.3, 0.85, 1, 1], linewidth: 4, softAA: true },
    camera: "ortho",
    build: () => ({
      positions: segs(
        [-4, 0, 0, 4, 0, 0],
        [0, 0, -4, 0, 0, 4],
        [-3, 0, -3, 3, 0, -3],
        [-3, 0, 3, 3, 0, 3],
      ),
    }),
  },
  {
    id: "H02",
    title: "Many diagonals",
    hint: "No angle-dependent thickness bias",
    kind: "good",
    material: { color: [1, 0.75, 0.2, 1], linewidth: 3, softAA: true },
    camera: "ortho",
    build: () => ({ positions: manyDiagonals(16) }),
  },
  {
    id: "H03",
    title: "Zig-zag polyline",
    hint: "Segment joins (no true miters)",
    kind: "good",
    material: { color: [0.6, 1, 0.4, 1], linewidth: 5, softAA: true },
    camera: "ortho",
    build: () => ({ positions: zigZag(24), polyline: true }),
  },
  {
    id: "H04",
    title: "Circle ring",
    hint: "Dense polyline loop continuity",
    kind: "good",
    material: { color: [1, 0.4, 0.7, 1], linewidth: 3, softAA: true },
    camera: "ortho",
    build: () => ({ positions: circlePoly(0, 0, 0, 4, 64), polyline: true }),
  },
  {
    id: "H05",
    title: "Thickness ladder",
    hint: "1…12 px steps via 12 multi-draw encodes (one linewidth per pass — cost tradeoff vs single draw)",
    kind: "good",
    multiWidth: true,
    material: { color: [0.9, 0.9, 1, 1], linewidth: 2, softAA: true },
    camera: "ortho",
    build: () => {
      const arr = [];
      for (let i = 0; i < 12; i++) {
        const z = -5 + i * 0.9;
        arr.push(-5, 0, z, 5, 0, z);
      }
      return { positions: new Float32Array(arr) };
    },
  },
  {
    id: "H06a",
    title: "softAA ON",
    hint: "Soft endcaps; long edges via MSAA",
    kind: "good",
    material: { color: [0.2, 1, 0.5, 1], linewidth: 10, softAA: true },
    camera: "ortho",
    build: () => ({
      positions: segs([-4, 0, -2, 4, 0, 2], [-4, 0, 2, 4, 0, -2]),
    }),
  },
  {
    id: "H06b",
    title: "softAA OFF",
    hint: "Hard endcaps; long edges still MSAA",
    kind: "good",
    material: { color: [0.2, 1, 0.5, 1], linewidth: 10, softAA: false },
    camera: "ortho",
    build: () => ({
      positions: segs([-4, 0, -2, 4, 0, 2], [-4, 0, 2, 4, 0, -2]),
    }),
  },
  {
    id: "H07",
    title: "Dashed polyline",
    hint: "dashSize/gap along distance",
    kind: "good",
    material: {
      color: [1, 0.9, 0.2, 1],
      linewidth: 4,
      softAA: true,
      dashed: true,
      dashSize: 0.8,
      gapSize: 0.4,
      dashScale: 1,
    },
    camera: "ortho",
    build: () => ({
      positions: zigZag(20, 9, 3),
      polyline: true,
      computeDistances: true,
    }),
  },
  {
    id: "H08",
    title: "Vertex colors",
    hint: "Endpoint RGB lerp",
    kind: "good",
    material: { color: [1, 1, 1, 1], linewidth: 6, softAA: true, vertexColors: true },
    camera: "ortho",
    build: () => {
      const positions = segs(
        [-5, 0, -3, 5, 0, -3],
        [-5, 0, 0, 5, 0, 0],
        [-5, 0, 3, 5, 0, 3],
      );
      return {
        positions,
        colors: gradientColorsForSegments(3),
      };
    },
  },
  {
    id: "H09",
    title: "Opacity overlaps",
    hint: "Alpha blend stacking",
    kind: "good",
    material: { color: [1, 0.3, 0.3, 0.45], linewidth: 14, softAA: true },
    camera: "ortho",
    build: () => ({
      positions: segs(
        [-5, 0, 0, 5, 0, 0],
        [0, 0, -5, 0, 0, 5],
        [-4, 0, -4, 4, 0, 4],
        [-4, 0, 4, 4, 0, -4],
      ),
    }),
  },
  {
    id: "H10",
    title: "Ortho top-down",
    hint: "Galaxy map-style camera",
    kind: "good",
    material: { color: [0.4, 0.7, 1, 1], linewidth: 3, softAA: true, worldUnits: false },
    camera: "ortho",
    build: () => ({
      positions: polyline([
        [-4, 0, -3],
        [-1, 0, 2],
        [2, 0, -1],
        [4, 0, 3],
      ]),
      polyline: true,
    }),
  },
  {
    id: "H11",
    title: "Perspective",
    hint: "Thickness under perspective",
    kind: "good",
    material: { color: [0.9, 0.5, 1, 1], linewidth: 4, softAA: true },
    camera: "perspective",
    build: () => ({
      positions: segs(
        [-3, 0, -2, 3, 0, -2],
        [-3, 1, 0, 3, 1, 0],
        [-3, 0, 2, 3, 0, 2],
        [-2, -1, -3, -2, 2, 3],
      ),
    }),
  },
  {
    id: "H12",
    title: "Dolly zoom (screen px)",
    hint: "Width should stay ~constant in px",
    kind: "good",
    material: { color: [0.3, 1, 0.8, 1], linewidth: 5, softAA: true, worldUnits: false },
    camera: "dolly",
    animateGeometry: false,
    build: () => ({
      positions: segs([-4, 0, 0, 4, 0, 0], [0, 0, -4, 0, 0, 4]),
    }),
  },

  // ── Residual / accepted ─────────────────────────────────────────────────
  // Human eval: leave animate ON. Expected failure modes documented in VISUAL-REVIEW.md.
  // Captions spell the tradeoff (not just FAIL/PASS) so kind=residual is self-documenting.
  {
    id: "R01",
    title: "Near clip.w≈0",
    hint: "TRADEOFF screen-space: thickness spike / ribbon thrash as clip.w→near (offset·w + ndc/w) — avoid grazing near plane",
    kind: "residual",
    material: { color: [1, 0.2, 0.2, 1], linewidth: 5, softAA: true, worldUnits: false },
    camera: "nearClip",
    build: () => ({
      // X cross + Z arm that reaches toward typical nearClip eye (+Z) so one
      // endpoint spends time with clip.w ≈ near (tiny).
      positions: segs(
        [-2.5, 0, 0, 2.5, 0, 0],
        [0, 0, -1.2, 0, 0, 0.05],
        [-1.2, 0, 0.02, 1.2, 0, 0.02],
      ),
    }),
  },
  {
    id: "R02",
    title: "Extreme FOV",
    hint: "TRADEOFF NDC dir (ndcEnd−ndcStart) under ~165° FOV: warped / uneven width + orientation jitter at edges",
    kind: "residual",
    material: { color: [1, 0.5, 0.1, 1], linewidth: 3, softAA: true, worldUnits: false },
    camera: "extremeFov",
    build: () => ({
      positions: segs(
        [-2, 0, -2, 2, 0, 2],
        [-2, 0, 2, 2, 0, -2],
        [-3, 0, 0, 3, 0, 0],
        [0, 0, -3, 0, 0, 3],
      ),
    }),
  },
  {
    id: "R03",
    title: "worldUnits near eye",
    hint: "TRADEOFF worldUnits: holes / alpha freckles / endcap pop when eye≈line (FS normalize(worldPos) + closestLine)",
    kind: "residual",
    material: {
      color: [1, 0.3, 0.8, 1],
      linewidth: 0.12,
      worldUnits: true,
      softAA: true,
    },
    camera: "worldNear",
    build: () => ({
      // Through-origin segs + short arm so expanded ribbon can skim view origin
      positions: segs(
        [-1, 0, 0, 1, 0, 0],
        [0, 0, -1, 0, 0, 1],
        [-0.3, 0, -0.3, 0.3, 0, 0.3],
      ),
    }),
  },
  {
    id: "R04",
    title: "worldUnits + dolly",
    hint: "TRADEOFF worldUnits+dolly: thickness grows on zoom-in / shrinks on zoom-out (~10×) — accept only if you want world-true width",
    kind: "residual",
    material: {
      color: [0.2, 0.8, 1, 1],
      linewidth: 0.25,
      worldUnits: true,
      softAA: true,
    },
    camera: "dolly",
    build: () => ({
      positions: segs([-4, 0, 0, 4, 0, 0], [0, 0, -4, 0, 0, 4]),
    }),
  },
  {
    id: "R05",
    title: "Screen-space (recommended)",
    hint: "TRADEOFF vs R04: same dolly, worldUnits=false → constant ~4px — prefer for map overlays (H12 twin)",
    kind: "residual",
    material: {
      color: [0.3, 1, 0.4, 1],
      linewidth: 4,
      worldUnits: false,
      softAA: true,
    },
    camera: "dolly",
    build: () => ({
      positions: segs([-4, 0, 0, 4, 0, 0], [0, 0, -4, 0, 0, 4]),
    }),
  },

  // ── Degenerate ──────────────────────────────────────────────────────────
  {
    id: "D01",
    title: "Zero-length segment",
    hint: "No NaN fullscreen trash",
    kind: "degen",
    material: { color: [1, 1, 0.2, 1], linewidth: 6, softAA: true },
    camera: "ortho",
    build: () => ({
      positions: segs([0, 0, 0, 0, 0, 0], [-3, 0, 0, 3, 0, 0]),
    }),
  },
  {
    id: "D02",
    title: "Tiny segments",
    hint: "Endcap-dominated ribbons",
    kind: "degen",
    material: { color: [1, 0.6, 0.2, 1], linewidth: 8, softAA: true },
    camera: "ortho",
    build: () => ({
      positions: segs(
        [0, 0, 0, 0.02, 0, 0],
        [1, 0, 0, 1.01, 0, 0.01],
        [-1, 0, 1, -1.005, 0, 1.005],
      ),
    }),
  },
  {
    id: "D03",
    title: "Collinear + reverse",
    hint: "No black holes",
    kind: "degen",
    material: { color: [0.7, 0.9, 1, 1], linewidth: 4, softAA: true },
    camera: "ortho",
    build: () => ({
      positions: segs(
        [-4, 0, 0, 0, 0, 0],
        [0, 0, 0, 4, 0, 0],
        [4, 0, 0, -4, 0, 0],
        [0, 0, -3, 0, 0, 3],
      ),
    }),
  },
  {
    id: "D04",
    title: "1px single segment",
    hint: "Minimum visibility",
    kind: "degen",
    material: { color: [1, 1, 1, 1], linewidth: 1, softAA: true },
    camera: "ortho",
    build: () => ({ positions: segs([-3, 0, 0, 3, 0, 0]) }),
  },
  {
    id: "D05",
    title: "Vertex color after grow",
    hint: "Re-setColors after larger setPositions",
    kind: "degen",
    material: { color: [1, 1, 1, 1], linewidth: 5, softAA: true, vertexColors: true },
    camera: "ortho",
    animateGeometry: true,
    build: (t) => {
      // Alternate segment counts to force buffer grow / shrink path.
      const big = Math.floor(t * 0.5) % 2 === 0;
      if (big) {
        const positions = manyDiagonals(12);
        return { positions, colors: gradientColorsForSegments(12) };
      }
      const positions = segs([-3, 0, 0, 3, 0, 0]);
      return {
        positions,
        colors: new Float32Array([1, 0, 0, 0, 1, 0]),
      };
    },
  },

  // ── Performance ─────────────────────────────────────────────────────────
  {
    id: "P01",
    title: "100 segments",
    hint: "Should stay ~60 FPS",
    kind: "perf",
    material: { color: [0.5, 0.8, 1, 1], linewidth: 2, softAA: true },
    camera: "orbit",
    build: () => ({ positions: randomSegments(100, 42) }),
  },
  {
    id: "P02",
    title: "1k segments",
    hint: "Watch FPS HUD",
    kind: "perf",
    material: { color: [0.5, 1, 0.6, 1], linewidth: 2, softAA: true },
    camera: "orbit",
    build: () => ({ positions: randomSegments(1000, 7) }),
  },
  {
    id: "P03",
    title: "8k segments",
    hint: "When Line2 is the wrong tool (dense blob)",
    kind: "perf",
    material: { color: [1, 0.5, 0.4, 1], linewidth: 1.5, softAA: false },
    camera: "orbit",
    build: () => ({ positions: randomSegments(8000, 99) }),
  },
  {
    id: "P04",
    title: "Static + orbit",
    hint: "Draw cost only (no upload)",
    kind: "perf",
    material: { color: [0.8, 0.8, 1, 1], linewidth: 2, softAA: true },
    camera: "orbit",
    animateGeometry: false,
    build: () => ({ positions: randomSegments(2000, 3) }),
  },
  {
    id: "P05",
    title: "Per-frame churn",
    hint: "setPositions every frame",
    kind: "perf",
    material: { color: [1, 0.8, 0.3, 1], linewidth: 2, softAA: true },
    camera: "orbit",
    animateGeometry: true,
    build: (t) => {
      // Rotate noise seed-ish by rebuilding with phase offset
      const positions = randomSegments(1500, 11);
      const phase = t * 2;
      for (let i = 0; i < positions.length; i += 3) {
        positions[i] += Math.sin(phase + i * 0.01) * 0.15;
        positions[i + 2] += Math.cos(phase + i * 0.01) * 0.15;
      }
      return { positions, churn: true };
    },
  },

  // ── Integration ─────────────────────────────────────────────────────────
  {
    id: "I01",
    title: "Galaxy color-only pipeline",
    hint: "depthFormat:null in 2nd color-only pass (prod map shape)",
    kind: "integration",
    // True Galaxy path: pipeline has no depthStencil. Drawn in a separate
    // color-only pass (main.mjs) — cannot share a depth-bearing pass.
    depthFormatNull: true,
    material: { color: [0.4, 0.9, 1, 1], linewidth: 4, softAA: true },
    camera: "ortho",
    depth: false,
    build: () => ({
      positions: segs([-4, 0, -2, 4, 0, 2], [-4, 0, 2, 4, 0, -2]),
    }),
  },
  {
    id: "I02",
    title: "Depth occluder",
    hint: "depth24plus; line behind box fades",
    kind: "integration",
    material: {
      color: [1, 0.4, 0.2, 1],
      linewidth: 5,
      softAA: true,
      depthTest: true,
      depthWrite: false,
    },
    camera: "perspective",
    depth: true,
    build: () => ({
      // Line through origin; main draws a depth box in front for half the view
      positions: segs([-5, 0, 0, 5, 0, 0], [0, -2, 0, 0, 2, 0]),
    }),
  },
];

export function filterCases(all, filterText) {
  if (!filterText || !filterText.trim()) return all;
  const q = filterText.trim().toLowerCase();
  return all.filter(
    (c) =>
      c.id.toLowerCase().includes(q) ||
      c.title.toLowerCase().includes(q) ||
      c.kind.toLowerCase().includes(q) ||
      c.hint.toLowerCase().includes(q),
  );
}
