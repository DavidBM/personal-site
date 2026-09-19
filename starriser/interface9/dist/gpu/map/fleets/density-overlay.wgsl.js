/** Debug draw: 64³ density bricks in compact SCENE space. */
export const DENSITY_OVERLAY_SIDE = 64;
export const DENSITY_OVERLAY_CELL_LAB = 4;
export const DENSITY_OVERLAY_VERTICES = 24;
export const DENSITY_OVERLAY_WGSL = /* wgsl */ `
struct Uniforms {
  viewProj: mat4x4<f32>,
  origin: vec4<f32>,
  field: vec4<f32>,
}
struct Vertex { @builtin(position) clip: vec4<f32>, @location(0) color: vec4<f32> }
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> densityView: array<u32>;
@vertex fn densityCell(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Vertex {
  var out: Vertex;
  out.clip = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  out.color = vec4<f32>(0.0);
  let side = u32(u.field.x);
  let cells = side * side * side;
  if (instance >= cells || instance >= arrayLength(&densityView)) { return out; }
  let mass = f32(densityView[instance]) / 1024.0;
  if (mass < 0.00005) { return out; }
  let cell = max(u.field.y * u.field.z, u.field.w);
  let ix = instance % side;
  let iy = (instance / side) % side;
  let iz = instance / (side * side);
  let origin = vec3<f32>(u.origin.x, u.origin.y, u.origin.z);
  let center = vec3<f32>(f32(ix) + 0.5, f32(iy) + 0.5, f32(iz) + 0.5) * cell
    - vec3<f32>(f32(side) * 0.5 * cell) + origin;
  let corners = array<vec3<f32>, 8>(
    vec3<f32>(-1.0, -1.0, -1.0), vec3<f32>(1.0, -1.0, -1.0), vec3<f32>(1.0, 1.0, -1.0), vec3<f32>(-1.0, 1.0, -1.0),
    vec3<f32>(-1.0, -1.0, 1.0), vec3<f32>(1.0, -1.0, 1.0), vec3<f32>(1.0, 1.0, 1.0), vec3<f32>(-1.0, 1.0, 1.0),
  );
  let edges = array<u32, 24>(0u,1u, 1u,2u, 2u,3u, 3u,0u, 4u,5u, 5u,6u, 6u,7u, 7u,4u, 0u,4u, 1u,5u, 2u,6u, 3u,7u);
  let heat = clamp(log2(1.0 + mass) / 5.0, 0.0, 1.0);
  let world = center + corners[edges[vertex]] * cell * 0.48;
  out.clip = u.viewProj * vec4<f32>(world, 1.0);
  let tint = mix(vec3<f32>(0.15, 0.85, 1.0), vec3<f32>(1.0, 0.35, 0.05), heat);
  let alpha = 0.35 + 0.55 * heat;
  out.color = vec4<f32>(tint * alpha, alpha);
  return out;
}
@fragment fn densityFrag(in: Vertex) -> @location(0) vec4<f32> { return in.color; }
`;
//# sourceMappingURL=density-overlay.wgsl.js.map