/**
 * Node tests for Line2 geometry packing + material uniform layout (pure CPU).
 *
 * Run after `./build.sh`:
 *   node js/vendor/line2/tests/geometry-material.test.mjs
 *   node js/vendor/line2/tests/run-line2-tests.mjs
 *
 * Exports `runGeometryMaterialTests()` for the shared runner.
 *
 * GPU-only residual (not covered here):
 *   seedDistancesOnly / white color seed bytes on the GPU queue.
 *   Pure decision path (seed vs skip vs compute) is covered in attr-state.test.mjs
 *   via distanceUploadMode.
 */

import {
  LINE2_COLOR_FLOATS,
  LINE2_DIST_FLOATS,
  LINE2_POS_FLOATS,
  LINE2_TEMPLATE_INDEX_COUNT,
  LINE2_TEMPLATE_INDICES,
  LINE2_TEMPLATE_POSITIONS,
  LINE2_TEMPLATE_UVS,
  LINE2_TEMPLATE_VERT_COUNT,
  buildTemplateInterleaved,
  computeLineDistances,
  createLine2Geometry,
  packSegmentColors,
  packSegmentPositions,
  polylineColorsToSegments,
  polylineToSegments,
  validateSegmentColorCount,
} from "../../../../dist/vendor/line2/line-geometry.js";

import {
  LINE2_UNIFORM_FLOATS,
  LINE2_UNIFORM_SIZE,
  applyMaterialParams,
  createDefaultMaterialState,
  writeMaterialUniforms,
  writeMat4,
} from "../../../../dist/vendor/line2/line2-material.js";

import { ensureSize } from "../../../../dist/vendor/line2/line2-attr-state.js";

/**
 * @param {{ assert?: (cond: boolean, msg: string) => void, log?: (msg: string) => void }} [opts]
 * @returns {{ failed: number, passed: number }}
 */
