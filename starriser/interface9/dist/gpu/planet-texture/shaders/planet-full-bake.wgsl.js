/**
 * Full-fidelity planet bake on WebGPU compute (multi-pass).
 *
 * Three shader modules so each pipeline layout stays within
 * maxStorageBuffersPerShaderStage (default 8):
 *   terrain ≤7 storage, product ≤7, hydro ≤3.
 *
 * Order in each module: Params + pure noise → bindings (P) → P-using helpers → entry points.
 * Policies match bake.ts. Hydraulic Option B uses atomics (metric parity).
 */
const PLANET_BAKE_PURE = /* wgsl */ `

struct Params {
  width: u32,
  height: u32,
  seed: i32,
  planetClass: i32, // 0 ocean 1 temperate 2 rocky 3 ice 4 gas 5 exotic

  heightOctaves: i32,
  liquidKind: i32, // 0 water 1 methane 2 acid 3 lava 4 none
  thermalIters: i32,
  hydroDrops: i32,

  heightFreq: f32,
  warp: f32,
  continentScale: f32,
  mountainScale: f32,

  sea: f32,
  colorBoost: f32,
  cloudCover: f32,
  wetness: f32,

  talus: f32,
  streamK: f32,
  hydroInertia: f32,
  hydroCapacity: f32,

  hydroErosion: f32,
  hydroDeposition: f32,
  hydroEvap: f32,
  hydroGravity: f32,

  hydroMaxSteps: i32,
  hydroRadius: i32,
  blendCols: i32,
  hydroStepIdx: i32,

  normalStrength: f32,
  reinjectAmt: f32,
  coastSea: f32,
  coastBand: f32,

  atmR: f32,
  atmG: f32,
  atmB: f32,
  /** Base index for chunked 1D dispatches (gid.x + workOffset). */
  workOffset: u32,

  /** Polar ice footprint scale (1 = default; from poleIceExtentScale / poleSize). */
  poleIceScale: f32,
  _padPole0: f32,
  _padPole1: f32,
  _padPole2: f32,

  // Surface palette RGB (matches materials.ts SurfacePalette order)
  // indices 0..19: deep mid shelf shallow beach arid aridHot grass forest forestDeep
  //               lowland highland mountain rockDark snow tundra gasA gasB gasC gasStorm
  pal: array<vec4<f32>, 20>,
}

fn clamp01(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }

fn smoothstep_f(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / max(1e-8, e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn hash3(ix: i32, iy: i32, iz: i32, seed: i32) -> f32 {
  var n = ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 1013904223;
  var u = u32(n);
  u = u ^ (u >> 13u);
  n = i32(u);
  n = n * 1274126177;
  u = u32(n);
  u = u ^ (u >> 16u);
  return f32(u) / 4294967296.0;
}

fn fade(t: f32) -> f32 {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

fn lerp(a: f32, b: f32, t: f32) -> f32 { return a + (b - a) * t; }

fn valueNoise3(x: f32, y: f32, z: f32, seed: i32) -> f32 {
  let x0 = i32(floor(x));
  let y0 = i32(floor(y));
  let z0 = i32(floor(z));
  let fx = fade(x - f32(x0));
  let fy = fade(y - f32(y0));
  let fz = fade(z - f32(z0));
  let n000 = hash3(x0, y0, z0, seed);
  let n100 = hash3(x0 + 1, y0, z0, seed);
  let n010 = hash3(x0, y0 + 1, z0, seed);
  let n110 = hash3(x0 + 1, y0 + 1, z0, seed);
  let n001 = hash3(x0, y0, z0 + 1, seed);
  let n101 = hash3(x0 + 1, y0, z0 + 1, seed);
  let n011 = hash3(x0, y0 + 1, z0 + 1, seed);
  let n111 = hash3(x0 + 1, y0 + 1, z0 + 1, seed);
  let nx00 = lerp(n000, n100, fx);
  let nx10 = lerp(n010, n110, fx);
  let nx01 = lerp(n001, n101, fx);
  let nx11 = lerp(n011, n111, fx);
  return lerp(lerp(nx00, nx10, fy), lerp(nx01, nx11, fy), fz);
}

fn fbm3(x: f32, y: f32, z: f32, seed: i32, octaves: i32) -> f32 {
  var amp = 1.0;
  var freq = 1.0;
  var sum = 0.0;
  var norm = 0.0;
  let n = clamp(octaves, 1, 12);
  for (var i = 0; i < n; i++) {
    let v = valueNoise3(x * freq, y * freq, z * freq, seed + i * 101);
    sum += (v * 2.0 - 1.0) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  if (norm > 0.0) { return sum / norm; }
  return 0.0;
}

fn ridged3(x: f32, y: f32, z: f32, seed: i32, octaves: i32, freq0: f32) -> f32 {
  var amp = 0.5;
  var f = max(1e-4, freq0);
  var sum = 0.0;
  var weight = 1.0;
  let n = clamp(octaves, 1, 12);
  for (var i = 0; i < n; i++) {
    var s = valueNoise3(x * f, y * f, z * f, seed + i * 67);
    s = 1.0 - abs(s * 2.0 - 1.0);
    s = s * s;
    s = s * weight;
    weight = min(1.0, s * 1.6);
    sum += s * amp;
    amp *= 0.5;
    f *= 2.0;
  }
  return sum;
}

fn warpedFbm3(x: f32, y: f32, z: f32, seed: i32, octaves: i32, warp: f32, baseFreq: f32) -> f32 {
  let w = max(0.0, warp);
  let f = max(1e-4, baseFreq);
  let wx = fbm3(x * f * 0.7, y * f * 0.7, z * f * 0.7, seed + 17, 3) * w;
  let wy = fbm3(x * f * 0.7 + 19.1, y * f * 0.7 - 7.3, z * f * 0.7, seed + 31, 3) * w;
  let wz = fbm3(x * f * 0.7 - 5.2, y * f * 0.7 + 11.7, z * f * 0.7, seed + 53, 3) * w;
  return fbm3((x + wx) * f, (y + wy) * f, (z + wz) * f, seed, octaves);
}

struct Tec {
  continentalness: f32,
  uplift: f32,
  erosion: f32,
  peaks: f32,
  craton: f32,
}

fn sampleTectonicControls(x: f32, y: f32, z: f32, seed: i32, freq: f32, warp: f32, continentScale: f32) -> Tec {
  let f = max(1e-4, freq);
  let w = max(0.2, warp);
  let plateA = warpedFbm3(x, y, z, seed + 1, 3, w * 0.9, f * 0.22) * 0.5 + 0.5;
  let plateB = warpedFbm3(x, y, z, seed + 71, 3, w * 0.7, f * 0.35) * 0.5 + 0.5;
  var cont = warpedFbm3(x, y, z, seed + 11, 4, w * 1.15, f * 0.5) * 0.5 + 0.5;
  cont = cont * 0.55 + plateA * 0.28 + plateB * 0.17;
  let arch = warpedFbm3(x, y, z, seed + 131, 3, w * 0.4, f * 0.75) * 0.5 + 0.5;
  let craton = fbm3(x * f * 0.7, y * f * 0.7, z * f * 0.7, seed + 91, 3) * 0.5 + 0.5;
  let cPow = 1.0 / max(0.5, min(2.0, continentScale));
  cont = pow(clamp01(cont), cPow);
  cont = clamp01(cont * 0.92 + arch * 0.1 * continentScale * 0.45);
  cont = clamp01(cont + (craton - 0.5) * 0.08);

  let orogA = ridged3(x * 0.7, y * 1.4, z * 0.7, seed + 301, 4, f * 1.8);
  let orogB = ridged3(x * 1.3, y * 0.6, z * 1.3, seed + 311, 4, f * 2.6);
  let plateEdge = abs(plateA - plateB);
  let uplift = clamp01(orogA * 0.45 + orogB * 0.4 + plateEdge * 0.55);

  let erosion = fbm3(x * f * 1.6, y * f * 1.6, z * f * 1.6, seed + 350, 4) * 0.5 + 0.5;

  let peakA = ridged3(x, y, z, seed + 401, 8, f * 22.0);
  let peakB = ridged3(x, y, z, seed + 411, 7, f * 36.0);
  let peakC = ridged3(x, y, z, seed + 421, 6, f * 52.0);
  let volcanic = ridged3(x, y, z, seed + 431, 5, f * 18.0);
  let peaks = clamp01(peakA * 0.42 + peakB * 0.32 + peakC * 0.2 + volcanic * 0.12);

  var out: Tec;
  out.continentalness = cont;
  out.uplift = uplift;
  out.erosion = clamp01(erosion);
  out.peaks = peaks;
  out.craton = clamp01(craton);
  return out;
}
`;
const PLANET_BAKE_AFTER_P = /* wgsl */ `
fn sampleHeightAtDir(x: f32, y: f32, z: f32) -> f32 {
  let seed = P.seed;
  let freq = P.heightFreq;
  let warp = P.warp;
  let continentScale = P.continentScale;
  let mountainScale = P.mountainScale;
  let planetClass = P.planetClass;
  let octaves = P.heightOctaves;

  if (planetClass == 4) {
    return fbm3(x * freq * 0.5, y * freq * 2.5, z * freq * 0.5, seed, 5) * 0.5 + 0.5;
  }

  let f = max(1e-4, freq);
  let mtn = max(0.35, mountainScale);
  let oct = clamp(octaves, 4, 10);

  let tec = sampleTectonicControls(x, y, z, seed, freq, warp, continentScale);
  let landMask = smoothstep_f(0.34, 0.56, tec.continentalness);
  let landSoft = smoothstep_f(0.28, 0.62, tec.continentalness);
  let chainMask = smoothstep_f(0.25, 0.65, tec.uplift) * landMask;
  let erode = tec.erosion;
  let reliefKeep = 1.0 - erode * 0.55;

  let abyssal = fbm3(x * f * 1.4, y * f * 1.4, z * f * 1.4, seed + 201, 5) * 0.5 + 0.5;
  let ridge = ridged3(x, y, z, seed + 211, 4, f * 2.2) * 0.5;
  let trench = ridged3(x * 1.1, y * 0.6, z * 1.1, seed + 221, 3, f * 3.5);
  let seamount = ridged3(x, y, z, seed + 231, 5, f * 8.0);
  let shelfNoise = fbm3(x * f * 0.9, y * f * 0.9, z * f * 0.9, seed + 241, 3) * 0.5 + 0.5;
  let shelf = landSoft * 0.35 + shelfNoise * 0.15 * (1.0 - landMask);
  var oceanFloor = 0.08 + abyssal * 0.22 + ridge * 0.12
    + seamount * 0.08 * (1.0 - landMask) - trench * 0.1 * (1.0 - landMask) + shelf * 0.35;

  let rangeA = ridged3(x, y, z, seed + 321, 6, f * 4.5);
  let rangeB = ridged3(x, y, z, seed + 331, 5, f * 7.0);
  let foothills = fbm3(x * f * 9.0, y * f * 9.0, z * f * 9.0, seed + 341, 5) * 0.5 + 0.5;
  let hills = fbm3(x * f * 12.0, y * f * 12.0, z * f * 12.0, seed + 501, 5) * 0.5 + 0.5;
  let micro = fbm3(x * f * 48.0, y * f * 48.0, z * f * 48.0, seed + 511, min(6, oct)) * 0.5 + 0.5;
  let microRidge = ridged3(x, y, z, seed + 521, 4, f * 64.0);
  let carve = fbm3(x * f * 14.0, y * f * 14.0, z * f * 14.0, seed + 531, 3) * 0.5 + 0.5;

  var land = 0.36 + tec.continentalness * 0.12 + tec.craton * 0.07
    + hills * 0.09 * reliefKeep + foothills * 0.07 * landMask * reliefKeep;
  land = land + chainMask * (rangeA * 0.3 + rangeB * 0.2) * mtn * (0.65 + 0.35 * reliefKeep);
  land = land + landMask * tec.peaks * (0.24 + 0.16 * mtn) * (1.0 - erode * 0.2);
  land = land + chainMask * tec.peaks * 0.14 * mtn;
  land = land + landMask * (micro * 0.05 + microRidge * 0.04);
  land = land - landMask * carve * 0.03 * (0.5 + erode * 0.5);

  if (planetClass == 2) {
    land = land + landMask * (rangeA * 0.12 + tec.peaks * 0.1) * mtn;
    oceanFloor = oceanFloor * 0.85;
  } else if (planetClass == 3) {
    land = land + landMask * (rangeB * 0.15 + microRidge * 0.08);
    land = land + abs(y) * 0.06;
  } else if (planetClass == 5) {
    let chaos = ridged3(x * 1.5, y * 1.5, z * 1.5, seed + 601, 5, f * 11.0);
    land = land + landMask * chaos * 0.15;
  }

  var h = oceanFloor * (1.0 - landMask) + land * landMask;
  if (planetClass == 0 || planetClass == 1) {
    h = h + 0.02 * (1.0 - abs(y)) * landMask;
  }
  return h;
}

fn idxOf(x: u32, y: u32) -> u32 { return y * P.width + x; }

fn wrapX(x: i32) -> u32 {
  let W = i32(P.width);
  return u32((x % W + W) % W);
}

fn clampY(y: i32) -> u32 {
  return u32(clamp(y, 0, i32(P.height) - 1));
}

fn packRgba8(r: f32, g: f32, b: f32, a: f32) -> u32 {
  let ri = u32(clamp(r, 0.0, 1.0) * 255.0 + 0.5);
  let gi = u32(clamp(g, 0.0, 1.0) * 255.0 + 0.5);
  let bi = u32(clamp(b, 0.0, 1.0) * 255.0 + 0.5);
  let ai = u32(clamp(a, 0.0, 1.0) * 255.0 + 0.5);
  return ri | (gi << 8u) | (bi << 16u) | (ai << 24u);
}

fn palRgb(i: u32) -> vec3<f32> {
  let v = P.pal[i];
  return vec3<f32>(v.x, v.y, v.z);
}

fn lerpRgb(a: vec3<f32>, b: vec3<f32>, t: f32) -> vec3<f32> {
  let u = clamp(t, 0.0, 1.0);
  return a + (b - a) * u;
}

fn boostRgb(c: vec3<f32>, amount: f32) -> vec3<f32> {
  let m = (c.x + c.y + c.z) / 3.0;
  let s = 1.0 + amount * 0.32;
  return clamp(vec3<f32>(
    m + (c.x - m) * s,
    m + (c.y - m) * s,
    m + (c.z - m) * s,
  ), vec3<f32>(0.0), vec3<f32>(1.0));
}

// Mulberry32 step (erosion.ts) — for parallel drop RNG from drop id
fn mulberry32_step(state: u32) -> u32 {
  var a = state + 0x6d2b79f5u;
  var t = a;
  t = (t ^ (t >> 15u)) * (t | 1u);
  t = t ^ (t + (t ^ (t >> 7u)) * (t | 61u));
  return t ^ (t >> 14u);
}

fn mulberry32_f(state: ptr<function, u32>) -> f32 {
  *state = mulberry32_step(*state);
  return f32(*state) / 4294967296.0;
}

/** Sphere-native ocean shallow cue [0,1] — shared terrain + product (cs_paint). */
fn sampleOceanBathymetry3d(x: f32, y: f32, z: f32, seed: i32, freq: f32) -> f32 {
  let f = max(1e-4, freq);
  let basin = fbm3(x * f * 0.28, y * f * 0.28, z * f * 0.28, seed + 201, 5) * 0.5 + 0.5;
  let basin2 = fbm3(x * f * 0.55 + 3.1, y * f * 0.55, z * f * 0.55 - 1.7, seed + 207, 4) * 0.5 + 0.5;
  let ridge = ridged3(x * 0.85, y * 1.35, z * 0.85, seed + 211, 5, f * 1.9);
  let ridge2 = ridged3(x * 1.4, y * 0.7, z * 1.4, seed + 217, 4, f * 3.1);
  let trench = ridged3(x * 1.15, y * 0.55, z * 1.15, seed + 221, 3, f * 3.6);
  let plain = fbm3(x * f * 1.35, y * f * 1.35, z * f * 1.35, seed + 231, 4) * 0.5 + 0.5;
  let seamount = ridged3(x, y, z, seed + 241, 5, f * 7.5);
  let fracture = fbm3(x * f * 2.4 + 9.0, y * f * 0.4, z * f * 2.4, seed + 251, 3) * 0.5 + 0.5;
  let shallow = 0.08 + basin * 0.18 + basin2 * 0.1 + ridge * 0.16 + ridge2 * 0.08
    + plain * 0.08 + seamount * 0.08 + fracture * 0.04 - trench * 0.16;
  return clamp01(shallow);
}

fn oceanHeightFromShallow(shallow01: f32, sea: f32, micro: f32) -> f32 {
  let t = clamp01(shallow01);
  var band: f32;
  if (t > 0.75) { band = 0.42 + (t - 0.75) * 0.9; }
  else if (t > 0.4) { band = 0.18 + (t - 0.4) * 0.7; }
  else { band = 0.05 + t * 0.32; }
  let h = sea * clamp01(band) - micro * 0.02;
  return clamp(h, 0.02, sea - 0.02);
}

/** Equirect shelf cue damped at poles (match polarSafeShelfCue). */
fn polarSafeShelfCue(prior01: f32, absLat: f32) -> f32 {
  let raw = clamp01((prior01 - 0.22) / 0.55);
  let tt = clamp01((absLat - 0.72) / 0.22);
  let polarDamp = tt * tt * (3.0 - 2.0 * tt);
  return clamp01(raw * (1.0 - polarDamp * 0.92));
}

fn oceanPaintDepth(sea: f32, height: f32, shallow01: f32) -> f32 {
  let fromField = 1.0 - clamp01(shallow01);
  let fromH = (sea - height) / max(1e-4, sea);
  return clamp01(0.28 + (fromField * 0.85 + clamp01(fromH) * 0.15) * 0.72);
}

// =====================================================================
// Height sample + reduce / normalize
// =====================================================================
`;
/** Height post-process stages. */
export const PLANET_FULL_BAKE_TERRAIN_WGSL = PLANET_BAKE_PURE + /* wgsl */ `
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> luts: array<f32>;
@group(0) @binding(2) var<storage, read_write> heightA: array<f32>;
@group(0) @binding(3) var<storage, read_write> heightB: array<f32>;
@group(0) @binding(4) var<storage, read_write> reduceBuf: array<f32>;
@group(0) @binding(5) var<storage, read_write> upliftBuf: array<f32>;
@group(0) @binding(6) var<storage, read_write> flowBuf: array<f32>;
@group(0) @binding(7) var<storage, read_write> flowAdd: array<f32>;

fn cosLon(x: u32) -> f32 { return luts[x]; }
fn sinLon(x: u32) -> f32 { return luts[P.width + x]; }
fn cosLat(y: u32) -> f32 { return luts[P.width * 2u + y]; }
fn sinLat(y: u32) -> f32 { return luts[P.width * 2u + P.height + y]; }
` + PLANET_BAKE_AFTER_P + /* wgsl */ `

@compute @workgroup_size(8, 8, 1)
fn cs_height(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let dx = cosLat(y) * cosLon(x);
  let dy = sinLat(y);
  let dz = cosLat(y) * sinLon(x);
  heightA[idxOf(x, y)] = sampleHeightAtDir(dx, dy, dz);
}

/**
 * Structure-first height: heightA = elevation prior (host upsample),
 * heightB = land mask 0/1 (host upsample). Writes composed height to heightA.
 * Micro relief is GPU fbm/ridged (bulk cost moved off main thread).
 * Ocean helpers: sampleOceanBathymetry3d / oceanHeightFromShallow live in PLANET_BAKE_AFTER_P.
 */
fn sampleMicroRelief(x: f32, y: f32, z: f32, isLand: bool) -> f32 {
  let seed = P.seed;
  let f = max(1e-4, P.heightFreq);
  let mtn = max(0.35, P.mountainScale);
  // heightOctaves UI (2–8) drives micro fBm depth
  let oct = clamp(P.heightOctaves, 2, 8);
  let octLo = max(2, oct - 1);
  let octHi = min(8, oct + 1);
  if (!isLand) {
    let abyssal = fbm3(x * f * 1.4, y * f * 1.4, z * f * 1.4, seed + 201, oct) * 0.5 + 0.5;
    let seamount = ridged3(x, y, z, seed + 231, oct, f * 8.0);
    return abyssal * 0.08 + seamount * 0.04;
  }
  let hills = fbm3(x * f * 12.0, y * f * 12.0, z * f * 12.0, seed + 501, oct) * 0.5 + 0.5;
  let foothills = fbm3(x * f * 9.0, y * f * 9.0, z * f * 9.0, seed + 341, oct) * 0.5 + 0.5;
  let micro = fbm3(x * f * 48.0, y * f * 48.0, z * f * 48.0, seed + 511, octHi) * 0.5 + 0.5;
  let microRidge = ridged3(x, y, z, seed + 521, octLo, f * 64.0);
  let rangeA = ridged3(x, y, z, seed + 321, min(8, oct + 1), f * 4.5);
  let rangeB = ridged3(x, y, z, seed + 331, oct, f * 7.0);
  let peaks = ridged3(x, y, z, seed + 401, min(8, oct + 2), f * 22.0) * 0.45
    + ridged3(x, y, z, seed + 411, min(8, oct + 1), f * 36.0) * 0.35
    + ridged3(x, y, z, seed + 421, oct, f * 52.0) * 0.2;
  return hills * 0.06 + foothills * 0.045 + micro * 0.04 + microRidge * 0.035
    + rangeA * 0.09 * mtn + rangeB * 0.06 * mtn + peaks * 0.18 * mtn;
}

@compute @workgroup_size(8, 8, 1)
fn cs_structure_compose(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let i = idxOf(x, y);
  let prior = heightA[i];
  let isLand = heightB[i] > 0.5;
  let dx = cosLat(y) * cosLon(x);
  let dy = sinLat(y);
  let dz = cosLat(y) * sinLon(x);
  let micro = sampleMicroRelief(dx, dy, dz, isLand);
  let sea = P.sea;
  let mtn = max(0.35, P.mountainScale);
  let cls = P.planetClass;
  var h: f32;
  if (isLand) {
    h = sea + 0.035 + (prior - 0.45) * 0.28 + micro * 0.42;
    // Mild mountain from prior already; small extra peak from micro
    h = min(h, sea + 0.52);
    if (cls == 2) { h = h + micro * 0.08; }
    if (cls == 3) { h = h + abs(dy) * 0.04; }
    if (cls == 5) {
      h = h + ridged3(dx * 1.5, dy * 1.5, dz * 1.5, P.seed + 601, 4, P.heightFreq * 11.0) * 0.08;
    }
  } else {
    // Sphere-native 3D bathymetry (not equirect prior quantiles — polar rings)
    let shallow3d = sampleOceanBathymetry3d(dx, dy, dz, P.seed + 40, P.heightFreq);
    let shelfCue = polarSafeShelfCue(prior, abs(dy));
    let shallow = clamp01(shallow3d * (1.0 - shelfCue * 0.5) + shelfCue * 0.82);
    h = oceanHeightFromShallow(shallow, sea, micro - 0.0);
    if (cls == 2) { h = h * 0.92; }
  }
  h = clamp01(h);
  // Soft contrast on land only
  if (isLand) {
    let c = h * h * (3.0 - 2.0 * h);
    h = h * 0.78 + c * 0.22;
  }
  // Hard mask enforce
  let eps = 0.012;
  if (isLand) {
    h = max(h, sea + eps);
  } else {
    h = min(h, sea - eps);
  }
  heightA[i] = clamp01(h);
}

/**
 * Re-assert land/ocean band from heightB mask — but NOT in the thin coastal
 * strip. Full hard snap on every pixel reintroduces stairstep/pixelated
 * coasts after soft_coast (low-res mask upsample edges). Interior only.
 */
@compute @workgroup_size(8, 8, 1)
fn cs_enforce_mask(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let W = P.width;
  let H = P.height;
  let i = idxOf(x, y);
  let isLand = heightB[i] > 0.5;
  var h = heightA[i];
  let sea = P.sea;
  let eps = 0.006;
  // Coast band in mask-space: any 4-neigh differs → leave soft_coast result
  var edge = false;
  if (y > 0u && y < H - 1u) {
    let xl = (x + W - 1u) % W;
    let xr = (x + 1u) % W;
    let m0 = heightB[i] > 0.5;
    let mL = heightB[y * W + xl] > 0.5;
    let mR = heightB[y * W + xr] > 0.5;
    let mU = heightB[(y - 1u) * W + x] > 0.5;
    let mD = heightB[(y + 1u) * W + x] > 0.5;
    if (m0 != mL || m0 != mR || m0 != mU || m0 != mD) {
      edge = true;
    }
    // Also 2-ring: catch thicker stairsteps from low-res upsample
    if (!edge && y > 1u && y < H - 2u) {
      let mL2 = heightB[y * W + ((x + W - 2u) % W)] > 0.5;
      let mR2 = heightB[y * W + ((x + 2u) % W)] > 0.5;
      let mU2 = heightB[(y - 2u) * W + x] > 0.5;
      let mD2 = heightB[(y + 2u) * W + x] > 0.5;
      if (m0 != mL2 || m0 != mR2 || m0 != mU2 || m0 != mD2) {
        edge = true;
      }
    }
  }
  if (edge) {
    // Soft pull only: keep shores continuous
    if (isLand && h < sea) {
      h = mix(h, sea + eps, 0.65);
    } else if (!isLand && h > sea) {
      h = mix(h, sea - eps, 0.65);
    }
  } else {
    if (isLand) {
      h = max(h, sea + eps);
    } else {
      h = min(h, sea - eps);
    }
  }
  heightA[i] = clamp01(h);
}

/** Final hard land/ocean snap — coastline locked to structure mask (no offset shore). */
@compute @workgroup_size(8, 8, 1)
fn cs_enforce_mask_hard(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let i = idxOf(x, y);
  let isLand = heightB[i] > 0.5;
  var h = heightA[i];
  let sea = P.sea;
  let eps = 0.012;
  if (isLand) {
    h = max(h, sea + eps);
  } else {
    h = min(h, sea - eps);
  }
  heightA[i] = clamp01(h);
}

@compute @workgroup_size(256, 1, 1)
fn cs_reduce_minmax(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = P.width * P.height;
  let tid = gid.x;
  let totalThreads = (n + 255u) / 256u;
  if (tid >= totalThreads) { return; }
  let start = tid * 256u;
  var lo = 1e30;
  var hi = -1e30;
  for (var i = 0u; i < 256u; i++) {
    let idx = start + i;
    if (idx >= n) { break; }
    let h = heightA[idx];
    lo = min(lo, h);
    hi = max(hi, h);
  }
  reduceBuf[2u + tid * 2u] = lo;
  reduceBuf[2u + tid * 2u + 1u] = hi;
}

@compute @workgroup_size(1, 1, 1)
fn cs_finalize_minmax() {
  let n = P.width * P.height;
  let totalThreads = (n + 255u) / 256u;
  var lo = 1e30;
  var hi = -1e30;
  for (var i = 0u; i < totalThreads; i++) {
    lo = min(lo, reduceBuf[2u + i * 2u]);
    hi = max(hi, reduceBuf[2u + i * 2u + 1u]);
  }
  reduceBuf[0] = lo;
  reduceBuf[1] = hi;
}

@compute @workgroup_size(8, 8, 1)
fn cs_normalize(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let idx = idxOf(x, y);
  let minH = reduceBuf[0];
  let maxH = reduceBuf[1];
  let range = max(1e-8, maxH - minH);
  heightA[idx] = (heightA[idx] - minH) / range;
}

// Soft contrast: t*0.72 + smoothstep(t)*0.28 (heightfield.ts)
@compute @workgroup_size(8, 8, 1)
fn cs_soft_contrast(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let idx = idxOf(x, y);
  let t = heightA[idx];
  let c = t * t * (3.0 - 2.0 * t);
  heightA[idx] = t * 0.72 + c * 0.28;
}

// softCoastFilter one Jacobi pass: read heightA → write heightB
@compute @workgroup_size(8, 8, 1)
fn cs_soft_coast(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let W = P.width;
  let H = P.height;
  let i = idxOf(x, y);
  let h = heightA[i];
  // skip poles
  if (y == 0u || y == H - 1u) {
    heightB[i] = h;
    return;
  }
  let dist = abs(h - P.coastSea);
  if (dist > P.coastBand) {
    heightB[i] = h;
    return;
  }
  let w = 1.0 - dist / P.coastBand;
  let xl = (x + W - 1u) % W;
  let xr = (x + 1u) % W;
  let avg = (
    heightA[i] +
    heightA[y * W + xl] + heightA[y * W + xr] +
    heightA[(y - 1u) * W + x] + heightA[(y + 1u) * W + x] +
    heightA[(y - 1u) * W + xl] + heightA[(y - 1u) * W + xr] +
    heightA[(y + 1u) * W + xl] + heightA[(y + 1u) * W + xr]
  ) / 9.0;
  // Mild soft-coast mix (less than historical 0.90 mush; enough to kill razor cliffs)
  heightB[i] = h * (1.0 - w * 0.5) + avg * (w * 0.5);
}

// Copy heightB → heightA (after soft coast / thermal / stream ping-pong)
@compute @workgroup_size(8, 8, 1)
fn cs_copy_b_to_a(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let i = idxOf(x, y);
  heightA[i] = heightB[i];
}

// Thermal Jacobi: read A write B (amount 0.45)
@compute @workgroup_size(8, 8, 1)
fn cs_thermal(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let W = P.width;
  let H = P.height;
  let i = idxOf(x, y);
  let h = heightA[i];
  let t = max(1e-6, P.talus);
  let a = 0.45;
  let n0 = heightA[y * W + ((x + 1u) % W)];
  let n1 = heightA[y * W + ((x + W - 1u) % W)];
  let n2 = heightA[min(H - 1u, y + 1u) * W + x];
  let n3 = heightA[select(0u, y - 1u, y > 0u) * W + x];
  var maxDiff = 0.0;
  var maxJ = -1;
  let d0 = h - n0; if (d0 > maxDiff) { maxDiff = d0; maxJ = 0; }
  let d1 = h - n1; if (d1 > maxDiff) { maxDiff = d1; maxJ = 1; }
  let d2 = h - n2; if (d2 > maxDiff) { maxDiff = d2; maxJ = 2; }
  let d3 = h - n3; if (d3 > maxDiff) { maxDiff = d3; maxJ = 3; }

  // Deposit is applied by neighbor threads reading us; Jacobi: only subtract
  // excess locally and add deposits by scanning who would deposit onto us.
  // Match CPU double-buffer: each cell computes own loss + received deposit
  // from neighbors that chose this cell as steepest downslope.
  var next = h;
  if (maxJ >= 0 && maxDiff > t) {
    let excess = (maxDiff - t) * a * 0.25;
    next = next - excess;
  }
  // Incoming from 4 neighbors
  // neighbor at n that has us as steepest gets excess added to us
  // Check each neighbor's steepest descent target
  let neighX = array<u32, 4>(
    (x + 1u) % W,
    (x + W - 1u) % W,
    x,
    x,
  );
  let neighY = array<u32, 4>(
    y,
    y,
    min(H - 1u, y + 1u),
    select(0u, y - 1u, y > 0u),
  );
  for (var ni = 0u; ni < 4u; ni++) {
    let nx = neighX[ni];
    let ny = neighY[ni];
    let niIdx = ny * W + nx;
    let hn = heightA[niIdx];
    let nn0 = heightA[ny * W + ((nx + 1u) % W)];
    let nn1 = heightA[ny * W + ((nx + W - 1u) % W)];
    let nn2 = heightA[min(H - 1u, ny + 1u) * W + nx];
    let nn3 = heightA[select(0u, ny - 1u, ny > 0u) * W + nx];
    var md = 0.0;
    var mj = -1;
    let e0 = hn - nn0; if (e0 > md) { md = e0; mj = 0; }
    let e1 = hn - nn1; if (e1 > md) { md = e1; mj = 1; }
    let e2 = hn - nn2; if (e2 > md) { md = e2; mj = 2; }
    let e3 = hn - nn3; if (e3 > md) { md = e3; mj = 3; }
    if (mj >= 0 && md > t) {
      // Does neighbor deposit onto (x,y)?
      var tx = nx;
      var ty = ny;
      if (mj == 0) { tx = (nx + 1u) % W; }
      else if (mj == 1) { tx = (nx + W - 1u) % W; }
      else if (mj == 2) { ty = min(H - 1u, ny + 1u); }
      else { ty = select(0u, ny - 1u, ny > 0u); }
      if (tx == x && ty == y) {
        next = next + (md - t) * a * 0.25;
      }
    }
  }
  heightB[i] = next;
}

// Uplift field from tectonics
@compute @workgroup_size(8, 8, 1)
fn cs_uplift(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let dx = cosLat(y) * cosLon(x);
  let dy = sinLat(y);
  let dz = cosLat(y) * sinLon(x);
  let tec = sampleTectonicControls(dx, dy, dz, P.seed, P.heightFreq, P.warp, P.continentScale);
  upliftBuf[idxOf(x, y)] = tec.uplift;
}

// Init flow = 1
@compute @workgroup_size(8, 8, 1)
fn cs_stream_flow_init(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  flowBuf[idxOf(x, y)] = 1.0;
  flowAdd[idxOf(x, y)] = 0.0;
}

// One flow accumulation sweep: write add into flowAdd, then host or second kernel merges.
// Steepest descent among 4-neigh; deposit flow*0.85 to downhill (Jacobi via atomic-free:
// each cell adds to flowAdd of best neighbor by scanning who points here).
@compute @workgroup_size(8, 8, 1)
fn cs_stream_flow_sweep(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let W = P.width;
  let H = P.height;
  let i = idxOf(x, y);
  // Gather: sum contributions from neighbors that flow into us
  var add = 0.0;
  if (y > 0u && y < H - 1u) {
    let candX = array<u32, 4>(
      (x + 1u) % W,
      (x + W - 1u) % W,
      x,
      x,
    );
    let candY = array<u32, 4>(
      y,
      y,
      y + 1u,
      y - 1u,
    );
    for (var ni = 0u; ni < 4u; ni++) {
      let nx = candX[ni];
      let ny = candY[ni];
      if (ny == 0u || ny >= H - 1u) { continue; }
      let niIdx = ny * W + nx;
      let h = heightA[niIdx];
      if (h <= P.sea) { continue; }
      // steepest descent from neighbor
      var best = -1;
      var bestDrop = 0.0;
      let j0 = ny * W + ((nx + 1u) % W);
      let j1 = ny * W + ((nx + W - 1u) % W);
      let j2 = (ny + 1u) * W + nx;
      let j3 = (ny - 1u) * W + nx;
      let drop0 = h - heightA[j0]; if (drop0 > bestDrop) { bestDrop = drop0; best = i32(j0); }
      let drop1 = h - heightA[j1]; if (drop1 > bestDrop) { bestDrop = drop1; best = i32(j1); }
      let drop2 = h - heightA[j2]; if (drop2 > bestDrop) { bestDrop = drop2; best = i32(j2); }
      let drop3 = h - heightA[j3]; if (drop3 > bestDrop) { bestDrop = drop3; best = i32(j3); }
      if (best == i32(i) && bestDrop > 1e-6) {
        add += flowBuf[niIdx] * 0.85;
      }
    }
  }
  flowAdd[i] = add;
}

@compute @workgroup_size(8, 8, 1)
fn cs_stream_flow_merge(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let i = idxOf(x, y);
  flowBuf[i] = 1.0 + flowAdd[i];
}

// Stream-power erode: read heightA+flow+uplift → heightB
@compute @workgroup_size(8, 8, 1)
fn cs_stream_erode(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let W = P.width;
  let H = P.height;
  let i = idxOf(x, y);
  let h = heightA[i];
  var next = h;
  let sea = P.sea;
  let k = P.streamK;

  // Jacobi: own dig + deposits from neighbors that chose us as downslope
  if (y > 0u && y < H - 1u && h > sea + 0.01) {
    let xl = (x + W - 1u) % W;
    let xr = (x + 1u) % W;
    let yu = y - 1u;
    let yd = y + 1u;
    let gx = (heightA[y * W + xr] - heightA[y * W + xl]) * 0.5;
    let gy = (heightA[yd * W + x] - heightA[yu * W + x]) * 0.5;
    let slope = sqrt(gx * gx + gy * gy);
    if (slope >= 1e-6) {
      let protect = clamp01(upliftBuf[i]);
      let m = 0.5;
      let n = 1.2;
      let power = pow(max(flowBuf[i], 1.0), m) * pow(slope, n);
      let erodeAmt = k * power * (1.0 - protect * 0.75);
      if (erodeAmt > 1e-8) {
        let maxDig = max(0.0, h - (sea + 0.02));
        let dig = min(erodeAmt, min(maxDig, 0.04));
        next = next - dig;
      }
    }
  }

  // Incoming deposit from neighbors
  if (y > 0u && y < H - 1u) {
    let candX = array<u32, 4>((x + 1u) % W, (x + W - 1u) % W, x, x);
    let candY = array<u32, 4>(y, y, y + 1u, y - 1u);
    for (var ni = 0u; ni < 4u; ni++) {
      let nx = candX[ni];
      let ny = candY[ni];
      if (ny == 0u || ny >= H - 1u) { continue; }
      let niIdx = ny * W + nx;
      let hn = heightA[niIdx];
      if (hn <= sea + 0.01) { continue; }
      let xl = (nx + W - 1u) % W;
      let xr = (nx + 1u) % W;
      let yu = ny - 1u;
      let yd = ny + 1u;
      let gx = (heightA[ny * W + xr] - heightA[ny * W + xl]) * 0.5;
      let gy = (heightA[yd * W + nx] - heightA[yu * W + nx]) * 0.5;
      let slope = sqrt(gx * gx + gy * gy);
      if (slope < 1e-6) { continue; }
      let protect = clamp01(upliftBuf[niIdx]);
      let power = pow(max(flowBuf[niIdx], 1.0), 0.5) * pow(slope, 1.2);
      let erodeAmt = k * power * (1.0 - protect * 0.75);
      if (erodeAmt <= 1e-8) { continue; }
      let maxDig = max(0.0, hn - (sea + 0.02));
      let dig = min(erodeAmt, min(maxDig, 0.04));
      // steepest of neighbor
      var best = -1;
      var bestDrop = 0.0;
      let c0 = ny * W + xr;
      let c1 = ny * W + xl;
      let c2 = yd * W + nx;
      let c3 = yu * W + nx;
      let dr0 = hn - heightA[c0]; if (dr0 > bestDrop) { bestDrop = dr0; best = i32(c0); }
      let dr1 = hn - heightA[c1]; if (dr1 > bestDrop) { bestDrop = dr1; best = i32(c1); }
      let dr2 = hn - heightA[c2]; if (dr2 > bestDrop) { bestDrop = dr2; best = i32(c2); }
      let dr3 = hn - heightA[c3]; if (dr3 > bestDrop) { bestDrop = dr3; best = i32(c3); }
      if (best == i32(i) && dig > 0.0) {
        next = next + dig * 0.65;
      }
    }
  }
  heightB[i] = next;
}

// Reinject peak detail amount from P.reinjectAmt
@compute @workgroup_size(8, 8, 1)
fn cs_reinject_peaks(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let i = idxOf(x, y);
  let h0 = heightA[i];
  let sea = P.sea;
  if (h0 <= sea + 0.01) { return; }
  let seed = P.seed + 900;
  let f = max(1e-4, P.heightFreq);
  let amt = max(0.0, P.reinjectAmt) * max(0.4, P.mountainScale);
  if (amt < 1e-4) { return; }
  let dx = cosLat(y) * cosLon(x);
  let dy = sinLat(y);
  let dz = cosLat(y) * sinLon(x);
  let oct = clamp(P.heightOctaves, 2, 8);
  let pA = ridged3(dx, dy, dz, seed + 1, min(8, oct + 1), f * 28.0);
  let pB = ridged3(dx, dy, dz, seed + 2, oct, f * 44.0);
  let pC = ridged3(dx, dy, dz, seed + 3, max(2, oct - 1), f * 56.0);
  let peaks = pA * 0.5 + pB * 0.35 + pC * 0.15;
  // Keep reinject off coasts (match heightfield reinjectPeakDetail)
  let inland = smoothstep_f(sea + 0.14, sea + 0.48, h0);
  heightA[i] = clamp01(h0 + peaks * amt * inland);
}

// sealEquirectSeam → heightB (avoid in-place races), host copies B→A
@compute @workgroup_size(8, 8, 1)
fn cs_seal_seam(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let W = P.width;
  let i = idxOf(x, y);
  let h = heightA[i];
  if (W < 4u) {
    heightB[i] = h;
    return;
  }
  let k = max(1u, min(W / 8u, u32(max(1, P.blendCols))));
  let hL = heightA[y * W + 0u];
  let hR = heightA[y * W + (W - 1u)];
  let mid = (hL + hR) * 0.5;
  if (x == 0u || x == W - 1u) {
    heightB[i] = mid;
    return;
  }
  if (x < k) {
    let t = 1.0 - f32(x) / f32(k);
    heightB[i] = h * (1.0 - t * 0.5) + mid * (t * 0.5);
  } else if (x >= W - k) {
    let c = W - 1u - x;
    let t = 1.0 - f32(c) / f32(k);
    heightB[i] = h * (1.0 - t * 0.5) + mid * (t * 0.5);
  } else {
    heightB[i] = h;
  }
}
`;
/** Full paintSurface + normals + height gray + clouds. */
export const PLANET_FULL_BAKE_PRODUCT_WGSL = PLANET_BAKE_PURE + /* wgsl */ `
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> luts: array<f32>;
@group(0) @binding(2) var<storage, read> heightA: array<f32>;
@group(0) @binding(3) var<storage, read_write> albedoBuf: array<u32>;
@group(0) @binding(4) var<storage, read_write> normalBuf: array<u32>;
@group(0) @binding(5) var<storage, read_write> liquidBuf: array<u32>;
@group(0) @binding(6) var<storage, read_write> heightRgbaBuf: array<u32>;
@group(0) @binding(7) var<storage, read_write> cloudBuf: array<u32>;

fn cosLon(x: u32) -> f32 { return luts[x]; }
fn sinLon(x: u32) -> f32 { return luts[P.width + x]; }
fn cosLat(y: u32) -> f32 { return luts[P.width * 2u + y]; }
fn sinLat(y: u32) -> f32 { return luts[P.width * 2u + P.height + y]; }
` + PLANET_BAKE_AFTER_P + /* wgsl */ `

/** Drivers: x=moisture, y=temperature, z=precip (Köppen-scale). Match climate.ts */
fn climateFields(x: f32, y: f32, z: f32, elevAboveSea: f32, seed: i32) -> vec3<f32> {
  let absLat = abs(y);
  // cos(φ)=sqrt(1−sin²φ) — mid/high lats stay warm enough for boreal forests
  let cosLat = sqrt(max(0.0, 1.0 - absLat * absLat));
  let subtropDry = smoothstep_f(0.15, 0.28, absLat) * (1.0 - smoothstep_f(0.48, 0.65, absLat));
  var moisture = fbm3(x * 1.2, y * 0.9, z * 1.2, seed + 500, 5) * 0.5 + 0.5;
  moisture = moisture * 0.48
    + (fbm3(x * 3.8, y * 2.8, z * 3.8, seed + 511, 4) * 0.5 + 0.5) * 0.28
    + cosLat * 0.12;
  moisture = moisture * (1.0 - subtropDry * 0.82);
  moisture = clamp01(moisture
    + smoothstep_f(0.45, 0.7, absLat) * (1.0 - smoothstep_f(0.88, 0.97, absLat)) * 0.14);
  let itcz = (1.0 - smoothstep_f(0.0, 0.28, absLat))
    * (0.6 + 0.4 * (fbm3(x * 2.5, y * 0.4, z * 2.5, seed + 530, 3) * 0.5 + 0.5));
  moisture = clamp01(moisture * 0.68 + itcz * 0.42);
  let coastWet = 1.0 - smoothstep_f(0.0, 0.2, elevAboveSea);
  moisture = clamp01(moisture * 0.72 + coastWet * 0.3);
  if (elevAboveSea > 0.1) {
    let dry = fbm3(x * 1.8 + 3.0, y * 1.8, z * 1.8 - 2.0, seed + 520, 3) * 0.5 + 0.5;
    moisture = moisture * (1.0 - elevAboveSea * 0.42 * dry);
  }
  moisture = clamp01(moisture);
  let orographic = elevAboveSea * elevAboveSea
    * (fbm3(x * 4.0, y * 2.0, z * 4.0, seed + 540, 3) * 0.5 + 0.5);
  let precip = clamp01(moisture * 0.75 + orographic * 0.35 + itcz * 0.15);
  var temperature = cosLat * 0.92 - elevAboveSea * 0.34;
  temperature = temperature + (fbm3(x * 1.2, y * 0.6, z * 1.2, seed + 600, 3) * 0.5 - 0.25) * 0.14;
  temperature = temperature - (1.0 - coastWet) * 0.03 * absLat;
  temperature = clamp01(temperature);
  return vec3<f32>(moisture, temperature, precip);
}

/** Discrete climate class 0..18 (match climate.ts ClimateClass). */
fn classifyClimate(temperature: f32, precip: f32, moisture: f32, elev: f32, absLat: f32) -> i32 {
  if (elev < 0.028) { return 18; } // Beach
  if (elev > 0.78 && temperature < 0.28 && absLat < 0.7) { return 17; } // Rock
  if (absLat > 0.96 || (absLat > 0.9 && temperature < 0.14)) { return 16; } // EF
  if (absLat > 0.82 && temperature < 0.28) { return 15; } // ET
  let aridThresh = 0.38 + temperature * 0.14;
  if (precip < aridThresh * 0.62 && temperature > 0.28) {
    if (temperature > 0.5) { return 3; }
    return 4;
  }
  if (precip < aridThresh * 1.05 && temperature > 0.24) {
    if (temperature > 0.44) { return 5; }
    return 6;
  }
  if (temperature > 0.68 && absLat < 0.35) {
    if (precip > 0.68 && moisture > 0.6) { return 0; }
    if (precip > 0.5) { return 1; }
    return 2;
  }
  if (temperature < 0.4 && absLat > 0.35) {
    if (temperature < 0.26) { return 14; }
    if (precip > 0.48) { return 13; }
    return 12;
  }
  let medDry = temperature > 0.48 && moisture < 0.48 && precip < 0.55
    && absLat > 0.22 && absLat < 0.55;
  if (medDry) {
    if (temperature > 0.58) { return 7; }
    return 8;
  }
  if (temperature > 0.52 && precip > 0.45) { return 9; }
  if (temperature > 0.36 && precip > 0.38) { return 10; }
  return 11;
}

fn climateClassColor(c: i32, elev: f32) -> vec3<f32> {
  // Palette indices match materials SurfacePalette packing in bake uniforms
  if (c == 18) { return palRgb(4u); } // beach
  if (c == 0) { return lerpRgb(palRgb(9u), palRgb(8u), 0.25); } // Af deep forest
  if (c == 1) { return lerpRgb(palRgb(8u), palRgb(9u), 0.35); }
  if (c == 2) { return lerpRgb(palRgb(7u), palRgb(8u), 0.35); }
  if (c == 3) { return lerpRgb(palRgb(5u), palRgb(6u), 0.65); }
  if (c == 4) { return lerpRgb(palRgb(5u), palRgb(11u), 0.35); }
  if (c == 5) { return lerpRgb(palRgb(5u), palRgb(7u), 0.4); }
  if (c == 6) { return lerpRgb(palRgb(7u), palRgb(5u), 0.45); }
  if (c == 7) { return lerpRgb(palRgb(7u), palRgb(5u), 0.35); }
  if (c == 8) { return lerpRgb(palRgb(7u), palRgb(10u), 0.4); }
  if (c == 9) { return lerpRgb(palRgb(8u), palRgb(7u), 0.45); }
  if (c == 10) { return lerpRgb(palRgb(10u), palRgb(8u), 0.55); }
  if (c == 11) { return lerpRgb(palRgb(15u), palRgb(10u), 0.4); }
  if (c == 12) { return lerpRgb(palRgb(7u), palRgb(8u), 0.3); }
  if (c == 13) { return lerpRgb(palRgb(8u), palRgb(15u), 0.35); }
  if (c == 14) { return lerpRgb(palRgb(15u), palRgb(8u), 0.25); }
  if (c == 15) { return lerpRgb(palRgb(15u), palRgb(7u), 0.4); } // ET chromatic
  if (c == 16) { return vec3<f32>(0.62, 0.72, 0.82); } // EF cool ice, not white
  // Rock warm brown
  return lerpRgb(palRgb(12u), palRgb(5u), 0.35 + elev * 0.1);
}

fn oceanColor(depth: f32, x: f32, y: f32, z: f32, seed: i32) -> vec3<f32> {
  // Earthmap teal-navy (match materials.oceanColor) — greener open sea, still B-dominant
  let d = clamp01(depth);
  let deep = palRgb(0u);
  let mid = palRgb(1u);
  let shelf = palRgb(2u);
  let midDark = lerpRgb(mid, deep, 0.35);
  let abyss = vec3<f32>(deep.x * 0.55, deep.y * 0.68, deep.z * 0.78);
  var col: vec3<f32>;
  if (d < 0.4) {
    col = lerpRgb(shelf, midDark, d / 0.4);
  } else if (d < 0.72) {
    col = lerpRgb(midDark, deep, (d - 0.4) / 0.32);
  } else {
    col = lerpRgb(deep, abyss, (d - 0.72) / 0.28);
  }
  let n1 = fbm3(x * 0.55, y * 0.28, z * 0.55, seed + 77, 2) * 0.012 - 0.004;
  let n2 = fbm3(x * 1.05, y * 0.45, z * 1.05, seed + 81, 1) * 0.005;
  col = clamp(vec3<f32>(
    col.x + n1 * 0.12 + n2 * 0.08,
    col.y + n1 * 0.28 + n2 * 0.14,
    col.z + n1 * 0.26 + n2 * 0.15,
  ), vec3<f32>(0.0), vec3<f32>(1.0));
  let atm = vec3<f32>(P.atmR, P.atmG, P.atmB);
  let tmax = max(max(atm.x, atm.y), max(atm.z, 1e-4));
  col = vec3<f32>(
    col.x * 0.98 + (atm.x / tmax) * 0.01,
    col.y * 0.985 + (atm.y / tmax) * 0.014,
    col.z * 0.97 + (atm.z / tmax) * 0.016,
  );
  return col;
}

/** Ice-class basins: frozen cool-blue ice (match materials.frozenIceSeaColor). */
fn frozenIceSeaColor(depth: f32, x: f32, y: f32, z: f32, seed: i32) -> vec3<f32> {
  let d = clamp01(depth);
  let shallow = vec3<f32>(0.82, 0.9, 0.97);
  let mid = vec3<f32>(0.62, 0.78, 0.92);
  let deep = vec3<f32>(0.45, 0.65, 0.84);
  var col: vec3<f32>;
  if (d < 0.4) { col = lerpRgb(shallow, mid, d / 0.4); }
  else { col = lerpRgb(mid, deep, (d - 0.4) / 0.6); }
  let n1 = fbm3(x * 1.2, y * 0.4, z * 1.2, seed + 501, 3) * 0.04 - 0.015;
  let n2 = fbm3(x * 4.5, y * 1.1, z * 4.5, seed + 511, 2) * 0.025;
  col = clamp(vec3<f32>(
    col.x + n1 * 0.7 + n2 * 0.4,
    col.y + n1 * 0.85 + n2 * 0.5,
    col.z + n1 * 0.95 + n2 * 0.55,
  ), vec3<f32>(0.0), vec3<f32>(1.0));
  let L = (col.x + col.y + col.z) / 3.0;
  if (L < 0.55) {
    let lift = (0.55 - L) * 0.65;
    col = clamp(vec3<f32>(
      col.x + lift * 0.85,
      col.y + lift * 0.95,
      col.z + lift,
    ), vec3<f32>(0.0), vec3<f32>(1.0));
  }
  return col;
}

// oceanPaintDepth is defined once in PLANET_BAKE_AFTER_P (shared with terrain)

struct LandOut {
  col: vec3<f32>,
  mat: f32,
  spec: f32,
}

/** Map absLat ice threshold toward pole when poleIceScale < 1 (match climate.ts). */
fn scalePoleLatThresh(thresh: f32, poleIceScale: f32) -> f32 {
  let s = clamp(poleIceScale, 0.004, 2.0);
  return 1.0 - (1.0 - thresh) * s;
}

/** Soft continuous biomes (match climate.ts softBiomeColor). */
fn softBiomeColor(
  elev: f32, absLat: f32, temperature: f32, moisture: f32,
  x: f32, y: f32, z: f32, seed: i32,
) -> vec4<f32> {
  // returns rgb + snowW in .w
  let pScale = clamp(P.poleIceScale, 0.004, 2.0);
  let iceWarp = min(1.0, pScale);
  // Gas-style domain warp before biomes (match climate.ts) — scatter off pure lat lines
  let poleHold0 = smoothstep_f(0.62, 0.9, absLat);
  let warpAmt = 0.28 * (1.0 - poleHold0 * 0.95);
  let wx = (fbm3(x * 0.32, y * 0.18, z * 0.32, seed + 640, 3) * 2.0 - 1.0) * warpAmt;
  let wy = (fbm3(x * 0.32 + 2.4, y * 0.18, z * 0.32, seed + 641, 3) * 2.0 - 1.0) * warpAmt * 0.55;
  let wz = (fbm3(x * 0.32 - 1.7, y * 0.18, z * 0.32, seed + 642, 3) * 2.0 - 1.0) * warpAmt;
  var px = x + wx;
  var py = y + wy;
  var pz = z + wz;
  {
    let plen = max(1e-6, sqrt(px * px + py * py + pz * pz));
    px = px / plen; py = py / plen; pz = pz / plen;
  }
  let absLatW = abs(py);
  let poleHold = smoothstep_f(0.62, 0.9, absLatW);
  let latBig = (fbm3(px * 0.18, py * 0.1, pz * 0.18, seed + 680, 3) * 2.0 - 1.0) * 0.2
    + (fbm3(px * 0.4 + 2.1, py * 0.14, pz * 0.4, seed + 690, 3) * 2.0 - 1.0) * 0.12;
  let lat = clamp01(absLatW + latBig * (1.0 - poleHold * 0.96));
  let edgeNoise = fbm3(px * 2.0, py * 0.85, pz * 2.0, seed + 731, 3) * 0.5 + 0.5;

  let vegProv = smoothstep_f(0.34, 0.64, fbm3(px * 0.2, py * 0.11, pz * 0.2, seed + 820, 4) * 0.5 + 0.5)
    * (0.4 + 0.6 * smoothstep_f(0.15, 0.5, moisture)) * (1.0 - smoothstep_f(0.8, 0.97, lat));
  let forestBlob = smoothstep_f(0.38, 0.7, fbm3(px * 0.45 + 3.0, py * 0.16, pz * 0.45, seed + 830, 3) * 0.5 + 0.5)
    * (0.45 + 0.55 * smoothstep_f(0.2, 0.55, moisture)) * (0.5 + 0.5 * edgeNoise);
  let grayLobe = smoothstep_f(0.38, 0.68, fbm3(px * 0.24 - 2.0, py * 0.12, pz * 0.24, seed + 870, 3) * 0.5 + 0.5)
    * (0.25 + 0.75 * smoothstep_f(0.12, 0.48, elev)) * (1.0 - smoothstep_f(0.78, 0.95, lat));
  // Desert patches — same style as forest (mid-freq sphere blobs, not lat belts)
  let aridN = fbm3(px * 0.65 + 5.0, py * 0.26, pz * 0.65, seed + 850, 4) * 0.5 + 0.5;
  let aridN2 = fbm3(px * 1.6 - 3.0, py * 0.5, pz * 1.6, seed + 851, 3) * 0.5 + 0.5;
  let aridN3 = fbm3(px * 2.8 + 1.2, py * 0.75, pz * 2.8, seed + 852, 3) * 0.5 + 0.5;
  let aridMix = aridN * 0.45 + aridN2 * 0.35 + aridN3 * 0.2;
  // Raw sphere mix ~0.45–0.62; top ~12–18% dry islands (match climate.ts)
  let aridPatch = smoothstep_f(0.55, 0.62, aridMix);
  let aridLatGate = (1.0 - smoothstep_f(0.58, 0.85, lat))
    * (0.55 + 0.45 * smoothstep_f(0.02, 0.35, lat) * (1.0 - smoothstep_f(0.48, 0.72, lat)));
  let aridLobe = aridPatch * aridLatGate * (1.0 - vegProv * 0.3)
    * (1.0 - smoothstep_f(0.55, 0.82, lat) * 0.5);
  let moistEff = clamp01(moisture * 0.65 + 0.12
    + (fbm3(px * 0.26, py * 0.13, pz * 0.26, seed + 840, 3) * 2.0 - 1.0) * 0.18
    + vegProv * 0.15 - aridLobe * 0.4 - grayLobe * 0.08);
  let tempEff = clamp01(temperature
    + (fbm3(px * 0.24 - 1.4, py * 0.11, pz * 0.24, seed + 860, 3) * 2.0 - 1.0) * 0.12 * (1.0 - poleHold));
  let aridClimate = smoothstep_f(0.25, 0.7, tempEff) * (1.0 - smoothstep_f(0.35, 0.7, moistEff))
    * (1.0 - vegProv * 0.35);
  let aridW0 = clamp01(aridLobe * 0.85 + aridClimate * aridLobe * 0.45) * 0.95;

  let plateau = smoothstep_f(0.28, 0.62, elev)
    * smoothstep_f(0.38, 0.68, fbm3(px * 0.4 + 4.0, py * 0.2, pz * 0.4, seed + 810, 3) * 0.5 + 0.5)
    * (1.0 - smoothstep_f(0.8, 0.96, lat)) * (0.4 + 0.6 * grayLobe) * (0.5 + 0.5 * (1.0 - moistEff));

  // Open grass vs canopy lobes (match climate.ts — exclusive lowland/forest)
  let openLobe = smoothstep_f(0.4, 0.7, fbm3(px * 0.22 + 7.0, py * 0.12, pz * 0.22, seed + 880, 3) * 0.5 + 0.5)
    * (1.0 - forestBlob * 0.65) * (1.0 - smoothstep_f(0.72, 0.92, lat));
  let canopyLobe = smoothstep_f(0.42, 0.72, fbm3(px * 0.28 - 3.0, py * 0.14, pz * 0.28, seed + 890, 3) * 0.5 + 0.5)
    * smoothstep_f(0.28, 0.62, moistEff) * (0.4 + 0.6 * forestBlob);

  let forestTrop = smoothstep_f(0.18, 0.48, moistEff) * smoothstep_f(0.26, 0.72, tempEff)
    * (1.0 - smoothstep_f(0.5, 0.8, lat)) * (1.0 - smoothstep_f(0.55, 0.92, elev))
    * (1.0 - aridW0 * 0.75) * (1.0 - plateau * 0.4) * (1.0 - openLobe * 0.85)
    * (0.25 + 0.5 * vegProv + 0.55 * forestBlob + 0.45 * canopyLobe);
  let forestTemp = smoothstep_f(0.15, 0.5, moistEff) * smoothstep_f(0.16, 0.7, tempEff)
    * (1.0 - smoothstep_f(0.68, 0.92, lat)) * (1.0 - aridW0 * 0.7) * (1.0 - plateau * 0.35)
    * (1.0 - openLobe * 0.8)
    * (0.25 + 0.45 * vegProv + 0.5 * forestBlob + 0.35 * canopyLobe);
  let boreal = smoothstep_f(0.35, 0.58, lat) * (1.0 - smoothstep_f(0.8, 0.94, lat))
    * smoothstep_f(0.12, 0.48, moistEff) * (1.0 - smoothstep_f(0.5, 0.85, elev))
    * smoothstep_f(0.06, 0.48, tempEff) * (0.5 + 0.5 * edgeNoise)
    * (1.0 - aridW0 * 0.55) * (1.0 - plateau * 0.3) * (1.0 - openLobe * 0.5)
    * (0.55 + 0.3 * vegProv + 0.25 * canopyLobe);
  let grass = smoothstep_f(0.1, 0.55, moistEff) * smoothstep_f(0.18, 0.8, tempEff)
    * (1.0 - forestTrop * 0.35) * (1.0 - forestTemp * 0.3) * (1.0 - boreal * 0.35)
    * (1.0 - canopyLobe * 0.75) * (1.0 - aridW0 * 0.7) * (1.0 - plateau * 0.45)
    * (1.0 - smoothstep_f(0.75, 0.94, lat))
    * (0.4 + 0.7 * openLobe + 0.25 * (1.0 - forestBlob));
  // Polar ice first; tundra keyed to iceLat (follows cap warble) — match climate.ts
  let iceN1 = fbm3(x * 1.15, y * 0.32, z * 1.15, seed + 901, 5) * 0.5 + 0.5;
  let iceN2 = fbm3(x * 2.9 + 4.0, y * 0.55, z * 2.9, seed + 911, 4) * 0.5 + 0.5;
  let iceN3 = fbm3(x * 5.5 - 2.0, y * 0.9, z * 5.5, seed + 921, 3) * 0.5 + 0.5;
  let iceLat = clamp01(absLat + (iceN1 * 2.0 - 1.0) * 0.035 * iceWarp
    + (iceN2 * 2.0 - 1.0) * 0.02 * iceWarp
    + (iceN3 * 2.0 - 1.0) * 0.01 * iceWarp);
  let iceLobe = smoothstep_f(0.28, 0.62, iceN1 * 0.5 + iceN2 * 0.35 + iceN3 * 0.15);
  let iceSolid = smoothstep_f(
    scalePoleLatThresh(0.905, pScale),
    scalePoleLatThresh(0.955, pScale),
    iceLat,
  );
  // Wider soft fringe so tundra doesn't hard-cut (match climate.ts)
  let iceFringe = clamp01(
    smoothstep_f(
      scalePoleLatThresh(0.78, pScale),
      scalePoleLatThresh(0.93, pScale),
      iceLat,
    ) * (1.0 - iceSolid) * (0.5 + 0.5 * iceLobe) * (0.5 + 0.5 * (1.0 - temperature)),
  );
  let iceCap = clamp01(iceSolid + iceFringe * 0.92);
  let alpine = smoothstep_f(0.55, 0.88, elev) * (1.0 - smoothstep_f(0.28, 0.55, temperature))
    * (1.0 - smoothstep_f(0.88, 0.99, absLat) * 0.4) * 0.45 + plateau * 0.55;
  let snowW = clamp01(iceSolid + (1.0 - iceSolid) * (iceFringe * 0.88 + alpine * 0.5));
  let vegKill = 1.0 - clamp01(iceSolid * 1.0 + snowW * 0.9 + iceCap * 0.25);
  // Rock/desert kill near ice + high lat — no forced tundra bar (match climate.ts)
  let polarRockKill = clamp01(
    smoothstep_f(0.2, 0.7, iceFringe + iceSolid * 0.85) * 0.95
      + smoothstep_f(0.35, 0.75, snowW) * 0.55
      + smoothstep_f(0.76, 0.88, absLat) * 0.7,
  );
  // Polar fringe + alpine (elev+cold) tundra — height-correlated (match climate.ts)
  let tundraPatch = smoothstep_f(0.42, 0.68, fbm3(px * 1.8 + 0.4, py * 0.55, pz * 1.8, seed + 930, 3) * 0.5 + 0.5)
    * (0.35 + 0.65 * smoothstep_f(0.38, 0.65, fbm3(px * 0.55 - 2.1, py * 0.22, pz * 0.55, seed + 931, 3) * 0.5 + 0.5));
  let polarTundra = iceFringe * (0.25 + 0.75 * tundraPatch) * (1.0 - iceSolid) * (1.0 - boreal * 0.45);
  let alpineTundra = clamp01(
    smoothstep_f(0.26, 0.44, elev) * (1.0 - smoothstep_f(0.38, 0.7, tempEff))
      * (0.5 + 0.5 * smoothstep_f(0.08, 0.4, absLat))
      * (0.55 + 0.45 * tundraPatch) * (1.0 - iceSolid) * (1.0 - aridLobe * 0.55),
  );
  let tundra = clamp01(max(polarTundra, alpineTundra * 0.95) * (1.0 - iceSolid * 0.5));
  let beachW = 1.0 - smoothstep_f(0.0, 0.035, elev);

  // Soft multi-class land (match climate.ts): grassland base + forest patches (not exclusive sectors)
  // Sphere LF FBM is low-contrast; stretch then threshold (match climate.ts)
  let landAlive = vegKill * (1.0 - snowW);
  let patchN = fbm3(px * 0.7 + 1.3, py * 0.28, pz * 0.7, seed + 900, 4) * 0.5 + 0.5;
  let patchN2 = fbm3(px * 1.9 - 2.1, py * 0.55, pz * 1.9, seed + 910, 3) * 0.5 + 0.5;
  let patchN3 = fbm3(px * 3.4 + 0.7, py * 0.9, pz * 3.4, seed + 920, 3) * 0.5 + 0.5;
  let patchRaw = patchN * 0.42 + patchN2 * 0.36 + patchN3 * 0.22;
  let patch01 = clamp01((patchRaw - 0.22) / 0.3);
  let forestPatch = smoothstep_f(0.58, 0.82, patch01);
  let deepCore = smoothstep_f(0.72, 0.9, patch01) * forestPatch;
  let forestBoost = clamp01(
    0.92 + forestBlob * 0.12 + canopyLobe * 0.08 + forestTrop * 0.05 + forestTemp * 0.08 + boreal * 0.05,
  );
  var forestDensity = clamp01(
    forestPatch * forestBoost * (1.0 - openLobe * 0.15) * (1.0 - aridW0 * 0.55)
      * (1.0 - aridLobe * 0.55) * (1.0 - alpineTundra * 0.97)
      * (1.0 - smoothstep_f(0.28, 0.5, elev) * 0.7)
      * (1.0 - plateau * 0.3) * (1.0 - smoothstep_f(0.78, 0.96, lat) * 0.45),
  );
  var deepDensity = clamp01(
    smoothstep_f(0.25, 0.75,
      deepCore * (0.9 + 0.1 * canopyLobe) * (1.0 - openLobe * 0.12) * (1.0 - aridW0 * 0.45)),
  );
  deepDensity = min(deepDensity, forestDensity);
  // Desert/gray minority islands — soft desert fringe (match climate.ts)
  let desertPri = clamp01(aridLobe * 1.2 + aridW0 * 0.35);
  let rockRaw = fbm3(px * 0.55 + 6.2, py * 0.2, pz * 0.55, seed + 875, 4) * 0.5 + 0.5;
  let rockRaw2 = fbm3(px * 1.3 - 1.1, py * 0.4, pz * 1.3, seed + 876, 3) * 0.5 + 0.5;
  let rockMix = rockRaw * 0.65 + rockRaw2 * 0.35;
  let rockLobe = smoothstep_f(0.44, 0.52, rockMix)
    * smoothstep_f(0.42, 0.68, elev) * (1.0 - smoothstep_f(0.62, 0.78, lat))
    * (1.0 - polarRockKill) * (1.0 - alpineTundra * 0.7)
    * (0.5 + 0.5 * (1.0 - moistEff));
  let grayPri = clamp01(grayLobe * 0.22 + plateau * 0.22 + rockLobe * 1.15) * (1.0 - desertPri * 0.4)
    * (1.0 - polarRockKill) * (1.0 - alpineTundra * 0.65) * smoothstep_f(0.38, 0.62, elev);
  let aDesert = landAlive * (1.0 - polarRockKill)
    * select(0.0, smoothstep_f(0.16, 0.72, desertPri), desertPri > 0.16) * 0.78;
  let aGray = landAlive * (1.0 - polarRockKill)
    * select(0.0, smoothstep_f(0.42, 0.7, grayPri), grayPri > 0.42)
    * (1.0 - aDesert * 0.65 / max(landAlive, 1e-6)) * 0.88;
  let aAlpine = landAlive * alpineTundra * 0.95;
  let vegLand = max(0.0, landAlive * (1.0 - aDesert * 0.55) - aGray * 0.85 - aAlpine * 0.9);
  // Partition weights (match climate.ts): pure grass | mid forest | deep
  let wDeep = deepDensity;
  let wForest = max(0.0, forestDensity - deepDensity);
  let wGrass = max(0.0, 1.0 - forestDensity);
  let wSum = max(1e-6, wDeep + wForest + wGrass);
  let aDeep = vegLand * (wDeep / wSum);
  let aForest = vegLand * (wForest / wSum);
  let aGrass = vegLand * (wGrass / wSum);

  var col = palRgb(10u);
  col = lerpRgb(col, vec3<f32>(0.88, 0.91, 0.94), snowW * 0.2);
  let grassC = palRgb(7u);
  let forestC = palRgb(8u);
  let deepC = palRgb(9u);
  col = col * (1.0 - vegLand) + (grassC * aGrass + forestC * aForest + deepC * aDeep);
  let desertEdge = aDesert * (1.0 - aDesert);
  col = lerpRgb(col, grassC, desertEdge * 0.45);
  col = lerpRgb(col, palRgb(5u), aDesert * 0.82);
  col = lerpRgb(col, palRgb(6u), aDesert * aDesert * 0.28);
  col = lerpRgb(col, palRgb(12u), aGray * 0.85);
  col = lerpRgb(col, palRgb(13u), aGray * 0.3);
  col = lerpRgb(col, palRgb(11u), aGray * 0.25);
  // peakK matches climate.ts peak(w) = pow(w, 1.65)
  let peakK = 1.65;
  // Alpine + polar tundra — stronger cores, soft edges (match climate.ts)
  col = lerpRgb(col, palRgb(15u), pow(clamp01(tundra), peakK) * vegKill * 0.92);
  col = lerpRgb(col, palRgb(15u), clamp01(
    iceFringe * (1.0 - iceSolid) * 0.18 * tundraPatch + alpineTundra * 0.88
      + snowW * (1.0 - snowW) * 0.15,
  ));
  col = lerpRgb(col, palRgb(14u), clamp01(iceSolid * 1.0 + iceFringe * 0.72));
  col = lerpRgb(col, vec3<f32>(0.94, 0.97, 1.0), clamp01(iceSolid * 0.55 + iceFringe * 0.2));
  col = lerpRgb(col, palRgb(4u), pow(clamp01(beachW), peakK) * 0.92 * vegKill);
  // Peak rock above alpine band only (match climate.ts)
  if (snowW < 0.35 && absLat < 0.72 && polarRockKill < 0.35) {
    let peakRock = smoothstep_f(0.55, 0.9, elev) * 0.38 * (1.0 - aridW0 * 0.3) * (1.0 - alpineTundra * 0.5)
      + rockLobe * 0.75 + aGray * 0.4;
    col = lerpRgb(col, palRgb(12u), clamp01(peakRock) * (1.0 - snowW) * (1.0 - polarRockKill));
    col = lerpRgb(col, palRgb(13u), clamp01(rockLobe * 0.45 + aGray * 0.3)
      * (1.0 - snowW) * (1.0 - polarRockKill));
  }
  return vec4<f32>(col, snowW);
}

/** Sphere-native isotropic lava veins (match materials.lavaChannelField). */
fn lavaChannelField(x: f32, y: f32, z: f32, seed: i32) -> f32 {
  let w = 0.08;
  let wx = fbm3(x * 1.8, y * 1.8, z * 1.8, seed + 10, 3) * w;
  let wy = fbm3(x * 1.8 + 4.0, y * 1.8, z * 1.8 - 2.0, seed + 20, 3) * w;
  let wz = fbm3(x * 1.8 - 3.0, y * 1.8 + 5.0, z * 1.8, seed + 30, 3) * w;
  var nx = x + wx;
  var ny = y + wy;
  var nz = z + wz;
  let len = max(1e-6, sqrt(nx * nx + ny * ny + nz * nz));
  nx = nx / len; ny = ny / len; nz = nz / len;
  var rivers = 0.0;
  let pwr = 2.6;
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1201, 4, 4), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1211, 4, 6.5), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1221, 4, 9.5), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1231, 4, 14), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1241, 4, 20), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1251, 4, 28), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1261, 4, 38), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1271, 4, 52), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1281, 4, 70), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1291, 4, 95), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1301, 4, 125), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1311, 4, 160), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1321, 4, 8), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1331, 4, 17), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1341, 4, 32), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1351, 4, 50), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1361, 4, 80), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1371, 4, 110), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1381, 4, 145), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1391, 4, 11), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1401, 4, 24), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1411, 4, 42), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1421, 4, 68), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1431, 4, 100), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1441, 4, 135), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1451, 4, 5.5), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1461, 4, 15), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1471, 4, 35), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1481, 4, 60), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1491, 4, 90), pwr));
  rivers = max(rivers, pow(ridged3(nx, ny, nz, seed + 1501, 4, 120), pwr));
  return clamp01(rivers);
}

fn brightLavaColor(intensity: f32) -> vec3<f32> {
  // Molten basalt blackbody continuum (match materials.ts — hard hot floor)
  let t = clamp01(intensity);
  let s = pow(t, 0.55);
  let dark = vec3<f32>(0.88, 0.16, 0.02);
  let mid = vec3<f32>(0.98, 0.3, 0.03);
  let hot = vec3<f32>(1.0, 0.48, 0.05);
  let core = vec3<f32>(1.0, 0.75, 0.22);
  if (s < 0.35) { return lerpRgb(dark, mid, s / 0.35); }
  if (s < 0.7) { return lerpRgb(mid, hot, (s - 0.35) / 0.35); }
  return lerpRgb(hot, core, (s - 0.7) / 0.3);
}

fn landBiomeColor(
  elev: f32, moisture: f32, temperature: f32, precip: f32, absLat: f32,
  cls: i32, liquidKind: i32, x: f32, y: f32, z: f32, seed: i32,
) -> LandOut {
  var out: LandOut;
  // cls: 0 ocean 1 temperate 2 rocky 3 ice 4 gas 5 exotic
  // liquidKind: 0 water 1 methane 2 acid 3 lava 4 none

  // Rocky Mars: basins darker than highlands (match materials.ts)
  if (cls == 2) {
    var col = lerpRgb(palRgb(13u), palRgb(10u), smoothstep_f(0.0, 0.32, elev));
    col = lerpRgb(col, palRgb(5u), smoothstep_f(0.12, 0.5, elev) * 0.6);
    col = lerpRgb(col, palRgb(6u), smoothstep_f(0.35, 0.8, elev) * 0.4);
    col = lerpRgb(col, palRgb(12u), smoothstep_f(0.5, 0.95, elev) * 0.5);
    col = lerpRgb(col, palRgb(11u), smoothstep_f(0.55, 0.98, elev) * 0.25);
    let basin = 1.0 - smoothstep_f(0.0, 0.2, elev);
    col = lerpRgb(col, palRgb(13u) * 0.45, basin * 0.82);
    col = lerpRgb(col, vec3<f32>(0.08, 0.05, 0.04), basin * basin * 0.35);
    let n = fbm3(x * 22.0, y * 22.0, z * 22.0, seed + 40, 4) * 0.08 - 0.03;
    out.col = clamp(vec3<f32>(col.x + n * 0.7, col.y + n * 0.45, col.z + n * 0.3), vec3<f32>(0.0), vec3<f32>(1.0));
    out.mat = select(8.0, 7.0, basin > 0.55);
    out.spec = 0.06 + basin * 0.04;
    return out;
  }
  // Ice world: global ice/cold rock
  if (cls == 3) {
    let iceN = fbm3(x * 1.4, y * 0.5, z * 1.4, seed + 50, 4) * 0.5 + 0.5;
    var col = lerpRgb(palRgb(15u), palRgb(14u), 0.55 + iceN * 0.35);
    col = lerpRgb(col, palRgb(11u), elev * 0.25);
    col = lerpRgb(col, palRgb(13u), elev * elev * 0.2);
    col = lerpRgb(col, vec3<f32>(0.92, 0.95, 0.98), 0.25 + iceN * 0.2);
    out.col = col; out.mat = 9.0; out.spec = 0.28;
    return out;
  }
  // Lava basalt crust (channels in cs_paint)
  if (liquidKind == 3) {
    var col = lerpRgb(palRgb(13u), palRgb(10u), elev * 0.5);
    col = lerpRgb(col, palRgb(12u), smoothstep_f(0.35, 0.9, elev) * 0.45);
    let n = fbm3(x * 28.0, y * 28.0, z * 28.0, seed + 60, 3) * 0.1 - 0.04;
    out.col = clamp(vec3<f32>(col.x + n, col.y + n * 0.6, col.z + n * 0.45), vec3<f32>(0.0), vec3<f32>(1.0));
    out.mat = 8.0; out.spec = 0.12;
    return out;
  }
  // Exotic rock (methane/acid land) — no Earth green/snow poles
  if (cls == 5) {
    var col = lerpRgb(palRgb(10u), palRgb(11u), elev * 0.55);
    col = lerpRgb(col, palRgb(5u), 0.4 + elev * 0.2);
    col = lerpRgb(col, palRgb(12u), smoothstep_f(0.4, 0.9, elev) * 0.35);
    col = lerpRgb(col, palRgb(13u), elev * 0.25);
    let n = fbm3(x * 20.0, y * 20.0, z * 20.0, seed + 70, 4) * 0.1 - 0.04;
    out.col = clamp(vec3<f32>(col.x + n * 0.85, col.y + n * 0.7, col.z + n * 0.55), vec3<f32>(0.0), vec3<f32>(1.0));
    out.mat = 11.0; out.spec = 0.07;
    return out;
  }

  // Earthlike ocean/temperate soft biomes
  let ccls = classifyClimate(temperature, precip, moisture, elev, absLat);
  let soft = softBiomeColor(elev, absLat, temperature, moisture, x, y, z, seed);
  var col = soft.xyz;
  let snowW = soft.w;
  // iceAmt=1 solid polar snow core (match materials.ts)
  let iceAmt = clamp01(snowW);
  let aridW = select(0.0, 0.6, ccls == 3 || ccls == 4 || ccls == 5);
  let forestW = select(0.0, 0.6, ccls == 0 || ccls == 1 || ccls == 9 || ccls == 14);

  var mat = 6.0;
  if (ccls == 18) { mat = 5.0; }
  else if (iceAmt > 0.55 || ccls == 16 || ccls == 15) { mat = 9.0; }
  else if (ccls == 3 || ccls == 4) { mat = 11.0; }
  else if (ccls == 0 || ccls == 1 || ccls == 9 || ccls == 14) { mat = 12.0; }
  else if (ccls == 17 || elev > 0.55) { mat = 8.0; }

  if (iceAmt > 0.02) {
    col = lerpRgb(col, palRgb(14u), iceAmt);
    col = lerpRgb(col, vec3<f32>(0.94, 0.97, 1.0), smoothstep_f(0.75, 1.0, iceAmt) * 0.35);
  }

  // Land micro-grain — zero-mean luminance fleck (neutral; match materials.ts)
  let landAmpBase = select(1.35, 1.85, cls == 0 || cls == 1);
  let iceQuiet = smoothstep_f(0.2, 0.88, iceAmt);
  let landAmp = landAmpBase * (1.0 - iceQuiet) + 0.35 * iceQuiet;
  // Whisper fleck (match materials.ts)
  let grainSoft = 0.04; // half intensity (match materials.ts)
  let n1 = (fbm3(x * 18.0, y * 18.0, z * 18.0, seed + 12, 4) * 2.0 - 1.0) * 0.15 * 0.15 * grainSoft * landAmp;
  let n2 = (ridged3(x, y, z, seed + 44, 3, 18.0) * 2.0 - 1.0) * 0.012 * grainSoft * landAmp;
  let n3 = (valueNoise3(x * 55.0, y * 55.0, z * 55.0, seed + 19) * 2.0 - 1.0) * 0.01 * grainSoft * landAmp;
  let n4 = (fbm3(x * 48.0, y * 48.0, z * 48.0, seed + 88, 3) * 2.0 - 1.0) * 0.008 * grainSoft * landAmp;
  let n5 = select(0.0, (ridged3(x, y, z, seed + 101, 4, 28.0) * 2.0 - 1.0) * 0.008 * grainSoft * landAmp, cls == 0 || cls == 1);
  let aridN = clamp01(aridW);
  let grain = n1 * 0.55 + n2 * 0.3 + n3 * 0.22 + n4 * 0.18 + n5 * 0.15;
  let warmFleck = aridN * n3 * 0.03;
  let preR = col.x;
  let preG = col.y;
  let preB = col.z;
  let preL = 0.2126 * preR + 0.7152 * preG + 0.0722 * preB;
  col = clamp(vec3<f32>(
    col.x + grain + warmFleck * 0.25,
    col.y + grain,
    col.z + grain - warmFleck * 0.08,
  ), vec3<f32>(0.0), vec3<f32>(1.0));
  {
    let oL = 0.2126 * col.x + 0.7152 * col.y + 0.0722 * col.z;
    if (oL > 1e-5 && preL > 1e-5) {
      let lumaTarget = preL * 0.92 + oL * 0.08;
      let k = lumaTarget / oL;
      col = clamp(col * k, vec3<f32>(0.0), vec3<f32>(1.0));
    }
  }
  if (aridN > 0.22) {
    let aridFade = 1.0 - iceAmt * 0.92;
    col = lerpRgb(col, palRgb(5u), aridN * 0.18 * aridFade);
    col = lerpRgb(col, palRgb(6u), aridN * aridN * 0.1 * aridFade);
  }
  if (forestW > 0.12 && aridN < 0.5 && absLat < 0.9) {
    let fw = clamp01(forestW) * (1.0 - smoothstep_f(0.15, 0.75, iceAmt));
    if (fw > 0.02) {
      col = vec3<f32>(
        clamp01(col.x - fw * 0.04),
        clamp01(col.y + fw * 0.08),
        clamp01(col.z - fw * 0.025),
      );
      col = lerpRgb(col, palRgb(8u), fw * 0.22);
    }
  }
  if (iceAmt > 0.02) {
    col = lerpRgb(col, palRgb(14u), clamp01(iceAmt * iceAmt * 0.35 + iceAmt * 0.65));
    col = lerpRgb(col, vec3<f32>(0.95, 0.97, 1.0), smoothstep_f(0.88, 1.0, iceAmt) * 0.4);
  }
  {
    let valley = 1.0 - smoothstep_f(0.0, 0.12, elev) * 0.03
      * select(1.0, 0.3, aridW > 0.4) * (1.0 - iceAmt * 0.95);
    col = clamp(col * valley, vec3<f32>(0.0), vec3<f32>(1.0));
  }

  var spec = 0.06;
  if (iceAmt > 0.35) { spec = 0.06 + iceAmt * 0.26; }
  else if (aridW > 0.5) { spec = 0.07; }
  else if (forestW > 0.5) { spec = 0.04; }

  out.col = col;
  out.mat = mat;
  out.spec = spec;
  return out;
}

@compute @workgroup_size(8, 8, 1)
fn cs_paint(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let i = idxOf(x, y);
  let h = heightA[i];
  let dx = cosLat(y) * cosLon(x);
  let dy = sinLat(y);
  let dz = cosLat(y) * sinLon(x);
  let seed = P.seed;
  let sea = P.sea;
  let cls = P.planetClass;
  let liquidKind = P.liquidKind;

  var col = vec3<f32>(0.0);
  var liq = 0.0;
  var spec = 0.0;
  var mat = 0.0;

  if (cls == 4) {
    // Gas path kept on CPU host; this is a safety fill
    col = lerpRgb(palRgb(16u), palRgb(17u), h);
    mat = 10.0;
    spec = 0.18;
  } else if (liquidKind == 3) {
    // Lava GPU draft: multi-basin seas via ridged barriers (host re-paints full
    // drainage + dilate after readback for product parity).
    var elev = h;
    if (sea < 0.999) { elev = (h - sea) / max(1e-4, 1.0 - sea); }
    let elevC = clamp01(elev);
    let clim = climateFields(dx, dy, dz, elevC, seed);
    let land = landBiomeColor(elevC, clim.x, clim.y, clim.z, abs(dy), cls, liquidKind, dx, dy, dz, seed);
    let b1 = ridged3(dx, dy, dz, seed + 901, 4, 1.15);
    let b2 = ridged3(dx, dy, dz, seed + 911, 3, 2.1);
    let b3 = ridged3(dx, dy, dz, seed + 921, 3, 3.6);
    let ridge = max(max(b1, b2 * 0.92), b3 * 0.7);
    let plate = fbm3(dx * 0.85, dy * 0.4, dz * 0.85, seed + 777, 4) * 0.5 + 0.5;
    let plateWall = pow(abs(plate * 2.0 - 1.0), 1.1);
    let barrier = pow(max(ridge, plateWall * 0.85), 1.25);
    let hLiq = h + clamp(barrier, 0.0, 1.0) * 0.28;
    let depthBelow = sea - h;
    let isSea = hLiq < sea && depthBelow > 0.012 + clamp(barrier, 0.0, 1.0) * 0.04;
    if (isSea) {
      let depth = clamp01((sea - h) / max(1e-4, sea));
      // Near-binary hot melt (host hardenLavaShores also re-heats + lip)
      let intensity = clamp01(0.9 + depth * 0.1);
      col = brightLavaColor(intensity);
      liq = 1.0;
      spec = 0.04; // matte melt — not water wet (host re-paint also uses LAVA_LIQUID_SPEC)
      mat = 4.0;
    } else {
      col = land.col;
      mat = land.mat;
      spec = land.spec;
      liq = 0.0;
    }
  } else if (liquidKind != 4 && h < sea) {
    let shallow3d = sampleOceanBathymetry3d(dx, dy, dz, seed + 40, P.heightFreq);
    let depth = oceanPaintDepth(sea, h, shallow3d);
    if (cls == 3) {
      // Ice world: frozen ice basin (cool blue snow), not open liquid navy
      col = frozenIceSeaColor(clamp01(depth), dx, dy, dz, seed);
      liq = 1.0;
      spec = 0.38 + P.wetness * 0.12 * (1.0 - depth * 0.2);
      mat = 9.0;
    } else {
      col = oceanColor(clamp01(depth), dx, dy, dz, seed);
      // Methane/acid: lean palette toward liquid stops (pal already class-packed)
      if (liquidKind == 1) {
        // methane: warm dark lakes
        col = lerpRgb(col, palRgb(0u), 0.35);
        col = clamp(col * vec3<f32>(1.15, 0.85, 0.55), vec3<f32>(0.0), vec3<f32>(1.0));
      } else if (liquidKind == 2) {
        col = lerpRgb(col, palRgb(1u), 0.25);
      }
      liq = 1.0;
      spec = 0.55 + P.wetness * 0.35 * (1.0 - depth * 0.25);
      if (liquidKind == 2) { mat = 3.0; }
      else if (liquidKind == 1) { mat = 2.0; }
      else { mat = 1.0; }
    }
  } else {
    var elev = h;
    if (sea < 0.999) {
      elev = (h - sea) / max(1e-4, 1.0 - sea);
    }
    let elevC = clamp01(elev);
    let clim = climateFields(dx, dy, dz, elevC, seed);
    let land = landBiomeColor(elevC, clim.x, clim.y, clim.z, abs(dy), cls, liquidKind, dx, dy, dz, seed);
    col = land.col;
    mat = land.mat;
    spec = land.spec;
  }

  col = boostRgb(col, P.colorBoost);
  albedoBuf[i] = packRgba8(col.x, col.y, col.z, 1.0);
  liquidBuf[i] = packRgba8(liq, min(1.0, spec), mat / 15.0, 1.0);
}

@compute @workgroup_size(8, 8, 1)
fn cs_normal(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let W = P.width;
  let H = P.height;
  let strength = P.normalStrength;
  let lat = (0.5 - (f32(y) + 0.5) / f32(H)) * 3.14159265;
  let cosLatV = max(0.08, cos(lat));
  let xl = (x + W - 1u) % W;
  let xr = (x + 1u) % W;
  let yu = max(0u, y - 1u);
  let yd = min(H - 1u, y + 1u);
  let hL = heightA[y * W + xl];
  let hR = heightA[y * W + xr];
  let hU = heightA[yu * W + x];
  let hD = heightA[yd * W + x];
  let ddx = ((hR - hL) * strength) / cosLatV;
  let ddy = (hD - hU) * strength;
  var nx = -ddx;
  var ny = -ddy;
  var nz = 1.0;
  let len = max(1e-8, sqrt(nx * nx + ny * ny + nz * nz));
  nx = nx / len;
  ny = ny / len;
  nz = nz / len;
  normalBuf[idxOf(x, y)] = packRgba8(nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5, 1.0);
}

fn sampleLiquid01(x: i32, y: i32) -> f32 {
  // U-wrap, V-clamp liquid R
  let W = i32(P.width);
  let H = i32(P.height);
  var xx = x;
  if (xx < 0) { xx = xx + W; }
  if (xx >= W) { xx = xx - W; }
  let yy = clamp(y, 0, H - 1);
  let packed = liquidBuf[u32(yy) * P.width + u32(xx)];
  return f32(packed & 0xffu) / 255.0;
}

@compute @workgroup_size(8, 8, 1)
fn cs_flatten_liquid_normals(@builtin(global_invocation_id) gid: vec3<u32>) {
  // Kill land/sea normal rim completely + offshore micro waves
  // (match heightfield.flattenLiquidNormals)
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let i = idxOf(x, y);
  let hardLiq = f32(liquidBuf[i] & 0xffu) / 255.0;
  // Soft liquid via box average (≈ COAST_NORMAL_SOFT_RADIUS = 8)
  var soft = 0.0;
  let R = 8;
  var cnt = 0.0;
  for (var ky = -R; ky <= R; ky = ky + 1) {
    for (var kx = -R; kx <= R; kx = kx + 1) {
      soft = soft + sampleLiquid01(i32(x) + kx, i32(y) + ky);
      cnt = cnt + 1.0;
    }
  }
  soft = soft / max(1.0, cnt);
  if (hardLiq < 0.04 && soft < 0.02) { return; }

  var t: f32;
  if (hardLiq >= 0.5) {
    t = 1.0; // all water → fully flat base
  } else {
    // land near water → full flat (no cliff rim)
    let u = clamp(soft / 0.22, 0.0, 1.0);
    t = u * u * (3.0 - 2.0 * u);
  }
  if (t < 0.015) { return; }

  let n = normalBuf[i];
  let nr = f32(n & 0xffu) / 255.0;
  let ng = f32((n >> 8u) & 0xffu) / 255.0;
  let nb = f32((n >> 16u) & 0xffu) / 255.0;
  var nx = (nr * 2.0 - 1.0) * (1.0 - t);
  var ny = (ng * 2.0 - 1.0) * (1.0 - t);
  var nz = (nb * 2.0 - 1.0) * (1.0 - t) + 1.0 * t;

  // Micro waves only well offshore
  if (hardLiq > 0.55 && soft > 0.72) {
    let dx = cosLat(y) * cosLon(x);
    let dy = sinLat(y);
    let dz = cosLat(y) * sinLon(x);
    let cosL = max(0.12, sqrt(max(0.0, 1.0 - dy * dy)));
    let open = clamp((soft - 0.72) / 0.25, 0.0, 1.0);
    let amp = 0.2 * open * (0.7 + 0.3 * cosL);
    let fAcross = 960.0;
    let fAlong = 960.0 / 10.0;
    let fY = 960.0 * 0.28;
    let sWave = P.seed + 4401;
    let ca = 0.92;
    let sa = 0.39;
    let qx = dx * ca + dz * sa;
    let qz = -dx * sa + dz * ca;
    let h1 = valueNoise3(qx * fAcross, dy * fY, qz * fAlong, sWave) * 2.0 - 1.0;
    let h2 = valueNoise3(qx * fAcross * 2.05 + 2.1, dy * fY * 1.4 - 0.7, qz * fAlong * 2.05, sWave + 31) * 2.0 - 1.0;
    let ca2 = 0.34;
    let sa2 = 0.94;
    let rx = dx * ca2 + dz * sa2;
    let rz = -dx * sa2 + dz * ca2;
    let h3 = valueNoise3(rx * fAcross * 0.85, dy * fY, rz * fAlong * 0.85, sWave + 17) * 2.0 - 1.0;
    let across = h1 * 0.7 + h2 * 0.3;
    let along = h3 * 0.45 + h1 * 0.15;
    nx = nx + across * amp;
    ny = ny + along * amp * 0.45;
  }
  let len = max(1e-8, sqrt(nx * nx + ny * ny + nz * nz));
  nx = nx / len;
  ny = ny / len;
  nz = nz / len;
  normalBuf[i] = packRgba8(nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5, 1.0);
}

@compute @workgroup_size(8, 8, 1)
fn cs_height_gray(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let i = idxOf(x, y);
  let g = clamp01(heightA[i]);
  heightRgbaBuf[i] = packRgba8(g, g, g, 1.0);
}

@compute @workgroup_size(8, 8, 1)
fn cs_clouds(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let i = idxOf(x, y);
  // Clouds: temperate only (cls 1). Gas=4, ocean/rocky/etc skip.
  if (P.cloudCover <= 0.01 || P.planetClass != 1) {
    cloudBuf[i] = 0u;
    return;
  }
  let seed = P.seed + 9001;
  let cover = clamp01(P.cloudCover);
  let dx = cosLat(y) * cosLon(x);
  let dy = sinLat(y);
  let dz = cosLat(y) * sinLon(x);
  // Structured multi-scale clouds (match materials.generateClouds)
  let wx = fbm3(dx * 1.4, dy * 1.1, dz * 1.4, seed + 1, 3) * 0.18 - 0.09;
  let wz = fbm3(dx * 1.4 + 3.0, dy * 1.1, dz * 1.4, seed + 2, 3) * 0.18 - 0.09;
  let px = dx + wx;
  let py = dy * 0.85;
  let pz = dz + wz;
  let deck = fbm3(px * 1.6, py * 1.2, pz * 1.6, seed, 5) * 0.5 + 0.5;
  let broken = ridged3(px, py, pz, seed + 11, 4, 3.8);
  let cells = fbm3(px * 4.5, py * 2.2, pz * 4.5, seed + 21, 4) * 0.5 + 0.5;
  let fluff = fbm3(px * 14.0, py * 6.0, pz * 14.0, seed + 31, 3) * 0.5 + 0.5;
  let ridgeEdge = ridged3(px, py, pz, seed + 41, 3, 11.0);
  var c = deck * 0.42 + broken * 0.28 + cells * 0.18 + fluff * 0.08 + ridgeEdge * 0.12;
  c = c * (0.82 + 0.18 * (1.0 - abs(dy) * 0.55));
  let thresh = 1.0 - cover * 0.78;
  var a = smoothstep_f(thresh, min(1.0, thresh + 0.22 + cover * 0.08), c);
  a = clamp01(a * a * (1.35 + cover * 0.25));
  if (broken < 0.22 && cover < 0.85) { a = a * (0.35 + broken * 2.0); }
  let g = (200.0 + a * 55.0) / 255.0;
  let b = min(1.0, (200.0 + a * 55.0 + 12.0) / 255.0);
  cloudBuf[i] = packRgba8(g, g, b, a);
}

// =====================================================================
// Hydraulic Option B: parallel droplets + atomic i32 height deltas
// =====================================================================
`;
/** Parallel hydraulic droplets with atomic height deltas. */
export const PLANET_FULL_BAKE_HYDRO_WGSL = PLANET_BAKE_PURE + /* wgsl */ `
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> heightA: array<f32>;
@group(0) @binding(2) var<storage, read_write> dropState: array<f32>;
@group(0) @binding(3) var<storage, read_write> deltaAtomic: array<atomic<i32>>;

const HYDRO_SCALE: f32 = 1000000.0;
` + PLANET_BAKE_AFTER_P + /* wgsl */ `

fn sampleH_bilinear(fx: f32, fy: f32) -> f32 {
  let W = f32(P.width);
  let H = f32(P.height);
  var x = fx % W;
  if (x < 0.0) { x = x + W; }
  let y = clamp(fy, 0.0, H - 1.001);
  let x0 = u32(floor(x)) % P.width;
  let x1 = (x0 + 1u) % P.width;
  let y0 = u32(floor(y));
  let y1 = min(P.height - 1u, y0 + 1u);
  let tx = x - floor(x);
  let ty = y - f32(y0);
  let h00 = heightA[y0 * P.width + x0];
  let h10 = heightA[y0 * P.width + x1];
  let h01 = heightA[y1 * P.width + x0];
  let h11 = heightA[y1 * P.width + x1];
  return h00 * (1.0 - tx) * (1.0 - ty) + h10 * tx * (1.0 - ty)
    + h01 * (1.0 - tx) * ty + h11 * tx * ty;
}

fn depositDelta(fx: f32, fy: f32, amount: f32) {
  if (amount <= 0.0) { return; }
  let W = i32(P.width);
  let H = i32(P.height);
  let x0 = i32(floor(fx));
  let y0 = i32(floor(fy));
  let tx = fx - f32(x0);
  let ty = fy - f32(y0);
  let weights = array<f32, 4>((1.0 - tx) * (1.0 - ty), tx * (1.0 - ty), (1.0 - tx) * ty, tx * ty);
  let xs = array<i32, 4>(x0, x0 + 1, x0, x0 + 1);
  let ys = array<i32, 4>(y0, y0, y0 + 1, y0 + 1);
  for (var k = 0u; k < 4u; k++) {
    let xi = (xs[k] % W + W) % W;
    let yi = clamp(ys[k], 0, H - 1);
    let idx = u32(yi) * P.width + u32(xi);
    let d = i32(round(amount * weights[k] * HYDRO_SCALE));
    atomicAdd(&deltaAtomic[idx], d);
  }
}

fn erodeDelta(fx: f32, fy: f32, amount: f32) {
  if (amount <= 0.0) { return; }
  let r = max(1, P.hydroRadius);
  let cx = i32(floor(fx));
  let cy = i32(floor(fy));
  let W = i32(P.width);
  let H = i32(P.height);
  var sumW = 0.0;
  // two-pass weight sum then apply (radius usually 1 → 5–9 cells)
  for (var dy = -r; dy <= r; dy++) {
    for (var dx = -r; dx <= r; dx++) {
      let dist = sqrt(f32(dx * dx + dy * dy));
      if (dist > f32(r)) { continue; }
      sumW = sumW + max(0.0, f32(r) - dist);
    }
  }
  if (sumW <= 0.0) { return; }
  for (var dy = -r; dy <= r; dy++) {
    for (var dx = -r; dx <= r; dx++) {
      let dist = sqrt(f32(dx * dx + dy * dy));
      if (dist > f32(r)) { continue; }
      let w = max(0.0, f32(r) - dist);
      let xi = ((cx + dx) % W + W) % W;
      let yi = clamp(cy + dy, 0, H - 1);
      let idx = u32(yi) * P.width + u32(xi);
      let d = -i32(round((amount * w / sumW) * HYDRO_SCALE));
      atomicAdd(&deltaAtomic[idx], d);
    }
  }
}

@compute @workgroup_size(256, 1, 1)
fn cs_hydro_init_drops(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x + P.workOffset;
  if (id >= u32(P.hydroDrops)) { return; }
  // Independent stream per drop (order ≠ serial mulberry; metric parity OK)
  var state = u32(P.seed) ^ 0xa5a5a5a5u;
  state = state + id * 0x9e3779b9u;
  state = mulberry32_step(state);
  let px = f32(state) / 4294967296.0 * f32(P.width);
  state = mulberry32_step(state);
  let py = f32(state) / 4294967296.0 * f32(P.height);
  let base = id * 8u;
  dropState[base + 0u] = px;
  dropState[base + 1u] = py;
  dropState[base + 2u] = 0.0;
  dropState[base + 3u] = 0.0;
  dropState[base + 4u] = 1.0; // speed
  dropState[base + 5u] = 1.0; // water
  dropState[base + 6u] = 0.0; // sediment
  dropState[base + 7u] = 1.0; // alive
}

@compute @workgroup_size(256, 1, 1)
fn cs_hydro_clear_delta(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = P.width * P.height;
  let i = gid.x + P.workOffset;
  if (i >= n) { return; }
  atomicStore(&deltaAtomic[i], 0);
}

@compute @workgroup_size(256, 1, 1)
fn cs_hydro_step(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x + P.workOffset;
  if (id >= u32(P.hydroDrops)) { return; }
  let base = id * 8u;
  if (dropState[base + 7u] < 0.5) { return; }

  var px = dropState[base + 0u];
  var py = dropState[base + 1u];
  var dirX = dropState[base + 2u];
  var dirY = dropState[base + 3u];
  var speed = dropState[base + 4u];
  var water = dropState[base + 5u];
  var sediment = dropState[base + 6u];

  let W = f32(P.width);
  let H = f32(P.height);
  let h0 = sampleH_bilinear(px, py);
  let e = 1.0;
  let gx = (sampleH_bilinear(px + e, py) - sampleH_bilinear(px - e, py)) * 0.5;
  let gy = (sampleH_bilinear(px, py + e) - sampleH_bilinear(px, py - e)) * 0.5;

  dirX = dirX * P.hydroInertia - gx * (1.0 - P.hydroInertia);
  dirY = dirY * P.hydroInertia - gy * (1.0 - P.hydroInertia);
  let len = sqrt(dirX * dirX + dirY * dirY);
  if (len < 1e-8) {
    // flat — hash nudge from drop id + step
    let r0 = hash3(i32(id), P.hydroStepIdx, 1, P.seed);
    let r1 = hash3(i32(id), P.hydroStepIdx, 2, P.seed);
    dirX = r0 * 2.0 - 1.0;
    dirY = r1 * 2.0 - 1.0;
  } else {
    dirX = dirX / len;
    dirY = dirY / len;
  }

  let npx = px + dirX;
  let npy = py + dirY;
  if (npy < 0.0 || npy >= H) {
    dropState[base + 7u] = 0.0;
    return;
  }

  let h1 = sampleH_bilinear(npx, npy);
  let deltaH = h1 - h0;
  let cap = max(deltaH, 0.01) * speed * water * P.hydroCapacity;

  if (sediment > cap || deltaH > 0.0) {
    var amount: f32;
    if (deltaH > 0.0) {
      amount = min(sediment, deltaH);
    } else {
      amount = (sediment - cap) * P.hydroDeposition;
    }
    sediment = sediment - amount;
    depositDelta(px, py, amount);
  } else {
    let amount = min((cap - sediment) * P.hydroErosion, -deltaH);
    sediment = sediment + amount;
    erodeDelta(px, py, amount);
  }

  speed = sqrt(max(0.0, speed * speed + deltaH * P.hydroGravity));
  water = water * (1.0 - P.hydroEvap);
  px = npx % W;
  if (px < 0.0) { px = px + W; }
  py = npy;

  dropState[base + 0u] = px;
  dropState[base + 1u] = py;
  dropState[base + 2u] = dirX;
  dropState[base + 3u] = dirY;
  dropState[base + 4u] = speed;
  dropState[base + 5u] = water;
  dropState[base + 6u] = sediment;
  if (water < 0.01) {
    dropState[base + 7u] = 0.0;
  }
}

@compute @workgroup_size(8, 8, 1)
fn cs_hydro_apply_delta(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let i = idxOf(x, y);
  let d = atomicLoad(&deltaAtomic[i]);
  heightA[i] = max(0.0, heightA[i] + f32(d) / HYDRO_SCALE);
}
`;
export const PLANET_FULL_BAKE_FULL_WGSL = PLANET_FULL_BAKE_TERRAIN_WGSL;
//# sourceMappingURL=planet-full-bake.wgsl.js.map
//# sourceMappingURL=planet-full-bake.wgsl.js.map