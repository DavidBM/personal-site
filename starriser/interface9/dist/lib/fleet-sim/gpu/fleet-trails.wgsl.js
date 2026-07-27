/**
 * L5b — fat trail ribbons (minimal screen-space quads).
 *
 * Geometry stays GPU-expanded by fleet-integrate into fixed per-ship slots
 * (no host upload). Draw reinterprets each segment as one instance and
 * expands a shared **body-only** rectangle — **not** the vendored Line2
 * endcap pill (map overlays keep Line2; trails do not).
 *
 * Per segment: **4 verts / 2 triangles** (side × along). The trail is a
 * **continuous body**: at each shared sample both adjacent segs use the same
 * screen-space miter offset (from prev/start/end/next), so same-side joint
 * verts **coincide**. Miter is **limited + bevelled** near sharp/short folds
 * so new samples never fling pin spikes or flip left/right each frame.
 *
 * Instance layout (80 B / segment = TRAIL_SEGMENT_FLOATS):
 *   start: pos.xyz + color.rgb + alpha
 *   end:   pos.xyz + color.rgb + alpha
 *   prev:  pos.xyz  (older neighbor; = start if none)
 *   next:  pos.xyz  (newer neighbor; = end if none)
 *
 * Width: `mix(widthTailPx, widthHeadPx, alpha)` — head = ship (high α), tail = old.
 * Long-edge AA: MSAA + alphaToCoverage (no circular soft endcaps).
 */
import { DEFAULT_TRAIL_LAYOUT, TRAIL_LINE_FLOATS_PER_SHIP, TRAIL_LINE_FLOATS_PER_VERT, TRAIL_LINE_STRIDE, TRAIL_SEGMENT_FLOATS, TRAIL_SEGMENT_STRIDE, TRAIL_SEGS_PER_SHIP, TRAIL_VERTS_PER_SHIP, } from "../visual/fleet-trail-ref.js";
export { TRAIL_LINE_FLOATS_PER_SHIP, TRAIL_LINE_FLOATS_PER_VERT, TRAIL_LINE_STRIDE, TRAIL_SEGMENT_FLOATS, TRAIL_SEGMENT_STRIDE, TRAIL_SEGS_PER_SHIP as TRAIL_DRAW_SEGS, TRAIL_VERTS_PER_SHIP, };
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
/** Bytes per trail segment instance (start+end+prev+next). */
export const TRAIL_INSTANCE_STRIDE = TRAIL_SEGMENT_STRIDE;
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
/**
 * Max miter scale (|offset| / unit-normal). Spikes beyond this become bevel.
 * 2 ⇒ joint half-width ≤ 2× intended pixel half-width.
 */
export const TRAIL_MITER_LIMIT = 2.0;
/**
 * If nIn·nOut is below this, skip 1/dot miter (bevel / unit average).
 * Prevents flip-flop near 180° folds and opposite-normal noise.
 */
export const TRAIL_MITER_BEVEL_DOT = 0.15;
/**
 * Min projected segment length in aspect-corrected NDC. Shorter segs use a
 * stable normal (new samples almost on top of previous → garbage normalize).
 */
export const TRAIL_MIN_SEG_NDC = 1e-5;
function trailXyz(v) {
    if (Array.isArray(v))
        return [v[0], v[1], v[2]];
    const o = v;
    return [o.x, o.y, o.z];
}
function trailMat4MulVec4(m, x, y, z, w) {
    return [
        m[0] * x + m[4] * y + m[8] * z + m[12] * w,
        m[1] * x + m[5] * y + m[9] * z + m[13] * w,
        m[2] * x + m[6] * y + m[10] * z + m[14] * w,
        m[3] * x + m[7] * y + m[11] * z + m[15] * w,
    ];
}
/** Project world/model point → NDC xy via modelView * projection. */
function trailWorldToNdc(m, p, x, y, z) {
    const eye = trailMat4MulVec4(m, x, y, z, 1);
    const clip = trailMat4MulVec4(p, eye[0], eye[1], eye[2], eye[3]);
    const iw = clip[3] !== 0 ? 1 / clip[3] : 0;
    return { x: clip[0] * iw, y: clip[1] * iw, clip };
}
/** Aspect-corrected segment length in NDC (isotropic screen). */
export function trailSegLenScreen(ax, ay, bx, by, aspect) {
    const dx = (bx - ax) * aspect;
    const dy = by - ay;
    return Math.hypot(dx, dy);
}
/**
 * Unit left normal in **aspect-corrected screen space** (isotropic pixels).
 * Degenerate segs return a stable default (not a noisy normalize).
 */
