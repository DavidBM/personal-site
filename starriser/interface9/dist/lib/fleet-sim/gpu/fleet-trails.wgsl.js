/**
 * L5b — fat trail ribbons (Line2-style screen-space expand).
 *
 * Geometry stays GPU-expanded by fleet-integrate into fixed per-ship slots
 * (no host upload). Draw reinterprets each segment pair as one instance and
 * expands a shared template ribbon — same algorithm family as `js/vendor/line2`
 * but:
 *   - screen-space only (no worldUnits / dash)
 *   - **variable width** from endpoint alpha (wide at head / fresh, thin at tail)
 *   - alpha from expand (dead slots α≈0 → discard)
 *
 * Instance layout = two consecutive expand verts (56 B / segment):
 *   start: pos.xyz + color.rgb + alpha
 *   end:   pos.xyz + color.rgb + alpha
 *
 * Width: `mix(widthTailPx, widthHeadPx, alpha)` — head = ship (high α), tail = old.
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
 * Uniform buffer: view + projection + resolution + width knobs.
 * 128 (2×mat4) + 32 (vec2 + 4 f32 + pad) = 160 bytes (16-byte aligned).
 */
export const TRAIL_UNIFORM_SIZE = 160;
export const TRAIL_UNIFORM_FLOATS = TRAIL_UNIFORM_SIZE / 4;
/** Bytes per trail segment instance (two expand verts). */
export const TRAIL_INSTANCE_STRIDE = TRAIL_LINE_STRIDE * 2;
/**
 * Line2 ribbon template (pos.xyz + uv.xy interleaved, 5 floats/vert).
 * Shared static buffer — identical to vendor Line2 template.
 */
export const TRAIL_TEMPLATE_VERT_COUNT = 8;
export const TRAIL_TEMPLATE_INDEX_COUNT = 18;
export const TRAIL_TEMPLATE_STRIDE = 20; // 5 × f32
export const TRAIL_TEMPLATE_INDICES = new Uint16Array([
    0, 2, 1, 2, 3, 1, 2, 4, 3, 4, 5, 3, 4, 6, 5, 6, 7, 5,
]);
/** Build interleaved template once (pos3 + uv2). */
export function buildTrailTemplateInterleaved() {
    // position.x = side (±1), position.y = along (−1…2), uv for endcap AA
    const positions = [
        -1, 2, 0, 1, 2, 0, -1, 1, 0, 1, 1, 0, -1, 0, 0, 1, 0, 0, -1, -1, 0, 1, -1, 0,
    ];
    const uvs = [-1, 2, 1, 2, -1, 1, 1, 1, -1, -1, 1, -1, -1, -2, 1, -2];
    const out = new Float32Array(TRAIL_TEMPLATE_VERT_COUNT * 5);
    for (let i = 0; i < TRAIL_TEMPLATE_VERT_COUNT; i++) {
        const o = i * 5;
        const p = i * 3;
        const u = i * 2;
        out[o] = positions[p];
        out[o + 1] = positions[p + 1];
        out[o + 2] = positions[p + 2];
        out[o + 3] = uvs[u];
        out[o + 4] = uvs[u + 1];
    }
    return out;
}
/**
 * Write trail draw uniforms into a staging Float32Array (length ≥ TRAIL_UNIFORM_FLOATS).
 * Matrices are column-major Mat4.
 */
export function writeTrailUniforms(out, view, projection, resolutionW, resolutionH, widthHeadPx = TRAIL_WIDTH_HEAD_PX, widthTailPx = TRAIL_WIDTH_TAIL_PX, softAA = true) {
    for (let i = 0; i < 16; i++)
        out[i] = view[i];
    for (let i = 0; i < 16; i++)
        out[16 + i] = projection[i];
    out[32] = Math.max(resolutionW, 1);
    out[33] = Math.max(resolutionH, 1);
    out[34] = widthHeadPx;
    out[35] = widthTailPx;
    out[36] = softAA ? 1 : 0;
    out[37] = 0;
    out[38] = 0;
    out[39] = 0;
}
export const FLEET_TRAILS_WGSL = /* wgsl */ `
// 160 B: 2×mat4 (128) + resolution.xy + widths + softAA + pad (32)
struct TrailUniforms {
  modelView : mat4x4<f32>,
  projection : mat4x4<f32>,
  resolution : vec2<f32>,
  widthHead : f32,
  widthTail : f32,
  softAA : f32,
  _pad0 : f32,
  _pad1 : f32,
  _pad2 : f32,
};

@group(0) @binding(0) var<uniform> u : TrailUniforms;

struct VSIn {
  // Template ribbon: position.x = side (±1), position.y = along (−1…2)
  @location(0) position : vec3<f32>,
  @location(1) uv : vec2<f32>,
  // Instance = one expand segment (older start → newer end)
  @location(2) instanceStart : vec3<f32>,
  @location(3) instanceColorStart : vec3<f32>,
  @location(4) instanceAlphaStart : f32,
  @location(5) instanceEnd : vec3<f32>,
  @location(6) instanceColorEnd : vec3<f32>,
  @location(7) instanceAlphaEnd : f32,
};

struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) vUv : vec2<f32>,
  @location(1) vColor : vec4<f32>, // rgb + alpha
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
  out.vUv = input.uv;

  // Dead expand slots (MID/FAR / tombstone): bail before mat4 work.
  // Required at 10k×CAP_NEAR full high-water trail draws (~3M instances).
  if (input.instanceAlphaStart <= 0.0 && input.instanceAlphaEnd <= 0.0) {
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

  var start = u.modelView * vec4<f32>(input.instanceStart, 1.0);
  var end_ = u.modelView * vec4<f32>(input.instanceEnd, 1.0);

  // Near-plane trim (Line2 / Three parity)
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

  // Screen-space direction (Line2 classic)
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
  // Line2: aspect on dir then undo on dir for endcaps; offset keeps aspect
  dir.x = dir.x / aspect;
  offset.x = offset.x / aspect;

  if (input.position.x < 0.0) {
    offset = -offset;
  }

  // Endcaps
  if (input.position.y < 0.0) {
    offset = offset - dir;
  } else if (input.position.y > 1.0) {
    offset = offset + dir;
  }

  // Variable linewidth (px) → NDC offset
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
  var alpha = input.vColor.a;
  let rgb = input.vColor.rgb;

  // Endcap distance (body |vUv.y| ≤ 1; skirts |vUv.y| > 1).
  let a = input.vUv.x;
  let b = select(input.vUv.y + 1.0, input.vUv.y - 1.0, input.vUv.y > 0.0);
  let len2 = a * a + b * b;
  // fwidth: uniform control flow only — call before any varying-based discard/if.
  let dlen = fwidth(len2);
  let inEndcap = abs(input.vUv.y) > 1.0;
  // softAA is a uniform (uniform CF OK)
  let soft = u.softAA > 0.5;

  // Soft endcaps only (MSAA + a2c smooth long edges). Body multiplies by 1.
  if (soft) {
    if (inEndcap) {
      alpha = alpha * (1.0 - smoothstep(1.0 - dlen, 1.0 + dlen, len2));
    }
  } else if (inEndcap && len2 > 1.0) {
    discard;
  }

  // Dead expand slots / fully faded endcaps
  if (alpha <= 0.001) {
    discard;
  }

  return vec4<f32>(rgb, alpha);
}
`;
//# sourceMappingURL=fleet-trails.wgsl.js.map