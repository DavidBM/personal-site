/**
 * Shared f32 math for the GPU-accelerated planet bake and its CPU twin.
 *
 * Design for bit-identical CPU↔GPU:
 * - All float ops go through f32 (Math.fround on CPU; f32 in WGSL).
 * - Sphere directions come from 1D cos/sin LUTs (no per-pixel sin/cos drift).
 * - Integer lattice hash matches WGSL i32 wrapping (Math.imul / |0).
 * - No sequential hydraulic/stream-power (parallel-only stages).
 *
 * Full quality CPU bake (bakePlanetTextures) remains the Node smoke path;
 * this module is the locked GPU-parity pipeline.
 */
export function f32(x) {
    return Math.fround(x);
}
export function imul(a, b) {
    return Math.imul(a | 0, b | 0);
}
/**
 * Match WGSL i32 hash exactly:
 * - each + wraps as signed i32 (stepwise `| 0`, not float64 sum)
 * - shifts are **arithmetic** `>>` (WGSL `i32` right-shift), not logical `>>>`
 * - final mix bitcast to u32 via `>>> 0`
 */
export function hash3(ix, iy, iz, seed) {
    let n = imul(ix | 0, 374761393);
    n = (n + imul(iy | 0, 668265263)) | 0;
    n = (n + imul(iz | 0, 2147483647)) | 0;
    n = (n + imul(seed | 0, 1013904223)) | 0;
    // Arithmetic >> matches WGSL i32 shift (sign-extends); >>> was the GPU≠CPU bug
    n = (n ^ (n >> 13)) | 0;
    n = imul(n, 1274126177);
    const mixed = (n ^ (n >> 16)) | 0;
    return f32((mixed >>> 0) / 4294967296);
}
function fade(t) {
    const x = f32(t);
    // t^3 * (t * (6t - 15) + 10)
    return f32(x * x * x * f32(x * f32(x * 6 - 15) + 10));
}
function lerp(a, b, t) {
    return f32(f32(a) + f32(f32(b) - f32(a)) * f32(t));
}
export function valueNoise3(x, y, z, seed) {
    const xf = f32(x);
    const yf = f32(y);
    const zf = f32(z);
    const x0 = Math.floor(xf);
    const y0 = Math.floor(yf);
    const z0 = Math.floor(zf);
    const fx = fade(f32(xf - x0));
    const fy = fade(f32(yf - y0));
    const fz = fade(f32(zf - z0));
    const n000 = hash3(x0, y0, z0, seed);
    const n100 = hash3(x0 + 1, y0, z0, seed);
    const n010 = hash3(x0, y0 + 1, z0, seed);
    const n110 = hash3(x0 + 1, y0 + 1, z0, seed);
    const n001 = hash3(x0, y0, z0 + 1, seed);
    const n101 = hash3(x0 + 1, y0, z0 + 1, seed);
    const n011 = hash3(x0, y0 + 1, z0 + 1, seed);
    const n111 = hash3(x0 + 1, y0 + 1, z0 + 1, seed);
    const nx00 = lerp(n000, n100, fx);
    const nx10 = lerp(n010, n110, fx);
    const nx01 = lerp(n001, n101, fx);
    const nx11 = lerp(n011, n111, fx);
    const nxy0 = lerp(nx00, nx10, fy);
    const nxy1 = lerp(nx01, nx11, fy);
    return lerp(nxy0, nxy1, fz);
}
export function fbm3(x, y, z, seed, octaves, lacunarity = 2, gain = 0.5) {
    let amp = f32(1);
    let freq = f32(1);
    let sum = f32(0);
    let norm = f32(0);
    const n = Math.max(1, Math.min(8, octaves | 0));
    const lac = f32(lacunarity);
    const g = f32(gain);
    for (let i = 0; i < n; i++) {
        const v = valueNoise3(f32(x * freq), f32(y * freq), f32(z * freq), (seed + i * 101) | 0);
        sum = f32(sum + f32(f32(v * 2 - 1) * amp));
        norm = f32(norm + amp);
        amp = f32(amp * g);
        freq = f32(freq * lac);
    }
    return norm > 0 ? f32(sum / norm) : 0;
}
export function ridged3(x, y, z, seed, octaves, freq) {
    let amp = f32(0.5);
    let f = f32(Math.max(1e-4, freq));
    let sum = f32(0);
    let weight = f32(1);
    const n = Math.max(1, Math.min(8, octaves | 0));
    for (let i = 0; i < n; i++) {
        let s = valueNoise3(f32(x * f), f32(y * f), f32(z * f), (seed + i * 67) | 0);
        s = f32(1 - Math.abs(f32(s * 2 - 1)));
        s = f32(s * s);
        s = f32(s * weight);
        weight = f32(Math.min(1, f32(s * 1.6)));
        sum = f32(sum + f32(s * amp));
        amp = f32(amp * 0.5);
        f = f32(f * 2);
    }
    return sum;
}
function smoothstep(e0, e1, x) {
    const a = f32(e0);
    const b = f32(e1);
    const t = f32(Math.max(0, Math.min(1, f32(f32(x - a) / f32(b - a)))));
    return f32(t * t * f32(3 - f32(2 * t)));
}
/**
 * Multi-field planet height on unit sphere (GPU↔CPU-ref parity).
 * Dense peaks + multi-scale land/ocean so definition matches sequential quality
 * spirit (not the prior ~4-field lean stack that collapsed peaks to ~6@512).
 * Output roughly [0.05, 1.2] before global normalize.
 */