export function trailUnitNormalScreen(ax, ay, bx, by, aspect) {
    let dx = (bx - ax) * aspect;
    let dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len >= TRAIL_MIN_SEG_NDC) {
        dx /= len;
        dy /= len;
        // Left normal in screen: (dy, -dx) — unit when dir is unit.
        return { nX: dy, nY: -dx, len };
    }
    // Stable fallback — never flip with sample noise on zero-length segs.
    return { nX: 0, nY: -1, len };
}
/** Screen-space unit normal → NDC offset basis (pre-linewidth). */
function trailScreenNormalToNdc(nX, nY, aspect) {
    return { x: nX / aspect, y: nY };
}
/**
 * Stable continuous-joint offset in screen space (pre-linewidth).
 * Path-ordered (nIn, nOut); both segs at a joint pass the same pair → meet.
 * - No join / degenerate → nFallback (segment normal)
 * - Sharp fold (nIn·nOut low) or tiny sum → unit bevel (no 1/dot spike)
 * - Mild turn → miter with hard {@link TRAIL_MITER_LIMIT}
 */
export function trailMiterOffsetScreen(nInX, nInY, nOutX, nOutY, hasJoin, nFallbackX, nFallbackY) {
    if (!hasJoin) {
        return { x: nFallbackX, y: nFallbackY };
    }
    const dJoin = nInX * nOutX + nInY * nOutY;
    let mx = nInX + nOutX;
    let my = nInY + nOutY;
    const mLen = Math.hypot(mx, my);
    // Opposite / near-180°: sum vanishes → flip-flop under noise. Unit bevel or fallback.
    if (mLen < 1e-4 || dJoin < TRAIL_MITER_BEVEL_DOT) {
        if (mLen < 1e-4) {
            return { x: nFallbackX, y: nFallbackY };
        }
        return { x: mx / mLen, y: my / mLen };
    }
    mx /= mLen;
    my /= mLen;
    // Path-ordered scale vs nIn so both segs share identical offset; hard limit.
    const cosH = Math.max(mx * nInX + my * nInY, 1e-4);
    let scale = 1 / cosH;
    if (scale > TRAIL_MITER_LIMIT) {
        scale = TRAIL_MITER_LIMIT;
    }
    return { x: mx * scale, y: my * scale };
}
/** @deprecated alias */
export function trailMiterOffsetNdc(nInX, nInY, nOutX, nOutY, hasJoin, nFallbackX = nInX, nFallbackY = nInY) {
    return trailMiterOffsetScreen(nInX, nInY, nOutX, nOutY, hasJoin, nFallbackX, nFallbackY);
}
/**
 * Expand one body-quad corner in screen space — ε-aligned with trail VS.
 * Continuous mode uses miter at endpoints (shared joint verts across segs).
 */
