/**
 * L5b — fat trail ribbons (minimal screen-space quads).
 *
 * Geometry stays GPU-expanded by fleet-integrate into fixed per-ship slots
 * (no host upload). Draw reinterprets each segment pair as one instance and
 * expands a shared **body-only** rectangle — **not** the vendored Line2
 * endcap pill (map overlays keep Line2; trails do not).
 *
 * Per segment: **4 verts / 2 triangles** (side × along), screen-space
 * perpendicular offset, variable width from endpoint alpha.
 *
 * Instance layout = two consecutive expand verts (56 B / segment):
 *   start: pos.xyz + color.rgb + alpha
 *   end:   pos.xyz + color.rgb + alpha
 *
 * Width: `mix(widthTailPx, widthHeadPx, alpha)` — head = ship (high α), tail = old.
 * Long-edge AA: MSAA + alphaToCoverage (no circular soft endcaps).
 */
import { DEFAULT_TRAIL_LAYOUT, TRAIL_LINE_FLOATS_PER_SHIP, TRAIL_LINE_FLOATS_PER_VERT, TRAIL_LINE_STRIDE, TRAIL_SEGS_PER_SHIP, TRAIL_VERTS_PER_SHIP, } from "../visual/fleet-trail-ref.js";
export { TRAIL_LINE_FLOATS_PER_SHIP, TRAIL_LINE_FLOATS_PER_VERT, TRAIL_LINE_STRIDE, TRAIL_SEGS_PER_SHIP as TRAIL_DRAW_SEGS, TRAIL_VERTS_PER_SHIP, };
/** Game-default ring for static checks. Runtime uses layer.trailLayout. */
export const TRAIL_DRAW_RING_SIZE = DEFAULT_TRAIL_LAYOUT.ringSize;
/** Wide end at the ship (fresh samples, high alpha). Buffer pixels. */
export const TRAIL_WIDTH_HEAD_PX = 3.5;
/** Thin end at the oldest live sample. Buffer pixels. */
export const TRAIL_WIDTH_TAIL_PX = 0.45;
/**
 * Uniform buffer: relative view + projection + resolution + width knobs + origin.
 * 128 (2×mat4) + 32 (res/widths/flags) + 16 (origin.xyz + pad) = 176 bytes.
 * Layout kept stable; softAA slot is unused padding (trails have no endcap AA).
 */
export const TRAIL_UNIFORM_SIZE = 176;
export const TRAIL_UNIFORM_FLOATS = TRAIL_UNIFORM_SIZE / 4;
/** Bytes per trail segment instance (two expand verts). */
export const TRAIL_INSTANCE_STRIDE = TRAIL_LINE_STRIDE * 2;
/**
 * Body-only ribbon template (pos.xyz only, 12 B/vert).
 * position.x = side (±1), position.y = along (0 = start/tail, 1 = end/head).
 * Shared static buffer — 4 verts / 2 triangles (no Line2 endcap skirts).
 */
export const TRAIL_TEMPLATE_VERT_COUNT = 4;
/** Index count for drawIndexed / DrawIndexedIndirect (2 tris × 3). */
export const TRAIL_TEMPLATE_INDEX_COUNT = 6;
export const TRAIL_TEMPLATE_STRIDE = 12; // 3 × f32 (pos only)
export const TRAIL_TEMPLATE_INDICES = new Uint16Array([
    0, 2, 1, 2, 3, 1,
]);
/** Build template once (pos3 only). */
export function buildTrailTemplateInterleaved() {
    // x = side, y = along (0 start, 1 end), z unused
    return new Float32Array([
        -1, 0, 0, // 0 start left
        1, 0, 0, // 1 start right
        -1, 1, 0, // 2 end left
        1, 1, 0, // 3 end right
    ]);
}
/**
 * Write trail draw uniforms into a staging Float32Array (length ≥ TRAIL_UNIFORM_FLOATS).
 * `view` must be origin-relative (lookAt(eye−origin, target−origin)).
 * Matrices are column-major Mat4.
 *
 * SoftAA param is accepted but ignored (legacy call sites / layout pad at [36]).
 */
