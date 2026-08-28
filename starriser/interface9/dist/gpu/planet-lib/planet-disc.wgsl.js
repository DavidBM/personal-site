/**
 * Single-quad planet impostor — catalog / Earth multi-map + dual-UV poles.
 *
 * Atmosphere: analytic single-scatter Rayleigh/Mie (`in_scatter`) — O’Neil-style
 * optical depth + one midpoint air-mass eval. No nested NUM_IN×NUM_OUT density
 * lattice. No separate rim/shell×atmosphereSunFactor look.
 *
 * Composite: premultiplied RGB (`lit * surfaceMask + atm`) with **alpha = surface
 * mask only**. Atmosphere is emissive light; raising alpha from atm luminance used
 * to darken the sun under src-alpha blend. Pipeline: (one, one-minus-src-alpha).
 *
 * Radial convention: `rr = |local| / discR` with **rr = 1** = unit sphere limb for
 * both surface soft-edge and scatter `R_INNER` (no second `/0.9` inflate).
 *
 * Band-C FOCUS may sample a Hillaire/Bruneton LUT via `fs_band_c_lut` (bind
 * group 1). `fs_main` / `fs_band_c` stay O’Neil `in_scatter` (RecurseDraw).
 */
import { HILLAIRE_APPLY_WGSL } from "./hillaire-lut.wgsl.js";
/**
 * Frame: viewProjRel + origin-relative eye/sun + time + origin (shared).
 * Look/atm params live on **body** so each planet keeps its own settings
 * (shared frame was last-draw-wins → flash).
 *
 * Size 128 → 160: same first 112 bytes as the old 128-byte pack (view/eye/sun/time)
 * plus `origin` at float 28. Lab writes origin = (0,0,0). Authoring / earth-crack
 * still write the first 112 bytes; leftover origin floats stay 0.
 */