export function sampleGpuHeight(x, y, z, seed, freq, warp, continentScale, mountainScale, planetClass) {
    const f = f32(Math.max(1e-4, freq));
    const s = seed | 0;
    const cont = f32(continentScale);
    const mtn = f32(Math.max(0.35, mountainScale));
    if (planetClass === 4) {
        return f32(fbm3(f32(x * 5), f32(y * 1.2), f32(z * 5), s + 7, 5) * 0.5 +
            0.5 +
            ridged3(x, y, z, s + 19, 3, 8) * 0.12);
    }
    // Domain warp (continent irregularity)
    const wAmt = f32(warp * 0.65);
    const wx = f32(fbm3(f32(x * f * 0.55), f32(y * f * 0.55), f32(z * f * 0.55), s + 11, 4) * wAmt);
    const wy = f32(fbm3(f32(x * f * 0.55 + 3.1), f32(y * f * 0.55), f32(z * f * 0.55 - 1.7), s + 29, 4) * wAmt);
    const wz = f32(fbm3(f32(x * f * 0.55 - 2.2), f32(y * f * 0.55 + 4.4), f32(z * f * 0.55), s + 47, 4) * wAmt);
    const cx = f32(x + wx);
    const cy = f32(y + wy);
    const cz = f32(z + wz);
    // Dual-scale continentalness (plates + secondary)
    let continental = f32(fbm3(f32(cx * f * cont), f32(cy * f * cont), f32(cz * f * cont), s + 101, 5) * 0.5 + 0.5);
    continental = f32(continental * 0.72 +
        f32(fbm3(f32(cx * f * 2.1), f32(cy * f * 2.1), f32(cz * f * 2.1), s + 131, 4) * 0.5 + 0.5) *
            0.28);
    const landMask = smoothstep(0.38, 0.58, continental);
    const landSoft = smoothstep(0.32, 0.64, continental);
    // Uplift / mountain belts
    const uplift = f32(ridged3(cx, cy, cz, s + 201, 4, f32(f * 2.4)) * 0.55 +
        f32(fbm3(f32(cx * f * 1.8), f32(cy * f * 1.8), f32(cz * f * 1.8), s + 211, 3) * 0.5 + 0.5) *
            0.45);
    const chainMask = f32(smoothstep(0.22, 0.62, uplift) * landMask);
    // Dense peak field (high-freq ridged — drives landLocalMaxima count)
    const peaksA = ridged3(cx, cy, cz, s + 301, 5, f32(f * 11));
    const peaksB = ridged3(cx, cy, cz, s + 311, 4, f32(f * 22));
    const peaksC = ridged3(x, y, z, s + 321, 4, f32(f * 48));
    const peaks = f32(peaksA * 0.5 + peaksB * 0.32 + peaksC * 0.18);
    // Ocean bathymetry multi-scale
    const abyssal = f32(fbm3(f32(x * f * 1.4), f32(y * f * 1.4), f32(z * f * 1.4), s + 401, 4) * 0.5 + 0.5);
    const ridge = f32(ridged3(x, y, z, s + 411, 4, f32(f * 2.2)) * 0.5);
    const seamount = ridged3(x, y, z, s + 421, 4, f32(f * 9));
    let oceanFloor = f32(0.08 +
        abyssal * 0.22 +
        ridge * 0.12 +
        f32(seamount * 0.07 * f32(1 - landMask)) +
        f32(landSoft * 0.22));
    // Land composition
    const hills = f32(fbm3(f32(x * f * 8), f32(y * f * 8), f32(z * f * 8), s + 501, 4) * 0.5 + 0.5);
    const rangeA = ridged3(x, y, z, s + 511, 5, f32(f * 4.5));
    const micro = f32(fbm3(f32(x * f * 36), f32(y * f * 36), f32(z * f * 36), s + 521, 3) * 0.5 + 0.5);
    const microRidge = ridged3(x, y, z, s + 531, 3, f32(f * 64));
    let land = f32(0.34 +
        continental * 0.14 +
        f32(hills * 0.1 * landMask) +
        f32(chainMask * rangeA * 0.32 * mtn) +
        f32(landMask * peaks * 0.38 * mtn) +
        f32(landMask * micro * 0.06) +
        f32(landMask * microRidge * 0.05));
    if (planetClass === 2) {
        land = f32(land + f32(landMask * (rangeA * 0.12 + peaks * 0.1) * mtn));
        oceanFloor = f32(oceanFloor * 0.85);
    }
    else if (planetClass === 3) {
        land = f32(land + f32(landMask * peaks * 0.1) + f32(Math.abs(y) * 0.07));
    }
    else if (planetClass === 5) {
        land = f32(land + f32(landMask * ridged3(f32(x * 1.5), f32(y * 1.5), f32(z * 1.5), s + 601, 4, f32(f * 12)) * 0.14));
    }
    let h = f32(f32(oceanFloor * f32(1 - landMask)) + f32(land * landMask));
    if (planetClass === 0 || planetClass === 1) {
        h = f32(h + f32(0.02 * f32(1 - Math.abs(y)) * landMask));
    }
    return h;
}
export function classToId(cls) {
    switch (cls) {
        case "ocean":
            return 0;
        case "temperate":
            return 1;
        case "rocky":
            return 2;
        case "ice":
            return 3;
        case "gas":
            return 4;
        case "exotic":
            return 5;
        default:
            return 0;
    }
}
/** Build lon/lat LUTs for bit-identical dirs (CPU + GPU upload). */
export function buildSphereLuts(width, height) {
    const cosLon = new Float32Array(width);
    const sinLon = new Float32Array(width);
    const cosLat = new Float32Array(height);
    const sinLat = new Float32Array(height);
    const twoPi = f32(Math.PI * 2);
    const pi = f32(Math.PI);
    for (let x = 0; x < width; x++) {
        const u = f32((x + 0.5) / width);
        const lon = f32(f32(u - 0.5) * twoPi);
        cosLon[x] = f32(Math.cos(lon));
        sinLon[x] = f32(Math.sin(lon));
    }
    for (let y = 0; y < height; y++) {
        const v = f32((y + 0.5) / height);
        const lat = f32(f32(0.5 - v) * pi);
        cosLat[y] = f32(Math.cos(lat));
        sinLat[y] = f32(Math.sin(lat));
    }
    return { cosLon, sinLon, cosLat, sinLat };
}
export function dirFromLuts(x, y, cosLon, sinLon, cosLat, sinLat) {
    const cl = cosLat[y];
    return {
        x: f32(cl * cosLon[x]),
        y: f32(sinLat[y]),
        z: f32(cl * sinLon[x]),
    };
}
/**
 * Paint one land/ocean pixel → RGB 0–1 + liquid flag 0/1.
 * Simplified climate-first palette matching azure/rocky/ice/exotic spirit.
 */
