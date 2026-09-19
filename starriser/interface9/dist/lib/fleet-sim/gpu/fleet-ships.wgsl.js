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
 * Uniforms carry cameraY / viewportH / viewportW / tanHalfFov so icon and
 * jewel triangles stay a fixed CSS size and face the screen.
 * Hull band: when modelLodActive>0.5, clip every triangle (hulls own the draw).
 */
export const FLEET_SHIP_DRAW_STRIDE = 48;
/** Screen-space flag written into draw pad (must match SHIP_DRAW_SCREEN_SPACE). */
export const FLEET_SHIP_SCREEN_SPACE_FLAG = 1;
/**
 * mat4 viewProjRel + origin.xyz + opacity + cameraY + viewportH + tanHalfFov +
 * modelLodActive + viewportW. Uniform `vec3` aligns to 16, so the trailing
 * pad lands at offset 112 and the struct is 128 B.
 */
export const FLEET_SHIP_UNIFORM_SIZE = 128;
export const FLEET_SHIPS_WGSL = /* wgsl */ `
struct Uniforms {
  /** proj * lookAt(eye−origin, target−origin). */
  viewProj : mat4x4<f32>,
  origin : vec3<f32>,
  opacity : f32,
  cameraY : f32,
  viewportH : f32,
  tanHalfFov : f32,
  /** 1 = jewel hull band: clip every triangle (hulls own the draw). */
  modelLodActive : f32,
  viewportW : f32,
  /** vec3 in uniform space is 16-byte aligned; this is the 128 B tail. */
  _pad : vec3<f32>,
};

@group(0) @binding(0) var<uniform> u : Uniforms;
/** 1 = hide this instance's formation triangle (model path owns it). */
@group(0) @binding(1) var<storage, read> modelHide : array<u32>;

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
  @builtin(instance_index) inst : u32,
) -> VSOut {
  var out : VSOut;
  // Hull band owns every simulated SCENE ship — triangles are off.
  if (u.modelLodActive > 0.5) {
    out.clip = vec4<f32>(0.0, 0.0, 2.0, 1.0);
    out.color = color;
    return out;
  }
  // Tombstone / hidden slots: skip work (still launched as instances, but no FS).
  if (size <= 0.0) {
    out.clip = vec4<f32>(0.0, 0.0, 2.0, 1.0); // outside clip volume
    out.color = color;
    return out;
  }
  // Camera-facing billboard in clip space. size is CSS px when screenSpace,
  // otherwise leftover world metres converted at this camera (tiny at galaxy
  // distance — never an 8px world floor that fills the map on jewel exit).
  let H = max(u.viewportH, 1.0);
  let W = max(u.viewportW, H);
  var sizePx = size;
  if (screenSpace <= 0.5) {
    let cy = max(u.cameraY, 1e-4);
    sizePx = size * H / max(2.0 * cy * u.tanHalfFov, 1e-8);
  }
  let sn = sin(rotation);
  let cs = cos(rotation);
  let mx = meshPos.x * cs - meshPos.z * sn;
  let mz = meshPos.x * sn + meshPos.z * cs;
  // Instance base is **already origin-relative**. Do not subtract origin again.
  let rel = base + center;
  var clip = u.viewProj * vec4<f32>(rel, 1.0);
  clip.x += mx * sizePx * (2.0 / W) * clip.w;
  clip.y += mz * sizePx * (2.0 / H) * clip.w;
  out.clip = clip;
  out.color = color;
  return out;
}

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  return vec4<f32>(input.color, u.opacity);
}
`;
//# sourceMappingURL=fleet-ships.wgsl.js.map