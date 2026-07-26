/**
 * CPU reference for Line2 screen-space (non-worldUnits) vertex expansion.
 *
 * Pure TS port of the VS screen-space branch in `line2-wgsl.ts` for **one
 * corner of one segment**. Used by Node unit tests — no GPU, no Three.
 *
 * Math must stay ε-aligned with the WGSL path (and classic three.js
 * LineMaterial screen-space expansion).
 */

import type { Mat4Like } from "./types.js";

/** Clip-space position (xyzw). */
export interface ClipVec4 {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** World / model-space endpoint (xyz). */
export type Vec3Like =
  | readonly [number, number, number]
  | { readonly x: number; readonly y: number; readonly z: number };

/** Inputs for one expanded ribbon corner (screen-space thickness). */
export interface Line2ExpandScreenParams {
  /** Segment start in model / world space (same space as GPU instanceStart). */
  start: Vec3Like;
  /** Segment end in model / world space. */
  end: Vec3Like;
  /** Column-major model-view matrix (length 16). */
  modelView: Mat4Like;
  /** Column-major projection matrix (length 16). */
  projection: Mat4Like;
  /** Viewport resolution in CSS/buffer pixels `[width, height]`. */
  resolution: readonly [number, number] | { readonly x: number; readonly y: number };
  /** Line thickness in CSS / buffer pixels. */
  linewidth: number;
  /**
   * Template ribbon `position.x` = side (±1).
   * Negative → flip lateral offset (matches WGSL `position.x < 0`).
   */
  positionX: number;
  /**
   * Template ribbon `position.y` = along-line param (−1…2).
   * `< 0.5` selects start clip; `> 1` / `< 0` extend endcaps along dir when
   * {@link endcaps} is true.
   */
  positionY: number;
  /**
   * When false, no along-dir endcap push (body-only ribbon). Default true
   * (Line2 / three.js pill). Matches material `endcaps` uniform.
   */
  endcaps?: boolean;
}

function xyz(v: Vec3Like): [number, number, number] {
  if (Array.isArray(v)) return [v[0]!, v[1]!, v[2]!];
  const o = v as { x: number; y: number; z: number };
  return [o.x, o.y, o.z];
}

function resXY(
  r: readonly [number, number] | { readonly x: number; readonly y: number },
): [number, number] {
  if (Array.isArray(r)) return [r[0]!, r[1]!];
  const o = r as { x: number; y: number };
  return [o.x, o.y];
}

/** Column-major mat4 × vec4 → [x,y,z,w]. */
export function mat4MulVec4(
  m: Mat4Like,
  x: number,
  y: number,
  z: number,
  w: number,
): [number, number, number, number] {
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]! * w,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]! * w,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]! * w,
    m[3]! * x + m[7]! * y + m[11]! * z + m[15]! * w,
  ];
}

function mix3(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  t: number,
): [number, number, number] {
  return [ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t];
}

/**
 * Conservative near-plane estimate from projection (supports reverse-Z).
 * Matches WGSL `trimSegmentAlpha` nearEstimate.
 */
export function nearPlaneEstimate(projection: Mat4Like): number {
  // projection[col][row] column-major: [2][2]=m[10], [3][2]=m[14]
  const a = projection[10]!;
  const b = projection[14]!;
  if (a > 0) {
    return -b / (a + 1);
  }
  return (-0.5 * b) / a;
}

/**
 * Alpha along start→end where the segment hits the near plane.
 * Matches WGSL `trimSegmentAlpha(start, end_)`.
 */
export function trimSegmentAlpha(
  startZ: number,
  endZ: number,
  projection: Mat4Like,
): number {
  const nearEstimate = nearPlaneEstimate(projection);
  return (nearEstimate - startZ) / (endZ - startZ);
}

/**
 * Expand one ribbon corner in screen-space mode (`worldUnits = false`).
 *
 * Returns clip.xyzw — the same quantity written to `@builtin(position)`.
 */