export function paintGpuPixel(h, dx, dy, dz, sea, seed, planetClass, liquidKind, // 0 none,1 water,2 methane,3 acid,4 lava
colorBoost) {
    const s = seed | 0;
    if (planetClass === 4) {
        // gas bands
        const band = f32(fbm3(f32(dx * 6), f32(dy * 1.5), f32(dz * 6), s + 9, 4) * 0.5 + 0.5);
        const storm = ridged3(dx, dy, dz, s + 19, 3, 8);
        let r = f32(0.55 + band * 0.35 + storm * 0.1);
        let g = f32(0.35 + band * 0.25 + storm * 0.05);
        let b = f32(0.22 + band * 0.15);
        const boost = f32(1 + colorBoost * 0.35);
        return {
            r: f32(Math.min(1, r * boost)),
            g: f32(Math.min(1, g * boost)),
            b: f32(Math.min(1, b * boost)),
            liquid: 0,
        };
    }
    if (liquidKind !== 0 && h < sea) {
        const depth = f32(f32(sea - h) / f32(Math.max(1e-4, sea)));
        let r, g, b;
        if (liquidKind === 4) {
            // lava
            r = f32(0.55 + depth * 0.4);
            g = f32(0.12 + depth * 0.15);
            b = f32(0.02);
        }
        else if (liquidKind === 3) {
            r = f32(0.12 + depth * 0.1);
            g = f32(0.45 - depth * 0.15);
            b = f32(0.1);
        }
        else if (liquidKind === 2) {
            r = f32(0.08);
            g = f32(0.22 + (1 - depth) * 0.2);
            b = f32(0.28 + (1 - depth) * 0.15);
        }
        else {
            // water — large-scale bathymetry only
            if (depth < 0.08) {
                r = f32(0.18);
                g = f32(0.55);
                b = f32(0.58);
            }
            else if (depth < 0.28) {
                r = f32(0.1);
                g = f32(0.42);
                b = f32(0.52);
            }
            else if (depth < 0.55) {
                r = f32(0.04);
                g = f32(0.16);
                b = f32(0.34);
            }
            else {
                r = f32(0.02);
                g = f32(0.05);
                b = f32(0.14);
            }
            // Large-scale current tint (integer hash, bit-identical)
            const ix = Math.floor(f32(dx * 48));
            const iy = Math.floor(f32(dy * 48));
            const iz = Math.floor(f32(dz * 48));
            const n1 = f32(hash3(ix, iy, iz, s + 77) * 0.05 - 0.015);
            r = f32(r + n1 * 0.35);
            g = f32(g + n1 * 0.55);
            b = f32(b + n1 * 0.75);
        }
        return {
            r: f32(Math.max(0, Math.min(1, r))),
            g: f32(Math.max(0, Math.min(1, g))),
            b: f32(Math.max(0, Math.min(1, b))),
            liquid: 1,
        };
    }
    // Land: Köppen-scale climate classes (match climate.ts + WGSL)
    const elev = f32(f32(h - sea) / f32(Math.max(1e-4, 1 - sea)));
    const elevC = f32(Math.max(0, Math.min(1, elev)));
    const absLat = f32(Math.abs(dy));
    const moisture = f32(Math.max(0, Math.min(1, 0.55 - elevC * 0.35 + f32(1 - absLat) * 0.2)));
    const temperature = f32(Math.max(0, Math.min(1, f32(1 - absLat) * 0.95 - elevC * 0.35)));
    const precip = f32(Math.max(0, Math.min(1, moisture * 0.8 + (1 - absLat) * 0.15)));
    // classifyClimate simplified for ref
    let ccls = 10;
    if (elevC < 0.028)
        ccls = 18;
    else if (temperature < 0.12 || absLat > 0.92)
        ccls = 16;
    else if (temperature < 0.22)
        ccls = 15;
    else if (precip < 0.28)
        ccls = temperature > 0.55 ? 3 : 4;
    else if (temperature > 0.72)
        ccls = precip > 0.65 ? 0 : 2;
    else if (temperature < 0.42)
        ccls = 13;
    else
        ccls = 10;
    let r = f32(0.32);
    let g = f32(0.38);
    let b = f32(0.18);
    if (ccls === 3 || ccls === 4) {
        r = f32(0.78);
        g = f32(0.58);
        b = f32(0.32);
    }
    else if (ccls === 0 || ccls === 1) {
        r = f32(0.12);
        g = f32(0.28);
        b = f32(0.11);
    }
    else if (ccls === 15 || ccls === 16) {
        r = f32(0.85);
        g = f32(0.88);
        b = f32(0.9);
    }
    else if (ccls === 7 || ccls === 5) {
        r = f32(0.55);
        g = f32(0.48);
        b = f32(0.22);
    }
    const aridW = f32(ccls === 3 || ccls === 4 ? 0.8 : 0);
    const forestW = f32(ccls === 0 || ccls === 1 ? 0.8 : 0);
    const grassW = f32(ccls === 10 || ccls === 2 ? 0.5 : 0);
    const rock = smoothstep(0.45, 0.85, elevC);
    r = f32(r * f32(1 - rock * 0.25) + 0.28 * rock);
    g = f32(g * f32(1 - rock * 0.25) + 0.24 * rock);
    b = f32(b * f32(1 - rock * 0.25) + 0.2 * rock);
    // Soft polar ice only (match climate softBiome — no mid-lat white rings)
    const snow = f32(smoothstep(0.9, 0.985, absLat) * 0.72);
    r = f32(r * f32(1 - snow) + 0.9 * snow);
    g = f32(g * f32(1 - snow) + 0.93 * snow);
    b = f32(b * f32(1 - snow) + 0.96 * snow);
    if (planetClass === 2) {
        r = f32(r * 0.7 + 0.45);
        g = f32(g * 0.55 + 0.2);
        b = f32(b * 0.45 + 0.1);
    }
    else if (planetClass === 3) {
        r = f32(r * 0.4 + 0.55);
        g = f32(g * 0.45 + 0.6);
        b = f32(b * 0.5 + 0.7);
    }
    // Integer-lattice grit (hash only — bit-identical JS/WGSL)
    const ix = Math.floor(f32(dx * 96));
    const iy = Math.floor(f32(dy * 96));
    const iz = Math.floor(f32(dz * 96));
    const grit = f32(hash3(ix, iy, iz, s + 12) * 0.1 - 0.05);
    r = f32(Math.max(0, Math.min(1, f32(r + grit))));
    g = f32(Math.max(0, Math.min(1, f32(g + grit * 0.9))));
    b = f32(Math.max(0, Math.min(1, f32(b + grit * 0.75))));
    const boost = f32(1 + colorBoost * 0.4);
    return {
        r: f32(Math.min(1, f32(r * boost))),
        g: f32(Math.min(1, f32(g * boost))),
        b: f32(Math.min(1, f32(b * boost))),
        liquid: 0,
    };
}
export function liquidKindToId(k) {
    switch (k) {
        case "none":
            return 0;
        case "water":
            return 1;
        case "methane":
            return 2;
        case "acid":
            return 3;
        case "lava":
            return 4;
        default:
            return 1;
    }
}
/** Pack [0,1] via 16-bit index → u8 (stable half-level rounding). */
export function packU8(x) {
    const t = f32(Math.max(0, Math.min(1, f32(x))));
    const q = Math.min(65535, Math.max(0, Math.floor(t * 65535 + 0.5)));
    return Math.min(255, Math.floor((q * 255 + 32767) / 65535));
}
/**
 * Normals from quantized height — single implementation for CPU-ref and GPU
 * post-readback so product normals are bit-identical (avoids WGSL vs JS sqrt ULP).
 */
