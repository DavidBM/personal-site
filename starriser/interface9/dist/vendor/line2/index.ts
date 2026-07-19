/**
 * Three.js-free fat Line2 for raw WebGPU.
 *
 * Algorithm ported from three.js Line2 / LineSegments2 / LineMaterial (MIT).
 * See README.md for usage and feature parity.
 */

export type {
  Line2CameraUniforms,
  Line2GeometryData,
  Line2MaterialParams,
  Line2RendererOptions,
  Mat4Like,
  Rgba,
  Rgb,
} from "./types.js";

export {
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
} from "./line-geometry.js";

export {
  LINE2_UNIFORM_FLOATS,
  LINE2_UNIFORM_SIZE,
  applyMaterialParams,
  createDefaultMaterialState,
  writeMaterialUniforms,
  writeMat4,
  type Line2MaterialState,
} from "./line2-material.js";

export { LINE2_WGSL } from "./line2-wgsl.js";

export {
  expandLine2CornerScreenSpace,
  mat4Identity16,
  mat4MulVec4,
  mat4Ortho16,
  nearPlaneEstimate,
  trimSegmentAlpha,
  type ClipVec4,
  type Line2ExpandScreenParams,
  type Vec3Like,
} from "./line2-expand-ref.js";

export {
  LINE2_BLEND,
  createLine2Pipeline,
  line2VertexBufferLayouts,
  type Line2PipelineBundle,
  type Line2PipelineOptions,
} from "./line2-pipeline.js";

export { Line2Renderer } from "./line2-renderer.js";

export {
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
  type Line2GeometryAttrFlags,
} from "./line2-attr-state.js";
