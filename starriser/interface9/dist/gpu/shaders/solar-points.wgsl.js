/**
 * WGSL for instanced solar-system point billboards.
 * Positions + colors as interleaved instance attributes (float3 + float3).
 *
 * Billboard: camera-facing quads using cameraRight/cameraUp uniforms
 * (extracted from the view matrix on the CPU). Falls back cleanly when
 * axes are zero (should not happen with a valid look-at).
 *
 * Size: CPU supplies `worldScale` (half-extent) so on-screen diameter stays
 * ~constant (galaxy point LOD); no cameraY growth formula in the shader.
 */
/**
 * Billboard quads: each solar system is one instance; 6 verts (2 tris) per point.
 * Instance buffer: pos.xyz + color.rgb interleaved as 6 floats.
 */
export const SOLAR_POINTS_BILLBOARD_WGSL = /* wgsl */ `
struct Uniforms {
  viewProj : mat4x4<f32>,
  /** Half-extent of billboard quad in world units (diameter ≈ 2 * worldScale). */
  worldScale : f32,
  _pad0 : f32,
  _pad1 : f32,
  _pad2 : f32,
  /** Camera right axis in world space (unit). */
  cameraRight : vec3<f32>,
  _padR : f32,
  /** Camera up axis in world space (unit). */
  cameraUp : vec3<f32>,
  _padU : f32,
};

@group(0) @binding(0) var<uniform> u : Uniforms;

struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) color : vec3<f32>,
  @location(1) uv : vec2<f32>,
};

// Corner index 0..5 → unit quad corners for two triangles
fn corner_offset(corner : u32) -> vec2<f32> {
  // 0:(-1,-1) 1:(1,-1) 2:(1,1)  3:(-1,-1) 4:(1,1) 5:(-1,1)
  switch corner {
    case 0u: { return vec2<f32>(-1.0, -1.0); }
    case 1u: { return vec2<f32>( 1.0, -1.0); }
    case 2u: { return vec2<f32>( 1.0,  1.0); }
    case 3u: { return vec2<f32>(-1.0, -1.0); }
    case 4u: { return vec2<f32>( 1.0,  1.0); }
    default: { return vec2<f32>(-1.0,  1.0); }
  }
}

@vertex
fn vs_main(
  @builtin(vertex_index) vid : u32,
  @location(0) center : vec3<f32>,
  @location(1) color : vec3<f32>,
) -> VSOut {
  var out : VSOut;
  let corner = vid % 6u;
  let off = corner_offset(corner);
  let scale = u.worldScale;
  // Camera-facing billboard (right/up from view matrix)
  let world = center
    + u.cameraRight * (off.x * scale)
    + u.cameraUp * (off.y * scale);
  out.clip = u.viewProj * vec4<f32>(world, 1.0);
  out.color = color;
  out.uv = off * 0.5 + vec2<f32>(0.5, 0.5);
  return out;
}

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  let d = distance(input.uv, vec2<f32>(0.5, 0.5));
  if (d > 0.5) {
    discard;
  }
  let alpha = 0.85 * smoothstep(0.5, 0.35, d);
  return vec4<f32>(input.color, alpha);
}
`;
//# sourceMappingURL=solar-points.wgsl.js.map