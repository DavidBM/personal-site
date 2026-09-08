/** Conservative emitter bounds in the same local numeric space as trail expansion. */
import { MODEL_VISIBILITY_EPSILON, writeModelFrustumPlanes } from "./model-visibility.js";
export const TRAIL_VISIBILITY_UNIFORM_BYTES = 128;
export const TRAIL_VISIBILITY_EPSILON = MODEL_VISIBILITY_EPSILON;
const UNIFORM_FLOATS = TRAIL_VISIBILITY_UNIFORM_BYTES / 4;
function finiteValues(values, count) {
    for (let i = 0; i < count; i++)
        if (!Number.isFinite(values[i]))
            return false;
    return true;
}
/** Full screen pixels become view-space half-width per unit of endpoint depth. */
export function computeTrailScreenWidthCoefficient(fullWidthPx, resolutionH, projectionP11) {
    const width = Math.fround(fullWidthPx), resolution = Math.fround(resolutionH), projection = Math.fround(projectionP11);
    if (!Number.isFinite(width) || !Number.isFinite(resolution) || !Number.isFinite(projection))
        return NaN;
    // Match the draw's f32 inputs and clamps. There is no additional factor 1/2:
    // converting full pixel width to NDC half-width already divides by resY.
    const coefficient = (Math.max(width, 0) / Math.max(resolution, 1)) / Math.max(Math.abs(projection), Math.fround(1e-5));
    if (coefficient === 0)
        return 0;
    // Cover division/reassociation and f32 upload, including subnormal widths.
    return Math.max(2 ** -149, Math.fround(coefficient * (1 + 2 ** -22)));
}
/**
 * Six normalized frustum planes, view-Z camera plane, width, enabled, width mode,
 * one zero pad. Mode 0 stores world half-width; mode 1 stores a screen coefficient.
 * Matrices and expanded bounds share the draw's local origin and rigid view.
 * Input matrices must not overlap target; target may alias the integrate UBO tail.
 * Invalid inputs disable rejection. The view plane detects legacy near-trim
 * extrapolation, which can extend a camera-crossing segment beyond its endpoints.
 */
export function writeTrailVisibilityUniform(target, viewProj, view, maxWorldHalfWidth, enabled, screenCoefficient) {
    if (target.length < UNIFORM_FLOATS)
        throw new RangeError("Trail visibility target must hold 32 floats");
    target.fill(0, 0, UNIFORM_FLOATS);
    if (!enabled || !finiteValues(viewProj, 16) || !finiteValues(view, 16))
        return;
    const width = screenCoefficient === undefined ? maxWorldHalfWidth : screenCoefficient;
    if (!Number.isFinite(width) || width < 0)
        return;
    writeModelFrustumPlanes(target, 0, viewProj);
    target[24] = view[2];
    target[25] = view[6];
    target[26] = view[10];
    target[27] = view[14];
    target[28] = width;
    target[30] = screenCoefficient === undefined ? 0 : 1;
    if (finiteValues(target, 29))
        target[29] = 1;
    else
        target.fill(0, 0, UNIFORM_FLOATS);
}
function readBounds(minX, minY, minZ, maxX, maxY, maxZ) {
    if (!finiteValues([minX, minY, minZ, maxX, maxY, maxZ], 6))
        return null;
    if (minX > maxX || minY > maxY || minZ > maxZ)
        return null;
    const x = (minX + maxX) * 0.5, y = (minY + maxY) * 0.5, z = (minZ + maxZ) * 0.5;
    const ex = (maxX - minX) * 0.5, ey = (maxY - minY) * 0.5, ez = (maxZ - minZ) * 0.5;
    return finiteValues([x, y, z, ex, ey, ez], 6) ? { x, y, z, ex, ey, ez } : null;
}
function planeBounds(uniform, offset, bounds, width) {
    const nx = uniform[offset], ny = uniform[offset + 1], nz = uniform[offset + 2], w = uniform[offset + 3];
    const dx = nx * bounds.x, dy = ny * bounds.y, dz = nz * bounds.z;
    const radius = Math.abs(nx) * bounds.ex + Math.abs(ny) * bounds.ey + Math.abs(nz) * bounds.ez + width;
    const margin = TRAIL_VISIBILITY_EPSILON * Math.max(1, Math.abs(dx) + Math.abs(dy) + Math.abs(dz) + Math.abs(w) + radius);
    return { distance: dx + dy + dz + w, radius, margin };
}
function crossesCameraPlane(uniform, bounds, halfWidth) {
    const normalLength = Math.hypot(uniform[24], uniform[25], uniform[26]);
    const plane = planeBounds(uniform, 24, bounds, halfWidth * normalLength);
    return Math.abs(plane.distance) <= plane.radius + plane.margin;
}
function boundsHalfWidth(uniform, bounds) {
    if (uniform[30] === 0)
        return uniform[28];
    const depth = planeBounds(uniform, 24, bounds, 0);
    // The affine view-Z extremum bounds every original endpoint. Its dot-product
    // margin also covers cancellation before a depth-dependent width is expanded.
    const maxDepth = Math.abs(depth.distance) + depth.radius + depth.margin;
    return uniform[28] * maxDepth;
}
function validUniform(uniform) {
    if (uniform.length < UNIFORM_FLOATS || !finiteValues(uniform, 31))
        return false;
    return uniform[29] === 1 && uniform[28] >= 0 && (uniform[30] === 0 || uniform[30] === 1);
}
/**
 * Reference for the GPU whole-emitter gate. Bounds contain every live expanded
 * endpoint, including its rotated emitter offset. Half-width covers every quad
 * corner because the production ribbon uses a unit view-facing side axis.
 * Simulation, trail history and model ownership never depend on this result.
 */
export function isTrailBoundsVisible(uniform, minX, minY, minZ, maxX, maxY, maxZ) {
    if (!validUniform(uniform))
        return true;
    const bounds = readBounds(minX, minY, minZ, maxX, maxY, maxZ);
    if (!bounds)
        return true;
    const halfWidth = boundsHalfWidth(uniform, bounds);
    if (!Number.isFinite(halfWidth))
        return true;
    if (crossesCameraPlane(uniform, bounds, halfWidth))
        return true;
    for (let offset = 0; offset < 24; offset += 4) {
        const plane = planeBounds(uniform, offset, bounds, halfWidth);
        if (plane.distance < -plane.radius - plane.margin)
            return false;
    }
    return true;
}
//# sourceMappingURL=trail-visibility.js.map