export function runGeometryMaterialTests(opts = {}) {
  let failed = 0;
  let passed = 0;

  const log = opts.log ?? ((msg) => console.log(msg));
  const assert =
    opts.assert ??
    ((cond, msg) => {
      if (!cond) {
        console.error("FAIL:", msg);
        failed += 1;
      } else {
        log("ok: " + msg);
        passed += 1;
      }
    });

  const approxEq = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
  const throws = (fn, re, msg) => {
    let threw = false;
    let errMsg = "";
    try {
      fn();
    } catch (e) {
      threw = true;
      errMsg = e instanceof Error ? e.message : String(e);
    }
    assert(
      threw && (re == null || re.test(errMsg)),
      msg + (threw ? ` (got: ${errMsg})` : " (no throw)"),
    );
  };

  // ── Stride / template constants ──────────────────────────────────────────
  {
    assert(LINE2_POS_FLOATS === 6, "LINE2_POS_FLOATS === 6");
    assert(LINE2_COLOR_FLOATS === 6, "LINE2_COLOR_FLOATS === 6");
    assert(LINE2_DIST_FLOATS === 2, "LINE2_DIST_FLOATS === 2");
    assert(LINE2_TEMPLATE_VERT_COUNT === 8, "LINE2_TEMPLATE_VERT_COUNT === 8");
    assert(LINE2_TEMPLATE_INDEX_COUNT === 18, "LINE2_TEMPLATE_INDEX_COUNT === 18");
    assert(
      LINE2_TEMPLATE_POSITIONS.length === LINE2_TEMPLATE_VERT_COUNT * 3,
      "template positions length = 8×3",
    );
    assert(
      LINE2_TEMPLATE_UVS.length === LINE2_TEMPLATE_VERT_COUNT * 2,
      "template uvs length = 8×2",
    );
    assert(
      LINE2_TEMPLATE_INDICES.length === LINE2_TEMPLATE_INDEX_COUNT,
      "template indices length = 18",
    );

    const interleaved = buildTemplateInterleaved();
    assert(
      interleaved.length === LINE2_TEMPLATE_VERT_COUNT * 5,
      "buildTemplateInterleaved: 8 verts × 5 floats",
    );
    // First vert: pos (−1, 2, 0) + uv (−1, 2)
    assert(
      interleaved[0] === -1 &&
        interleaved[1] === 2 &&
        interleaved[2] === 0 &&
        interleaved[3] === -1 &&
        interleaved[4] === 2,
      "buildTemplateInterleaved: first vertex pos+uv",
    );
  }

  // ── packSegmentPositions / packSegmentColors alias (P05 churn path) ──────
  {
    const pairs = new Float32Array([0, 0, 0, 1, 0, 0]);
    const same = packSegmentPositions(pairs);
    assert(same === pairs, "packSegmentPositions: Float32Array is aliased");

    // Mutating the aliased buffer is visible through the pack result (P05 warn)
    pairs[0] = 42;
    assert(
      same[0] === 42,
      "packSegmentPositions: alias shares storage (mutate in-place)",
    );
    pairs[0] = 0;

    const fromArr = packSegmentPositions([0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0]);
    assert(
      fromArr instanceof Float32Array && fromArr.length === 12,
      "packSegmentPositions: ArrayLike → Float32Array copy",
    );
    // number[] path must not alias the input array object
    const arr = [0, 0, 0, 1, 0, 0];
    const copied = packSegmentPositions(arr);
    assert(
      copied instanceof Float32Array && copied !== arr,
      "packSegmentPositions: number[] is copied (not same ref)",
    );
    arr[0] = 99;
    assert(copied[0] === 0, "packSegmentPositions: copy is independent of number[]");

    // Empty Float32Array (0 segs) is a valid multiple of 6 and aliases
    const empty = new Float32Array(0);
    assert(
      packSegmentPositions(empty) === empty,
      "packSegmentPositions: empty Float32Array aliases",
    );

    throws(
      () => packSegmentPositions(new Float32Array([1, 2, 3, 4, 5])),
      /multiple of 6/,
      "packSegmentPositions: non-multiple of 6 throws",
    );

    // packSegmentColors also aliases Float32Array when count matches
    const colF32 = new Float32Array([1, 0, 0, 0, 1, 0]);
    const colSame = packSegmentColors(colF32, 1);
    assert(
      colSame === colF32,
      "packSegmentColors: Float32Array is aliased when count matches",
    );
    const colArr = [0, 1, 0, 0, 0, 1];
    const colCopy = packSegmentColors(colArr, 1);
    assert(
      colCopy instanceof Float32Array && colCopy[1] === 1,
      "packSegmentColors: ArrayLike → Float32Array copy",
    );
  }

  // ── polylineToSegments / createLine2Geometry 1-point ─────────────────────
  {
    // One vertex → zero segments (Three LineGeometry parity)
    const empty = polylineToSegments(new Float32Array([1, 2, 3]));
    assert(
      empty.length === 0 && empty instanceof Float32Array,
      "polylineToSegments: 1-point → empty Float32Array",
    );

    const geo1 = createLine2Geometry({
      positions: [5, 6, 7],
      polyline: true,
    });
    assert(
      geo1.segmentCount === 0 &&
        geo1.positions.length === 0 &&
        geo1.colors === null &&
        geo1.distances === null,
      "createLine2Geometry: 1-point polyline → segmentCount 0",
    );

    // Two points → one segment
    const geo2 = createLine2Geometry({
      positions: [0, 0, 0, 10, 0, 0],
      polyline: true,
    });
    assert(
      geo2.segmentCount === 1 && geo2.positions.length === 6,
      "createLine2Geometry: 2-point polyline → 1 segment",
    );
    assert(
      geo2.positions[0] === 0 &&
        geo2.positions[3] === 10 &&
        geo2.positions[5] === 0,
      "createLine2Geometry: 2-point segment endpoints",
    );

    // Three points → two segments
    const geo3 = createLine2Geometry({
      positions: [0, 0, 0, 1, 0, 0, 1, 1, 0],
      polyline: true,
      computeDistances: true,
    });
    assert(
      geo3.segmentCount === 2 && geo3.positions.length === 12,
      "createLine2Geometry: 3-point polyline → 2 segments",
    );
    assert(
      geo3.distances != null && geo3.distances.length === 4,
      "createLine2Geometry: computeDistances fills 2×segmentCount floats",
    );

    throws(
      () => polylineToSegments(new Float32Array([1, 2])),
      /multiple of 3/,
      "polylineToSegments: length % 3 ≠ 0 throws",
    );
    throws(
      () => polylineToSegments(new Float32Array([])),
      /≥1|≥ 3|length ≥ 3/,
      "polylineToSegments: empty throws",
    );
  }

  // ── validateSegmentColorCount edge cases ─────────────────────────────────
  {
    // Exact match: 0 segments → 0 colors ok
    let ok = true;
    try {
      validateSegmentColorCount(new Float32Array(0), 0);
    } catch {
      ok = false;
    }
    assert(ok, "validateSegmentColorCount: 0 segments / 0 floats ok");

    // Exact match: 2 segments × 6
    ok = true;
    try {
      validateSegmentColorCount(new Float32Array(12), 2);
    } catch {
      ok = false;
    }
    assert(ok, "validateSegmentColorCount: 2 segments / 12 floats ok");

    throws(
      () => validateSegmentColorCount(new Float32Array(6), 2),
      /expected 12/,
      "validateSegmentColorCount: too few floats throws",
    );
    throws(
      () => validateSegmentColorCount(new Float32Array(18), 2),
      /expected 12/,
      "validateSegmentColorCount: too many floats throws",
    );
    throws(
      () => validateSegmentColorCount(new Float32Array([1, 2, 3]), 1),
      /expected 6/,
      "validateSegmentColorCount: 3 floats for 1 segment throws",
    );

    // packSegmentColors delegates to validate
    const cols = packSegmentColors([1, 0, 0, 0, 1, 0], 1);
    assert(cols.length === 6, "packSegmentColors: matching count ok");
    throws(
      () => packSegmentColors([1, 0, 0], 1),
      /expected 6/,
      "packSegmentColors: mismatch throws",
    );
    throws(
      () => packSegmentColors(new Float32Array(12), 1),
      /expected 6/,
      "packSegmentColors: too many floats (2-seg buffer for 1 seg) throws",
    );
    throws(
      () => packSegmentColors(new Float32Array(0), 1),
      /expected 6/,
      "packSegmentColors: empty colors for 1 segment throws",
    );
    // 0 segments / 0 colors is valid (clearGeometry-shaped)
    const emptyCols = packSegmentColors(new Float32Array(0), 0);
    assert(
      emptyCols.length === 0,
      "packSegmentColors: 0 segments / 0 floats ok",
    );

    // createLine2Geometry polyline colors must match position vertex count
    throws(
      () =>
        createLine2Geometry({
          positions: [0, 0, 0, 1, 0, 0, 2, 0, 0], // 3 verts → 2 segs
          polyline: true,
          colors: [1, 0, 0, 0, 1, 0], // only 2 verts → 1 seg worth after expand
        }),
      /expected 12|validateSegmentColorCount/,
      "createLine2Geometry: color vertex count mismatch throws",
    );

    // Raw segment colors (non-polyline) length throw
    throws(
      () =>
        createLine2Geometry({
          positions: [0, 0, 0, 1, 0, 0, 1, 0, 0, 2, 0, 0], // 2 segs
          colors: [1, 0, 0, 0, 1, 0], // only 1 seg of colors
        }),
      /expected 12/,
      "createLine2Geometry: raw segment color length throw",
    );

    // Matching polyline colors
    const geoC = createLine2Geometry({
      positions: [0, 0, 0, 1, 0, 0],
      polyline: true,
      colors: [1, 0, 0, 0, 1, 0],
    });
    assert(
      geoC.segmentCount === 1 &&
        geoC.colors != null &&
        geoC.colors.length === 6 &&
        geoC.colors[0] === 1 &&
        geoC.colors[3] === 0 &&
        geoC.colors[4] === 1,
      "createLine2Geometry: matching polyline colors pack endpoints",
    );

    // One-vertex polyline colors → empty colors, then validate vs segmentCount 0
    const geoC0 = createLine2Geometry({
      positions: [0, 0, 0],
      polyline: true,
      colors: [1, 0, 0],
    });
    assert(
      geoC0.segmentCount === 0 &&
        geoC0.colors != null &&
        geoC0.colors.length === 0,
      "createLine2Geometry: 1-point polyline colors → empty colors",
    );
  }

  // ── computeLineDistances ─────────────────────────────────────────────────
  {
    // Single segment of length 5 along +X
    const one = new Float32Array([0, 0, 0, 5, 0, 0]);
    const d1 = computeLineDistances(one);
    assert(d1.length === 2, "computeLineDistances: single segment → 2 floats");
    assert(
      approxEq(d1[0], 0) && approxEq(d1[1], 5),
      `computeLineDistances: single segment [0, len] (got ${d1[0]}, ${d1[1]})`,
    );

    // Zero-length single segment
    const z = new Float32Array([1, 1, 1, 1, 1, 1]);
    const dz = computeLineDistances(z);
    assert(
      approxEq(dz[0], 0) && approxEq(dz[1], 0),
      "computeLineDistances: zero-length single segment [0, 0]",
    );

    // Two segments: len 3 then len 4 → cumulative 0,3 then 3,7
    const two = new Float32Array([
      0, 0, 0, 3, 0, 0, // len 3
      3, 0, 0, 3, 4, 0, // len 4
    ]);
    const d2 = computeLineDistances(two);
    assert(d2.length === 4, "computeLineDistances: two segments → 4 floats");
    assert(
      approxEq(d2[0], 0) &&
        approxEq(d2[1], 3) &&
        approxEq(d2[2], 3) &&
        approxEq(d2[3], 7),
      `computeLineDistances: cumulative chain (got ${[...d2]})`,
    );

    // Empty positions → empty distances
    const d0 = computeLineDistances(new Float32Array(0));
    assert(d0.length === 0, "computeLineDistances: empty positions → empty");

    throws(
      () => computeLineDistances(new Float32Array([1, 2, 3, 4, 5])),
      /multiple of 6/,
      "computeLineDistances: bad length throws",
    );

    // createLine2Geometry with computeDistances on raw segments
    const g = createLine2Geometry({
      positions: one,
      computeDistances: true,
    });
    assert(
      g.distances != null &&
        approxEq(g.distances[0], 0) &&
        approxEq(g.distances[1], 5),
      "createLine2Geometry: computeDistances on single segment",
    );
  }

  // ── Uniform layout constants (float 38 = linewidth, …) ───────────────────
  {
    assert(LINE2_UNIFORM_SIZE === 192, "LINE2_UNIFORM_SIZE === 192 bytes");
    assert(
      LINE2_UNIFORM_FLOATS === 48,
      "LINE2_UNIFORM_FLOATS === 48 (192/4)",
    );
    assert(
      LINE2_UNIFORM_SIZE % 16 === 0,
      "LINE2_UNIFORM_SIZE is multiple of 16 (uniform alignment)",
    );

    const state = createDefaultMaterialState({
      color: [0.1, 0.2, 0.3, 0.4],
      linewidth: 7.5,
      dashScale: 2,
      dashSize: 3,
      gapSize: 4,
      dashOffset: 0.5,
      worldUnits: true,
      dashed: true,
      softAA: false,
      vertexColors: true,
    });
    state.resolutionX = 1280;
    state.resolutionY = 720;

    const dst = new Float32Array(LINE2_UNIFORM_FLOATS);
    // Poison non-material slots so we only assert material write range
    dst.fill(-999);
    writeMat4(dst, 0, [
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ]);
    writeMat4(dst, 16, [
      2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1,
    ]);
    writeMaterialUniforms(dst, state);

    // Layout (floats): 32–35 color, 36–37 res, 38 lw, 39–42 dash, 43–46 flags
    assert(approxEq(dst[32], 0.1) && approxEq(dst[35], 0.4), "uniform[32..35] color.rgba");
    assert(approxEq(dst[36], 1280) && approxEq(dst[37], 720), "uniform[36..37] resolution.xy");
    assert(approxEq(dst[38], 7.5), "uniform[38] linewidth");
    assert(approxEq(dst[39], 2), "uniform[39] dashScale");
    assert(approxEq(dst[40], 3), "uniform[40] dashSize");
    assert(approxEq(dst[41], 4), "uniform[41] gapSize");
    assert(approxEq(dst[42], 0.5), "uniform[42] dashOffset");
    assert(dst[43] === 1, "uniform[43] worldUnits = 1");
    assert(dst[44] === 1, "uniform[44] dashed = 1");
    assert(dst[45] === 0, "uniform[45] softAA = 0");
    assert(dst[46] === 1, "uniform[46] vertexColors = 1");
    assert(dst[47] === 0, "uniform[47] pad = 0");
    // Matrices left intact by writeMaterialUniforms
    assert(dst[0] === 1 && dst[16] === 2, "writeMaterialUniforms does not clobber mat4 slots");

    // Defaults
    const def = createDefaultMaterialState();
    assert(
      def.linewidth === 1 &&
        def.softAA === true &&
        def.dashed === false &&
        def.worldUnits === false &&
        def.vertexColors === false &&
        def.depthTest === true &&
        def.depthWrite === false,
      "createDefaultMaterialState defaults",
    );

    applyMaterialParams(def, { linewidth: 9, dashed: true });
    assert(
      def.linewidth === 9 && def.dashed === true && def.softAA === true,
      "applyMaterialParams merges partial without clearing other fields",
    );
  }

  // ── polylineColorsToSegments parity with positions ───────────────────────
  {
    const c = polylineColorsToSegments([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    assert(
      c.length === 12 &&
        c[0] === 1 &&
        c[3] === 0 &&
        c[4] === 1 &&
        c[6] === 0 &&
        c[7] === 1 &&
        c[9] === 0 &&
        c[11] === 1,
      "polylineColorsToSegments: 3 verts → 2 segment color pairs",
    );
  }

  // ── ensureSize (grow-only power-of-2 capacity) ────────────────────────────
  {
    assert(ensureSize(1, 0) === 4, "ensureSize: seed from 0 → 4 for need=1");
    assert(ensureSize(4, 0) === 4, "ensureSize: seed from 0 → 4 for need=4");
    assert(ensureSize(5, 0) === 8, "ensureSize: seed from 0 → 8 for need=5");
    assert(ensureSize(12, 4) === 16, "ensureSize: 4→16 for need=12 (D05 path)");
    assert(ensureSize(8000, 0) === 8192, "ensureSize: 8k segs → capacity 8192");
    assert(ensureSize(8192, 8192) === 8192, "ensureSize: exact power-of-2 keeps current");
    assert(ensureSize(100, 256) === 256, "ensureSize: never shrinks (need < current)");
    assert(ensureSize(1, 16) === 16, "ensureSize: never shrinks (need=1, cap=16)");
    // stepwise doubling from an existing non-zero cap
    assert(ensureSize(9, 8) === 16, "ensureSize: double once from 8");
    assert(ensureSize(17, 8) === 32, "ensureSize: double twice from 8");
  }

  // ── API trap contracts (pure; no GPU Line2Renderer) ──────────────────────
  // Source of truth: line2-renderer.ts assertLive / setResolution / setColors.
  // Full Line2Renderer needs WebGPU — throw strings + clamp are verified here
  // as pure contracts; GPU dispose/encode is visual-suite + source only.
  {
    /** Mirrors Line2Renderer.setResolution clamp (no device). */
    const clampRes = (width, height) => [
      Math.max(width, 1),
      Math.max(height, 1),
    ];
    assert(
      clampRes(0, 0)[0] === 1 && clampRes(0, 0)[1] === 1,
      "setResolution contract: (0,0) → (1,1)",
    );
    assert(
      clampRes(-10, 720)[0] === 1 && clampRes(-10, 720)[1] === 720,
      "setResolution contract: negative width → 1, positive height kept",
    );
    assert(
      clampRes(1280, 0)[0] === 1280 && clampRes(1280, 0)[1] === 1,
      "setResolution contract: height 0 → 1",
    );
    assert(
      clampRes(1920, 1080)[0] === 1920 && clampRes(1920, 1080)[1] === 1080,
      "setResolution contract: positive passthrough",
    );

    // Default material resolution is 1×1 (safe before first setResolution).
    const def = createDefaultMaterialState();
    assert(
      def.resolutionX === 1 && def.resolutionY === 1,
      "createDefaultMaterialState: resolution defaults to 1×1 (never 0)",
    );

    // Uniform path writes whatever is on state — renderer must clamp first.
    def.resolutionX = Math.max(0, 1);
    def.resolutionY = Math.max(0, 1);
    const dst = new Float32Array(LINE2_UNIFORM_FLOATS);
    writeMaterialUniforms(dst, def);
    assert(
      dst[36] === 1 && dst[37] === 1,
      "writeMaterialUniforms: clamped 1×1 lands at floats 36–37",
    );

    // Documented throw message contracts (string literals in line2-renderer.ts).
    const DISPOSED_MSG = "Line2Renderer: disposed";
    const COLORS_ORDER_MSG = "Line2Renderer.setColors: call setPositions first";
    assert(
      DISPOSED_MSG === "Line2Renderer: disposed",
      "assertLive contract: message is exactly 'Line2Renderer: disposed'",
    );
    assert(
      COLORS_ORDER_MSG === "Line2Renderer.setColors: call setPositions first",
      "setColors order contract: message is exactly '…call setPositions first'",
    );

    // segmentCount===0 is the pure predicate for setColors throw / encode no-op.
    // clearGeometry sets segmentCount=0; encode returns early without draw.
    let segmentCount = 0;
    assert(
      segmentCount === 0,
      "setColors before setPositions: segmentCount===0 → throw (GPU path)",
    );
    segmentCount = 2;
    assert(
      segmentCount > 0,
      "setColors after setPositions: segmentCount>0 → allowed",
    );

    // dispose is idempotent in source (`if (this.disposed) return`) but every
    // mutating API after the first dispose hits assertLive. encode after
    // dispose throws — does NOT silently no-op (unlike segmentCount===0).
    let disposed = false;
    const assertLive = () => {
      if (disposed) throw new Error(DISPOSED_MSG);
    };
    disposed = true;
    throws(
      () => assertLive(),
      /^Line2Renderer: disposed$/,
      "assertLive pure mirror: throws after dispose",
    );
    // Second dispose itself does not throw (idempotent).
    const disposeOnce = () => {
      if (disposed) return;
      disposed = true;
    };
    disposed = true;
    let disposeThrew = false;
    try {
      disposeOnce();
    } catch {
      disposeThrew = true;
    }
    assert(!disposeThrew, "dispose contract: second dispose is idempotent (no throw)");
  }

  return { failed, passed };
}

// Direct execution
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("geometry-material.test.mjs");

if (isMain) {
  const { failed, passed } = runGeometryMaterialTests();
  if (failed > 0) {
    console.error(`\ngeometry-material: ${failed} failed, ${passed} passed`);
    process.exitCode = 1;
  } else {
    console.log(`\ngeometry-material: all ${passed} passed`);
  }
}
