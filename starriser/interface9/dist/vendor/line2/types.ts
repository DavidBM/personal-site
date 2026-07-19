/**
 * Public types for the Three.js-free fat Line2 library.
 * Algorithm ported from three.js LineMaterial / LineSegmentsGeometry (MIT).
 */

/** Column-major 4×4 matrix (length 16), matching Galaxy `Mat4` / WGSL mat4x4. */
export type Mat4Like = Float32Array | number[];

/** RGBA color; alpha is opacity when used as material color. */
export type Rgba = readonly [number, number, number, number];

/** RGB only (vertex colors match Three instanceColorStart/End). */
export type Rgb = readonly [number, number, number];

/**
 * Material knobs mirroring three.js `LineMaterial` / `Line2NodeMaterial`.
 * `linewidth` is CSS pixels when `worldUnits` is false, else world units.
 */
export interface Line2MaterialParams {
  /** Diffuse RGB + opacity in A. Default white opaque. */
  color?: Rgba | Float32Array | number[];
  /** Line thickness. Default 1. */
  linewidth?: number;
  /** When true, `linewidth` is in world units (camera-space). Default false. */
  worldUnits?: boolean;
  /** Enable dashed rendering (needs distance attributes). Default false. */
  dashed?: boolean;
  /** Multiplier on cumulative distance for dash pattern. Default 1. */
  dashScale?: number;
  /** Dash length along the distance attribute. Default 1. */
  dashSize?: number;
  /** Gap length along the distance attribute. Default 1. */
  gapSize?: number;
  /** Phase offset into the dash cycle. Default 0. */
  dashOffset?: number;
  /**
   * Soft **endcap** AA via `fwidth` + smoothstep (three.js LineMaterial parity).
   * Long edges stay geometric — use pipeline `sampleCount > 1` +
   * `alphaToCoverage` for smooth sides (do not expand ribbons / UV skirts).
   * World-units: softens analytic half-width silhouette when true. Default true.
   */
  softAA?: boolean;
  /** Multiply fragment color by per-endpoint instance colors. Default false. */
  vertexColors?: boolean;
  /** Depth test. Default true. */
  depthTest?: boolean;
  /** Depth write. Default false (transparent lines). */
  depthWrite?: boolean;
}

/** Options when constructing {@link Line2Renderer}. */
export interface Line2RendererOptions {
  /** Swap-chain / color target format. */
  format: GPUTextureFormat;
  /** Sample count for the render target (1 = no MSAA). Default 1. */
  sampleCount?: number;
  /**
   * When true and sampleCount > 1, enables pipeline `alphaToCoverage`.
   * Complements material `softAA`. Default false.
   */
  alphaToCoverage?: boolean;
  /** Initial material params. */
  material?: Line2MaterialParams;
  /**
   * Depth attachment format. Default `null` — no `depthStencil` state
   * (Galaxy color-only overlay passes). Pass `"depth24plus"` (or similar)
   * when the render pass includes a depth attachment.
   */
  depthFormat?: GPUTextureFormat | null;
}

/**
 * CPU-side segment geometry descriptor.
 * Positions are packed as consecutive start/end xyz pairs: `[x0,y0,z0, x1,y1,z1, ...]`.
 */
export interface Line2GeometryData {
  /** Segment count (positions.length / 6). */
  segmentCount: number;
  /** Interleaved instance start/end positions (6 floats per segment). */
  positions: Float32Array;
  /** Optional start/end RGB (6 floats per segment). */
  colors: Float32Array | null;
  /** Optional cumulative distances dStart/dEnd (2 floats per segment). */
  distances: Float32Array | null;
}

/** Camera matrices for expansion (must stay separate; viewProj alone is not enough). */
export interface Line2CameraUniforms {
  /**
   * Model-view matrix (column-major).
   * For world-space geometry with no model transform, pass the view matrix.
   */
  modelView: Mat4Like;
  /** Projection matrix (column-major). */
  projection: Mat4Like;
}