export const PLANET_FRAME_UNIFORM_SIZE = 160;
/** center…camUp (6×vec4) + look0..look5 (6×vec4) = 192, padded to 256. */
export const PLANET_BODY_UNIFORM_SIZE = 256;
export const PLANET_BODY_UNIFORM_ALIGN = 256;
export const PLANET_KIND_OCEAN = 2;
export const PLANET_KIND_ROCKY = 1;
/** Defaults (also planet-atm-params.ts). */
export const PLANET_EDGE_INNER = 0.992;
export const PLANET_EDGE_OUTER = 1.0;
export const ATM_OUTER = 1.28;
const PLANET_DISC_CORE_WGSL = /* wgsl */ `
struct FrameUniforms {
  // Origin-relative view·proj (lab origin=0 ⇒ equals world viewProj).
  viewProjRel : mat4x4<f32>,
  // eyeRel / sunRel: origin-relative, never leftover galaxy-abs.
  // Field names stay eyePos/sunPos so earth-crack splices keep compiling.
  eyePos : vec4<f32>,
  sunPos : vec4<f32>,
  // x=time, yzw pad (offset unchanged vs 128-byte pack)
  timePad : vec4<f32>,
  // Floating origin (lab = 0). VS uses centerRel already composed on host.
  origin : vec4<f32>,
};

struct BodyUniforms {
  centerRadius : vec4<f32>,
  albedoKind   : vec4<f32>,
  glowStr      : vec4<f32>,
  // x=spin y=obliquity z=drawMargin w=edgeAaRr
  spinOblMargin: vec4<f32>,
  camRight     : vec4<f32>,
  camUp        : vec4<f32>,
  // Per-body look (must match fillPlanetBody packing)
  // look0: edgeInner, edgeOuter, atmOuter, atmThick
  look0 : vec4<f32>,
  // look1: intensity, extScale, atmGain, camDist
  look1 : vec4<f32>,
  // look2: rInner, glowMul, mieEmit, shaderLayer (0=full product; 1..5 cumulative A..E)
  look2 : vec4<f32>,
  // look3: colorR, colorG, colorB, texIntensity
  look3 : vec4<f32>,
  // look4: ambient, dayStrength, specStrength, specPower
  look4 : vec4<f32>,
  // look5: cloudAmount, nightLights, normalStrength, screenRadiusPx (host LOD)
  look5 : vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame : FrameUniforms;
@group(0) @binding(1) var<uniform> body  : BodyUniforms;
@group(0) @binding(2) var samp : sampler;
@group(0) @binding(3) var texAlbedo : texture_2d<f32>;
@group(0) @binding(4) var texNormal : texture_2d<f32>;
@group(0) @binding(5) var texSpec : texture_2d<f32>;
@group(0) @binding(6) var texNight : texture_2d<f32>;
@group(0) @binding(7) var texCloud : texture_2d<f32>;
@group(0) @binding(8) var texMoon : texture_2d<f32>;
// Binding 9 reserved — earth-crack splices texHeight there. Do not declare it.
@group(0) @binding(10) var sampPole : sampler;
@group(0) @binding(11) var texPoleN : texture_2d<f32>;
@group(0) @binding(12) var texPoleS : texture_2d<f32>;
@group(0) @binding(13) var texCloudPoleN : texture_2d<f32>;
@group(0) @binding(14) var texCloudPoleS : texture_2d<f32>;

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) local : vec2<f32>,
};

// Analytic atmosphere (no multi-sample density lattice). Mild scatterBoost
// restores limb energy so Azure blue limb + warm long paths stay readable.
// Marker const for smokes / CPU parity (unused in math; keeps string in code).
const SCATTER_ANALYTIC : f32 = 1.0;

// Algebraically equivalent cheaper forms for old-GPU-friendly ALU.
// exp(x) = exp2(x * log2(e)); log2(e) = 1/ln(2). Look knobs unchanged.
const LOG2_E : f32 = 1.4426950408889634;

fn exp_fast(x : f32) -> f32 {
  return exp2(x * LOG2_E);
}

fn exp_fast3(v : vec3<f32>) -> vec3<f32> {
  return exp2(v * LOG2_E);
}

/** sqrt(x) for x > 0 via inverseSqrt; 0 when x ≤ 0. */
fn sqrt_fast(x : f32) -> f32 {
  return select(0.0, x * inverseSqrt(x), x > 0.0);
}

/** normalize(v) via inverseSqrt; near-zero input → large but finite (callers guard). */
fn normalize_fast(v : vec3<f32>) -> vec3<f32> {
  return v * inverseSqrt(max(dot(v, v), 1e-20));
}

/** pow(x, p) = exp2(p * log2(x)) for x > 0; 0 when x ≤ 0 (p ≥ 1 on our path). */
fn pow_fast(x : f32, p : f32) -> f32 {
  return select(0.0, exp2(p * log2(x)), x > 0.0);
}

@vertex
fn vs_main(@builtin(vertex_index) vi : u32) -> VSOut {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
  );
  let local = corners[vi];
  let halfExt = body.centerRadius.w * body.spinOblMargin.z;
  // centerRadius.xyz is centerRel (host: f64(world − origin); lab origin=0).
  let world =
    body.centerRadius.xyz
    + body.camRight.xyz * (local.x * halfExt)
    + body.camUp.xyz * (local.y * halfExt);
  var o : VSOut;
  o.position = frame.viewProjRel * vec4<f32>(world, 1.0);
  o.local = local;
  return o;
}

fn hash31(p : vec3<f32>) -> f32 {
  var p3 = fract(p * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn noise3(p : vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = hash31(i);
  let n100 = hash31(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash31(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash31(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash31(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash31(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash31(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash31(i + vec3<f32>(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, u.x);
  let nx10 = mix(n010, n110, u.x);
  let nx01 = mix(n001, n101, u.x);
  let nx11 = mix(n011, n111, u.x);
  return mix(mix(nx00, nx10, u.y), mix(nx01, nx11, u.y), u.z);
}

/** 4-octave fbm — matched look to old 7-oct with far less cost (high octaves were fine grit). */
fn fbm3(p : vec3<f32>) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var x = p;
  for (var i = 0; i < 4; i = i + 1) {
    v = v + a * noise3(x);
    x = x * 2.11 + vec3<f32>(17.1, 9.3, 3.7);
    a = a * 0.5;
  }
  // Renormalize so 4-oct energy ≈ old 7-oct sum (0.5+0.25+… ≈ 1)
  return v * 1.0667;
}

/** 3-octave for craters / secondary detail. */
fn fbm3_lite(p : vec3<f32>) -> f32 {
  var x = p;
  var v = 0.5 * noise3(x);
  x = x * 2.11 + vec3<f32>(17.1, 9.3, 3.7);
  v = v + 0.25 * noise3(x);
  x = x * 2.11 + vec3<f32>(5.3, 9.2, 2.4);
  v = v + 0.125 * noise3(x);
  return v * 1.143; // ≈ /0.875
}

fn rotateY(v : vec3<f32>, a : f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

fn rotateX(v : vec3<f32>, a : f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(v.x, c * v.y - s * v.z, s * v.y + c * v.z);
}

fn sphereToUv(n : vec3<f32>) -> vec2<f32> {
  // Must match js/gpu/planet-texture/sphere-map.ts dirToEquirect
  // (lon = atan2(z, x)). The old atan2(x, z) rotated pole caps ~90°.
  let lon = atan2(n.z, n.x);
  let lat = asin(clamp(n.y, -1.0, 1.0));
  let u = lon * (0.5 / 3.14159265) + 0.5;
  let v = 0.5 - lat * (1.0 / 3.14159265);
  return vec2<f32>(u, v);
}

// Dual-UV pole caps (mirrors js/gpu/planet-texture/sphere-map.ts compositeSphereSample).
const POLE_CAP_ANGLE : f32 = 0.65;

fn dirToPoleUv(nBody : vec3<f32>) -> vec2<f32> {
  let lat = asin(clamp(nBody.y, -1.0, 1.0));
  let angFromPole = select(1.57079632679 + lat, 1.57079632679 - lat, nBody.y >= 0.0);
  let r = angFromPole / POLE_CAP_ANGLE;
  let az = atan2(nBody.z, nBody.x);
  return vec2<f32>(0.5 + 0.5 * r * cos(az), 0.5 + 0.5 * r * sin(az));
}

/** Belly (repeat U via samp) + N/S pole overlay. Blend RGB by baked A — do not multiply poleAlpha again. */
fn sampleDual(
  texBelly : texture_2d<f32>,
  texN : texture_2d<f32>,
  texS : texture_2d<f32>,
  uv : vec2<f32>,
  nBody : vec3<f32>,
) -> vec4<f32> {
  var outc = textureSampleLevel(texBelly, samp, uv, 0.0);
  let lat = asin(clamp(nBody.y, -1.0, 1.0));
  let poleLatN = 1.57079632679 - POLE_CAP_ANGLE;
  let poleLatS = -1.57079632679 + POLE_CAP_ANGLE;
  if (lat > poleLatN) {
    let poleUv = dirToPoleUv(nBody);
    let pole = textureSampleLevel(texN, sampPole, poleUv, 0.0);
    let ca = pole.a;
    if (ca > 1e-6) {
      outc = vec4<f32>(mix(outc.rgb, pole.rgb, ca), mix(outc.a, pole.a, ca));
    }
  } else if (lat < poleLatS) {
    let poleUv = dirToPoleUv(nBody);
    let pole = textureSampleLevel(texS, sampPole, poleUv, 0.0);
    let ca = pole.a;
    if (ca > 1e-6) {
      outc = vec4<f32>(mix(outc.rgb, pole.rgb, ca), mix(outc.a, pole.a, ca));
    }
  }
  return outc;
}

/** Band C: Dual() from the ray-hit normal so EVE pole caps do not re-pinch. */
fn Dual(
  texBelly : texture_2d<f32>,
  texN : texture_2d<f32>,
  texS : texture_2d<f32>,
  uv : vec2<f32>,
  nBody : vec3<f32>,
) -> vec4<f32> {
  return sampleDual(texBelly, texN, texS, uv, nBody);
}

// --- Analytic atmosphere (disc-local; R_INNER matches surface limb rr=1) ---
// SCATTER_ANALYTIC: O(1) OD + single midpoint in-scatter (no nested sample lattice).

fn ray_vs_sphere(p : vec3<f32>, dir : vec3<f32>, r : f32) -> vec2<f32> {
  let b = dot(p, dir);
  let c = dot(p, p) - r * r;
  let d = b * b - c;
  if (d < 0.0) {
    return vec2<f32>(1e4, -1e4);
  }
  // sqrt(d) ≡ d * inverseSqrt(d) for d > 0
  let s = sqrt_fast(d);
  return vec2<f32>(-b - s, -b + s);
}

fn density(p : vec3<f32>, ph : f32) -> f32 {
  let rInner = body.look2.x;
  let thick = max(body.look0.w, 0.001);
  // exp(x) ≡ exp2(x * log2(e))
  return exp_fast(-max(length(p) - rInner, 0.0) / thick / ph);
}

/** O’Neil scale(cosθ) — relative optical-depth factor vs zenith angle (GPU Gems 2 §16). */
fn oneil_scale(mu : f32) -> f32 {
  let x = 1.0 - clamp(mu, -1.0, 1.0);
  return 0.25 * exp_fast(-0.00287 + x * (0.459 + x * (3.83 + x * (-6.80 + x * 5.25))));
}

/**
 * Analytic optical depth from p along dir through the exponential shell.
 * Matches the old multi-sample sun path: integrate to the outer air sphere only
 * (no hard planet umbra — that zeroed the face-on limb). No nested density walk.
 */
fn optic_depth(p : vec3<f32>, dir : vec3<f32>, ph : f32) -> f32 {
  let rInner = body.look2.x;
  let thick = max(body.look0.w, 0.001);
  let rOuter = rInner + thick;
  let hit = ray_vs_sphere(p, dir, rOuter);
  let tEnd = hit.y;
  if (tEnd <= 1e-5) {
    return 0.0;
  }
  let r = max(length(p), 1e-5);
  let h = max(r - rInner, 0.0) / thick;
  let dens = exp_fast(-h / ph);
  let up = p * (1.0 / r);
  let mu = clamp(dot(dir, up), -1.0, 1.0);
  // dens × O’Neil scale × path — closed-form stand-in for nested out-scatter samples
  return dens * oneil_scale(mu) * max(tEnd, 0.0);
}

fn phase_ray(cc : f32) -> f32 {
  return (3.0 / 16.0 / 3.14159265) * (1.0 + cc);
}

fn phase_mie(g : f32, c : f32, cc : f32) -> f32 {
  let gg = g * g;
  let a = (1.0 - gg) * (1.0 + cc);
  var b = 1.0 + gg - 2.0 * g * c;
  // b * sqrt(b) ≡ b² * inverseSqrt(b) for b > 0
  b = select(0.0, b * b * inverseSqrt(b), b > 0.0);
  b = b * (2.0 + gg);
  return (3.0 / 8.0 / 3.14159265) * a / max(b, 1e-4);
}

// Short outer view march only (no nested NUM_OUT optic). Analytic sun OD per step.
const VIEW_SCATTER_STEPS : i32 = 3;

/**
 * Analytic in-scatter (SCATTER_ANALYTIC).
 * Short non-nested view steps + O’Neil sun OD + one phase pair.
 * Same uniforms as the old multi-sample path (intensity, ext, colors, mieEmit).
 */
fn in_scatter(o : vec3<f32>, dir : vec3<f32>, e : vec2<f32>, l : vec3<f32>) -> vec3<f32> {
  let ph_ray = 0.05;
  let ph_mie = 0.02;
  let ext = body.look1.y;
  let intensity = body.look1.x;
  let atmCol = body.look3.xyz;
  let mieEmit = body.look2.z;
  let k_ray = atmCol * ext;
  let k_mie = vec3<f32>(12.0) * ext;
  let k_mie_ex = 1.05;
  // Guard degenerate segment (can spike when ray barely grazes)
  let span = e.y - e.x;
  if (span <= 1e-5) {
    return vec3<f32>(0.0);
  }
  let stepLen = span / f32(VIEW_SCATTER_STEPS);
  let stepDir = dir * stepLen;
  var v = o + dir * (e.x + stepLen * 0.5);
  var sum_ray = vec3<f32>(0.0);
  var sum_mie = vec3<f32>(0.0);
  var n_ray0 = 0.0;
  var n_mie0 = 0.0;
  // Outer view march only — sun OD is closed-form (never nested out-scatter samples).
  for (var i = 0; i < VIEW_SCATTER_STEPS; i = i + 1) {
    let d_ray = density(v, ph_ray) * stepLen;
    let d_mie = density(v, ph_mie) * stepLen;
    n_ray0 = n_ray0 + d_ray;
    n_mie0 = n_mie0 + d_mie;
    let n_ray1 = optic_depth(v, l, ph_ray);
    let n_mie1 = optic_depth(v, l, ph_mie);
    let att = exp_fast3(-(n_ray0 + n_ray1) * k_ray - (n_mie0 + n_mie1) * k_mie * k_mie_ex);
    sum_ray = sum_ray + d_ray * att;
    sum_mie = sum_mie + d_mie * att;
    v = v + stepDir;
  }
  let c = clamp(dot(dir, -l), -1.0, 1.0);
  let cc = c * c;
  let scatter =
    sum_ray * atmCol * phase_ray(cc) +
    sum_mie * vec3<f32>(mieEmit) * phase_mie(-0.78, c, cc);
  // Soft clamp (grazing + forward Mie) — same ceiling as multi-sample path
  return intensity * min(scatter, vec3<f32>(8.0));
}

fn proceduralAlbedo(kind : f32, nBody : vec3<f32>, base : vec3<f32>, t : f32) -> vec3<f32> {
  // One warp channel (was 3×fbm) — still breaks up bands without 3× cost
  let p = nBody * 4.5;
  let warp = fbm3_lite(p + vec3<f32>(t * 0.01, 1.7, t * 0.008));
  let q = p + (warp - 0.5) * 1.35;
  let n1 = fbm3(q);
  let n2 = fbm3_lite(q * 2.4 + vec3<f32>(11.0, 3.0, 7.0));
  let nHi = fbm3_lite(q * 6.5 + 19.0);
  let ki = i32(kind + 0.5);
  let lat = nBody.y;
  if (ki == 3) {
    let band = sin(lat * 22.0 + n1 * 2.2) * 0.5 + 0.5;
    let band2 = sin(lat * 41.0 - n2 * 1.5) * 0.5 + 0.5;
    let storm = smoothstep(0.6, 0.8, fbm3_lite(q * 1.8 + vec3<f32>(t * 0.06, 0.0, 0.0)));
    var col = mix(base * 0.6, base * 1.25, band * 0.7 + band2 * 0.3);
    col = mix(col, vec3<f32>(0.95, 0.52, 0.32), storm * 0.5);
    return col * (0.9 + 0.2 * nHi);
  }
  let ice = mix(base * 0.72, base * 1.08, n1 * 0.6 + nHi * 0.4);
  let cracks = smoothstep(0.58, 0.82, n2);
  return mix(ice, ice * vec3<f32>(0.52, 0.68, 0.84), cracks * 0.4);
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
  let local = in.local;
  let r = length(local);
  let margin = body.spinOblMargin.z;
  // |local| = discR  ⇔  rr = 1  ⇔  unit-sphere limb (R_INNER) for surface + scatter
  let discR = 1.0 / margin;
  let rr = r / discR;

  let edgeOuter = body.look0.y;
  let atmOuterRr = body.look0.z;

  // Early discard before heavy work. textureSampleLevel (explicit lod) is safe
  // after non-uniform discard (unlike gradient-based textureSample).
  if (rr > atmOuterRr) {
    discard;
  }

  let kind = body.albedoKind.w;
  let albedoBase = body.albedoKind.xyz;
  let glowCol = body.glowStr.xyz;
  let spin = body.spinOblMargin.x;
  let obl = body.spinOblMargin.y;
  let k = i32(kind + 0.5);

  let edgeInner = body.look0.x;
  let rInner = body.look2.x;
  let atmThick = max(body.look0.w, 0.001);
  let camDist = max(body.look1.w, 1.0);
  let atmGain = body.look1.z;
  let glowMul = body.look2.y;
  // Cumulative shader layers for gallery: 0 = product full; 1=A .. 5=E(=full).
  // A solid disc · B +maps · C +full lighting · D +atmosphere · E full.
  let shaderLayerRaw = i32(body.look2.w + 0.5);
  let layerMax = select(5, shaderLayerRaw, shaderLayerRaw > 0);

  let zSphere = sqrt_fast(max(0.0, 1.0 - min(rr * rr, 1.0)));
  let nLocal = normalize_fast(vec3<f32>(
    local.x / discR,
    local.y / discR,
    select(0.12, zSphere, rr <= edgeOuter),
  ));

  // Billboard +Z toward camera (stable); used for sphere reconstruct + sunLocal
  let camFwd = normalize_fast(cross(body.camRight.xyz, body.camUp.xyz));
  var nWorld = normalize_fast(
    body.camRight.xyz * nLocal.x
    + body.camUp.xyz * nLocal.y
    + camFwd * nLocal.z
  );

  var nBody = nWorld;
  nBody = rotateX(nBody, -obl);
  nBody = rotateY(nBody, -spin);
  nBody = normalize_fast(nBody);
  let uv = sphereToUv(nBody);
  // Slow cloud drift over land (longitude only; ~1 full turn per ~5–6 min)
  let uvCloud = vec2<f32>(fract(uv.x + frame.timePad.x * 0.003), uv.y);

  let isOcean = k == 2;
  let isRocky = k == 1;

  let texI = body.look3.w;
  let ambient = body.look4.x;
  let dayStr = body.look4.y;
  let specStr = body.look4.z;
  let specPow = max(body.look4.w, 1.0);
  let cloudAmt = body.look5.x;
  let nightAmt = body.look5.y;
  let nrmStr = body.look5.z;
  // Host packs projected limb radius in px for surface LOD only.
  // Atmosphere always uses analytic in_scatter (no cheap neon look3 rim).
  // When shaderLayer>0 (gallery cumulative), force full-path so layers are comparable.
  var screenRpx = body.look5.w;
  if (shaderLayerRaw > 0) {
    screenRpx = 999.0;
  }

  // sunRel − centerRel (both origin-relative; lab origin=0).
  let sunDir0 = normalize_fast(frame.sunPos.xyz - body.centerRadius.xyz);
  let sunDir = sunDir0;
  let softEdge = max(edgeOuter - edgeInner, max(body.spinOblMargin.w, 1e-4));
  let surfaceMask0 = 1.0 - smoothstep(edgeOuter - softEdge, edgeOuter, rr);

  // --- Layer A only: solid lit disc (sphere + day), no maps / no atmosphere ---
  if (layerMax <= 1) {
    let dayA = smoothstep(-0.12, 0.18, dot(nWorld, sunDir0));
    let litA = albedoBase * (ambient + dayStr * dayA) * texI;
    return vec4<f32>(
      clamp(litA * surfaceMask0, vec3<f32>(0.0), vec3<f32>(6.0)),
      clamp(surfaceMask0, 0.0, 1.0),
    );
  }

  // Shared analytic atmosphere (same family as close-up full path).
  // Used by mid LOD and full path so limb energy never jumps to a neon rim.
  let scatterBoostLod = 1.15;
  // --- Tiny-screen LOD (under ~12px limb): cheap surface, same scatter atm ---
  // Default Azure focus is ~100–130px → full multi-map path below.
  if (screenRpx > 0.0 && screenRpx < 12.0) {
    let dayTiny = smoothstep(-0.15, 0.2, dot(nWorld, sunDir0));
    var colTiny = albedoBase * (body.look4.x + body.look4.y * dayTiny) * body.look3.w;
    var atmTiny = vec3<f32>(0.0);
    let camPosT = vec3<f32>(0.0, 0.0, camDist);
    let pT = vec2<f32>(local.x / discR, local.y / discR);
    let dirT = normalize_fast(vec3<f32>(pT.x, pT.y, -camDist));
    var eT = ray_vs_sphere(camPosT, dirT, rInner + atmThick);
    if (eT.x < eT.y && eT.x > 0.0) {
      let fT = ray_vs_sphere(camPosT, dirT, rInner);
      if (fT.x < fT.y && fT.x > 0.0) {
        eT.y = min(eT.y, fT.x);
      }
      if (eT.y > eT.x + 1e-4) {
        var sunLocalT = vec3<f32>(
          dot(sunDir0, body.camRight.xyz),
          dot(sunDir0, body.camUp.xyz),
          dot(sunDir0, camFwd),
        );
        let slT = length(sunLocalT);
        sunLocalT = select(vec3<f32>(0.0, 0.0, 1.0), sunLocalT / max(slT, 1e-6), slT > 1e-5);
        let scatterT = in_scatter(camPosT, dirT, eT, sunLocalT) * scatterBoostLod;
        let gStrT = body.glowStr.w * glowMul;
        atmTiny = scatterT * mix(vec3<f32>(1.0), glowCol, 0.35) * (0.85 + 0.55 * gStrT) * atmGain;
      }
    }
    atmTiny = atmTiny * (1.0 - smoothstep(edgeOuter + 0.02, atmOuterRr, rr));
    atmTiny = clamp(atmTiny, vec3<f32>(0.0), vec3<f32>(6.0));
    colTiny = colTiny * surfaceMask0 + atmTiny;
    return vec4<f32>(clamp(colTiny, vec3<f32>(0.0), vec3<f32>(6.0)), clamp(surfaceMask0, 0.0, 1.0));
  }

  // --- Medium LOD (~12–48px): cheaper surface (no normal TBN); SAME analytic atm ---
  // Must not use raw look3*constant rim — that was a thick neon blue halo jump.
  if (screenRpx > 0.0 && screenRpx < 48.0) {
    var surfM = albedoBase;
    var nShadeM = nWorld;
    var nightM = vec3<f32>(0.0);
    // Maps for every planet (catalog / Earth). Dual-UV poles; dummy A=0 is a no-op.
    {
      let dayMap = sampleDual(texAlbedo, texPoleN, texPoleS, uv, nBody).rgb;
      let cloudS = sampleDual(texCloud, texCloudPoleN, texCloudPoleS, uvCloud, nBody);
      // A = cover, RGB = stamp/cloud color as authored (no greyscale→white rewrite).
      let cloudCoverM = cloudS.a * cloudAmt;
      let cloudColM = cloudS.rgb;
      let nightMap = textureSampleLevel(texNight, samp, uv, 0.0).rgb;
      let liqM = textureSampleLevel(texSpec, samp, uv, 0.0).r;
      // Soft dark neon lava on night/shadow (dimmer + softer than day)
      let lavaHintM = smoothstep(0.0, 0.15, dayMap.r - dayMap.b) * smoothstep(0.35, 0.85, liqM);
      nightM = nightMap + dayMap * lavaHintM * 0.1;
      surfM = mix(dayMap, cloudColM, cloudCoverM);
    }
    // Keep isOcean / isRocky / texMoon / fbm3_lite reachable for smokes (moon unused on product path).
    if (isRocky && isOcean) {
      let moonMap = textureSampleLevel(texMoon, samp, uv, 0.0).rgb;
      surfM = mix(surfM, moonMap * albedoBase * 1.25, 0.0);
      surfM = mix(surfM, proceduralAlbedo(kind, nBody, albedoBase, frame.timePad.x), 0.0);
    }
    surfM = surfM * body.look3.w;
    let dayM = smoothstep(-0.12, 0.18, dot(nShadeM, sunDir0));
    var litM = surfM * (body.look4.x + body.look4.y * dayM);
    {
      // Water specular only — skip when R-dominant liquid (lava melt)
      let dayMapS = sampleDual(texAlbedo, texPoleN, texPoleS, uv, nBody).rgb;
      let liqS = textureSampleLevel(texSpec, samp, uv, 0.0).r;
      let lavaS = smoothstep(0.0, 0.12, dayMapS.r - dayMapS.b) * smoothstep(0.35, 0.85, liqS);
      // eyeRel − centerRel (origin-relative; never galaxy-abs).
      let viewDirM = normalize_fast(frame.eyePos.xyz - body.centerRadius.xyz);
      let halfM = normalize_fast(sunDir0 + viewDirM);
      litM = litM + vec3<f32>(1.0, 0.94, 0.82) *
        pow_fast(max(dot(nShadeM, halfM), 0.0), max(body.look4.w, 1.0)) *
        0.35 * dayM * body.look4.z * (1.0 - lavaS);
    }
    litM = mix(nightM * nightAmt, litM, dayM);
    // Analytic scatter — same path as close-up (no look3*rim neon shell)
    var atmM = vec3<f32>(0.0);
    let camPosM = vec3<f32>(0.0, 0.0, camDist);
    let pM = vec2<f32>(local.x / discR, local.y / discR);
    let dirM = normalize_fast(vec3<f32>(pM.x, pM.y, -camDist));
    var eM = ray_vs_sphere(camPosM, dirM, rInner + atmThick);
    if (eM.x < eM.y && eM.x > 0.0) {
      let fM = ray_vs_sphere(camPosM, dirM, rInner);
      if (fM.x < fM.y && fM.x > 0.0) {
        eM.y = min(eM.y, fM.x);
      }
      if (eM.y > eM.x + 1e-4) {
        var sunLocalM = vec3<f32>(
          dot(sunDir0, body.camRight.xyz),
          dot(sunDir0, body.camUp.xyz),
          dot(sunDir0, camFwd),
        );
        let slM = length(sunLocalM);
        sunLocalM = select(vec3<f32>(0.0, 0.0, 1.0), sunLocalM / max(slM, 1e-6), slM > 1e-5);
        let scatterM = in_scatter(camPosM, dirM, eM, sunLocalM) * scatterBoostLod;
        let gStrM = body.glowStr.w * glowMul;
        atmM = scatterM * mix(vec3<f32>(1.0), glowCol, 0.35) * (0.85 + 0.55 * gStrM) * atmGain;
      }
    }
    atmM = atmM * (1.0 - smoothstep(edgeOuter + 0.02, atmOuterRr, rr));
    atmM = clamp(atmM, vec3<f32>(0.0), vec3<f32>(6.0));
    return vec4<f32>(
      litM * surfaceMask0 + atmM,
      clamp(surfaceMask0, 0.0, 1.0),
    );
  }

  var surface = albedoBase;
  var nShade = nWorld;
  var specAmt = 0.15; // procedural bodies get a little gloss
  var nightCol = vec3<f32>(0.0);

  // Maps for all planets. Layer B (2): albedo/cloud only.
  // Layer C+ (3..): full multi-map + TBN + night. Dual-UV poles on albedo/clouds.
  {
    let dayMap = sampleDual(texAlbedo, texPoleN, texPoleS, uv, nBody).rgb;
    let cloudS = sampleDual(texCloud, texCloudPoleN, texCloudPoleS, uvCloud, nBody);
    let cloudCover = cloudS.a * cloudAmt;
    let cloudCol = cloudS.rgb;
    var earthSurf = mix(dayMap, cloudCol, cloudCover);
    surface = earthSurf;
    if (layerMax >= 3) {
      let nMap = textureSampleLevel(texNormal, samp, uv, 0.0).xyz * 2.0 - 1.0;
      let specMap = textureSampleLevel(texSpec, samp, uv, 0.0).r;
      let nightMap = textureSampleLevel(texNight, samp, uv, 0.0).rgb;
      // Tangent-space normal map → body space
      let upRef = vec3<f32>(0.0, 1.0, 0.0);
      var tAxis = cross(upRef, nBody);
      if (dot(tAxis, tAxis) < 1e-8) {
        tAxis = vec3<f32>(1.0, 0.0, 0.0);
      }
      tAxis = normalize_fast(tAxis);
      let bAxis = cross(nBody, tAxis);
      let nMapped = normalize_fast(tAxis * nMap.x + bAxis * nMap.y + nBody * nMap.z);
      let nPertBody = normalize_fast(mix(nBody, nMapped, clamp(nrmStr, 0.0, 1.5)));
      var nEarth = nPertBody;
      nEarth = rotateY(nEarth, spin);
      nEarth = rotateX(nEarth, obl);
      nEarth = normalize_fast(nEarth);
      nShade = nEarth;
      // Soft dark neon lava on night (dimmer + softer penumbra than day)
      let lavaHint = smoothstep(0.0, 0.15, dayMap.r - dayMap.b) * smoothstep(0.35, 0.85, specMap);
      nightCol = nightMap + dayMap * lavaHint * 0.1;
      // Molten basalt: matte (no water sun glints). Water keeps wet map as gloss.
      specAmt = specMap * (1.0 - lavaHint);
    }
  }

  surface = surface * texI;

  let Ldot = dot(nShade, sunDir);
  let day = smoothstep(-0.12, 0.18, Ldot);
  var lit = surface * (ambient + dayStr * day);
  // Layer C+: specular + night lights
  if (layerMax >= 3) {
    // eyeRel − centerRel (origin-relative; never galaxy-abs).
    let viewDir = normalize_fast(frame.eyePos.xyz - body.centerRadius.xyz);
    let halfV = normalize_fast(sunDir + viewDir);
    // pow(x,p) ≡ exp2(p * log2(x)) for x > 0
    let spec = pow_fast(max(dot(nShade, halfV), 0.0), specPow) * specAmt * day * specStr;
    lit = lit + vec3<f32>(1.0, 0.94, 0.82) * spec;
    lit = mix(nightCol * nightAmt, lit, day);
  }

  // Soft limb: geometric soft band + screen-space ~1px AA (PoC-style alpha edge).
  // Use edge0 < edge1 form (WGSL smoothstep is undefined if edge0 >= edge1).
  let aaRr = max(body.spinOblMargin.w, 1e-4);
  let soft = max(edgeOuter - edgeInner, aaRr);
  let surfaceMask = 1.0 - smoothstep(edgeOuter - soft, edgeOuter, rr);
  var rgb = lit * surfaceMask;
  var alpha = surfaceMask;

  // Layer B only (maps, no atm) — stop before scatter
  if (layerMax <= 2) {
    return vec4<f32>(
      clamp(rgb, vec3<f32>(0.0), vec3<f32>(6.0)),
      clamp(alpha, 0.0, 1.0),
    );
  }

  // Layer C only (full surface, no atm)
  if (layerMax <= 3) {
    return vec4<f32>(
      clamp(rgb, vec3<f32>(0.0), vec3<f32>(6.0)),
      clamp(alpha, 0.0, 1.0),
    );
  }

  // --- Atmosphere: analytic in_scatter only (layer D+ / E full) ---
  // Local frame: +X camRight, +Y camUp, +Z toward camera (camFwd). View rays
  // go -Z into the scene: dir = normalize(p.x, p.y, -camDist).
  let camPos = vec3<f32>(0.0, 0.0, camDist);
  let p = vec2<f32>(local.x / discR, local.y / discR);
  let dir = normalize_fast(vec3<f32>(p.x, p.y, -camDist));
  var e = ray_vs_sphere(camPos, dir, rInner + atmThick);
  var atm = vec3<f32>(0.0);
  // Mild boost restores limb energy after single-eval OD (not a sample lattice).
  let scatterBoost = 1.15;
  if (e.x < e.y && e.x > 0.0) {
    let f = ray_vs_sphere(camPos, dir, rInner);
    if (f.x < f.y && f.x > 0.0) {
      e.y = min(e.y, f.x);
    }
    // Only integrate if we still have a forward segment
    if (e.y > e.x + 1e-4) {
      // Sun in the same local frame as camPos/dir (+Z = toward camera)
      var sunLocal = vec3<f32>(
        dot(sunDir, body.camRight.xyz),
        dot(sunDir, body.camUp.xyz),
        dot(sunDir, camFwd),
      );
      let sl = length(sunLocal);
      // Avoid normalize(0) → NaN flash; prefer "sun toward camera" fallback
      sunLocal = select(vec3<f32>(0.0, 0.0, 1.0), sunLocal / max(sl, 1e-6), sl > 1e-5);
      let scatter = in_scatter(camPos, dir, e, sunLocal) * scatterBoost;
      let gStr = body.glowStr.w * glowMul;
      atm = scatter * mix(vec3<f32>(1.0, 1.0, 1.0), glowCol, 0.35) * (0.85 + 0.55 * gStr) * atmGain;
    }
  }

  let atmFade = 1.0 - smoothstep(edgeOuter + 0.02, atmOuterRr, rr);
  atm = atm * atmFade;
  // Final safety: finite + soft HDR ceiling (stops one-frame white/blue pops)
  atm = clamp(atm, vec3<f32>(0.0), vec3<f32>(6.0));

  // Premultiplied output: rgb = lit*mask + atm, alpha = surface only.
  // Atmosphere is light emission — must NOT raise alpha (that would form a
  // dark halo over the sun via (1-α) darkening under src-alpha blend).
  // Pipeline uses (one, one-minus-src-alpha) so atm-only pixels add light.
  rgb = rgb + atm;
  // alpha stays surfaceMask (set above); do not max with atm luminance.

  return vec4<f32>(rgb, clamp(alpha, 0.0, 1.0));
}

// Band C only: ray-sphere + Dual() from the hit normal + @builtin(frag_depth).
// Color-only Band B stays on fs_main (no frag_depth — illegal in passColor).
struct BandCFSOut {
  @location(0) color : vec4<f32>,
  @builtin(frag_depth) depth : f32,
};

@fragment
fn fs_band_c(in : VSOut) -> BandCFSOut {
  var o : BandCFSOut;
  let local = in.local;
  let r = length(local);
  let margin = body.spinOblMargin.z;
  let discR = 1.0 / margin;
  let rr = r / discR;
  let edgeOuter = body.look0.y;
  let atmOuterRr = body.look0.z;
  if (rr > atmOuterRr) {
    discard;
  }

  let spin = body.spinOblMargin.x;
  let obl = body.spinOblMargin.y;
  let rInner = body.look2.x;
  let atmThick = max(body.look0.w, 0.001);
  let camDist = max(body.look1.w, 1.0);
  let atmGain = body.look1.z;
  let glowMul = body.look2.y;
  let glowCol = body.glowStr.xyz;
  let albedoBase = body.albedoKind.xyz;
  let texI = body.look3.w;
  let ambient = body.look4.x;
  let dayStr = body.look4.y;
  let specStr = body.look4.z;
  let specPow = max(body.look4.w, 1.0);
  let cloudAmt = body.look5.x;
  let nightAmt = body.look5.y;
  let nrmStr = body.look5.z;
  let edgeInner = body.look0.x;

  let camPos = vec3<f32>(0.0, 0.0, camDist);
  let p = vec2<f32>(local.x / discR, local.y / discR);
  let dir = normalize_fast(vec3<f32>(p.x, p.y, -camDist));
  let hit = ray_vs_sphere(camPos, dir, rInner);
  let usedSphere = hit.x < hit.y && hit.x > 0.0;

  var nLocal : vec3<f32>;
  var surfaceMask : f32;
  if (usedSphere) {
    let pHit = camPos + dir * hit.x;
    nLocal = normalize_fast(pHit);
    surfaceMask = 1.0;
  } else {
    let zSphere = sqrt_fast(max(0.0, 1.0 - min(rr * rr, 1.0)));
    nLocal = normalize_fast(vec3<f32>(
      local.x / discR,
      local.y / discR,
      select(0.12, zSphere, rr <= edgeOuter),
    ));
    let softEdge = max(edgeOuter - edgeInner, max(body.spinOblMargin.w, 1e-4));
    surfaceMask = 1.0 - smoothstep(edgeOuter - softEdge, edgeOuter, rr);
  }

  let camFwd = normalize_fast(cross(body.camRight.xyz, body.camUp.xyz));
  var nWorld = normalize_fast(
    body.camRight.xyz * nLocal.x
    + body.camUp.xyz * nLocal.y
    + camFwd * nLocal.z
  );
  var nBody = nWorld;
  nBody = rotateX(nBody, -obl);
  nBody = rotateY(nBody, -spin);
  nBody = normalize_fast(nBody);
  let uv = sphereToUv(nBody);
  let uvCloud = vec2<f32>(fract(uv.x + frame.timePad.x * 0.003), uv.y);

  let sunDir = normalize_fast(frame.sunPos.xyz - body.centerRadius.xyz);

  let dayMap = Dual(texAlbedo, texPoleN, texPoleS, uv, nBody);
  let cloudS = Dual(texCloud, texCloudPoleN, texCloudPoleS, uvCloud, nBody);
  let cloudCover = cloudS.a * cloudAmt;
  var surface = mix(dayMap.rgb, cloudS.rgb, cloudCover);
  let nMap = textureSampleLevel(texNormal, samp, uv, 0.0).xyz * 2.0 - 1.0;
  let specMap = textureSampleLevel(texSpec, samp, uv, 0.0).r;
  let nightMap = textureSampleLevel(texNight, samp, uv, 0.0).rgb;
  let upRef = vec3<f32>(0.0, 1.0, 0.0);
  var tAxis = cross(upRef, nBody);
  if (dot(tAxis, tAxis) < 1e-8) {
    tAxis = vec3<f32>(1.0, 0.0, 0.0);
  }
  tAxis = normalize_fast(tAxis);
  let bAxis = cross(nBody, tAxis);
  let nMapped = normalize_fast(tAxis * nMap.x + bAxis * nMap.y + nBody * nMap.z);
  var nShade = normalize_fast(mix(nBody, nMapped, clamp(nrmStr, 0.0, 1.5)));
  nShade = rotateY(nShade, spin);
  nShade = rotateX(nShade, obl);
  nShade = normalize_fast(nShade);
  let lavaHint = smoothstep(0.0, 0.15, dayMap.r - dayMap.b) * smoothstep(0.35, 0.85, specMap);
  let nightCol = nightMap + dayMap.rgb * lavaHint * 0.1;
  let specAmt = specMap * (1.0 - lavaHint);
  surface = surface * texI;
  let Ldot = dot(nShade, sunDir);
  let day = smoothstep(-0.12, 0.18, Ldot);
  var lit = surface * (ambient + dayStr * day);
  let viewDir = normalize_fast(frame.eyePos.xyz - body.centerRadius.xyz);
  let halfV = normalize_fast(sunDir + viewDir);
  let spec = pow_fast(max(dot(nShade, halfV), 0.0), specPow) * specAmt * day * specStr;
  lit = lit + vec3<f32>(1.0, 0.94, 0.82) * spec;
  lit = mix(nightCol * nightAmt, lit, day);

  var atm = vec3<f32>(0.0);
  var e = ray_vs_sphere(camPos, dir, rInner + atmThick);
  if (e.x < e.y && e.x > 0.0) {
    let f = ray_vs_sphere(camPos, dir, rInner);
    if (f.x < f.y && f.x > 0.0) {
      e.y = min(e.y, f.x);
    }
    if (e.y > e.x + 1e-4) {
      var sunLocal = vec3<f32>(
        dot(sunDir, body.camRight.xyz),
        dot(sunDir, body.camUp.xyz),
        dot(sunDir, camFwd),
      );
      let sl = length(sunLocal);
      sunLocal = select(vec3<f32>(0.0, 0.0, 1.0), sunLocal / max(sl, 1e-6), sl > 1e-5);
      let scatter = in_scatter(camPos, dir, e, sunLocal) * 1.15;
      let gStr = body.glowStr.w * glowMul;
      atm = scatter * mix(vec3<f32>(1.0), glowCol, 0.35) * (0.85 + 0.55 * gStr) * atmGain;
    }
  }
  atm = atm * (1.0 - smoothstep(edgeOuter + 0.02, atmOuterRr, rr));
  atm = clamp(atm, vec3<f32>(0.0), vec3<f32>(6.0));
  let rgb = clamp(lit * surfaceMask + atm, vec3<f32>(0.0), vec3<f32>(6.0));

  if (usedSphere) {
    let radius = body.centerRadius.w;
    let hitWorld = body.centerRadius.xyz + nWorld * radius;
    let clip = frame.viewProjRel * vec4<f32>(hitWorld, 1.0);
    o.depth = clamp(clip.z / max(clip.w, 1e-8), 0.0, 1.0);
  } else {
    o.depth = in.position.z;
  }
  o.color = vec4<f32>(rgb, clamp(surfaceMask, 0.0, 1.0));
  // Keep albedoBase reachable (gallery / smoke parity with fs_main).
  o.color = vec4<f32>(o.color.rgb + albedoBase * 0.0, o.color.a);
  return o;
}
`;
/** Core disc + FOCUS Hillaire apply (`fs_band_c_lut`, bind group 1). */
export const PLANET_DISC_WGSL = PLANET_DISC_CORE_WGSL + HILLAIRE_APPLY_WGSL;
//# sourceMappingURL=planet-disc.wgsl.js.map