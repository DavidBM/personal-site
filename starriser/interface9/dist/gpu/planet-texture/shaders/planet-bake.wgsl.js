/**
 * WebGPU compute shaders for GPU planet bake (parity with gpu-bake-math.ts).
 * Integer hash + f32 noise; sphere dirs from LUT buffers.
 */
export const PLANET_BAKE_WGSL = /* wgsl */ `
struct Params {
  width: u32,
  height: u32,
  seed: i32,
  planetClass: i32,
  liquidKind: i32,
  sea: f32,
  freq: f32,
  warp: f32,
  continentScale: f32,
  mountainScale: f32,
  colorBoost: f32,
  cloudCover: f32,
  strength: f32,
  _pad: f32,
}

// ≤8 storage buffers (WebGPU per-stage limit). LUTs packed into one buffer:
// [0..W): cosLon, [W..2W): sinLon, [2W..2W+H): cosLat, [2W+H..2W+2H): sinLat
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> luts: array<f32>;
@group(0) @binding(2) var<storage, read_write> heightBuf: array<f32>;
@group(0) @binding(3) var<storage, read_write> albedoBuf: array<u32>; // packed RGBA8
@group(0) @binding(4) var<storage, read_write> normalBuf: array<u32>;
@group(0) @binding(5) var<storage, read_write> liquidBuf: array<u32>;
@group(0) @binding(6) var<storage, read_write> heightRgbaBuf: array<u32>;
@group(0) @binding(7) var<storage, read_write> cloudBuf: array<u32>;
@group(0) @binding(8) var<storage, read_write> reduceBuf: array<f32>; // [min,max] then scratch

fn cosLon(x: u32) -> f32 { return luts[x]; }
fn sinLon(x: u32) -> f32 { return luts[P.width + x]; }
fn cosLat(y: u32) -> f32 { return luts[P.width * 2u + y]; }
fn sinLat(y: u32) -> f32 { return luts[P.width * 2u + P.height + y]; }

fn imul(a: i32, b: i32) -> i32 {
  return a * b;
}

// Must match gpu-bake-math.ts hash3 exactly (arithmetic >>, stepwise i32 add).
fn hash3(ix: i32, iy: i32, iz: i32, seed: i32) -> f32 {
  var n = imul(ix, 374761393);
  n = n + imul(iy, 668265263);
  n = n + imul(iz, 2147483647);
  n = n + imul(seed, 1013904223);
  n = n ^ (n >> 13); // arithmetic i32 shift
  n = imul(n, 1274126177);
  let u = u32(n ^ (n >> 16)); // bitcast after arithmetic mix
  return f32(u) / 4294967296.0;
}

fn fade(t: f32) -> f32 {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
  return a + (b - a) * t;
}

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
  let nxy0 = lerp(nx00, nx10, fy);
  let nxy1 = lerp(nx01, nx11, fy);
  return lerp(nxy0, nxy1, fz);
}

fn fbm3(x: f32, y: f32, z: f32, seed: i32, octaves: i32) -> f32 {
  var amp = 1.0;
  var freq = 1.0;
  var sum = 0.0;
  var norm = 0.0;
  let n = clamp(octaves, 1, 8);
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
  let n = clamp(octaves, 1, 8);
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

fn smoothstep_f(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn sampleHeight(x: f32, y: f32, z: f32) -> f32 {
  // Dense stack — lockstep with gpu-bake-math.ts sampleGpuHeight
  let f = max(1e-4, P.freq);
  let s = P.seed;
  let cont = P.continentScale;
  let mtn = max(0.35, P.mountainScale);
  let planetClass = P.planetClass;

  if (planetClass == 4) {
    return fbm3(x * 5.0, y * 1.2, z * 5.0, s + 7, 5) * 0.5 + 0.5
      + ridged3(x, y, z, s + 19, 3, 8.0) * 0.12;
  }

  let wAmt = P.warp * 0.65;
  let wx = fbm3(x * f * 0.55, y * f * 0.55, z * f * 0.55, s + 11, 4) * wAmt;
  let wy = fbm3(x * f * 0.55 + 3.1, y * f * 0.55, z * f * 0.55 - 1.7, s + 29, 4) * wAmt;
  let wz = fbm3(x * f * 0.55 - 2.2, y * f * 0.55 + 4.4, z * f * 0.55, s + 47, 4) * wAmt;
  let cx = x + wx;
  let cy = y + wy;
  let cz = z + wz;

  var continental = fbm3(cx * f * cont, cy * f * cont, cz * f * cont, s + 101, 5) * 0.5 + 0.5;
  continental = continental * 0.72
    + (fbm3(cx * f * 2.1, cy * f * 2.1, cz * f * 2.1, s + 131, 4) * 0.5 + 0.5) * 0.28;
  let landMask = smoothstep_f(0.38, 0.58, continental);
  let landSoft = smoothstep_f(0.32, 0.64, continental);

  let uplift = ridged3(cx, cy, cz, s + 201, 4, f * 2.4) * 0.55
    + (fbm3(cx * f * 1.8, cy * f * 1.8, cz * f * 1.8, s + 211, 3) * 0.5 + 0.5) * 0.45;
  let chainMask = smoothstep_f(0.22, 0.62, uplift) * landMask;

  let peaksA = ridged3(cx, cy, cz, s + 301, 5, f * 11.0);
  let peaksB = ridged3(cx, cy, cz, s + 311, 4, f * 22.0);
  let peaksC = ridged3(x, y, z, s + 321, 4, f * 48.0);
  let peaks = peaksA * 0.5 + peaksB * 0.32 + peaksC * 0.18;

  let abyssal = fbm3(x * f * 1.4, y * f * 1.4, z * f * 1.4, s + 401, 4) * 0.5 + 0.5;
  let ridge = ridged3(x, y, z, s + 411, 4, f * 2.2) * 0.5;
  let seamount = ridged3(x, y, z, s + 421, 4, f * 9.0);
  var oceanFloor = 0.08 + abyssal * 0.22 + ridge * 0.12
    + seamount * 0.07 * (1.0 - landMask) + landSoft * 0.22;

  let hills = fbm3(x * f * 8.0, y * f * 8.0, z * f * 8.0, s + 501, 4) * 0.5 + 0.5;
  let rangeA = ridged3(x, y, z, s + 511, 5, f * 4.5);
  let micro = fbm3(x * f * 36.0, y * f * 36.0, z * f * 36.0, s + 521, 3) * 0.5 + 0.5;
  let microRidge = ridged3(x, y, z, s + 531, 3, f * 64.0);
  var land = 0.34 + continental * 0.14 + hills * 0.1 * landMask
    + chainMask * rangeA * 0.32 * mtn
    + landMask * peaks * 0.38 * mtn
    + landMask * micro * 0.06
    + landMask * microRidge * 0.05;

  if (planetClass == 2) {
    land = land + landMask * (rangeA * 0.12 + peaks * 0.1) * mtn;
    oceanFloor = oceanFloor * 0.85;
  } else if (planetClass == 3) {
    land = land + landMask * peaks * 0.1 + abs(y) * 0.07;
  } else if (planetClass == 5) {
    land = land + landMask * ridged3(x * 1.5, y * 1.5, z * 1.5, s + 601, 4, f * 12.0) * 0.14;
  }

  var h = oceanFloor * (1.0 - landMask) + land * landMask;
  if (planetClass == 0 || planetClass == 1) {
    h = h + 0.02 * (1.0 - abs(y)) * landMask;
  }
  return h;
}

fn packRgba(r: u32, g: u32, b: u32, a: u32) -> u32 {
  return r | (g << 8u) | (b << 16u) | (a << 24u);
}

fn paint(h: f32, dx: f32, dy: f32, dz: f32) -> vec4<f32> {
  let s = P.seed;
  let sea = P.sea;
  let planetClass = P.planetClass;
  let liquidKind = P.liquidKind;
  let colorBoost = P.colorBoost;

  if (planetClass == 4) {
    let band = fbm3(dx * 6.0, dy * 1.5, dz * 6.0, s + 9, 4) * 0.5 + 0.5;
    let storm = ridged3(dx, dy, dz, s + 19, 3, 8.0);
    var r = 0.55 + band * 0.35 + storm * 0.1;
    var g = 0.35 + band * 0.25 + storm * 0.05;
    var b = 0.22 + band * 0.15;
    let boost = 1.0 + colorBoost * 0.35;
    return vec4<f32>(min(1.0, r * boost), min(1.0, g * boost), min(1.0, b * boost), 0.0);
  }

  if (liquidKind != 0 && h < sea) {
    let depth = (sea - h) / max(1e-4, sea);
    var r: f32; var g: f32; var b: f32;
    if (liquidKind == 4) {
      r = 0.55 + depth * 0.4; g = 0.12 + depth * 0.15; b = 0.02;
    } else if (liquidKind == 3) {
      r = 0.12 + depth * 0.1; g = 0.45 - depth * 0.15; b = 0.1;
    } else if (liquidKind == 2) {
      r = 0.08; g = 0.22 + (1.0 - depth) * 0.2; b = 0.28 + (1.0 - depth) * 0.15;
    } else {
      if (depth < 0.08) { r = 0.18; g = 0.55; b = 0.58; }
      else if (depth < 0.28) { r = 0.1; g = 0.42; b = 0.52; }
      else if (depth < 0.55) { r = 0.04; g = 0.16; b = 0.34; }
      else { r = 0.02; g = 0.05; b = 0.14; }
      let ix = i32(floor(dx * 48.0));
      let iy = i32(floor(dy * 48.0));
      let iz = i32(floor(dz * 48.0));
      let n1 = hash3(ix, iy, iz, s + 77) * 0.05 - 0.015;
      r = r + n1 * 0.35; g = g + n1 * 0.55; b = b + n1 * 0.75;
    }
    return vec4<f32>(clamp(r,0.0,1.0), clamp(g,0.0,1.0), clamp(b,0.0,1.0), 1.0);
  }

  let elev = (h - sea) / max(1e-4, 1.0 - sea);
  let elevC = clamp(elev, 0.0, 1.0);
  let absLat = abs(dy);
  // elev/lat climate only — no extra fbm (8K budget)
  let moisture = clamp(0.55 - elevC * 0.35 + (1.0 - absLat) * 0.2, 0.0, 1.0);
  let temperature = clamp((1.0 - absLat) * 0.95 - elevC * 0.35, 0.0, 1.0);
  let aridW = smoothstep_f(0.42, 0.72, temperature) * (1.0 - smoothstep_f(0.18, 0.5, moisture));
  let forestW = smoothstep_f(0.4, 0.78, moisture) * smoothstep_f(0.25, 0.7, temperature);
  let grassW = smoothstep_f(0.22, 0.55, moisture) * smoothstep_f(0.18, 0.65, temperature) * (1.0 - aridW * 0.85);

  var r = 0.32 + elevC * 0.12;
  var g = 0.28 + elevC * 0.08;
  var b = 0.18 + elevC * 0.04;
  r = r + aridW * 0.35; g = g + aridW * 0.18; b = b + aridW * 0.05;
  r = r + grassW * 0.05 - forestW * 0.08;
  g = g + grassW * 0.22 + forestW * 0.2;
  b = b + grassW * 0.04 - forestW * 0.05;
  let rock = smoothstep_f(0.45, 0.85, elevC);
  r = r * (1.0 - rock * 0.25) + 0.28 * rock;
  g = g * (1.0 - rock * 0.25) + 0.24 * rock;
  b = b * (1.0 - rock * 0.25) + 0.2 * rock;
  // Soft polar ice only (true high lat — not mid-lat white rings)
  let snow = smoothstep_f(0.9, 0.985, absLat) * 0.72;
  r = r * (1.0 - snow) + 0.9 * snow;
  g = g * (1.0 - snow) + 0.93 * snow;
  b = b * (1.0 - snow) + 0.96 * snow;
  if (planetClass == 2) {
    r = r * 0.7 + 0.45; g = g * 0.55 + 0.2; b = b * 0.45 + 0.1;
  } else if (planetClass == 3) {
    r = r * 0.4 + 0.55; g = g * 0.45 + 0.6; b = b * 0.5 + 0.7;
  }
  // Integer-lattice grit (hash only — bit-identical JS/WGSL)
  let ix = i32(floor(dx * 96.0));
  let iy = i32(floor(dy * 96.0));
  let iz = i32(floor(dz * 96.0));
  let grit = hash3(ix, iy, iz, s + 12) * 0.1 - 0.05;
  r = clamp(r + grit, 0.0, 1.0);
  g = clamp(g + grit * 0.9, 0.0, 1.0);
  b = clamp(b + grit * 0.75, 0.0, 1.0);
  let boost = 1.0 + colorBoost * 0.4;
  return vec4<f32>(min(1.0, r * boost), min(1.0, g * boost), min(1.0, b * boost), 0.0);
}

@compute @workgroup_size(16, 16, 1)
fn cs_height(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let dx = cosLat(y) * cosLon(x);
  let dy = sinLat(y);
  let dz = cosLat(y) * sinLon(x);
  var h = sampleHeight(dx, dy, dz);
  // Fine 18-bit snap (matches CPU-ref) — not 8-bit ladder
  h = floor(h * 262144.0 + 0.5) / 262144.0;
  heightBuf[y * P.width + x] = h;
}

@compute @workgroup_size(256, 1, 1)
fn cs_reduce_minmax(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  // Each thread scans a chunk; write per-workgroup min/max into reduceBuf at index 2+
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
  // store interleaved min/max
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

@compute @workgroup_size(16, 16, 1)
fn cs_paint_normal(@builtin(global_invocation_id) gid: vec3<u32>) {
  // Expects heightBuf already normalized by cs_normalize_height.
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let idx = y * P.width + x;
  let h = heightBuf[idx];

  let dx = cosLat(y) * cosLon(x);
  let dy = sinLat(y);
  let dz = cosLat(y) * sinLon(x);
  let col = paint(h, dx, dy, dz);
  // 16-bit intermediate pack (matches CPU-ref u8)
  let qr = u32(clamp(col.r, 0.0, 1.0) * 65535.0 + 0.5);
  let qg = u32(clamp(col.g, 0.0, 1.0) * 65535.0 + 0.5);
  let qb = u32(clamp(col.b, 0.0, 1.0) * 65535.0 + 0.5);
  let r = min(255u, (qr * 255u + 32767u) / 65535u);
  let g = min(255u, (qg * 255u + 32767u) / 65535u);
  let b = min(255u, (qb * 255u + 32767u) / 65535u);
  albedoBuf[idx] = packRgba(r, g, b, 255u);
  let liq = select(0u, 255u, col.a > 0.5);
  liquidBuf[idx] = packRgba(liq, select(20u, 200u, liq > 0u), 0u, 255u);
  // Integer 16-bit → u8 (matches bake-gpu-cpu-ref heightU8)
  let hq = u32(clamp(h, 0.0, 1.0) * 65535.0 + 0.5);
  let hg = min(255u, (hq * 255u + 32767u) / 65535u);
  heightRgbaBuf[idx] = packRgba(hg, hg, hg, 255u);

  // normals from normalized neighbors
  let xl = select(x - 1u, P.width - 1u, x == 0u);
  let xr = select(x + 1u, 0u, x + 1u >= P.width);
  let yu = select(y - 1u, 0u, y == 0u);
  let yd = select(y + 1u, P.height - 1u, y + 1u >= P.height);
  let hL = heightBuf[y * P.width + xl];
  let hR = heightBuf[y * P.width + xr];
  let hU = heightBuf[yu * P.width + x];
  let hD = heightBuf[yd * P.width + x];
  // Same LUT as sphere dirs (not cos()) — bit-identical with CPU-ref
  let cosLatY = max(0.08, cosLat(y));
  let ddx = ((hR - hL) * P.strength) / cosLatY;
  let ddy = (hD - hU) * P.strength;
  var nx = -ddx;
  var ny = -ddy;
  var nz = 1.0;
  let len = max(1e-8, sqrt(nx*nx + ny*ny + nz*nz));
  nx /= len; ny /= len; nz /= len;
  // Open water: flat bathymetry + elongated micro wave normals.
  // Soft coastal flatten on liquid (full soft band is CPU/GPU full-bake path).
  if (liq > 0u && P.planetClass != 4 && P.liquidKind != 0) {
    // Flatten toward up (hard mask path — soft coast handled in full bake)
    nx = nx * 0.12;
    ny = ny * 0.12;
    nz = nz * 0.12 + 0.88;
    let amp = 0.2;
    let fAcross = 960.0;
    let fAlong = 96.0;
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
    let lenW = max(1e-8, sqrt(nx * nx + ny * ny + nz * nz));
    nx /= lenW; ny /= lenW; nz /= lenW;
  }
  // 16-bit intermediate pack (matches CPU-ref packN)
  let nrx = clamp(nx * 0.5 + 0.5, 0.0, 1.0);
  let nry = clamp(ny * 0.5 + 0.5, 0.0, 1.0);
  let nrz = clamp(nz * 0.5 + 0.5, 0.0, 1.0);
  let qrx = u32(nrx * 65535.0 + 0.5);
  let qry = u32(nry * 65535.0 + 0.5);
  let qrz = u32(nrz * 65535.0 + 0.5);
  let nr = min(255u, (qrx * 255u + 32767u) / 65535u);
  let ng = min(255u, (qry * 255u + 32767u) / 65535u);
  let nb = min(255u, (qrz * 255u + 32767u) / 65535u);
  normalBuf[idx] = packRgba(nr, ng, nb, 255u);

  // clouds — single valueNoise
  // Clouds temperate only (cls 1)
  if (P.cloudCover > 0.01 && P.planetClass == 1) {
    let cn = valueNoise3(dx * 3.0, dy * 1.1, dz * 3.0, P.seed + 9001);
    var a = 0u;
    if (cn > 1.0 - P.cloudCover) {
      a = u32(clamp((cn - (1.0 - P.cloudCover)) / max(1e-4, P.cloudCover) * 200.0, 0.0, 255.0));
    }
    cloudBuf[idx] = packRgba(255u, 255u, 255u, a);
  } else {
    cloudBuf[idx] = packRgba(0u, 0u, 0u, 0u);
  }
}

@compute @workgroup_size(16, 16, 1)
fn cs_normalize_height(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= P.width || y >= P.height) { return; }
  let idx = y * P.width + x;
  let minH = reduceBuf[0];
  let maxH = reduceBuf[1];
  let range = max(1e-6, maxH - minH);
  var h = (heightBuf[idx] - minH) / range;
  // 16-bit quantize only (not 8-bit) — keeps elev relief for paint/normals
  h = floor(clamp(h, 0.0, 1.0) * 65535.0 + 0.5) / 65535.0;
  heightBuf[idx] = h;
}
`;
//# sourceMappingURL=planet-bake.wgsl.js.map