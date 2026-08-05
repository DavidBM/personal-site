/**
 * Seeded 3D value / gradient noise for spherical planet sampling.
 *
 * We evaluate noise in R³ on the unit sphere so equirect U-wrap and poles
 * share one continuous field (no longitude seam in the noise domain).
 *
 * Hash is integer lattice → float; stable across JS engines (no Math.random).
 *
 * Refs: classic value noise + Perlin-style lattice; sphere sampling avoids
 * 2D equirect seams (common planet-gen practice).
 */
/** Mix seed into a 32-bit lattice hash. */
export function hash3(ix, iy, iz, seed) {
    let n = Math.imul(ix | 0, 374761393) +
        Math.imul(iy | 0, 668265263) +
        Math.imul(iz | 0, 2147483647) +
        Math.imul(seed | 0, 1013904223);
    n = (n ^ (n >>> 13)) | 0;
    n = Math.imul(n, 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
}
function lerp(a, b, t) {
    return a + (b - a) * t;
}
/**
 * Smooth 3D value noise in [0,1).
 * Domain: world-space coordinates (scale by frequency before call).
 */
export function valueNoise3(x, y, z, seed) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    const fx = fade(x - x0);
    const fy = fade(y - y0);
    const fz = fade(z - z0);
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
/**
 * fBm (fractal Brownian motion) of valueNoise3 → roughly [-1,1] after remap.
 * gain ~0.5, lacunarity 2.
 */
export function fbm3(x, y, z, seed, octaves, lacunarity = 2, gain = 0.5) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    const n = Math.max(1, Math.min(12, Math.floor(octaves)));
    for (let i = 0; i < n; i++) {
        sum +=
            (valueNoise3(x * freq, y * freq, z * freq, seed + i * 101) * 2 - 1) * amp;
        norm += amp;
        amp *= gain;
        freq *= lacunarity;
    }
    return norm > 0 ? sum / norm : 0;
}
/**
 * Domain-warped fBm: sample offset field then height (continent irregularity).
 */
export function warpedFbm3(x, y, z, seed, octaves, warp, baseFreq) {
    const w = Math.max(0, warp);
    const f = Math.max(1e-4, baseFreq);
    const wx = fbm3(x * f * 0.7, y * f * 0.7, z * f * 0.7, seed + 17, 3) * w;
    const wy = fbm3(x * f * 0.7 + 19.1, y * f * 0.7 - 7.3, z * f * 0.7, seed + 31, 3) * w;
    const wz = fbm3(x * f * 0.7 - 5.2, y * f * 0.7 + 11.7, z * f * 0.7, seed + 53, 3) * w;
    return fbm3((x + wx) * f, (y + wy) * f, (z + wz) * f, seed, octaves);
}
/** Ridged multifractal (mountains / ice ridges). Output ~[0,1]. */
export function ridged3(x, y, z, seed, octaves, freq) {
    let amp = 0.5;
    let f = Math.max(1e-4, freq);
    let sum = 0;
    let weight = 1;
    const n = Math.max(1, Math.min(12, Math.floor(octaves)));
    for (let i = 0; i < n; i++) {
        let s = valueNoise3(x * f, y * f, z * f, seed + i * 67);
        s = 1 - Math.abs(s * 2 - 1);
        s *= s;
        s *= weight;
        weight = Math.min(1, s * 1.6);
        sum += s * amp;
        amp *= 0.5;
        f *= 2;
    }
    return sum;
}
//# sourceMappingURL=noise.js.map