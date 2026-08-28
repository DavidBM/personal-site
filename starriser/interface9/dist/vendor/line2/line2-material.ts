/**
 * Line2 material defaults and uniform packing.
 * Uniform layout must stay in lockstep with `line2-wgsl.ts`.
 */

import type { Line2MaterialParams, Rgba } from "./types.js";

/**
 * Bytes of the GPU uniform buffer (multiple of 16).
 * 192 was packed full (endcaps at float 47); origin.xyz occupies the next
 * 16-byte slot so topology Line2 can stay absolute on the GPU.
 */
export const LINE2_UNIFORM_SIZE = 208;
/** Float count in the uniform staging array. */
export const LINE2_UNIFORM_FLOATS = LINE2_UNIFORM_SIZE / 4;
/** Float offset of `origin.xyz` (byte 192). Pad float 51 unused. */
export const LINE2_UNIFORM_ORIGIN_FLOAT = 48;

const DEFAULT_COLOR: Rgba = [1, 1, 1, 1];

export interface Line2MaterialState {
  color: Float32Array; // rgba
  linewidth: number;
  worldUnits: boolean;
  dashed: boolean;
  dashScale: number;
  dashSize: number;
  gapSize: number;
  dashOffset: number;
  softAA: boolean;
  /** Round endcap skirts + FS disc. Default true; galaxy topology sets false. */
  endcaps: boolean;
  vertexColors: boolean;
  depthTest: boolean;
  depthWrite: boolean;
  resolutionX: number;
  resolutionY: number;
}

export function createDefaultMaterialState(
  params?: Line2MaterialParams,
): Line2MaterialState {
  const color = new Float32Array(4);
  color.set(params?.color ?? DEFAULT_COLOR);
  return {
    color,
    linewidth: params?.linewidth ?? 1,
    worldUnits: params?.worldUnits ?? false,
    dashed: params?.dashed ?? false,
    dashScale: params?.dashScale ?? 1,
    dashSize: params?.dashSize ?? 1,
    gapSize: params?.gapSize ?? 1,
    dashOffset: params?.dashOffset ?? 0,
    softAA: params?.softAA ?? true,
    endcaps: params?.endcaps ?? true,
    vertexColors: params?.vertexColors ?? false,
    depthTest: params?.depthTest ?? true,
    depthWrite: params?.depthWrite ?? false,
    resolutionX: 1,
    resolutionY: 1,
  };
}

/** Merge partial params into an existing state (mutates). */
export function applyMaterialParams(
  state: Line2MaterialState,
  params: Line2MaterialParams,
): void {
  if (params.color !== undefined) state.color.set(params.color);
  if (params.linewidth !== undefined) state.linewidth = params.linewidth;
  if (params.worldUnits !== undefined) state.worldUnits = params.worldUnits;
  if (params.dashed !== undefined) state.dashed = params.dashed;
  if (params.dashScale !== undefined) state.dashScale = params.dashScale;
  if (params.dashSize !== undefined) state.dashSize = params.dashSize;
  if (params.gapSize !== undefined) state.gapSize = params.gapSize;
  if (params.dashOffset !== undefined) state.dashOffset = params.dashOffset;
  if (params.softAA !== undefined) state.softAA = params.softAA;
  if (params.endcaps !== undefined) state.endcaps = params.endcaps;
  if (params.vertexColors !== undefined) state.vertexColors = params.vertexColors;
  if (params.depthTest !== undefined) state.depthTest = params.depthTest;
  if (params.depthWrite !== undefined) state.depthWrite = params.depthWrite;
}

/**
 * Write material + resolution fields into the uniform staging buffer.
 * Matrices are written separately by the renderer each frame.
 *
 * Layout (offsets in floats):
 *   0–15  modelView mat4
 *  16–31  projection mat4
 *  32–35  color.rgba
 *  36–37  resolution.xy
 *  38     linewidth
 *  39     dashScale
 *  40     dashSize
 *  41     gapSize
 *  42     dashOffset
 *  43     worldUnits (0|1)
 *  44     dashed (0|1)
 *  45     softAA (0|1)
 *  46     vertexColors (0|1)
 *  47     endcaps (0|1) — was pad; body-only when 0
 *  48–50  origin.xyz (VS subtract; GPU instance pos stay absolute)
 *  51     pad
 */
export function writeMaterialUniforms(
  dst: Float32Array,
  state: Line2MaterialState,
): void {
  dst[32] = state.color[0]!;
  dst[33] = state.color[1]!;
  dst[34] = state.color[2]!;
  dst[35] = state.color[3]!;
  dst[36] = state.resolutionX;
  dst[37] = state.resolutionY;
  dst[38] = state.linewidth;
  dst[39] = state.dashScale;
  dst[40] = state.dashSize;
  dst[41] = state.gapSize;
  dst[42] = state.dashOffset;
  dst[43] = state.worldUnits ? 1 : 0;
  dst[44] = state.dashed ? 1 : 0;
  dst[45] = state.softAA ? 1 : 0;
  dst[46] = state.vertexColors ? 1 : 0;
  dst[47] = state.endcaps ? 1 : 0;
}

/**
 * Write floating origin into the uniform staging buffer (floats 48–50).
 * Does not touch material or matrix slots.
 */
export function writeOriginUniforms(
  dst: Float32Array,
  x: number,
  y: number,
  z: number,
): void {
  dst[LINE2_UNIFORM_ORIGIN_FLOAT] = x;
  dst[LINE2_UNIFORM_ORIGIN_FLOAT + 1] = y;
  dst[LINE2_UNIFORM_ORIGIN_FLOAT + 2] = z;
  dst[LINE2_UNIFORM_ORIGIN_FLOAT + 3] = 0;
}

/** Copy a column-major mat4 into `dst` at float offset `base`. */
export function writeMat4(dst: Float32Array, base: number, m: ArrayLike<number>): void {
  for (let i = 0; i < 16; i++) dst[base + i] = m[i]!;
}