export function expandLine2CornerScreenSpace(
  params: Line2ExpandScreenParams,
): ClipVec4 {
  const [sx, sy, sz] = xyz(params.start);
  const [ex, ey, ez] = xyz(params.end);
  const [resX, resY] = resXY(params.resolution);
  const aspect = resX / resY;
  const posX = params.positionX;
  const posY = params.positionY;
  const mv = params.modelView;
  const proj = params.projection;
  const linewidth = params.linewidth;

  // Camera / view space
  let start = mat4MulVec4(mv, sx, sy, sz, 1);
  let end_ = mat4MulVec4(mv, ex, ey, ez, 1);

  // Perspective segments that cross the camera plane must be trimmed so NDC math is valid.
  // projection[2][3] = m[11]; classic perspective has m[11] ≈ -1 → |m[11]+1| < 1e-5
  const perspective = Math.abs(proj[11]! + 1) < 1e-5;
  if (perspective) {
    if (start[2]! < 0 && end_[2]! >= 0) {
      const alpha = trimSegmentAlpha(start[2]!, end_[2]!, proj);
      const m = mix3(
        start[0]!,
        start[1]!,
        start[2]!,
        end_[0]!,
        end_[1]!,
        end_[2]!,
        alpha,
      );
      end_ = [m[0], m[1], m[2], end_[3]!];
    } else if (end_[2]! < 0 && start[2]! >= 0) {
      const alpha = trimSegmentAlpha(end_[2]!, start[2]!, proj);
      const m = mix3(
        end_[0]!,
        end_[1]!,
        end_[2]!,
        start[0]!,
        start[1]!,
        start[2]!,
        alpha,
      );
      start = [m[0], m[1], m[2], start[3]!];
    }
  }

  const clipStart = mat4MulVec4(proj, start[0]!, start[1]!, start[2]!, start[3]!);
  const clipEnd = mat4MulVec4(proj, end_[0]!, end_[1]!, end_[2]!, end_[3]!);
  const ndcStartX = clipStart[0]! / clipStart[3]!;
  const ndcStartY = clipStart[1]! / clipStart[3]!;
  const ndcEndX = clipEnd[0]! / clipEnd[3]!;
  const ndcEndY = clipEnd[1]! / clipEnd[3]!;

  let dirX = ndcEndX - ndcStartX;
  let dirY = ndcEndY - ndcStartY;
  dirX = dirX * aspect;
  const dirLen = Math.hypot(dirX, dirY);
  // Degenerate (zero-length) segments: arbitrary horizontal offset
  if (dirLen > 1e-8) {
    dirX /= dirLen;
    dirY /= dirLen;
  } else {
    dirX = 1;
    dirY = 0;
  }

  // Screen-space expansion (pixel linewidth) — matches line2-wgsl.ts else branch
  let offsetX = dirY;
  let offsetY = -dirX;
  dirX = dirX / aspect;
  offsetX = offsetX / aspect;

  if (posX < 0) {
    offsetX = -offsetX;
    offsetY = -offsetY;
  }

  // Endcaps (along-dir push) — skipped when endcaps: false
  const useEndcaps = params.endcaps !== false;
  if (useEndcaps) {
    if (posY < 0) {
      offsetX = offsetX - dirX;
      offsetY = offsetY - dirY;
    } else if (posY > 1) {
      offsetX = offsetX + dirX;
      offsetY = offsetY + dirY;
    }
  }

  offsetX = offsetX * linewidth;
  offsetY = offsetY * linewidth;
  // clip → screen using resolution.y (Three classic LineMaterial)
  offsetX = offsetX / resY;
  offsetY = offsetY / resY;

  const clip =
    posY < 0.5
      ? ([clipStart[0]!, clipStart[1]!, clipStart[2]!, clipStart[3]!] as const)
      : ([clipEnd[0]!, clipEnd[1]!, clipEnd[2]!, clipEnd[3]!] as const);

  const w = clip[3];
  offsetX = offsetX * w;
  offsetY = offsetY * w;

  return {
    x: clip[0] + offsetX,
    y: clip[1] + offsetY,
    z: clip[2],
    w,
  };
}

/** Identity 4×4 (column-major), convenient for unit tests. */
export function mat4Identity16(out: Float32Array = new Float32Array(16)): Float32Array {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

/**
 * Simple RH orthographic projection (column-major), clip range z ∈ [−1, 1].
 * Useful for screen-space expand tests without a full camera stack.
 */
export function mat4Ortho16(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
  out: Float32Array = new Float32Array(16),
): Float32Array {
  const lr = 1 / (left - right);
  const bt = 1 / (bottom - top);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = -2 * lr;
  out[5] = -2 * bt;
  out[10] = 2 * nf;
  out[12] = (left + right) * lr;
  out[13] = (top + bottom) * bt;
  out[14] = (far + near) * nf;
  out[15] = 1;
  return out;
}
