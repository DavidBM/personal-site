/**
 * Node tests for pure Line2 attr / capacity / clearGeometry flag helpers.
 *
 * Covers deterministic contracts the visual suite relies on (D05 grow,
 * P05 solid distance skip, setColors guards) without a GPU.
 *
 * Run after `./build.sh`:
 *   node js/vendor/line2/tests/attr-state.test.mjs
 *   node js/vendor/line2/tests/run-line2-tests.mjs
 *
 * Exports `runAttrStateTests()` for the shared runner.
 */

import {
  assertHasPositionsForColors,
  assertPackedColorLength,
  assertPackedDistanceLength,
  clearGeometryFlags,
  distanceUploadMode,
  ensureSize,
  expectedColorFloatCount,
  expectedDistanceFloatCount,
  growInstanceCapacity,
  invalidateColorsOnGrow,
} from "../../../../dist/vendor/line2/line2-attr-state.js";

/**
 * @param {{ assert?: (cond: boolean, msg: string) => void, log?: (msg: string) => void }} [opts]
 * @returns {{ failed: number, passed: number }}
 */
export function runAttrStateTests(opts = {}) {
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

  // ── growInstanceCapacity / ensureSize (D05 / P04–P05 ladder) ────────────
  {
    assert(
      growInstanceCapacity(1, 0) === 4,
      "growInstanceCapacity: empty current → seed 4 for need 1",
    );
    assert(
      growInstanceCapacity(5, 0) === 8,
      "growInstanceCapacity: empty → double 4→8 for need 5",
    );
    assert(
      growInstanceCapacity(12, 4) === 16,
      "growInstanceCapacity: D05 first grow 4→16 for 12 segs",
    );
    assert(
      growInstanceCapacity(1500, 0) === 2048,
      "growInstanceCapacity: P05 first upload ladder → 2048",
    );
    assert(
      growInstanceCapacity(2000, 0) === 2048,
      "growInstanceCapacity: P04 first upload ladder → 2048",
    );
    assert(
      growInstanceCapacity(1500, 2048) === 2048,
      "growInstanceCapacity: never shrinks when needed ≤ current",
    );
    assert(
      growInstanceCapacity(1, 16) === 16,
      "growInstanceCapacity: shrink path (1 after 12) keeps capacity",
    );
    // ensureSize is the renderer re-export alias
    assert(
      ensureSize === growInstanceCapacity ||
        (ensureSize(12, 4) === 16 && ensureSize(1, 0) === 4),
      "ensureSize re-export matches growInstanceCapacity behavior",
    );
  }

  // ── clearGeometry flags ──────────────────────────────────────────────────
  {
    const state = {
      segmentCount: 12,
      hasColors: true,
      hasDistances: true,
    };
    clearGeometryFlags(state);
    assert(
      state.segmentCount === 0 &&
        state.hasColors === false &&
        state.hasDistances === false,
      "clearGeometryFlags: zeros segmentCount + clears hasColors/hasDistances",
    );

    // Idempotent
    clearGeometryFlags(state);
    assert(
      state.segmentCount === 0 &&
        !state.hasColors &&
        !state.hasDistances,
      "clearGeometryFlags: idempotent on already-cleared state",
    );

    // After clear, setColors must throw (encode is no-op via segmentCount 0)
    throws(
      () => assertHasPositionsForColors(state.segmentCount),
      /setPositions first/,
      "clearGeometry → setColors guard throws (call setPositions first)",
    );
  }

  // ── invalidateColorsOnGrow (D05 grow path) ───────────────────────────────
  {
    const s = { hasColors: true };
    invalidateColorsOnGrow(s);
    assert(s.hasColors === false, "invalidateColorsOnGrow: clears hasColors");
    invalidateColorsOnGrow(s);
    assert(s.hasColors === false, "invalidateColorsOnGrow: stays false");
  }

  // ── distanceUploadMode (P05 solid skip) ──────────────────────────────────
  {
    assert(
      distanceUploadMode(false, false, 1500) === "seed",
      "distanceUploadMode: solid first frame → seed",
    );
    assert(
      distanceUploadMode(true, false, 1500) === "skip",
      "distanceUploadMode: solid subsequent (hasDistances) → skip (P05)",
    );
    assert(
      distanceUploadMode(false, true, 10) === "compute",
      "distanceUploadMode: dashed/wantDist → compute",
    );
    assert(
      distanceUploadMode(true, true, 10) === "compute",
      "distanceUploadMode: wantDist wins over hasDistances → compute",
    );
    assert(
      distanceUploadMode(false, true, 0) === "seed",
      "distanceUploadMode: wantDist but segmentCount 0 → seed (not compute)",
    );
    assert(
      distanceUploadMode(true, true, 0) === "skip",
      "distanceUploadMode: wantDist + 0 segs + hasDistances → skip",
    );
  }

  // ── color / distance length throws (setColors / setDistances contracts) ─
  {
    assert(
      expectedColorFloatCount(2) === 12,
      "expectedColorFloatCount: 2 segs → 12 floats",
    );
    assert(
      expectedDistanceFloatCount(3) === 6,
      "expectedDistanceFloatCount: 3 segs → 6 floats",
    );

    throws(
      () => assertHasPositionsForColors(0),
      /setPositions first/,
      "assertHasPositionsForColors: segmentCount 0 throws",
    );
    // segmentCount > 0 is ok
    let ok = true;
    try {
      assertHasPositionsForColors(1);
    } catch {
      ok = false;
    }
    assert(ok, "assertHasPositionsForColors: segmentCount 1 ok");

    // Exact match ok
    ok = true;
    try {
      assertPackedColorLength(6, 1);
      assertPackedColorLength(12, 2);
    } catch {
      ok = false;
    }
    assert(ok, "assertPackedColorLength: exact match ok");

    throws(
      () => assertPackedColorLength(3, 1),
      /expected 6/,
      "assertPackedColorLength: too few floats throws",
    );
    throws(
      () => assertPackedColorLength(18, 2),
      /expected 12/,
      "assertPackedColorLength: too many floats throws",
    );
    throws(
      () => assertPackedColorLength(6, 2, { polyline: true }),
      /polyline color vertex count must match/,
      "assertPackedColorLength: polyline mismatch adds hint",
    );

    throws(
      () => assertPackedDistanceLength(3, 2),
      /expected 4 floats/,
      "assertPackedDistanceLength: mismatch throws",
    );
    ok = true;
    try {
      assertPackedDistanceLength(4, 2);
    } catch {
      ok = false;
    }
    assert(ok, "assertPackedDistanceLength: exact match ok");
  }

  // ── Lifecycle story: set → clear → re-set flags ──────────────────────────
  {
    const flags = {
      segmentCount: 0,
      hasColors: false,
      hasDistances: false,
    };
    // Simulate setPositions solid first
    flags.segmentCount = 8;
    const mode1 = distanceUploadMode(
      flags.hasDistances,
      false,
      flags.segmentCount,
    );
    assert(mode1 === "seed", "lifecycle: first solid setPositions → seed");
    flags.hasDistances = true; // seedDistancesOnly
    flags.hasColors = true; // after setColors

    // Churn solid (P05)
    assert(
      distanceUploadMode(flags.hasDistances, false, flags.segmentCount) ===
        "skip",
      "lifecycle: solid churn skips dist re-upload",
    );

    // Grow invalidates colors only
    invalidateColorsOnGrow(flags);
    assert(
      flags.hasColors === false && flags.hasDistances === true,
      "lifecycle: grow clears colors only, keeps hasDistances",
    );

    clearGeometryFlags(flags);
    assert(
      flags.segmentCount === 0 &&
        !flags.hasColors &&
        !flags.hasDistances,
      "lifecycle: clearGeometry resets all attr flags",
    );
  }

  return { failed, passed };
}

// Direct execution
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("attr-state.test.mjs");

if (isMain) {
  const { failed, passed } = runAttrStateTests();
  if (failed > 0) {
    console.error(`\nattr-state: ${failed} failed, ${passed} passed`);
    process.exitCode = 1;
  } else {
    console.log(`\nattr-state: all ${passed} passed`);
  }
}
