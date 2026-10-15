/**
 * WebGPU shaders for the full-screen model viewer.
 * Model path mirrors game albedo/normal/rim lighting with a directional key light.
 * Overlay (ball, axes, tether) uses depth always so gizmos stay visible.
 */
/**
 * 112 B (28 f32) — WGSL uniform alignment for:
 *   mat4 viewProj @0
 *   vec3 lightDir + f32 ambient @64
 *   vec3 eye + f32 meshYawHalf @80
 *   f32 modelScale, f32 surface, f32 hasMetalRough, pad @96
 * Must stay ≥112 so modelScale (float index 24) is not OOB and GPU reads real scale.
 */
export const VIEWER_MODEL_UNIFORM_SIZE = 112;
/** Float index of modelScale in the staging Float32Array / uniform buffer. */
export const VIEWER_MODEL_U_MODEL_SCALE = 24;
/** Float index of the surface mode (VIEWER_SURFACE value). */
export const VIEWER_MODEL_U_SURFACE = 25;
/** Float index of the "mesh has a metallic-roughness map" flag (0 or 1). */
export const VIEWER_MODEL_U_HAS_METAL_ROUGH = 26;
/** Surface shading modes: game-style tint, true-colour studio PBR, untextured clay. */
export const VIEWER_SURFACE = { game: 0, studio: 1, clay: 2 };
export const VIEWER_MODEL_WGSL = /* wgsl */ `
struct U {
  viewProj : mat4x4<f32>,
  lightDir : vec3<f32>,
  ambient : f32,
  eye : vec3<f32>,
  meshYawHalf : f32,
  modelScale : f32,
  surface : f32,
  hasMetalRough : f32,
  _pad0 : f32,
};

@group(0) @binding(0) var<uniform> u : U;
@group(0) @binding(1) var baseColorTex : texture_2d<f32>;
@group(0) @binding(2) var normalTex : texture_2d<f32>;
@group(0) @binding(3) var specTex : texture_2d<f32>;
@group(0) @binding(4) var texSampler : sampler;

struct VSIn {
  @location(0) meshPos : vec3<f32>,
  @location(1) meshNrm : vec3<f32>,
  @location(2) meshUv : vec2<f32>,
};

struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) uv : vec2<f32>,
  @location(1) worldNrm : vec3<f32>,
  @location(2) worldPos : vec3<f32>,
};

fn quatRotate(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

@vertex
fn vs_main(input : VSIn) -> VSOut {
  var out : VSOut;
  // Same meshFix as fleet-model-ships (Y-yaw half-angle)
  let meshFix = vec4<f32>(0.0, sin(u.meshYawHalf), 0.0, cos(u.meshYawHalf));
  let local = quatRotate(meshFix, input.meshPos) * u.modelScale;
  let nLocal = quatRotate(meshFix, input.meshNrm);
  out.worldPos = local;
  out.worldNrm = nLocal;
  out.clip = u.viewProj * vec4<f32>(local, 1.0);
  out.uv = input.meshUv;
  return out;
}

// Tangent frame from screen-space derivatives (glTF meshes here carry no tangents).
// glTF UV v grows downward while normal-map green points up, so green is flipped.
fn perturbNormal(n: vec3<f32>, p: vec3<f32>, uv: vec2<f32>, mapN: vec3<f32>) -> vec3<f32> {
  let dp1 = dpdx(p);
  let dp2 = dpdy(p);
  let duv1 = dpdx(uv);
  let duv2 = dpdy(uv);
  let dp2perp = cross(dp2, n);
  let dp1perp = cross(n, dp1);
  let t = dp2perp * duv1.x + dp1perp * duv2.x;
  let b = dp2perp * duv1.y + dp1perp * duv2.y;
  let m = max(dot(t, t), dot(b, b));
  let s = inverseSqrt(max(m, 1e-24));
  let mapped = normalize(t * s * mapN.x - b * s * mapN.y + n * mapN.z);
  return select(n, mapped, m > 1e-20);
}

fn acesFit(x: vec3<f32>) -> vec3<f32> {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3<f32>(0.0), vec3<f32>(1.0));
}

// Neutral studio: key light (rotating), cool fill, sky/ground hemisphere and a
// soft environment reflection so metallic panels do not render black.
fn studio(base: vec3<f32>, rough: f32, metal: f32, n: vec3<f32>, v: vec3<f32>) -> vec3<f32> {
  let l = normalize(u.lightDir);
  let lf = normalize(vec3<f32>(-0.55, 0.25, -0.70));
  let sky = vec3<f32>(0.30, 0.33, 0.38);
  let ground = vec3<f32>(0.05, 0.05, 0.06);
  let hemi = mix(ground, sky, n.y * 0.5 + 0.5);
  let ndl = max(dot(n, l), 0.0);
  let ndf = max(dot(n, lf), 0.0);
  let diffuse = base * (1.0 - metal) * (vec3<f32>(2.4, 2.3, 2.15) * ndl + vec3<f32>(0.35, 0.42, 0.55) * ndf + hemi);
  let f0 = mix(vec3<f32>(0.04), base, metal);
  let h = normalize(l + v);
  let r4 = max(rough * rough * rough * rough, 1e-4);
  let shin = clamp(2.0 / r4 - 2.0, 2.0, 2048.0);
  let spec = f0 * pow(max(dot(n, h), 0.0), shin) * ndl * (shin + 8.0) / 25.0;
  let refl = reflect(-v, n);
  let env = f0 * mix(ground, sky * 1.6, smoothstep(-0.3, 0.8, refl.y)) * (1.0 - rough * 0.6);
  return diffuse + spec * 2.3 + env;
}

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  let baseSample = textureSample(baseColorTex, texSampler, input.uv);
  let specSample = textureSample(specTex, texSampler, input.uv);
  let nSample = textureSample(normalTex, texSampler, input.uv).xyz * 2.0 - 1.0;
  let geoN = normalize(input.worldNrm);
  let mappedN = perturbNormal(geoN, input.worldPos, input.uv, nSample);
  let toEyeS = u.eye - input.worldPos;
  let v = select(vec3<f32>(0.0, 1.0, 0.0), normalize(toEyeS), dot(toEyeS, toEyeS) > 1e-6);
  if (u.surface > 1.5) {
    let clay = studio(vec3<f32>(0.32), 0.65, 0.0, geoN, v);
    return vec4<f32>(pow(acesFit(clay), vec3<f32>(1.0 / 2.2)), 1.0);
  }
  if (u.surface > 0.5) {
    let base = pow(baseSample.rgb, vec3<f32>(2.2));
    let rough = select(0.6, clamp(specSample.g, 0.05, 1.0), u.hasMetalRough > 0.5);
    let metal = select(0.1, clamp(specSample.b, 0.0, 1.0), u.hasMetalRough > 0.5);
    let lit = studio(base, rough, metal, mappedN, v);
    return vec4<f32>(pow(acesFit(lit), vec3<f32>(1.0 / 2.2)), 1.0);
  }
  let cool = vec3<f32>(0.35, 0.72, 0.95);
  let hot = vec3<f32>(1.0, 0.45, 0.15);
  let albedo = mix(cool, baseSample.rgb, 0.55) * mix(vec3<f32>(1.0), specSample.rgb, 0.2);
  let n = normalize(geoN + nSample * 0.35);

  let L = normalize(u.lightDir);
  let NdotL = max(dot(n, L), 0.0);
  let hemi = u.ambient + (1.0 - u.ambient) * NdotL;

  let rim = pow(1.0 - max(dot(n, v), 0.0), 2.5);
  let eng = hot * rim * 0.18;
  let lit = albedo * hemi + eng + vec3<f32>(0.04, 0.06, 0.1);
  return vec4<f32>(lit, max(baseSample.a, 0.92));
}
`;
/**
 * Edge-line uniform, 112 B (28 f32):
 *   mat4 viewProj @0
 *   vec3 eye + f32 meshYawHalf @64
 *   vec4 color @80
 *   f32 modelScale, f32 nudge, 2×pad @96
 */
