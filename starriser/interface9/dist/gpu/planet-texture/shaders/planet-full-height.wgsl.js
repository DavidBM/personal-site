/**
 * Full sampleHeightAtDir + sampleTectonicControls for GPU base height.
 * Mirrors js/gpu/planet-texture/heightfield.ts + noise.ts (no lean substitution).
 */
export const PLANET_FULL_HEIGHT_WGSL = /* wgsl */ `
struct Params {
  width: u32,
  height: u32,
  seed: i32,
  planetClass: i32, // 0 ocean 1 temperate 2 rocky 3 ice 4 gas 5 exotic
  heightOctaves: i32,
  _pad0: i32,
  heightFreq: f32,
  warp: f32,
  continentScale: f32,
  mountainScale: f32,
}

@group(0) @binding(0) var<uniform> P: Params;
// LUT: [0..W) cosLon, [W..2W) sinLon, [2W..2W+H) cosLat, [2W+H..2W+2H) sinLat
@group(0) @binding(1) var<storage, read> luts: array<f32>;
@group(0) @binding(2) var<storage, read_write> heightBuf: array<f32>;
@group(0) @binding(3) var<storage, read_write> reduceBuf: array<f32>; // min/max scratch

fn cosLon(x: u32) -> f32 { return luts[x]; }
fn sinLon(x: u32) -> f32 { return luts[P.width + x]; }
fn cosLat(y: u32) -> f32 { return luts[P.width * 2u + y]; }
fn sinLat(y: u32) -> f32 { return luts[P.width * 2u + P.height + y]; }

fn clamp01(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }

fn smoothstep_f(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / max(1e-8, e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// Match noise.ts hash3 (logical >>> via u32)
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

@compute @workgroup_size(8, 8, 1)
fn cs_height(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let dx = cosLat(y) * cosLon(x);
  let dy = sinLat(y);
  let dz = cosLat(y) * sinLon(x);
  heightBuf[y * P.width + x] = sampleHeightAtDir(dx, dy, dz);
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
    let h = heightBuf[idx];
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
  // First-pass normalize only (soft contrast + softCoast stay on CPU like generateBaseHeight)
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let idx = y * P.width + x;
  let minH = reduceBuf[0];
  let maxH = reduceBuf[1];
  let range = max(1e-8, maxH - minH);
  heightBuf[idx] = (heightBuf[idx] - minH) / range;
}
`;
//# sourceMappingURL=planet-full-height.wgsl.js.map