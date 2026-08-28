/**
 * Minimal column-major mat4 helpers for WebGPU (no Three).
 * Layout matches WebGPU / WGSL `mat4x4<f32>` (column-major).
 */
export function mat4Identity(out = new Float32Array(16)) {
    out.fill(0);
    out[0] = out[5] = out[10] = out[15] = 1;
    return out;
}
export function mat4Perspective(out, fovyRad, aspect, near, far) {
    const f = 1 / Math.tan(fovyRad / 2);
    out.fill(0);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = far / (near - far);
    out[11] = -1;
    out[14] = (far * near) / (near - far);
    return out;
}
/**
 * Camera axes for a RH Y-up look-at (same basis as {@link mat4LookAt}).
 * `z` is camera back (eye − center); `x` right; `y` camera-up.
 *
 * Pure top-down: |back · worldUp| ≈ 1 → world-up becomes −Z so the
 * right-axis cross product stays finite (map “north” along −Z).
 */
export function lookAtAxes(eyeX, eyeY, eyeZ, centerX, centerY, centerZ, upX = 0, upY = 1, upZ = 0) {
    let zx = eyeX - centerX;
    let zy = eyeY - centerY;
    let zz = eyeZ - centerZ;
    let len = Math.hypot(zx, zy, zz) || 1;
    zx /= len;
    zy /= len;
    zz /= len;
    let ux = upX;
    let uy = upY;
    let uz = upZ;
    if (Math.abs(zx * ux + zy * uy + zz * uz) > 0.999) {
        ux = 0;
        uy = 0;
        uz = -1;
    }
    let xx = uy * zz - uz * zy;
    let xy = uz * zx - ux * zz;
    let xz = ux * zy - uy * zx;
    len = Math.hypot(xx, xy, xz) || 1;
    xx /= len;
    xy /= len;
    xz /= len;
    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;
    return { xx, xy, xz, yx, yy, yz, zx, zy, zz };
}
/**
 * Look-at RH, Y-up — camera at `eye`, looking at `center`.
 *
 * When the view direction is nearly parallel to world +Y (pure top-down map
 * camera), world-up is unusable and the right-axis cross product vanishes.
 * In that case we fall back to world −Z as the “up” hint so billboard axes
 * stay finite (stable map “north” along −Z).
 */
export function mat4LookAt(out, eyeX, eyeY, eyeZ, centerX, centerY, centerZ, upX = 0, upY = 1, upZ = 0) {
    const a = lookAtAxes(eyeX, eyeY, eyeZ, centerX, centerY, centerZ, upX, upY, upZ);
    out[0] = a.xx;
    out[1] = a.yx;
    out[2] = a.zx;
    out[3] = 0;
    out[4] = a.xy;
    out[5] = a.yy;
    out[6] = a.zy;
    out[7] = 0;
    out[8] = a.xz;
    out[9] = a.yz;
    out[10] = a.zz;
    out[11] = 0;
    out[12] = -(a.xx * eyeX + a.xy * eyeY + a.xz * eyeZ);
    out[13] = -(a.yx * eyeX + a.yy * eyeY + a.yz * eyeZ);
    out[14] = -(a.zx * eyeX + a.zy * eyeY + a.zz * eyeZ);
    out[15] = 1;
    return out;
}
/** out = a * b (column-major). */
export function mat4Multiply(out, a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = b[0], b01 = b[1], b02 = b[2], b03 = b[3];
    const b10 = b[4], b11 = b[5], b12 = b[6], b13 = b[7];
    const b20 = b[8], b21 = b[9], b22 = b[10], b23 = b[11];
    const b30 = b[12], b31 = b[13], b32 = b[14], b33 = b[15];
    out[0] = a00 * b00 + a10 * b01 + a20 * b02 + a30 * b03;
    out[1] = a01 * b00 + a11 * b01 + a21 * b02 + a31 * b03;
    out[2] = a02 * b00 + a12 * b01 + a22 * b02 + a32 * b03;
    out[3] = a03 * b00 + a13 * b01 + a23 * b02 + a33 * b03;
    out[4] = a00 * b10 + a10 * b11 + a20 * b12 + a30 * b13;
    out[5] = a01 * b10 + a11 * b11 + a21 * b12 + a31 * b13;
    out[6] = a02 * b10 + a12 * b11 + a22 * b12 + a32 * b13;
    out[7] = a03 * b10 + a13 * b11 + a23 * b12 + a33 * b13;
    out[8] = a00 * b20 + a10 * b21 + a20 * b22 + a30 * b23;
    out[9] = a01 * b20 + a11 * b21 + a21 * b22 + a31 * b23;
    out[10] = a02 * b20 + a12 * b21 + a22 * b22 + a32 * b23;
    out[11] = a03 * b20 + a13 * b21 + a23 * b22 + a33 * b23;
    out[12] = a00 * b30 + a10 * b31 + a20 * b32 + a30 * b33;
    out[13] = a01 * b30 + a11 * b31 + a21 * b32 + a31 * b33;
    out[14] = a02 * b30 + a12 * b31 + a22 * b32 + a32 * b33;
    out[15] = a03 * b30 + a13 * b31 + a23 * b32 + a33 * b33;
    return out;
}
/**
 * Extract camera right (world) from a view matrix produced by {@link mat4LookAt}.
 * Row 0 of the upper 3×3 is the camera right axis.
 */
