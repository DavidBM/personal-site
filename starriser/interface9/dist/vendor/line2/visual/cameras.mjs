/**
 * Column-major mat4 helpers for the Line2 visual suite.
 * Matches WebGPU / WGSL layout (same conventions as Galaxy mat4).
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

/** Symmetric orthographic projection (RH, clip z in [0,1] style via near/far). */
export function mat4Ortho(out, left, right, bottom, top, near, far) {
  const lr = 1 / (left - right);
  const bt = 1 / (bottom - top);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = -2 * lr;
  out[5] = -2 * bt;
  out[10] = nf;
  out[12] = (left + right) * lr;
  out[13] = (top + bottom) * bt;
  out[14] = near * nf;
  out[15] = 1;
  return out;
}

/**
 * Look-at RH, Y-up. Top-down fallback uses world −Z as up hint.
 */
export function mat4LookAt(
  out,
  eyeX,
  eyeY,
  eyeZ,
  centerX,
  centerY,
  centerZ,
  upX = 0,
  upY = 1,
  upZ = 0,
) {
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

  out[0] = xx;
  out[1] = yx;
  out[2] = zx;
  out[3] = 0;
  out[4] = xy;
  out[5] = yy;
  out[6] = zy;
  out[7] = 0;
  out[8] = xz;
  out[9] = yz;
  out[10] = zz;
  out[11] = 0;
  out[12] = -(xx * eyeX + xy * eyeY + xz * eyeZ);
  out[13] = -(yx * eyeX + yy * eyeY + yz * eyeZ);
  out[14] = -(zx * eyeX + zy * eyeY + zz * eyeZ);
  out[15] = 1;
  return out;
}

/** Flat top-down map view looking at origin (Galaxy-like XZ plane). */
export function cameraOrthoTopDown(outView, outProj, halfExtent, aspect, eyeY = 50) {
  mat4LookAt(outView, 0, eyeY, 0, 0, 0, 0, 0, 0, -1);
  const h = halfExtent;
  const w = halfExtent * aspect;
  mat4Ortho(outProj, -w, w, -h, h, 0.1, eyeY * 4);
  return { view: outView, projection: outProj };
}

/** Perspective looking at origin from (0, ey, ez). */
export function cameraPerspective(
  outView,
  outProj,
  aspect,
  {
    eye = [0, 4, 12],
    center = [0, 0, 0],
    fovyDeg = 50,
    near = 0.1,
    far = 200,
  } = {},
) {
  mat4LookAt(
    outView,
    eye[0],
    eye[1],
    eye[2],
    center[0],
    center[1],
    center[2],
  );
  mat4Perspective(outProj, (fovyDeg * Math.PI) / 180, aspect, near, far);
  return { view: outView, projection: outProj };
}

/**
 * Residual R01: force tiny clip.w on screen-space path.
 * clip.w ≈ -viewZ; near plane has clip.w ≈ near. Eye sits just outside near
 * with a shallow look so origin / toward-camera segs hit w ~ O(near).
 * (Previous eyeZ≈0.12, near=0.05 left min w≈0.13 — too mild to spike.)
 */
export function cameraNearClipW(outView, outProj, aspect, t = 0) {
  // near=0.015; eye distance oscillates ~0.022…0.040 so closest geom → w→near
  const near = 0.015;
  const eyeZ = 0.028 + 0.01 * Math.sin(t * 0.85);
  const eyeY = 0.004 + 0.0025 * Math.sin(t * 1.4);
  mat4LookAt(outView, 0.0, eyeY, eyeZ, 0, 0, 0);
  mat4Perspective(outProj, (80 * Math.PI) / 180, aspect, near, 40);
  return { view: outView, projection: outProj };
}

/**
 * Residual R02: extreme FOV / NDC stress on dir = ndcEnd−ndcStart.
 * 165° + tight radius → diagonals graze frustum edges; NDC warps hard.
 */
export function cameraExtremeFov(outView, outProj, aspect, t = 0) {
  const yaw = t * 0.35;
  // Low pitch + close orbit maximizes peripheral NDC stretch
  const r = 1.6;
  mat4LookAt(
    outView,
    Math.sin(yaw) * r,
    0.25 + 0.15 * Math.sin(t * 0.5),
    Math.cos(yaw) * r,
    0,
    0,
    0,
  );
  mat4Perspective(outProj, (165 * Math.PI) / 180, aspect, 0.05, 100);
  return { view: outView, projection: outProj };
}

/**
 * Residual R03: worldUnits FS normalize(worldPos.xyz).
 * worldPos is view-space; conditioning fails when |worldPos|→0 (geom at eye).
 * Prior r≈0.35…0.45 left |view pos|≳0.25 — normalize well-conditioned.
 */
export function cameraWorldUnitsNearEye(outView, outProj, aspect, t = 0) {
  // Eye distance ~0.05…0.14; with linewidth~0.12 ribbon verts can skim origin
  const r = 0.07 + 0.045 * Math.sin(t * 0.9);
  mat4LookAt(outView, r, r * 0.35, r, 0, 0, 0);
  mat4Perspective(outProj, (70 * Math.PI) / 180, aspect, 0.02, 20);
  return { view: outView, projection: outProj };
}

/**
 * Animated dolly for screen-space vs worldUnits zoom tests (H12 / R04 / R05).
 * Wide throw (~2…~28) so worldUnits screen size swings ~10×; screen-px holds.
 */
export function cameraDollyPerspective(outView, outProj, aspect, t, baseZ = 14) {
  // Map sin→[0,1] then lerp close…far. baseZ kept for call-site compat (scales far).
  const u = 0.5 + 0.5 * Math.sin(t * 0.55);
  const zNear = Math.max(1.8, baseZ * 0.14);
  const zFar = baseZ * 2.0;
  const z = zNear + (zFar - zNear) * u;
  const eyeY = 2.2 + 0.35 * z * 0.08;
  mat4LookAt(outView, 0, eyeY, z, 0, 0, 0);
  mat4Perspective(outProj, (45 * Math.PI) / 180, aspect, 0.1, 200);
  return { view: outView, projection: outProj };
}

/** Orbit around origin. */
export function cameraOrbit(outView, outProj, aspect, t, radius = 12, fovyDeg = 50) {
  const x = Math.sin(t * 0.4) * radius;
  const z = Math.cos(t * 0.4) * radius;
  mat4LookAt(outView, x, 4, z, 0, 0, 0);
  mat4Perspective(outProj, (fovyDeg * Math.PI) / 180, aspect, 0.1, 200);
  return { view: outView, projection: outProj };
}