export function normalsFromHeight(heightData, liquidMask, width, height, strength, cosLat, flattenLiquid) {
    const W = width;
    const H = height;
    const normal = new Uint8ClampedArray(W * H * 4);
    const s = f32(strength);
    for (let y = 0; y < H; y++) {
        const cosLatY = f32(Math.max(0.08, cosLat[y]));
        for (let x = 0; x < W; x++) {
            const xl = (x - 1 + W) % W;
            const xr = (x + 1) % W;
            const yu = Math.max(0, y - 1);
            const yd = Math.min(H - 1, y + 1);
            const hL = heightData[y * W + xl];
            const hR = heightData[y * W + xr];
            const hU = heightData[yu * W + x];
            const hD = heightData[yd * W + x];
            const dx = f32(f32(f32(hR - hL) * s) / cosLatY);
            const dyv = f32(f32(hD - hU) * s);
            let nx = f32(-dx);
            let ny = f32(-dyv);
            let nz = f32(1);
            const len2 = f32(nx * nx + ny * ny + nz * nz);
            const len = f32(Math.max(1e-8, Math.sqrt(len2)));
            nx = f32(nx / len);
            ny = f32(ny / len);
            nz = f32(nz / len);
            const o = (y * W + x) * 4;
            if (flattenLiquid && liquidMask[o] > 127) {
                // Flat bathymetry + micro wave tilt (match heightfield.flattenLiquidNormals)
                nx = 0;
                ny = 0;
                nz = 1;
                const u = (x + 0.5) / W;
                const v = (y + 0.5) / H;
                // Approximate sphere dir from equirect (lat from v)
                const lat = (0.5 - v) * Math.PI;
                const lon = u * Math.PI * 2;
                const cl = Math.cos(lat);
                const dx = cl * Math.cos(lon);
                const dy = Math.sin(lat);
                const dz = cl * Math.sin(lon);
                // Elongated waves: high freq across crests, low along (stretch ≈ 10)
                const fAcross = 960;
                const fAlong = 96;
                const fY = 960 * 0.28;
                const amp = 0.2;
                const sWave = 4401;
                const ca = 0.92;
                const sa = 0.39;
                const qx = dx * ca + dz * sa;
                const qz = -dx * sa + dz * ca;
                // Lightweight hash noise (no import cycle) — enough for micro sparkle
                const n1 = Math.sin(qx * fAcross * 12.9898 + dy * fY * 78.233 + qz * fAlong * 37.719 + sWave) * 43758.5453;
                const n2 = Math.sin(qx * fAcross * 12.9898 +
                    dy * fY * 78.233 +
                    qz * fAlong * 37.719 +
                    sWave +
                    17.3) * 43758.5453;
                const across = (n1 - Math.floor(n1)) * 2 - 1;
                const along = (n2 - Math.floor(n2)) * 2 - 1;
                nx = across * amp;
                ny = along * amp * 0.45;
                const lenW = Math.max(1e-8, Math.sqrt(nx * nx + ny * ny + nz * nz));
                nx /= lenW;
                ny /= lenW;
                nz /= lenW;
            }
            normal[o] = packU8(f32(nx * 0.5 + 0.5));
            normal[o + 1] = packU8(f32(ny * 0.5 + 0.5));
            normal[o + 2] = packU8(f32(nz * 0.5 + 0.5));
            normal[o + 3] = 255;
        }
    }
    return normal;
}
//# sourceMappingURL=gpu-bake-math.js.map