export function mat4CameraRight(view, out = new Float32Array(3)) {
    out[0] = view[0];
    out[1] = view[4];
    out[2] = view[8];
    return out;
}
/**
 * Extract camera up (world) from a view matrix produced by {@link mat4LookAt}.
 * Row 1 of the upper 3×3 is the camera up axis.
 */
export function mat4CameraUp(view, out = new Float32Array(3)) {
    out[0] = view[1];
    out[1] = view[5];
    out[2] = view[9];
    return out;
}
/** viewProj = proj * view */
export function mat4ViewProj(out, proj, view) {
    return mat4Multiply(out, proj, view);
}
/**
 * Invert a column-major 4×4. Writes into `out` (may alias `m`).
 * Returns `null` if the matrix is singular (det ≈ 0).
 */
export function mat4Invert(out, m) {
    const m00 = m[0], m01 = m[1], m02 = m[2], m03 = m[3];
    const m10 = m[4], m11 = m[5], m12 = m[6], m13 = m[7];
    const m20 = m[8], m21 = m[9], m22 = m[10], m23 = m[11];
    const m30 = m[12], m31 = m[13], m32 = m[14], m33 = m[15];
    const b00 = m00 * m11 - m01 * m10;
    const b01 = m00 * m12 - m02 * m10;
    const b02 = m00 * m13 - m03 * m10;
    const b03 = m01 * m12 - m02 * m11;
    const b04 = m01 * m13 - m03 * m11;
    const b05 = m02 * m13 - m03 * m12;
    const b06 = m20 * m31 - m21 * m30;
    const b07 = m20 * m32 - m22 * m30;
    const b08 = m20 * m33 - m23 * m30;
    const b09 = m21 * m32 - m22 * m31;
    const b10 = m21 * m33 - m23 * m31;
    const b11 = m22 * m33 - m23 * m32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
        return null;
    }
    det = 1 / det;
    out[0] = (m11 * b11 - m12 * b10 + m13 * b09) * det;
    out[1] = (m02 * b10 - m01 * b11 - m03 * b09) * det;
    out[2] = (m31 * b05 - m32 * b04 + m33 * b03) * det;
    out[3] = (m22 * b04 - m21 * b05 - m23 * b03) * det;
    out[4] = (m12 * b08 - m10 * b11 - m13 * b07) * det;
    out[5] = (m00 * b11 - m02 * b08 + m03 * b07) * det;
    out[6] = (m32 * b02 - m30 * b05 - m33 * b01) * det;
    out[7] = (m20 * b05 - m22 * b02 + m23 * b01) * det;
    out[8] = (m10 * b10 - m11 * b08 + m13 * b06) * det;
    out[9] = (m01 * b08 - m00 * b10 - m03 * b06) * det;
    out[10] = (m30 * b04 - m31 * b02 + m33 * b00) * det;
    out[11] = (m21 * b02 - m20 * b04 - m23 * b00) * det;
    out[12] = (m11 * b07 - m10 * b09 - m12 * b06) * det;
    out[13] = (m00 * b09 - m01 * b07 + m02 * b06) * det;
    out[14] = (m31 * b01 - m30 * b03 - m32 * b00) * det;
    out[15] = (m20 * b03 - m21 * b01 + m22 * b00) * det;
    return out;
}
//# sourceMappingURL=mat4.js.map