/**
 * Temperate land-only night city lights (equirect emissive) — planet scale.
 *
 * Visual canon (NASA Black Marble / DMSP / Earth-from-space night maps):
 * - Many small lights across continents, not a few mega-blobs or long geometric webs
 * - Denser agglomerations on coasts/lowlands; inland scatter still present
 * - Bright urban cores + medium metro glow + fine settlement speckles
 * - Near-pitch-black plate; open ocean dark
 *
 * Approach (procedural common practice + Black Marble patterns):
 * - Multi-octave sphere-domain density field (population / development mask)
 * - Habitat = land × soft coast/lowland bias (probability, not a glowing shoreline stroke)
 * - Thresholded multi-scale peaks → many compact ~4px lights at equirect resolution
 * - Soft land weight applied once (shore spill, no coast-cut half-disks)
 * - O(pixels) only — no sparse seed lattice of dozens of hubs
 *
 * Pure / deterministic — smoke drives shipped exports without WebGPU.
 */
import { equirectToDir } from "./sphere-map.js";
import { fbm3, valueNoise3 } from "./noise.js";
function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}
function smoothstep(edge0, edge1, x) {
    const t = clamp01((x - edge0) / Math.max(1e-6, edge1 - edge0));
    return t * t * (3 - 2 * t);
}
/** Distance-to-liquid on land (chamfer, U-wrap). Liquid → 0. */
function coastDistanceField(liquidR, W, H, maxDist) {
    const n = W * H;
    const d = new Float32Array(n);
    const INF = maxDist + 1;
    for (let i = 0; i < n; i++) {
        d[i] = liquidR[i * 4] >= 128 ? 0 : INF;
    }
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            let v = d[i];
            if (v <= 0)
                continue;
            if (x > 0)
                v = Math.min(v, d[i - 1] + 1);
            else
                v = Math.min(v, d[y * W + (W - 1)] + 1);
            if (y > 0) {
                v = Math.min(v, d[i - W] + 1);
                const xl = x > 0 ? x - 1 : W - 1;
                const xr = x < W - 1 ? x + 1 : 0;
                v = Math.min(v, d[(y - 1) * W + xl] + 1.414);
                v = Math.min(v, d[(y - 1) * W + xr] + 1.414);
            }
            d[i] = v;
        }
    }
    for (let y = H - 1; y >= 0; y--) {
        for (let x = W - 1; x >= 0; x--) {
            const i = y * W + x;
            let v = d[i];
            if (v <= 0)
                continue;
            if (x < W - 1)
                v = Math.min(v, d[i + 1] + 1);
            else
                v = Math.min(v, d[y * W] + 1);
            if (y < H - 1) {
                v = Math.min(v, d[i + W] + 1);
                const xl = x > 0 ? x - 1 : W - 1;
                const xr = x < W - 1 ? x + 1 : 0;
                v = Math.min(v, d[(y + 1) * W + xl] + 1.414);
                v = Math.min(v, d[(y + 1) * W + xr] + 1.414);
            }
            d[i] = Math.min(v, maxDist);
        }
    }
    return d;
}
/** Distance into ocean from land. Land → 0. */
function oceanDistanceField(liquidR, W, H, maxDist) {
    const n = W * H;
    const d = new Float32Array(n);
    const INF = maxDist + 1;
    for (let i = 0; i < n; i++) {
        d[i] = liquidR[i * 4] < 100 ? 0 : INF;
    }
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            let v = d[i];
            if (v <= 0)
                continue;
            if (x > 0)
                v = Math.min(v, d[i - 1] + 1);
            else
                v = Math.min(v, d[y * W + (W - 1)] + 1);
            if (y > 0) {
                v = Math.min(v, d[i - W] + 1);
                const xl = x > 0 ? x - 1 : W - 1;
                const xr = x < W - 1 ? x + 1 : 0;
                v = Math.min(v, d[(y - 1) * W + xl] + 1.414);
                v = Math.min(v, d[(y - 1) * W + xr] + 1.414);
            }
            d[i] = v;
        }
    }
    for (let y = H - 1; y >= 0; y--) {
        for (let x = W - 1; x >= 0; x--) {
            const i = y * W + x;
            let v = d[i];
            if (v <= 0)
                continue;
            if (x < W - 1)
                v = Math.min(v, d[i + 1] + 1);
            else
                v = Math.min(v, d[y * W] + 1);
            if (y < H - 1) {
                v = Math.min(v, d[i + W] + 1);
                const xl = x > 0 ? x - 1 : W - 1;
                const xr = x < W - 1 ? x + 1 : 0;
                v = Math.min(v, d[(y + 1) * W + xl] + 1.414);
                v = Math.min(v, d[(y + 1) * W + xr] + 1.414);
            }
            d[i] = Math.min(v, maxDist);
        }
    }
    return d;
}
/**
 * Soft land mask applied once after density: full on land, soft dim spill into
 * near-shore water (avoids knife-cut circular halos), open ocean → 0.
 */
