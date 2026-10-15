/**
 * Engine glows (ship-fx.ts): one camera-facing sprite per catalog glow of each
 * mid or full-detail hull, drawn like a lens flare. The sprite is never depth-tested,
 * so no hull polygon slices it; instead it is scaled by how much of its centre
 * the scene depth shows (13 taps around a point lifted GLOW_OCCLUSION_LIFT of
 * its radius toward the camera, so the surface it sits on does not hide it)
 * by its style's facing (full from behind the ship, gone from ahead) and by the
 * ship's engine level (present: follows the trail, 0 once the ship comes to rest).
 * Hidden glows collapse to a point and cost no fragments. Additive, like trails.
 *
 * Appended to the trail draw shader (sceneTrailDrawShader(FLEET_TRAILS_WGSL +
 * ENGINE_GLOW_WGSL)) for its uniforms, sampler, class table and scene-camera
 * view. Instances: SHIP_FX_MAX_GLOWS per glow ship that trail expansion listed
 * (fleet-integrate EngineList); copies beyond the class's glows collapse.
 */
import { SHIP_FX_MAX_CLASSES, SHIP_FX_MAX_GLOWS, SHIP_GLOW_SHIP_VEC4 } from "../visual/ship-fx.js";
export const ENGINE_GLOW_WGSL = /* wgsl */ `
@group(0) @binding(4) var glowStyles : texture_2d_array<f32>;
@group(0) @binding(5) var sceneDepth : texture_depth_2d;
/** Reversed-Z maps (nearer = larger depth); false for forward depth. */
override glowDepthReversed : bool = true;
const GLOW_OCCLUSION_LIFT : f32 = 0.3;
const GLOW_TAPS : u32 = 13u;

struct GlowOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) uv : vec2<f32>,
  @location(1) @interpolate(flat) layer : u32,
  @location(2) @interpolate(flat) light : f32,
};

fn glowClip(view : vec3<f32>) -> vec4<f32> {
  var clip = u.projection * vec4<f32>(view, 1.0);
  if (sceneCamera.cameraHigh.w == 0.0) { clip = sceneCamera.clip * clip; }
  return clip;
}

/** Share of depth taps around the projected test point with nothing nearer than it. */
fn glowVisibility(test : vec3<f32>, radius : f32) -> f32 {
  let clip = glowClip(test);
  if (clip.w <= 0.0) { return 0.0; }
  let size = vec2<f32>(textureDimensions(sceneDepth));
  let toPixels = vec2<f32>(0.5, -0.5) * size;
  let centre = (clip.xy / clip.w) * toPixels + 0.5 * size;
  let edge = glowClip(test + vec3<f32>(0.0, 0.2 * radius, 0.0));
  let tapPx = clamp(length((edge.xy / edge.w) * toPixels + 0.5 * size - centre), 1.5, 12.0);
  let depth = clip.z / clip.w;
  var seen = 0.0;
  for (var i = 0u; i < GLOW_TAPS; i++) {
    // Centre, then two rings of six (radius 0.5 and 1, the outer ring turned 30°).
    let ring = select(select(1.0, 0.5, i < 7u), 0.0, i == 0u);
    let angle = f32(i) * 1.0471976 + select(0.0, 0.5235988, i >= 7u);
    let p = centre + vec2<f32>(cos(angle), sin(angle)) * ring * tapPx;
    let scene = textureLoad(sceneDepth, vec2<i32>(clamp(p, vec2<f32>(0.0), size - 1.0)), 0);
    seen += select(0.0, 1.0, select(depth <= scene, depth >= scene, glowDepthReversed));
  }
  return seen / f32(GLOW_TAPS);
}

@vertex
fn vs_glow(@builtin(vertex_index) vi : u32, @builtin(instance_index) instance : u32) -> GlowOut {
  var out : GlowOut;
  out.clip = vec4<f32>(0.0, 0.0, 2.0, 1.0);
  out.uv = vec2<f32>(0.5);
  out.light = 0.0;
  // Direct draw of a fixed capacity: instances past this frame's glow ships collapse.
  if (instance >= bitcast<u32>(engineList[2].y)) { return out; }
  // engineList (trail module binding 8): header word 9 = glows × ships, glow ships from vec4 ${SHIP_GLOW_SHIP_VEC4}.
  let ship = ${SHIP_GLOW_SHIP_VEC4}u + (instance / ${SHIP_FX_MAX_GLOWS}u) * 3u;
  let index = instance % ${SHIP_FX_MAX_GLOWS}u;
  let hull = engineList[ship];
  let q = engineList[ship + 1u];
  let cls = u32(engineList[ship + 2u].x + 0.5);
  let engine = engineList[ship + 2u].z;
  if (cls >= ${SHIP_FX_MAX_CLASSES}u || index >= min(shipFx.counts[cls].y, ${SHIP_FX_MAX_GLOWS}u)) { return out; }
  let glow = shipFx.glows[(cls * 8u + index) * 2u];
  let style = shipFx.glows[(cls * 8u + index) * 2u + 1u];
  out.layer = u32(style.x + 0.5);
  let centre = hull.xyz + engineRotate(q, glow.xyz * hull.w);
  let radius = 0.5 * glow.w * hull.w;
  let view = sceneTrailView(centre).xyz;
  if (!(radius > 0.0) || view.z >= 0.0) { return out; }
  let toEye = normalize(-view);
  let aftView = sceneTrailView(centre + engineRotate(q, vec3<f32>(0.0, 0.0, -1.0))).xyz - view;
  // Full from behind (and up to 45° off), half from the side, nothing from 45° ahead onward.
  let behind = smoothstep(-0.7, 0.7, dot(toEye, normalize(aftView)));
  let facing = mix(1.0, behind, style.y) * engine;
  if (facing <= 0.001) { return out; }
  let lift = min(GLOW_OCCLUSION_LIFT * radius, 0.5 * length(view));
  out.light = facing * glowVisibility(view + toEye * lift, radius);
  if (out.light <= 0.0) { return out; }
  var corners = array<vec2<f32>, 6>(vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, 1.0));
  let c = corners[vi % 6u];
  out.clip = glowClip(view + vec3<f32>(c * radius, 0.0));
  out.uv = c * vec2<f32>(0.5, -0.5) + 0.5;
  return out;
}

// Trilinear: the style array is mipmapped, so a glow a few pixels wide reads a
// small level instead of aliasing level 0 into shimmer.
@fragment
fn fs_glow(input : GlowOut) -> @location(0) vec4<f32> {
  let texel = textureSample(glowStyles, trailSamp, input.uv, input.layer);
  return texel * input.light;
}
`;
//# sourceMappingURL=engine-glow.wgsl.js.map