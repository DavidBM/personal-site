/**
 * Three.js-free fat Line2 for raw WebGPU.
 *
 * Algorithm ported from three.js Line2 / LineSegments2 / LineMaterial (MIT).
 * See README.md for usage and feature parity.
 */
export { LINE2_COLOR_FLOATS, LINE2_DIST_FLOATS, LINE2_POS_FLOATS, LINE2_TEMPLATE_INDEX_COUNT, LINE2_TEMPLATE_INDICES, LINE2_TEMPLATE_POSITIONS, LINE2_TEMPLATE_UVS, LINE2_TEMPLATE_VERT_COUNT, buildTemplateInterleaved, computeLineDistances, createLine2Geometry, packSegmentColors, packSegmentPositions, polylineColorsToSegments, polylineToSegments, validateSegmentColorCount, } from "./line-geometry.js";
export { LINE2_UNIFORM_FLOATS, LINE2_UNIFORM_ORIGIN_FLOAT, LINE2_UNIFORM_SIZE, applyMaterialParams, createDefaultMaterialState, writeMaterialUniforms, writeMat4, writeOriginUniforms, } from "./line2-material.js";
export { LINE2_WGSL } from "./line2-wgsl.js";
export { expandLine2CornerScreenSpace, mat4Identity16, mat4MulVec4, mat4Ortho16, nearPlaneEstimate, trimSegmentAlpha, } from "./line2-expand-ref.js";
export { LINE2_BLEND, createLine2Pipeline, line2VertexBufferLayouts, } from "./line2-pipeline.js";
export { Line2Renderer } from "./line2-renderer.js";
export { assertHasPositionsForColors, assertPackedColorLength, assertPackedDistanceLength, clearGeometryFlags, distanceUploadMode, ensureSize, expectedColorFloatCount, expectedDistanceFloatCount, growInstanceCapacity, invalidateColorsOnGrow, } from "./line2-attr-state.js";
//# sourceMappingURL=index.js.map