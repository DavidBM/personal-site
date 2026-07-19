/**
 * CPU packing for fat-line segments — mirrors three.js
 * `LineSegmentsGeometry` / `LineGeometry` (no Three dependency).
 *
 * Instance layout (per segment, stride 6 floats):
 *   instanceStart.xyz | instanceEnd.xyz
 *
 * Optional colors (stride 6): colorStart.rgb | colorEnd.rgb
 * Optional distances (stride 2): distanceStart | distanceEnd
 *
 * Template mesh (shared for all instances): 8 verts + 18 indices forming a
 * ribbon with round-ish endcaps; `position.x` = side (±1), `position.y` =
 * along-line param (−1…2 for endcaps), `uv` drives fragment AA.
 */

import type { Line2GeometryData } from "./types.js";

/** Floats per segment position pair (start xyz + end xyz). */
export const LINE2_POS_FLOATS = 6;
/** Floats per segment color pair. */
export const LINE2_COLOR_FLOATS = 6;
/** Floats per segment distance pair. */
export const LINE2_DIST_FLOATS = 2;

/** Template vertex count (shared billboard ribbon). */
export const LINE2_TEMPLATE_VERT_COUNT = 8;
/** Indexed triangle count × 3. */
export const LINE2_TEMPLATE_INDEX_COUNT = 18;

/**
 * Three.js template positions (x = side, y = along-line, z unused).
 * y ∈ {2,1,0,−1} covers body + both endcap skirts.
 */
export const LINE2_TEMPLATE_POSITIONS = new Float32Array([
  -1, 2, 0, 1, 2, 0, -1, 1, 0, 1, 1, 0, -1, 0, 0, 1, 0, 0, -1, -1, 0, 1, -1, 0,
]);

/** UVs used by fragment endcap AA (`vUv.x` lateral, `vUv.y` along). */
export const LINE2_TEMPLATE_UVS = new Float32Array([
  -1, 2, 1, 2, -1, 1, 1, 1, -1, -1, 1, -1, -1, -2, 1, -2,
]);

/** Six triangles covering the ribbon. */
export const LINE2_TEMPLATE_INDICES = new Uint16Array([
  0, 2, 1, 2, 3, 1, 2, 4, 3, 4, 5, 3, 4, 6, 5, 6, 7, 5,
]);

/**
 * Interleaved template buffer: pos.xyz + uv.xy (5 floats, 20 bytes/vert).
 * Built once; uploaded as a static vertex buffer.
 */
export function buildTemplateInterleaved(): Float32Array {
  const out = new Float32Array(LINE2_TEMPLATE_VERT_COUNT * 5);
  for (let i = 0; i < LINE2_TEMPLATE_VERT_COUNT; i++) {
    const o = i * 5;
    const p = i * 3;
    const u = i * 2;
    out[o] = LINE2_TEMPLATE_POSITIONS[p]!;
    out[o + 1] = LINE2_TEMPLATE_POSITIONS[p + 1]!;
    out[o + 2] = LINE2_TEMPLATE_POSITIONS[p + 2]!;
    out[o + 3] = LINE2_TEMPLATE_UVS[u]!;
    out[o + 4] = LINE2_TEMPLATE_UVS[u + 1]!;
  }
  return out;
}

/**
 * Copy or wrap a flat segment list `[x0,y0,z0, x1,y1,z1, …]` (pairs).
 * Length must be a multiple of 6.
 */
export function packSegmentPositions(
  array: Float32Array | ArrayLike<number>,
): Float32Array {
  if (array instanceof Float32Array) {
    if (array.length % LINE2_POS_FLOATS !== 0) {
      throw new Error(
        `packSegmentPositions: length ${array.length} is not a multiple of 6`,
      );
    }
    return array;
  }
  const out = new Float32Array(array.length);
  out.set(array as ArrayLike<number>);
  if (out.length % LINE2_POS_FLOATS !== 0) {
    throw new Error(
      `packSegmentPositions: length ${out.length} is not a multiple of 6`,
    );
  }
  return out;
}

/**
 * Expand a packed polyline of triples (xyz or rgb) into start/end segment pairs.
 * Shared by positions and colors so topology stays identical.
 *
 * - length % 3 ≠ 0 → throw
 * - length < 3 → throw
 * - length === 3 (one vertex) → empty array (Three LineGeometry parity: no segments)
 * - length ≥ 6 → (n−1) segments × 6 floats
 */