export const VIEWER_EDGE_UNIFORM_SIZE = 112;
/** Triangle edges over the model: same vertex transform, constant colour.
 * Vertices move slightly toward the eye so edges win the depth test against
 * the surface they lie on. */
export const VIEWER_EDGE_WGSL = /* wgsl */ `
struct U {
  viewProj : mat4x4<f32>,
  eye : vec3<f32>,
  meshYawHalf : f32,
  color : vec4<f32>,
  modelScale : f32,
  nudge : f32,
  _pad0 : f32,
  _pad1 : f32,
};

@group(0) @binding(0) var<uniform> u : U;

fn quatRotate(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

@vertex
fn vs_main(@location(0) meshPos : vec3<f32>) -> @builtin(position) vec4<f32> {
  let meshFix = vec4<f32>(0.0, sin(u.meshYawHalf), 0.0, cos(u.meshYawHalf));
  let world = quatRotate(meshFix, meshPos) * u.modelScale;
  let p = world + (u.eye - world) * u.nudge;
  return u.viewProj * vec4<f32>(p, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  return u.color;
}
`;
/** Overlay uniform: viewProj only (color is per-vertex — safe across draws). */
export const VIEWER_OVERLAY_UNIFORM_SIZE = 64; // mat4
export const VIEWER_OVERLAY_WGSL = /* wgsl */ `
struct U {
  viewProj : mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> u : U;

struct VSIn {
  @location(0) pos : vec3<f32>,
  @location(1) color : vec4<f32>,
};

struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) color : vec4<f32>,
};

@vertex
fn vs_main(input : VSIn) -> VSOut {
  var out : VSOut;
  out.clip = u.viewProj * vec4<f32>(input.pos, 1.0);
  out.color = input.color;
  return out;
}

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  return input.color;
}
`;
//# sourceMappingURL=viewer-shaders.js.map