export function writeTrailUniforms(out, view, projection, resolutionW, resolutionH, widthHeadPx = TRAIL_WIDTH_HEAD_PX, widthTailPx = TRAIL_WIDTH_TAIL_PX, softAAOrOriginX = 0, originXOrY = 0, originYOrZ = 0, originZMaybe) {
    // Compat: old signature (…, softAA, ox, oy, oz) or new (…, ox, oy, oz).
    let originX = 0;
    let originY = 0;
    let originZ = 0;
    if (typeof softAAOrOriginX === "boolean") {
        originX = originXOrY;
        originY = originYOrZ;
        originZ = originZMaybe ?? 0;
    }
    else {
        originX = softAAOrOriginX;
        originY = originXOrY;
        originZ = originYOrZ;
    }
    for (let i = 0; i < 16; i++)
        out[i] = view[i];
    for (let i = 0; i < 16; i++)
        out[16 + i] = projection[i];
    out[32] = Math.max(resolutionW, 1);
    out[33] = Math.max(resolutionH, 1);
    out[34] = widthHeadPx;
    out[35] = widthTailPx;
    out[36] = 0; // unused (was softAA)
    // intensity (1 = full). 0 is treated as 1 in the shader so legacy zero-fill is safe.
    out[37] = 1;
    // minAlpha: hide expand samples below this (0 = full length). Model multi-trail sets >0.
    out[38] = 0;
    out[39] = 0;
    // Floating origin — VS subtracts before modelView (trail sample precision).
    out[40] = originX;
    out[41] = originY;
    out[42] = originZ;
    out[43] = 0;
}
/**
 * Optional multi-trail modulation for model LOD (intensity + length + widths).
 * Call after {@link writeTrailUniforms}. Defaults leave the single-trail path unchanged.
 */
