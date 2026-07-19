/**
 * M4 — simple line-list + triangle-list overlays (edit handles, rings, fills).
 * Interleaved vertex: pos.xyz + color.rgba (7 floats, 28 bytes).
 */
/** Floats per vertex: x,y,z,r,g,b,a */
export const MAP_OVERLAY_FLOATS_PER_VERT = 7;
/** Bytes per vertex */
export const MAP_OVERLAY_BYTES_PER_VERT = MAP_OVERLAY_FLOATS_PER_VERT * 4;
/** Uniform buffer size: mat4 (64) + opacity + pad (16) = 80 */
export const MAP_OVERLAY_UNIFORM_SIZE = 80;
export const MAP_OVERLAY_WGSL = /* wgsl */ `
struct Uniforms {
  viewProj : mat4x4<f32>,
  opacity : f32,
  _pad0 : f32,
  _pad1 : f32,
  _pad2 : f32,
};

@group(0) @binding(0) var<uniform> u : Uniforms;

struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) color : vec4<f32>,
};

@vertex
fn vs_main(
  @location(0) position : vec3<f32>,
  @location(1) color : vec4<f32>,
) -> VSOut {
  var out : VSOut;
  out.clip = u.viewProj * vec4<f32>(position, 1.0);
  out.color = color;
  return out;
}

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  return vec4<f32>(input.color.rgb, input.color.a * u.opacity);
}
`;
//# sourceMappingURL=map-overlay.wgsl.js.map