function softLandWeight(liquidA, oceanDist, spillPx) {
    if (liquidA < 0.35)
        return 1;
    const shore = 1 - smoothstep(0.2, 0.9, liquidA);
    const spill = Math.exp(-oceanDist / Math.max(1.8, spillPx)) * 0.45;
    return clamp01(Math.max(shore * 0.4, spill));
}
/**
 * Multi-scale settlement intensity ∈ [0,1].
 * Planet-scale density field (Black Marble style), O(pixels).
 */
export function buildTemperateSettlementIntensity(height, liquidMask, seed) {
    const W = height.width;
    const H = height.height;
    const n = W * H;
    const out = new Float32Array(n);
    const hR = height.rgba;
    const liq = liquidMask.rgba;
    const s = seed >>> 0;
    // Coast band scales gently with resolution (fraction of equirect width)
    const maxDist = Math.max(6, Math.min(80, Math.round(W * 0.06)));
    const coastDist = coastDistanceField(liq, W, H, maxDist);
    const oceanDist = oceanDistanceField(liq, W, H, Math.max(4, Math.round(maxDist * 0.4)));
    const spillPx = Math.max(1.8, W * 0.006);
    let hMin = 1;
    let hMax = 0;
    for (let i = 0; i < n; i++) {
        if (liq[i * 4] >= 128)
            continue;
        const h = hR[i * 4] / 255;
        if (h < hMin)
            hMin = h;
        if (h > hMax)
            hMax = h;
    }
    const hSpan = Math.max(1e-4, hMax - hMin);
    // Large-scale belts stay planet-fixed. Fine lights stay point sources
    // (resolution-scaled), then each peak is splatted to ~7px (see below).
    const fCont = 2.4; // continental development belts
    const fRegion = 7.5; // metro / conurbation regions
    const fUrban = Math.max(18, W / 28); // ~28px urban cores at any res
    const fTown = Math.max(36, W / 10); // towns
    const fSpeck = Math.max(72, W / 3.2); // settlement speckles
    const fPixel = Math.max(120, W / 1.6); // single-pixel street grit
    // Mild warp so density fields aren't axis-aligned
    const warpAmt = 0.12;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            const o = i * 4;
            const liquidA = liq[o] / 255;
            // Skip deep open ocean early (soft land will also kill residual)
            if (liquidA > 0.92 && oceanDist[i] > spillPx * 4) {
                out[i] = 0;
                continue;
            }
            const u = (x + 0.5) / W;
            const v = (y + 0.5) / H;
            const d = equirectToDir(u, v);
            // Domain warp (organic continent-scale development)
            const wx = fbm3(d.x * 1.7, d.y * 1.7, d.z * 1.7, s + 11, 3) * warpAmt;
            const wy = fbm3(d.x * 1.7 + 3.1, d.y * 1.7, d.z * 1.7 - 1.2, s + 23, 3) *
                warpAmt;
            const wz = fbm3(d.x * 1.7 - 2.4, d.y * 1.7 + 1.5, d.z * 1.7, s + 41, 3) *
                warpAmt;
            const px = d.x + wx;
            const py = d.y + wy;
            const pz = d.z + wz;
            // Habitat: land preference via soft land later; here elev + coast bias
            const elev = (hR[o] / 255 - hMin) / hSpan;
            const cd = coastDist[i];
            const coastNear = 1 - smoothstep(0, maxDist * 0.5, cd);
            const coastMid = 1 - smoothstep(0, maxDist * 0.95, cd);
            const lowland = 1 - smoothstep(0.18, 0.72, elev);
            const midland = 1 - smoothstep(0.4, 0.88, elev);
            // Habitat raises *probability density*, not a continuous shore stroke
            const habitat = clamp01(0.18 +
                0.42 * coastNear * lowland +
                0.22 * coastMid * midland +
                0.2 * lowland +
                0.12 * midland);
            // Multi-octave "population / development" density ∈ [0,1]
            const nCont = fbm3(px * fCont, py * fCont, pz * fCont, s + 101, 5) * 0.5 + 0.5;
            const nReg = fbm3(px * fRegion, py * fRegion, pz * fRegion, s + 211, 4) * 0.5 +
                0.5;
            const nUrb = fbm3(px * fUrban, py * fUrban, pz * fUrban, s + 307, 4) * 0.5 + 0.5;
            const nTown = valueNoise3(px * fTown, py * fTown, pz * fTown, s + 401);
            const nSpeck = valueNoise3(px * fSpeck + 1.7, py * fSpeck, pz * fSpeck - 0.9, s + 503);
            const nPix = valueNoise3(px * fPixel - 0.4, py * fPixel + 2.1, pz * fPixel, s + 607);
            // Development envelope: large-scale belts gate finer lights
            // (like how Earth has dark continents vs lit coasts/plains)
            const belt = smoothstep(0.34, 0.74, nCont);
            const region = smoothstep(0.4, 0.8, nReg);
            // Harsh peaks so cores stay compact (not filled metro discs)
            const core = Math.pow(smoothstep(0.72, 0.94, nUrb) * smoothstep(0.5, 0.88, nReg), 2.2);
            const metro = Math.pow(smoothstep(0.68, 0.92, nUrb * 0.5 + nReg * 0.5), 2.4);
            const towns = Math.pow(smoothstep(0.74, 0.96, nTown), 2.6);
            const speck = Math.pow(smoothstep(0.74, 0.96, nSpeck), 2.8);
            const grit = Math.pow(smoothstep(0.78, 0.98, nPix), 3.2);
            // Speckles + grit dominate count; cores are rare bright points
            let I = habitat *
                (0.16 + 0.84 * belt) *
                (core * 1.15 +
                    metro * 0.28 * region +
                    towns * 0.42 * (0.25 + 0.75 * region) +
                    speck * 0.95 * (0.4 + 0.6 * habitat) +
                    grit * 0.85 * (0.3 + 0.7 * habitat));
            // Keep dark plate; do not lift midtones into wash
            I = Math.pow(clamp01(I), 1.05);
            // Soft land once
            I *= softLandWeight(liquidA, oceanDist[i], spillPx);
            out[i] = clamp01(I);
        }
    }
    // Grow each local-max point into a ~4px disk (radius 2). Max-splat so
    // nearby towns overlap without merging into one wash.
    const LIGHT_R = 2;
    const rCeil = 2;
    const splat = new Float32Array(n);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            const I = out[i];
            if (I < 0.06)
                continue;
            let peak = true;
            for (let oy = -1; oy <= 1 && peak; oy++) {
                for (let ox = -1; ox <= 1; ox++) {
                    if (ox === 0 && oy === 0)
                        continue;
                    const yy = y + oy;
                    if (yy < 0 || yy >= H)
                        continue;
                    const xx = ((x + ox) % W + W) % W;
                    if (out[yy * W + xx] > I)
                        peak = false;
                }
            }
            if (!peak)
                continue;
            for (let dy = -rCeil; dy <= rCeil; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= H)
                    continue;
                for (let dx = -rCeil; dx <= rCeil; dx++) {
                    const r = Math.hypot(dx, dy);
                    if (r > LIGHT_R)
                        continue;
                    // Plateau + soft rim so the visible stamp is ~4px, not a 1px core
                    const core = 1.05;
                    const w = r <= core ? 1 : (LIGHT_R - r) / Math.max(1e-4, LIGHT_R - core);
                    const xx = ((x + dx) % W + W) % W;
                    const j = yy * W + xx;
                    const v = I * w;
                    if (v > splat[j])
                        splat[j] = v;
                }
            }
        }
    }
    for (let i = 0; i < n; i++) {
        const landW = softLandWeight(liq[i * 4] / 255, oceanDist[i], spillPx);
        splat[i] = clamp01(splat[i] * landW);
    }
    return splat;
}
/**
 * Colorize intensity → night emissive RGBA8.
 * Continuous soft mapping; open ocean near black; bright warm/cool cores.
 */