export function expandTrailBodyCorner(params) {
    const [sx, sy, sz] = trailXyz(params.start);
    const [ex, ey, ez] = trailXyz(params.end);
    const prev = params.prev !== undefined ? trailXyz(params.prev) : [sx, sy, sz];
    const next = params.next !== undefined ? trailXyz(params.next) : [ex, ey, ez];
    const resY = Math.max(params.resolutionH, 1);
    const aspect = params.resolutionW / resY;
    const mv = params.modelView;
    const proj = params.projection;
    const atStart = params.along < 0.5;
    const continuous = params.jointMode !== "independent";
    const pStart = trailWorldToNdc(mv, proj, sx, sy, sz);
    const pEnd = trailWorldToNdc(mv, proj, ex, ey, ez);
    const pPrev = trailWorldToNdc(mv, proj, prev[0], prev[1], prev[2]);
    const pNext = trailWorldToNdc(mv, proj, next[0], next[1], next[2]);
    // Miter in isotropic screen space so adjacent segs share identical side verts.
    const nSeg = trailUnitNormalScreen(pStart.x, pStart.y, pEnd.x, pEnd.y, aspect);
    let offScreenX = nSeg.nX;
    let offScreenY = nSeg.nY;
    if (continuous) {
        // Require non-degenerate projected segs on both sides of the joint.
        if (atStart) {
            const nPrev = trailUnitNormalScreen(pPrev.x, pPrev.y, pStart.x, pStart.y, aspect);
            const hasPrev = nPrev.len >= TRAIL_MIN_SEG_NDC && nSeg.len >= TRAIL_MIN_SEG_NDC;
            const m = trailMiterOffsetScreen(nPrev.nX, nPrev.nY, nSeg.nX, nSeg.nY, hasPrev, nSeg.nX, nSeg.nY);
            offScreenX = m.x;
            offScreenY = m.y;
        }
        else {
            const nNext = trailUnitNormalScreen(pEnd.x, pEnd.y, pNext.x, pNext.y, aspect);
            const hasNext = nNext.len >= TRAIL_MIN_SEG_NDC && nSeg.len >= TRAIL_MIN_SEG_NDC;
            const m = trailMiterOffsetScreen(nSeg.nX, nSeg.nY, nNext.nX, nNext.nY, hasNext, nSeg.nX, nSeg.nY);
            offScreenX = m.x;
            offScreenY = m.y;
        }
    }
    // Screen → NDC lateral basis, then side flip.
    let offset = trailScreenNormalToNdc(offScreenX, offScreenY, aspect);
    let offsetX = offset.x;
    let offsetY = offset.y;
    if (params.side < 0) {
        offsetX = -offsetX;
        offsetY = -offsetY;
    }
    const lw = params.linewidthPx;
    offsetX = (offsetX * lw) / resY;
    offsetY = (offsetY * lw) / resY;
    const clip = atStart ? pStart.clip : pEnd.clip;
    const w = clip[3];
    return {
        x: clip[0] + offsetX * w,
        y: clip[1] + offsetY * w,
        z: clip[2],
        w,
    };
}
/**
 * Four body corners (L0, R0, L1, R1) for one segment.
 */
export function expandTrailBodyQuad(params) {
    const base = params;
    return {
        leftStart: expandTrailBodyCorner({ ...base, side: -1, along: 0 }),
        rightStart: expandTrailBodyCorner({ ...base, side: 1, along: 0 }),
        leftEnd: expandTrailBodyCorner({ ...base, side: -1, along: 1 }),
        rightEnd: expandTrailBodyCorner({ ...base, side: 1, along: 1 }),
    };
}
/** NDC xy of a clip corner. */
export function trailClipToNdc(c) {
    const iw = c.w !== 0 ? 1 / c.w : 0;
    return { x: c.x * iw, y: c.y * iw };
}
/**
 * Continuous-body joint check for two consecutive segments A→J and J→B.
 *
 * Independent perps leave a same-side joint mismatch; continuous miter with
 * shared neighbors makes same-side joint verts coincide (ε).
 * Also reports lateral offset magnitude (spike guard) and side-sign stability
 * under tiny polyline noise (flip-flop guard).
 * Drives the real {@link expandTrailBodyCorner} helper (same math as WGSL).
 */
