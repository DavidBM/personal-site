/**
 * Bake shared earth/ground albedo, normal, height/cone/parallax maps.
 * Pure procedural path (Node smoke); browser may composite earthmap.jpg on top.
 */
import { HEIGHT_TEX_SIZE, NORMAL_MAP_STRENGTH, bakeConeAtlas, bakeHeightAtlas, heightToNormal, sampleFissureCavity, sampleGroundDetail, sampleHeightUV, sampleParallaxHeight, samplePolarHoleCavity, } from "./heightfield.js";
// ---------------------------------------------------------------------------
// Value-noise / FBM for dirt, pebbles, soil mottling (pure, no GPU)
// ---------------------------------------------------------------------------
function hash2(x, y) {
    // Deterministic 2D hash → [0,1)
    let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    n = n - Math.floor(n);
    return n;
}
function smoothstep01(t) {
    const x = Math.min(1, Math.max(0, t));
    return x * x * (3 - 2 * x);
}
function valueNoise2(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash2(x0, y0);
    const b = hash2(x0 + 1, y0);
    const c = hash2(x0, y0 + 1);
    const d = hash2(x0 + 1, y0 + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
/** Fractal Brownian motion in [0,1]. */
export function fbm2(x, y, octaves = 5) {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
        sum += amp * valueNoise2(x * freq, y * freq);
        norm += amp;
        amp *= 0.5;
        freq *= 2.05;
    }
    return sum / (norm || 1);
}
/**
 * Earth-like ground albedo at UV (dirt, dry grass flecks, rock grit).
 * Pure function — used by bake and smoke tests.
 */
export function sampleGroundAlbedo(u, v, structuralH) {
    // Mid frequencies with enough contrast for UV-walk grain to read
    const gx = u * 12;
    const gy = v * 7;
    const n1 = fbm2(gx, gy, 5);
    const n2 = fbm2(gx * 2.3 + 3.1, gy * 2.3 - 1.4, 4);
    const n3 = fbm2(gx * 5.5 - 2, gy * 5.5 + 5, 3);
    const pebble = valueNoise2(gx * 14, gy * 14);
    // Base soil (readable brown)
    let r = 0.4 + 0.2 * n1 + 0.08 * n2;
    let g = 0.3 + 0.14 * n1 + 0.05 * n2;
    let b = 0.18 + 0.07 * n1;
    // Dry grass flecks
    const grass = smoothstep01((n2 - 0.55) * 3.8);
    r = r * (1 - grass * 0.6) + 0.33 * grass;
    g = g * (1 - grass * 0.6) + 0.45 * grass;
    b = b * (1 - grass * 0.6) + 0.15 * grass;
    // Pebbles
    const rock = smoothstep01((pebble - 0.74) * 7);
    r = r * (1 - rock) + 0.52 * rock;
    g = g * (1 - rock) + 0.47 * rock;
    b = b * (1 - rock) + 0.42 * rock;
    // Sand patches
    const sand = smoothstep01((n3 - 0.62) * 3.5) * (1 - rock);
    r = r * (1 - sand * 0.3) + 0.54 * sand * 0.3;
    g = g * (1 - sand * 0.3) + 0.43 * sand * 0.3;
    b = b * (1 - sand * 0.3) + 0.28 * sand * 0.3;
    // Cavity: darker floors + warm wall edge (depth cue even on flat)
    const pole = samplePolarHoleCavity(u, v);
    const fissure = sampleFissureCavity(u, v);
    const cav = Math.max(pole, fissure);
    if (cav > 0.02) {
        const deepR = 0.1 + 0.05 * n2;
        const deepG = 0.08 + 0.04 * n2;
        const deepB = 0.07 + 0.04 * n1;
        const edge = smoothstep01(cav * 1.6) * (1 - smoothstep01((cav - 0.45) * 2.2));
        r = r * (1 - cav) + deepR * cav + 0.1 * edge;
        g = g * (1 - cav) + deepG * cav + 0.04 * edge;
        b = b * (1 - cav) + deepB * cav;
    }
    // Structural shade so fissure reads on flat without crushing crust
    const shade = 0.68 + 0.32 * structuralH;
    r = Math.min(1, Math.max(0, r * shade));
    g = Math.min(1, Math.max(0, g * shade));
    b = Math.min(1, Math.max(0, b * shade));
    return [r, g, b];
}
/**
 * Variance of RGB over the albedo atlas — used by smoke to prove non-uniform ground.
 */
export function albedoRgbVariance(albedo, width, height) {
    const n = width * height;
    if (n < 2)
        return 0;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        sr += albedo[o];
        sg += albedo[o + 1];
        sb += albedo[o + 2];
    }
    const mr = sr / n;
    const mg = sg / n;
    const mb = sb / n;
    let v = 0;
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        const dr = albedo[o] - mr;
        const dg = albedo[o + 1] - mg;
        const db = albedo[o + 2] - mb;
        v += dr * dr + dg * dg + db * db;
    }
    return v / n;
}
/** Build all maps used by every sphere method (pure procedural ground). */
export function bakeSurfaceMaps(width = HEIGHT_TEX_SIZE, height = HEIGHT_TEX_SIZE) {
    const heightFloat = bakeHeightAtlas(width, height);
    const coneFloat = bakeConeAtlas(heightFloat, width, height);
    const parallaxFloat = new Float32Array(width * height);
    const albedo = new Uint8Array(width * height * 4);
    const normal = new Uint8Array(width * height * 4);
    const heightCone = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        const v = y / (height - 1);
        for (let x = 0; x < width; x++) {
            const u = x / width;
            const i = y * width + x;
            const h = heightFloat[i];
            const ph = sampleParallaxHeight(u, v);
            parallaxFloat[i] = ph;
            const [ar, ag, ab] = sampleGroundAlbedo(u, v, h);
            const o = i * 4;
            albedo[o] = (ar * 255) | 0;
            albedo[o + 1] = (ag * 255) | 0;
            albedo[o + 2] = (ab * 255) | 0;
            albedo[o + 3] = 255;
            // Normals from structural + mild detail so ground has grit
            const n = heightToNormal(heightFloat, width, height, x, y, NORMAL_MAP_STRENGTH);
            // Mild detail normal only (strong detail made every lit tile look noisy)
            const d0 = sampleGroundDetail(u, v);
            const du = sampleGroundDetail(u + 1 / width, v) - d0;
            const dv = sampleGroundDetail(u, v + 1 / height) - d0;
            let nx = n.nx - du * 1.2;
            let ny = n.ny - dv * 1.2;
            let nz = n.nz;
            const len = Math.hypot(nx, ny, nz) || 1;
            nx /= len;
            ny /= len;
            nz /= len;
            normal[o] = ((nx * 0.5 + 0.5) * 255) | 0;
            normal[o + 1] = ((ny * 0.5 + 0.5) * 255) | 0;
            normal[o + 2] = ((nz * 0.5 + 0.5) * 255) | 0;
            normal[o + 3] = 255;
            heightCone[o] = (h * 255) | 0;
            heightCone[o + 1] = (coneFloat[i] * 255) | 0;
            heightCone[o + 2] = (ph * 255) | 0;
            heightCone[o + 3] = 255;
        }
    }
    void sampleHeightUV;
    return {
        width,
        height,
        albedo,
        normal,
        heightCone,
        heightFloat,
        parallaxFloat,
        coneFloat,
    };
}
/**
 * Optional light blend of equirect earth photo (opt-in via ?earth=1).
 * Previous default composite desaturated + muddied every method the same way
 * (shared distortion). Keep mix low and skip heavy recolor.
 */
