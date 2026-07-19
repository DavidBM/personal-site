/**
 * M2 — legacy thin line-list WGSL for connection edges.
 *
 * **Superseded:** live map draws topology via fat Line2
 * (`ConnectionLineGpuLayer` → `js/vendor/line2`). Kept for reference / tests
 * that may still import layout constants; not bound by the map view.
 */
export const CONNECTION_LINES_WGSL = /* wgsl */ `
struct Uniforms {
  viewProj : mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> u : Uniforms;

struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) color : vec3<f32>,
};

@vertex
fn vs_main(
  @location(0) position : vec3<f32>,
  @location(1) color : vec3<f32>,
) -> VSOut {
  var out : VSOut;
  out.clip = u.viewProj * vec4<f32>(position, 1.0);
  out.color = color;
  return out;
}

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  return vec4<f32>(input.color, 0.9);
}
`;
//# sourceMappingURL=connection-lines.wgsl.js.map