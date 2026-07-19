/**
 * Pure CPU state helpers for Line2Renderer geometry / attr flags.
 *
 * Extracted so Node unit tests can cover grow capacity, clearGeometry flag
 * reset, solid-distance skip, and setColors length guards without a GPU.
 * Behavior must stay locked to `line2-renderer.ts` call sites.
 */

import { LINE2_COLOR_FLOATS, LINE2_DIST_FLOATS } from "./line-geometry.js";

/** Live geometry attribute flags (CPU mirror of renderer private fields). */
export interface Line2GeometryAttrFlags {
  segmentCount: number;
  hasColors: boolean;
  hasDistances: boolean;
}

/**
 * Grow-only power-of-2 capacity (segments).
 * Empty → start at 4; never shrinks.
 * Used by `ensureInstanceBuffers` (also exported as `ensureSize`).
 */
export function growInstanceCapacity(needed: number, current: number): number {
  if (needed <= current) return current;
  let cap = current > 0 ? current : 4;
  while (cap < needed) cap *= 2;
  return cap;
}

/** Alias of {@link growInstanceCapacity} (historical name in renderer notes). */
export const ensureSize = growInstanceCapacity;

/**
 * `clearGeometry` flag contract: draw becomes a no-op; GPU buffers kept.
 * Resets segmentCount + color/distance validity (not VRAM capacity).
 */
export function clearGeometryFlags(state: Line2GeometryAttrFlags): void {
  state.segmentCount = 0;
  state.hasColors = false;
  state.hasDistances = false;
}

/**
 * Color buffer grow path: prior RGB upload is invalid (white seed on GPU).
 * Does **not** clear material.vertexColors — caller must re-`setColors`.
 */
export function invalidateColorsOnGrow(state: { hasColors: boolean }): void {
  state.hasColors = false;
}

/**
 * Distance upload decision for `setPositions` after packing segmentCount.
 *
 * - `compute` — dashed / computeDistances: write real distances
 * - `seed`    — solid first time: zero seed, mark hasDistances
 * - `skip`    — solid subsequent: hasDistances already true (P05 churn path)
 */
export function distanceUploadMode(
  hasDistances: boolean,
  wantDist: boolean,
  segmentCount: number,
): "compute" | "seed" | "skip" {
  if (wantDist && segmentCount > 0) return "compute";
  if (!hasDistances) return "seed";
  return "skip";
}

/** Expected color float count for `segmentCount` segments. */
export function expectedColorFloatCount(segmentCount: number): number {
  return segmentCount * LINE2_COLOR_FLOATS;
}

/** Expected distance float count for `segmentCount` segments. */
export function expectedDistanceFloatCount(segmentCount: number): number {
  return segmentCount * LINE2_DIST_FLOATS;
}

/**
 * Guard for `setColors` when no positions have been set (segmentCount === 0).
 * Matches `Line2Renderer.setColors` throw text.
 */
export function assertHasPositionsForColors(segmentCount: number): void {
  if (segmentCount === 0) {
    throw new Error("Line2Renderer.setColors: call setPositions first");
  }
}

/**
 * Guard packed color length against segmentCount (segment pairs or polyline expand).
 * Matches `Line2Renderer.setColors` length throw (after pack).
 */
export function assertPackedColorLength(
  packedLength: number,
  segmentCount: number,
  options?: { polyline?: boolean },
): void {
  const expected = expectedColorFloatCount(segmentCount);
  if (packedLength !== expected) {
    throw new Error(
      `Line2Renderer.setColors: expected ${expected} floats ` +
        `(${segmentCount} segments × ${LINE2_COLOR_FLOATS}), got ${packedLength}` +
        (options?.polyline
          ? " — polyline color vertex count must match setPositions"
          : ""),
    );
  }
}

/**
 * Guard distance float length against segmentCount.
 * Matches `Line2Renderer.setDistances` throw text.
 */
export function assertPackedDistanceLength(
  packedLength: number,
  segmentCount: number,
): void {
  const expected = expectedDistanceFloatCount(segmentCount);
  if (packedLength !== expected) {
    throw new Error(
      `Line2Renderer.setDistances: expected ${expected} floats`,
    );
  }
}