function expandPolylineTriples(
  src: Float32Array,
  label: string,
  unit: string,
): Float32Array {
  if (src.length % 3 !== 0) {
    throw new Error(
      `${label}: length ${src.length} is not a multiple of 3 (${unit} per vertex)`,
    );
  }
  if (src.length < 3) {
    throw new Error(
      `${label}: need ≥1 ${unit} triple (length ≥ 3); got ${src.length} floats`,
    );
  }
  // One vertex → zero segments (Three parity; prefer empty over throw).
  if (src.length === 3) {
    return new Float32Array(0);
  }
  // length of the “start” span in floats: all but last vertex
  const length = src.length - 3;
  const points = new Float32Array(2 * length);
  for (let i = 0; i < length; i += 3) {
    points[2 * i] = src[i]!;
    points[2 * i + 1] = src[i + 1]!;
    points[2 * i + 2] = src[i + 2]!;
    points[2 * i + 3] = src[i + 3]!;
    points[2 * i + 4] = src[i + 4]!;
    points[2 * i + 5] = src[i + 5]!;
  }
  return points;
}

/**
 * Convert a polyline `[x0,y0,z0, x1,y1,z1, …]` into segment pairs
 * (Three `LineGeometry.setPositions`).
 */
export function polylineToSegments(
  polyline: Float32Array | ArrayLike<number>,
): Float32Array {
  const src =
    polyline instanceof Float32Array
      ? polyline
      : Float32Array.from(polyline as ArrayLike<number>);
  return expandPolylineTriples(src, "polylineToSegments", "xyz");
}

/**
 * Convert polyline RGB colors the same way as positions
 * (Three `LineGeometry.setColors`).
 */
export function polylineColorsToSegments(
  colors: Float32Array | ArrayLike<number>,
): Float32Array {
  const src =
    colors instanceof Float32Array
      ? colors
      : Float32Array.from(colors as ArrayLike<number>);
  return expandPolylineTriples(src, "polylineColorsToSegments", "rgb");
}

/**
 * Assert colors float length matches segmentCount × {@link LINE2_COLOR_FLOATS}.
 */
export function validateSegmentColorCount(
  colors: Float32Array | ArrayLike<number>,
  segmentCount: number,
): void {
  const len = colors.length;
  const expected = segmentCount * LINE2_COLOR_FLOATS;
  if (len !== expected) {
    throw new Error(
      `validateSegmentColorCount: expected ${expected} floats ` +
        `(${segmentCount} segments × ${LINE2_COLOR_FLOATS}), got ${len}`,
    );
  }
}

/**
 * Pack segment endpoint colors `[r0,g0,b0, r1,g1,b1, …]`.
 * Length must be a multiple of 6 and match segment count.
 */
export function packSegmentColors(
  array: Float32Array | ArrayLike<number>,
  segmentCount: number,
): Float32Array {
  const out =
    array instanceof Float32Array
      ? array
      : Float32Array.from(array as ArrayLike<number>);
  validateSegmentColorCount(out, segmentCount);
  return out;
}

/**
 * Cumulative line distances for dashing (Three `LineSegments2.computeLineDistances`).
 * Each segment stores (distanceAtStart, distanceAtEnd); segments chain so a
 * polyline’s pattern is continuous. For disconnected segments the chain still
 * advances (matches Three).
 */
export function computeLineDistances(positions: Float32Array): Float32Array {
  const segmentCount = positions.length / LINE2_POS_FLOATS;
  if (!Number.isInteger(segmentCount)) {
    throw new Error("computeLineDistances: positions length must be multiple of 6");
  }
  const lineDistances = new Float32Array(segmentCount * LINE2_DIST_FLOATS);
  for (let i = 0, j = 0; i < segmentCount; i++, j += 2) {
    const o = i * LINE2_POS_FLOATS;
    const dx = positions[o + 3]! - positions[o]!;
    const dy = positions[o + 4]! - positions[o + 1]!;
    const dz = positions[o + 5]! - positions[o + 2]!;
    const len = Math.hypot(dx, dy, dz);
    lineDistances[j] = j === 0 ? 0 : lineDistances[j - 1]!;
    lineDistances[j + 1] = lineDistances[j]! + len;
  }
  return lineDistances;
}

/**
 * Build a full geometry descriptor from segment pairs (or polyline via flag).
 */
export function createLine2Geometry(options: {
  /** Segment pairs (xyz xyz) or polyline if `polyline` is true. */
  positions: Float32Array | ArrayLike<number>;
  /** When true, treat positions as a polyline chain. Default false. */
  polyline?: boolean;
  /** Optional endpoint colors (same topology as positions). */
  colors?: Float32Array | ArrayLike<number> | null;
  /** When true, compute dash distances. Default false. */
  computeDistances?: boolean;
}): Line2GeometryData {
  const positions = options.polyline
    ? polylineToSegments(options.positions)
    : packSegmentPositions(options.positions);
  const segmentCount = positions.length / LINE2_POS_FLOATS;

  let colors: Float32Array | null = null;
  if (options.colors) {
    colors = options.polyline
      ? polylineColorsToSegments(options.colors)
      : packSegmentColors(options.colors, segmentCount);
    // Polyline expand can succeed with a different vertex count than positions.
    validateSegmentColorCount(colors, segmentCount);
  }

  const distances = options.computeDistances
    ? computeLineDistances(positions)
    : null;

  return { segmentCount, positions, colors, distances };
}