export function trailJointContinuityCheck(opts) {
    const common = {
        modelView: opts.modelView,
        projection: opts.projection,
        resolutionW: opts.resolutionW,
        resolutionH: opts.resolutionH,
        linewidthPx: opts.linewidthPx,
    };
    const halfWNdc = opts.linewidthPx / Math.max(opts.resolutionH, 1);
    // Independent: segment-only perps at shared joint (daylight / mismatch).
    const indA = expandTrailBodyCorner({
        ...common,
        start: opts.p0,
        end: opts.joint,
        side: 1,
        along: 1,
        jointMode: "independent",
    });
    const indB = expandTrailBodyCorner({
        ...common,
        start: opts.joint,
        end: opts.p2,
        side: 1,
        along: 0,
        jointMode: "independent",
    });
    const iA = trailClipToNdc(indA);
    const iB = trailClipToNdc(indB);
    const independentPerpGapNdc = Math.hypot(iA.x - iB.x, iA.y - iB.y);
    // Geometric joint NDC for offset magnitude.
    const jMv = trailMat4MulVec4(opts.modelView, opts.joint[0], opts.joint[1], opts.joint[2], 1);
    const jPr = trailMat4MulVec4(opts.projection, jMv[0], jMv[1], jMv[2], jMv[3]);
    const jNdc = { x: jPr[0] / jPr[3], y: jPr[1] / jPr[3] };
    // Continuous: both segs share the chain p0→joint→p2 as neighbors.
    const gaps = [];
    let maxMiterScale = 0;
    for (const side of [-1, 1]) {
        const cA = expandTrailBodyCorner({
            ...common,
            start: opts.p0,
            end: opts.joint,
            prev: opts.p0,
            next: opts.p2,
            side,
            along: 1,
            jointMode: "continuous",
        });
        const cB = expandTrailBodyCorner({
            ...common,
            start: opts.joint,
            end: opts.p2,
            prev: opts.p0,
            next: opts.p2,
            side,
            along: 0,
            jointMode: "continuous",
        });
        const a = trailClipToNdc(cA);
        const b = trailClipToNdc(cB);
        gaps.push(Math.hypot(a.x - b.x, a.y - b.y));
        const offA = Math.hypot(a.x - jNdc.x, a.y - jNdc.y);
        const offB = Math.hypot(b.x - jNdc.x, b.y - jNdc.y);
        maxMiterScale = Math.max(maxMiterScale, offA / Math.max(halfWNdc, 1e-12), offB / Math.max(halfWNdc, 1e-12));
    }
    // Flip-flop guard: tiny noise on the path before the joint must not reverse
    // the continuous side offset sign at the joint (old 1/dot miter did).
    const noiseEps = 1e-3;
    const p0n1 = [
        opts.p0[0],
        opts.p0[1] + noiseEps,
        opts.p0[2],
    ];
    const p0n2 = [
        opts.p0[0],
        opts.p0[1] - noiseEps,
        opts.p0[2],
    ];
    const n1 = trailClipToNdc(expandTrailBodyCorner({
        ...common,
        start: opts.joint,
        end: opts.p2,
        prev: p0n1,
        next: opts.p2,
        side: 1,
        along: 0,
        jointMode: "continuous",
    }));
    const n2 = trailClipToNdc(expandTrailBodyCorner({
        ...common,
        start: opts.joint,
        end: opts.p2,
        prev: p0n2,
        next: opts.p2,
        side: 1,
        along: 0,
        jointMode: "continuous",
    }));
    // Lateral sign relative to joint (prefer y for horizontal chain fixtures).
    const s1 = Math.sign(n1.y - jNdc.y) || Math.sign(n1.x - jNdc.x);
    const s2 = Math.sign(n2.y - jNdc.y) || Math.sign(n2.x - jNdc.x);
    const sideSignStableUnderNoise = s1 === 0 || s2 === 0 || s1 === s2;
    return {
        independentPerpGapNdc,
        continuousJointGapNdc: Math.max(gaps[0], gaps[1]),
        continuousJointGapNdcLeft: gaps[0],
        continuousJointGapNdcRight: gaps[1],
        maxMiterScale,
        sideSignStableUnderNoise,
    };
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
  // Instance = one expand segment (older start → newer end + neighbors)
  @location(1) instanceStart : vec3<f32>,
  @location(2) instanceColorStart : vec3<f32>,
  @location(3) instanceAlphaStart : f32,
  @location(4) instanceEnd : vec3<f32>,
  @location(5) instanceColorEnd : vec3<f32>,
  @location(6) instanceAlphaEnd : f32,
  @location(7) instancePrev : vec3<f32>,
  @location(8) instanceNext : vec3<f32>,
};

struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) vColor : vec4<f32>, // rgb + alpha
};

// Stable continuous joints — match trailMiterOffsetScreen / pure TS.
const TRAIL_MITER_LIMIT : f32 = 2.0;
const TRAIL_MITER_BEVEL_DOT : f32 = 0.15;
const TRAIL_MIN_SEG_NDC : f32 = 1e-5;

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

/** Unit left normal + length in aspect-corrected screen space. */
fn trailSegNormalScreen(a : vec2<f32>, b : vec2<f32>, aspect : f32) -> vec3<f32> {
  var dir = b - a;
  dir.x = dir.x * aspect;
  let dirLen = length(dir);
  if (dirLen >= TRAIL_MIN_SEG_NDC) {
    dir = dir / dirLen;
    // Left normal (dir.y, -dir.x); z = length for degenerate checks
    return vec3<f32>(dir.y, -dir.x, dirLen);
  }
  // Stable fallback — never flip with near-zero sample noise
  return vec3<f32>(0.0, -1.0, dirLen);
}

/**
 * Path-ordered stable miter. Both segs at a joint pass the same (nIn,nOut)
 * so side verts meet. Hard limit + bevel near 180° kill spikes/flip-flop.
 */
fn trailMiterScreen(
  nIn : vec2<f32>,
  nOut : vec2<f32>,
  hasJoin : bool,
  nFallback : vec2<f32>,
) -> vec2<f32> {
  if (!hasJoin) {
    return nFallback;
  }
  let dJoin = dot(nIn, nOut);
  var m = nIn + nOut;
  let mLen = length(m);
  if (mLen < 1e-4 || dJoin < TRAIL_MITER_BEVEL_DOT) {
    if (mLen < 1e-4) {
      return nFallback;
    }
    return m / mLen; // unit bevel — no 1/dot spike
  }
  m = m / mLen;
  let cosH = max(dot(m, nIn), 1e-4);
  var scale = 1.0 / cosH;
  scale = min(scale, TRAIL_MITER_LIMIT);
  return m * scale;
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
  let prevE = u.modelView * vec4<f32>(input.instancePrev - u.origin, 1.0);
  let nextE = u.modelView * vec4<f32>(input.instanceNext - u.origin, 1.0);

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
  let clipPrev = u.projection * prevE;
  let clipNext = u.projection * nextE;
  let ndcStart = clipStart.xy / clipStart.w;
  let ndcEnd = clipEnd.xy / clipEnd.w;
  let ndcPrev = clipPrev.xy / clipPrev.w;
  let ndcNext = clipNext.xy / clipNext.w;

  // Continuous body: stable miter from incident segment normals (screen space).
  // Path-ordered (nIn, nOut) so both segs at a joint share the same offset.
  let nSegL = trailSegNormalScreen(ndcStart, ndcEnd, aspect);
  let nSeg = nSegL.xy;
  var offScreen : vec2<f32>;
  if (atStart) {
    let nPrevL = trailSegNormalScreen(ndcPrev, ndcStart, aspect);
    let hasPrev = nPrevL.z >= TRAIL_MIN_SEG_NDC && nSegL.z >= TRAIL_MIN_SEG_NDC;
    offScreen = trailMiterScreen(nPrevL.xy, nSeg, hasPrev, nSeg);
  } else {
    let nNextL = trailSegNormalScreen(ndcEnd, ndcNext, aspect);
    let hasNext = nNextL.z >= TRAIL_MIN_SEG_NDC && nSegL.z >= TRAIL_MIN_SEG_NDC;
    offScreen = trailMiterScreen(nSeg, nNextL.xy, hasNext, nSeg);
  }
  // Screen → NDC (aspect on x)
  var offset = vec2<f32>(offScreen.x / aspect, offScreen.y);

  if (input.position.x < 0.0) {
    offset = -offset;
  }

  // Variable linewidth (px) → NDC offset (body only — no along-push overlap)
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