export function compositeEarthAlbedo(maps, rgba, srcW, srcH, mix = 0.35) {
    const { width, height, albedo, heightFloat } = maps;
    const m = Math.min(1, Math.max(0, mix));
    for (let y = 0; y < height; y++) {
        const v = y / (height - 1);
        // Avoid extreme polar rows of equirect (worst stretch) — bias sample
        const vv = 0.08 + 0.84 * v;
        const sy = Math.min(srcH - 1, Math.floor(vv * (srcH - 1)));
        for (let x = 0; x < width; x++) {
            const u = x / width;
            const sx = Math.min(srcW - 1, Math.floor(u * srcW) % srcW);
            const si = (sy * srcW + sx) * 4;
            const o = (y * width + x) * 4;
            let er = rgba[si] / 255;
            let eg = rgba[si + 1] / 255;
            let eb = rgba[si + 2] / 255;
            // Prefer land tones: pull blue oceans toward soil so sphere stays “ground”
            const blue = Math.max(0, eb - Math.max(er, eg));
            if (blue > 0.05) {
                er = er * 0.4 + 0.28;
                eg = eg * 0.4 + 0.24;
                eb = eb * 0.25 + 0.14;
            }
            const h = heightFloat[y * width + x];
            if (h < 0.5) {
                const t = h / 0.5;
                er *= 0.35 + 0.65 * t;
                eg *= 0.32 + 0.68 * t;
                eb *= 0.3 + 0.7 * t;
            }
            const pr = albedo[o] / 255;
            const pg = albedo[o + 1] / 255;
            const pb = albedo[o + 2] / 255;
            albedo[o] = ((pr * (1 - m) + er * m) * 255) | 0;
            albedo[o + 1] = ((pg * (1 - m) + eg * m) * 255) | 0;
            albedo[o + 2] = ((pb * (1 - m) + eb * m) * 255) | 0;
        }
    }
}
//# sourceMappingURL=maps.js.map