export function colorizeCityNightRgba(intensity, liquidMask, albedo, W, H) {
    const out = new Uint8ClampedArray(W * H * 4);
    const liq = liquidMask.rgba;
    const alb = albedo?.rgba ?? null;
    for (let i = 0; i < W * H; i++) {
        const o = i * 4;
        out[o + 3] = 255;
        const I = intensity[i];
        if (I < 0.012) {
            // Near-pitch-black plate (tiny optional albedo bleed)
            if (alb) {
                out[o] = Math.min(3, Math.round(alb[o] * 0.01));
                out[o + 1] = Math.min(3, Math.round(alb[o + 1] * 0.01));
                out[o + 2] = Math.min(4, Math.round(alb[o + 2] * 0.012));
            }
            else {
                out[o] = 1;
                out[o + 1] = 1;
                out[o + 2] = 2;
            }
            continue;
        }
        // Black Marble–like: warm amber streets + cool white dense cores
        const coreAmt = smoothstep(0.15, 0.75, I);
        const midAmt = smoothstep(0.02, 0.4, I);
        const warmR = 255;
        const warmG = 205;
        const warmB = 140;
        const coolR = 200;
        const coolG = 225;
        const coolB = 255;
        const wr = warmR * (1 - coreAmt) + coolR * coreAmt;
        const wg = warmG * (1 - coreAmt) + coolG * coreAmt;
        const wb = warmB * (1 - coreAmt) + coolB * coreAmt;
        // Continuous gain — many dim points + bright cores
        const gain = 0.55 + midAmt * 1.1 + coreAmt * 1.55;
        const br = clamp01(Math.pow(I, 0.62) * gain);
        out[o] = Math.min(255, Math.round(wr * br));
        out[o + 1] = Math.min(255, Math.round(wg * br));
        out[o + 2] = Math.min(255, Math.round(wb * br));
    }
    return out;
}
/**
 * Full temperate night-lights map from bake fields.
 * Returns null if class is not temperate.
 */
export function buildTemperateCityNightRgba(set) {
    if (set.params.planetClass !== "temperate")
        return null;
    if (set.params.liquidKind === "lava")
        return null;
    const intensity = buildTemperateSettlementIntensity(set.height, set.liquidMask, set.params.seed);
    return colorizeCityNightRgba(intensity, set.liquidMask, set.albedo, set.albedo.width, set.albedo.height);
}
//# sourceMappingURL=city-lights.js.map