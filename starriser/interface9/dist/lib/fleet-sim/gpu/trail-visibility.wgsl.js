import { MODEL_VISIBILITY_EPSILON } from "../visual/model-visibility.js";
/** One conservative gate per emitter ribbon, using the draw's actual endpoints. */
export const TRAIL_VISIBILITY_WGSL = /* wgsl */ `
struct TrailVisibilityUniforms {
  planes: array<vec4<f32>, 6>,
  eyePlane: vec4<f32>,
  halfWidth: f32,
  enabled: f32,
  widthMode: f32, // 0 = fixed world half-width; 1 = screen coefficient * depth.
  _pad: f32,
};

fn expandedTrailPoint(sampleBase: u32, baseY: f32, worldOff: vec3<f32>, pathEnd: vec3<f32>, stableScene: bool) -> vec3<f32> {
  // Preserve subtract-before-offset and the existing scalar addition order.
  if (stableScene) {
    return vec3<f32>(
      trails[sampleBase] - u.origin.x + worldOff.x,
      baseY + trails[sampleBase + 3u] - u.origin.y + worldOff.y,
      trails[sampleBase + 1u] - u.origin.z + worldOff.z,
    );
  }
  let peOx = pathEnd.x - u.origin.x;
  let peOy = pathEnd.y - u.origin.y;
  let peOz = pathEnd.z - u.origin.z;
  return vec3<f32>(
    peOx + trails[sampleBase] + worldOff.x,
    baseY + peOy + trails[sampleBase + 3u] + worldOff.y,
    peOz + trails[sampleBase + 1u] + worldOff.z,
  );
}

fn trailFinitePoint(point: vec3<f32>) -> bool {
  return all(abs(point) <= vec3<f32>(3.402823466e+38));
}

fn trailPlaneMargin(plane: vec4<f32>, center: vec3<f32>, radius: f32) -> f32 {
  return ${MODEL_VISIBILITY_EPSILON} * max(1.0, dot(abs(plane.xyz), abs(center)) + abs(plane.w) + radius);
}

fn trailMaxHalfWidth(center: vec3<f32>, extent: vec3<f32>) -> f32 {
  if (u.trailVisibility.widthMode == 0.0) { return u.trailVisibility.halfWidth; }
  let eye = u.trailVisibility.eyePlane;
  let eyeDistance = dot(eye.xyz, center) + eye.w;
  let eyeExtent = dot(abs(eye.xyz), extent);
  // The live VS evaluates width on each centerline endpoint before side offset.
  // AABB support bounds both endpoint depths; padding protects f32 cancellation.
  let maxDepth = abs(eyeDistance) + eyeExtent + trailPlaneMargin(eye, center, eyeExtent);
  return u.trailVisibility.halfWidth * maxDepth;
}

fn trailBoundsVisible(low: vec3<f32>, high: vec3<f32>) -> bool {
  let center = (low + high) * 0.5;
  let extent = (high - low) * 0.5;
  if (!trailFinitePoint(center) || !trailFinitePoint(extent)) { return true; }
  let halfWidth = trailMaxHalfWidth(center, extent);
  if (!(halfWidth >= 0.0 && halfWidth <= 3.402823466e+38)) { return true; }
  let eye = u.trailVisibility.eyePlane;
  let eyeRadius = dot(abs(eye.xyz), extent) + halfWidth * length(eye.xyz);
  let eyeDistance = dot(eye.xyz, center) + eye.w;
  // Legacy near trim can extrapolate across the eye plane. Keep the whole
  // ambiguous ribbon instead of assuming its original endpoints bound that trim.
  if (abs(eyeDistance) <= eyeRadius + trailPlaneMargin(eye, center, eyeRadius)) { return true; }
  for (var i = 0u; i < 6u; i++) {
    let plane = u.trailVisibility.planes[i];
    let radius = dot(abs(plane.xyz), extent) + halfWidth;
    let distance = dot(plane.xyz, center) + plane.w;
    if (distance < -radius - trailPlaneMargin(plane, center, radius)) { return false; }
  }
  return true;
}

fn trailVisibilityModeEnabled() -> bool {
  if (u.trailVisibility.enabled != 1.0) { return false; }
  if (u.trailVisibility.widthMode == 0.0) { return u.expandTrails == 2u; }
  if (u.trailVisibility.widthMode == 1.0) { return u.expandTrails == 1u; }
  return false;
}

fn trailRibbonVisible(ringBase: u32, write: u32, nLive: u32, baseY: f32, worldOff: vec3<f32>, pathEnd: vec3<f32>, stableScene: bool) -> bool {
  if (!trailVisibilityModeEnabled()) { return true; }
  if (nLive < 2u) { return false; }
  var low = vec3<f32>(3.402823466e+38);
  var high = -low;
  for (var depth = 0u; depth < nLive; depth++) {
    let index = (write - 1u - depth) & (TRAIL_RING_SIZE - 1u);
    let point = expandedTrailPoint(ringBase + index * TRAIL_SAMPLE_FLOATS, baseY, worldOff, pathEnd, stableScene);
    // Check before min/max: implementations can otherwise hide NaNs in bounds.
    if (!trailFinitePoint(point)) { return true; }
    low = min(low, point);
    high = max(high, point);
  }
  return trailBoundsVisible(low, high);
}
`;
//# sourceMappingURL=trail-visibility.wgsl.js.map