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
 *   f32 modelScale + 3×pad @96
 * Must stay ≥112 so modelScale (float index 24) is not OOB and GPU reads real scale.
 */
export const VIEWER_MODEL_UNIFORM_SIZE = 112;
/** Float index of modelScale in the staging Float32Array / uniform buffer. */
export const VIEWER_MODEL_U_MODEL_SCALE = 24;
export const VIEWER_MODEL_WGSL = /* wgsl */ `
struct U {
  viewProj : mat4x4<f32>,
  lightDir : vec3<f32>,
  ambient : f32,
  eye : vec3<f32>,
  meshYawHalf : f32,
  modelScale : f32,
  _pad0 : f32,
  _pad1 : f32,
  _pad2 : f32,
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

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  let baseSample = textureSample(baseColorTex, texSampler, input.uv);
  let specSample = textureSample(specTex, texSampler, input.uv);
  let cool = vec3<f32>(0.35, 0.72, 0.95);
  let hot = vec3<f32>(1.0, 0.45, 0.15);
  let albedo = mix(cool, baseSample.rgb, 0.55) * mix(vec3<f32>(1.0), specSample.rgb, 0.2);
  let nMap = textureSample(normalTex, texSampler, input.uv).xyz * 2.0 - 1.0;
  var n = normalize(input.worldNrm);
  n = normalize(n + nMap * 0.35);

  let L = normalize(u.lightDir);
  let NdotL = max(dot(n, L), 0.0);
  let hemi = u.ambient + (1.0 - u.ambient) * NdotL;

  let toEye = u.eye - input.worldPos;
  let viewDir = select(
    vec3<f32>(0.0, 1.0, 0.0),
    normalize(toEye),
    dot(toEye, toEye) > 1e-6,
  );
  let rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.5);
  let eng = hot * rim * 0.18;
  let lit = albedo * hemi + eng + vec3<f32>(0.04, 0.06, 0.1);
  return vec4<f32>(lit, max(baseSample.a, 0.92));
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