export function writeTrailVariantModulation(out, intensity, minAlpha, widthHeadPx, widthTailPx) {
    out[37] = Math.max(0, intensity);
    out[38] = Math.max(0, Math.min(1, minAlpha));
    if (widthHeadPx !== undefined)
        out[34] = widthHeadPx;
    if (widthTailPx !== undefined)
        out[35] = widthTailPx;
}
export const FLEET_TRAILS_WGSL = /* wgsl */ `
// 176 B: 2×mat4 (128) + res/widths/flags (32) + origin.xyz + pad (16)
struct TrailUniforms {
  /** lookAt(eye−origin, target−origin) — origin-relative view. */
  modelView : mat4x4<f32>,
  projection : mat4x4<f32>,
  resolution : vec2<f32>,
  widthHead : f32,
  widthTail : f32,
  _padSoftAA : f32,
  /** Multiplies fragment alpha. 0 → treated as 1 (legacy zero-fill safe). */
  intensity : f32,
  /** Drop expand samples with max(alphaStart,alphaEnd) < minAlpha (shorter trails). */
  minAlpha : f32,
  _pad2 : f32,
  /** Frame floating origin; endpoints subtract before modelView. */
  origin : vec3<f32>,
  _pad3 : f32,
};

@group(0) @binding(0) var<uniform> u : TrailUniforms;

struct VSIn {
  // Template quad: position.x = side (±1), position.y = along (0 start, 1 end)
  @location(0) position : vec3<f32>,
  // Instance = one expand segment (older start → newer end)
  @location(1) instanceStart : vec3<f32>,
  @location(2) instanceColorStart : vec3<f32>,
  @location(3) instanceAlphaStart : f32,
  @location(4) instanceEnd : vec3<f32>,
  @location(5) instanceColorEnd : vec3<f32>,
  @location(6) instanceAlphaEnd : f32,
};

struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) vColor : vec4<f32>, // rgb + alpha
};

fn trimSegmentAlpha(start : vec4<f32>, end_ : vec4<f32>) -> f32 {
  let a = u.projection[2][2];
  let b = u.projection[3][2];
  var nearEstimate : f32;
  if (a > 0.0) {
    nearEstimate = -b / (a + 1.0);
  } else {
    nearEstimate = -0.5 * b / a;
  }
  return (nearEstimate - start.z) / (end_.z - start.z);
}

@vertex
fn vs_main(input : VSIn) -> VSOut {
  var out : VSOut;

  // Dead expand slots (MID/FAR / tombstone): bail before mat4 work.
  // Required at 10k×CAP_NEAR full high-water trail draws (~3M instances).
  if (input.instanceAlphaStart <= 0.0 && input.instanceAlphaEnd <= 0.0) {
    out.clip = vec4<f32>(0.0, 0.0, 2.0, 1.0);
    out.vColor = vec4<f32>(0.0);
    return out;
  }
  // Model multi-trail length: drop older (low-α) samples when minAlpha > 0.
  let peakA = max(input.instanceAlphaStart, input.instanceAlphaEnd);
  if (u.minAlpha > 0.0 && peakA < u.minAlpha) {
    out.clip = vec4<f32>(0.0, 0.0, 2.0, 1.0);
    out.vColor = vec4<f32>(0.0);
    return out;
  }

  // Endpoint pick: position.y < 0.5 → start (older/tail), else end (newer/head)
  let atStart = input.position.y < 0.5;
  let col = select(input.instanceColorEnd, input.instanceColorStart, atStart);
  let alp = select(input.instanceAlphaEnd, input.instanceAlphaStart, atStart);
  out.vColor = vec4<f32>(col, alp);

  // Width taper: high alpha (fresh / head) → widthHead; low → widthTail
  let wStart = mix(u.widthTail, u.widthHead, clamp(input.instanceAlphaStart, 0.0, 1.0));
  let wEnd = mix(u.widthTail, u.widthHead, clamp(input.instanceAlphaEnd, 0.0, 1.0));
  let linewidth = select(wEnd, wStart, atStart);

  let aspect = u.resolution.x / max(u.resolution.y, 1.0);

  // Endpoints are **already origin-relative** from integrate expand
  // (sample − origin + pot). Optional u.origin is a residual correction when
  // draw origin differs slightly; production writes 0 after expand-relative.
  var start = u.modelView * vec4<f32>(input.instanceStart - u.origin, 1.0);
  var end_ = u.modelView * vec4<f32>(input.instanceEnd - u.origin, 1.0);

  // Near-plane trim (cheap clip when segment crosses camera near)
  let perspective = abs(u.projection[2][3] + 1.0) < 1e-5;
  if (perspective) {
    if (start.z < 0.0 && end_.z >= 0.0) {
      let t = trimSegmentAlpha(start, end_);
      end_ = vec4<f32>(mix(start.xyz, end_.xyz, t), end_.w);
    } else if (end_.z < 0.0 && start.z >= 0.0) {
      let t = trimSegmentAlpha(end_, start);
      start = vec4<f32>(mix(end_.xyz, start.xyz, t), start.w);
    }
  }

  let clipStart = u.projection * start;
  let clipEnd = u.projection * end_;
  let ndcStart = clipStart.xyz / clipStart.w;
  let ndcEnd = clipEnd.xyz / clipEnd.w;

  // Screen-space direction → perpendicular half-width
  var dir = ndcEnd.xy - ndcStart.xy;
  dir.x = dir.x * aspect;
  let dirLen = length(dir);
  if (dirLen > 1e-8) {
    dir = dir / dirLen;
  } else {
    // Degenerate / dead slot — stable horizontal offset
    dir = vec2<f32>(1.0, 0.0);
  }

  var offset = vec2<f32>(dir.y, -dir.x); // perpendicular
  offset.x = offset.x / aspect;

  if (input.position.x < 0.0) {
    offset = -offset;
  }

  // Variable linewidth (px) → NDC offset (body only — no endcap along-push)
  offset = offset * linewidth;
  offset = offset / max(u.resolution.y, 1.0);

  var clip = select(clipEnd, clipStart, atStart);
  offset = offset * clip.w;
  clip = vec4<f32>(clip.xy + offset, clip.z, clip.w);
  out.clip = clip;
  return out;
}

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  // intensity 0 → 1 so zero-filled uniforms stay full strength.
  let inten = select(1.0, u.intensity, u.intensity > 0.0);
  let alpha = input.vColor.a * inten;
  let rgb = input.vColor.rgb;

  // Dead expand slots / fully faded segments
  if (alpha <= 0.001) {
    discard;
  }

  return vec4<f32>(rgb, alpha);
}
`;
//# sourceMappingURL=fleet-trails.wgsl.js.map