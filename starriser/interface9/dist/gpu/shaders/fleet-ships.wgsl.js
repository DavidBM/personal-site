/**
 * L2 / W4 — instanced ship **draw** records (not L1 storage ShipInstance).
 *
 * Distinct from `fleet-layout.ts` ShipInstance (formation + phase/fleetIndex).
 * Draw stride is also 48 bytes but field layout differs — do not share constants.
 *
 * Draw instance (12 floats = 48 bytes):
 *  0  base.xyz     fleet world position
 * 12  center.xyz   formation offset
 * 24  rotation, size
 * 32  color.rgb
 * 44  pad          // >0.5 → size is screen-space px (icon); else world size
 *
 * Uniforms carry cameraY / viewportH / tanHalfFov so icon triangles stay ~15px.
 */
export const FLEET_SHIP_DRAW_STRIDE = 48;
/** Screen-space flag written into draw pad (must match SHIP_DRAW_SCREEN_SPACE). */
export const FLEET_SHIP_SCREEN_SPACE_FLAG = 1;
export const FLEET_SHIPS_WGSL = /* wgsl */ `
struct Uniforms {
  viewProj : mat4x4<f32>,
  opacity : f32,
  cameraY : f32,
  viewportH : f32,
  tanHalfFov : f32,
};

@group(0) @binding(0) var<uniform> u : Uniforms;

struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) color : vec3<f32>,
};

@vertex
fn vs_main(
  @location(0) meshPos : vec3<f32>,
  @location(1) base : vec3<f32>,
  @location(2) center : vec3<f32>,
  @location(3) rotation : f32,
  @location(4) size : f32,
  @location(5) color : vec3<f32>,
  @location(6) screenSpace : f32,
) -> VSOut {
  var out : VSOut;
  // Tombstone / hidden slots: skip work (still launched as instances, but no FS).
  if (size <= 0.0) {
    out.clip = vec4<f32>(0.0, 0.0, 2.0, 1.0); // outside clip volume
    out.color = color;
    return out;
  }
  // World size: impostor/formation use size as world units.
  // Icon (screenSpace > 0.5): size is target diameter in px →
  //   worldSize = px * (2 * cameraY * tan(fovy/2)) / viewportH
  var worldSize = size;
  if (screenSpace > 0.5) {
    let H = max(u.viewportH, 1.0);
    let cy = max(u.cameraY, 1.0);
    worldSize = size * (2.0 * cy * u.tanHalfFov) / H;
  }
  let s = sin(rotation);
  let c = cos(rotation);
  let rx = meshPos.x * c - meshPos.z * s;
  let rz = meshPos.x * s + meshPos.z * c;
  let local = center + vec3<f32>(rx * worldSize, meshPos.y * worldSize, rz * worldSize);
  let world = base + local;
  out.clip = u.viewProj * vec4<f32>(world, 1.0);
  out.color = color;
  return out;
}

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  return vec4<f32>(input.color, u.opacity);
}
`;
//# sourceMappingURL=fleet-ships.wgsl.js.map