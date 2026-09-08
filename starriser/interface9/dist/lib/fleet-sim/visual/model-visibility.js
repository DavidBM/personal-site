/** Conservative hull visibility. All planes and centers share the draw's local space. */
export const MODEL_FRUSTUM_PLANE_COUNT = 6;
export const MODEL_FRUSTUM_PLANE_FLOATS = MODEL_FRUSTUM_PLANE_COUNT * 4;
/** Covers f32 plane/center/dot rounding; scales with cancellation, not galaxy placement. */
export const MODEL_VISIBILITY_EPSILON = 2 ** -20;
/** Origin-centered, so the draw's normalized quaternion and mesh yaw preserve the bound. */
export function computeMeshOriginRadius(interleaved, strideFloats = 8) {
    if (!Number.isInteger(strideFloats) || strideFloats < 3)
        throw new RangeError("Mesh position stride must contain XYZ");
    if (interleaved.length % strideFloats !== 0)
        throw new RangeError("Incomplete mesh vertex");
    let radius = 0;
    for (let offset = 0; offset < interleaved.length; offset += strideFloats) {
        const distance = Math.hypot(interleaved[offset], interleaved[offset + 1], interleaved[offset + 2]);
        // Invalid mesh positions cannot provide a safe culling bound. Keep every candidate.
        if (!Number.isFinite(distance))
            return Infinity;
        radius = Math.max(radius, distance);
    }
    if (radius === 0)
        return 0;
    // Pad before the f32 upload, including positive values below the subnormal range.
    return Math.max(2 ** -149, Math.fround(radius * (1 + 2 ** -22)));
}
function hasFiniteMatrix(matrix) {
    for (let i = 0; i < 16; i++)
        if (!Number.isFinite(matrix[i]))
            return false;
    return true;
}
function writeNormalizedPlane(target, offset, x, y, z, w) {
    const length = Math.hypot(x, y, z);
    if (!(length > 0) || !Number.isFinite(length))
        return;
    const distance = Math.fround(w / length);
    if (!Number.isFinite(distance))
        return;
    target[offset] = x / length;
    target[offset + 1] = y / length;
    target[offset + 2] = z / length;
    target[offset + 3] = distance;
}
/**
 * Six inward unit planes: left/right/bottom/top/near/far. Column-major WebGPU
 * projection clips Z to [0,W], so the near plane is row 2, not row 3 + row 2.
 * Degenerate/invalid planes stay zero (disabled); never discard uncertain geometry.
 * Target offset is in floats. The target must not overlap the input matrix.
 */
export function writeModelFrustumPlanes(target, offset, viewProj) {
    if (!Number.isInteger(offset) || offset < 0 || offset + MODEL_FRUSTUM_PLANE_FLOATS > target.length) {
        throw new RangeError("Model frustum target must hold six vec4 planes");
    }
    target.fill(0, offset, offset + MODEL_FRUSTUM_PLANE_FLOATS);
    if (!hasFiniteMatrix(viewProj))
        return;
    const m = viewProj;
    writeNormalizedPlane(target, offset, m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]);
    writeNormalizedPlane(target, offset + 4, m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
    writeNormalizedPlane(target, offset + 8, m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]);
    writeNormalizedPlane(target, offset + 12, m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
    writeNormalizedPlane(target, offset + 16, m[2], m[6], m[10], m[14]);
    writeNormalizedPlane(target, offset + 20, m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);
}
function validSphere(x, y, z, radius, epsilon) {
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
        && Number.isFinite(radius) && radius >= 0 && Number.isFinite(epsilon) && epsilon >= 0;
}
function outsidePlane(planes, offset, x, y, z, radius, epsilon) {
    const dx = planes[offset] * x, dy = planes[offset + 1] * y, dz = planes[offset + 2] * z;
    const w = planes[offset + 3];
    const magnitude = Math.abs(dx) + Math.abs(dy) + Math.abs(dz) + Math.abs(w) + radius;
    const margin = epsilon * Math.max(1, magnitude);
    return dx + dy + dz + w < -radius - margin;
}
/** A separating plane rejects; tangency, intersection and uncertain inputs stay visible. */
export function isModelSphereVisible(planes, x, y, z, radius, epsilon = MODEL_VISIBILITY_EPSILON) {
    if (planes.length < MODEL_FRUSTUM_PLANE_FLOATS || !validSphere(x, y, z, radius, epsilon))
        return true;
    for (let offset = 0; offset < MODEL_FRUSTUM_PLANE_FLOATS; offset += 4) {
        if (outsidePlane(planes, offset, x, y, z, radius, epsilon))
            return false;
    }
    return true;
}
//# sourceMappingURL=model-visibility.js.map