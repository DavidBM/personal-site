/**
 * Multi-field material / liquid classification + NASA Blue Marble colorization.
 *
 * CRITICAL: Albedo must NOT read as Age-of-Empires minimap
 * (white-for-elevation, two flat blues, one green fill).
 *
 * Land is climate-first: Köppen-scale multi-class biomes from temperature +
 * precip/moisture drivers (not only two-axis Whittaker blend). Mountains stay
 * rock/soil-colored until a true snow line — never a greyscale height ramp.
 *
 * Ocean is continuous bathymetry: abyss navy → mid teal-blue → wide shelf
 * turquoise with multi-scale current noise (not two solid flood fills).
 *
 * Refs: NASA Blue Marble true-color; Köppen–Geiger / moisture-temp tables.
 */
import { fbm3, valueNoise3, ridged3 } from "./noise.js";
import { equirectToDir } from "./sphere-map.js";
import { sampleClimateDrivers, classifyClimate, climateClassMatId, ClimateClass, softBiomeColor, } from "./climate.js";
import { sampleOceanBathymetry3d, oceanPaintDepth, } from "./ocean-bathymetry.js";
import { poleIceExtentScale } from "./pole-cap.js";
import { buildLandWindField, sampleWindField, pickCloudCategoryFromWind, longStampYawFromWind, } from "./wind-field.js";
function rgb(r, g, b) {
    return { r, g, b };
}
/**
 * Azure / Earthlike — true-color Blue Marble stops (colorized, not neon).
 * Deserts are warm saturated tans; forests dark muted green; rock brown-grey
 * (NOT white until snow). Oceans match solar-system earthmap teal-navy
 * (G closer to B than pure indigo — sample earthmap mean ~23,69,94).
 */
export const PALETTE_AZURE_OCEAN = {
    // Earthmap-like open sea: dark teal-navy (green-ish blue, still B-dominant)
    // Matched to assets/solar/earthmap.jpg ocean mean ~23,69,94 (G≃0.75·B)
    liquidDeep: rgb(0.06, 0.22, 0.3),
    liquidMid: rgb(0.09, 0.29, 0.37),
    liquidShelf: rgb(0.11, 0.32, 0.41),
    liquidShallow: rgb(0.13, 0.36, 0.45),
    beach: rgb(0.82, 0.74, 0.52),
    // Muted sand / steppe (not high-sat pumpkin orange — blends with green fringes)
    arid: rgb(0.68, 0.56, 0.38),
    aridHot: rgb(0.74, 0.6, 0.4),
    // Separated green stops: light open lowland / mid forest / deep canopy (must read apart at orbit)
    grassland: rgb(0.5, 0.64, 0.3),
    forest: rgb(0.14, 0.36, 0.14),
    forestDeep: rgb(0.06, 0.22, 0.1),
    // Light soil-green base for open lowlands (not dark canopy)
    lowland: rgb(0.42, 0.5, 0.28),
    highland: rgb(0.42, 0.42, 0.38),
    mountain: rgb(0.44, 0.42, 0.4),
    rockDark: rgb(0.34, 0.32, 0.3),
    snow: rgb(0.94, 0.96, 0.98),
    tundra: rgb(0.44, 0.48, 0.4),
    gasA: rgb(0.55, 0.4, 0.28),
    gasB: rgb(0.75, 0.55, 0.35),
    gasC: rgb(0.9, 0.75, 0.55),
    gasStorm: rgb(0.7, 0.25, 0.15),
};
export const PALETTE_ROCKY = {
    liquidDeep: rgb(0.1, 0.08, 0.07),
    liquidMid: rgb(0.2, 0.14, 0.1),
    liquidShelf: rgb(0.38, 0.28, 0.18),
    liquidShallow: rgb(0.48, 0.36, 0.22),
    beach: rgb(0.58, 0.45, 0.32),
    arid: rgb(0.68, 0.42, 0.26),
    aridHot: rgb(0.75, 0.5, 0.3),
    grassland: rgb(0.48, 0.36, 0.22),
    forest: rgb(0.32, 0.26, 0.18),
    forestDeep: rgb(0.25, 0.2, 0.14),
    lowland: rgb(0.55, 0.38, 0.26),
    highland: rgb(0.6, 0.44, 0.32),
    mountain: rgb(0.55, 0.48, 0.42),
    rockDark: rgb(0.4, 0.35, 0.3),
    snow: rgb(0.9, 0.88, 0.85),
    tundra: rgb(0.5, 0.45, 0.4),
    gasA: rgb(0.4, 0.35, 0.3),
    gasB: rgb(0.5, 0.45, 0.4),
    gasC: rgb(0.6, 0.55, 0.5),
    gasStorm: rgb(0.3, 0.25, 0.2),
};
/** Ice world: frozen basins are cool blue ice (not open navy water). */
export const PALETTE_ICE = {
    liquidDeep: rgb(0.42, 0.62, 0.82),
    liquidMid: rgb(0.55, 0.72, 0.88),
    liquidShelf: rgb(0.7, 0.84, 0.94),
    liquidShallow: rgb(0.82, 0.9, 0.97),
    beach: rgb(0.72, 0.8, 0.86),
    arid: rgb(0.7, 0.78, 0.84),
    aridHot: rgb(0.75, 0.82, 0.88),
    grassland: rgb(0.68, 0.78, 0.84),
    forest: rgb(0.5, 0.65, 0.72),
    forestDeep: rgb(0.4, 0.55, 0.65),
    lowland: rgb(0.78, 0.86, 0.9),
    highland: rgb(0.88, 0.92, 0.95),
    mountain: rgb(0.9, 0.93, 0.96),
    rockDark: rgb(0.55, 0.6, 0.65),
    snow: rgb(0.98, 0.98, 1),
    tundra: rgb(0.8, 0.86, 0.9),
    gasA: rgb(0.5, 0.6, 0.75),
    gasB: rgb(0.65, 0.75, 0.85),
    gasC: rgb(0.8, 0.88, 0.95),
    gasStorm: rgb(0.4, 0.5, 0.7),
};
/** Titan-like: dark orange-brown lakes, not water-blue seas. */
export const PALETTE_EXOTIC_METHANE = {
    liquidDeep: rgb(0.06, 0.04, 0.03),
    liquidMid: rgb(0.12, 0.08, 0.04),
    liquidShelf: rgb(0.2, 0.14, 0.06),
    liquidShallow: rgb(0.28, 0.2, 0.08),
    beach: rgb(0.42, 0.34, 0.22),
    arid: rgb(0.55, 0.4, 0.22),
    aridHot: rgb(0.62, 0.45, 0.2),
    grassland: rgb(0.48, 0.36, 0.22),
    forest: rgb(0.38, 0.3, 0.18),
    forestDeep: rgb(0.28, 0.22, 0.14),
    lowland: rgb(0.48, 0.36, 0.2),
    highland: rgb(0.5, 0.4, 0.28),
    mountain: rgb(0.42, 0.36, 0.3),
    rockDark: rgb(0.28, 0.24, 0.2),
    snow: rgb(0.45, 0.48, 0.42),
    tundra: rgb(0.4, 0.38, 0.3),
    gasA: rgb(0.4, 0.45, 0.35),
    gasB: rgb(0.5, 0.55, 0.4),
    gasC: rgb(0.55, 0.6, 0.45),
    gasStorm: rgb(0.35, 0.4, 0.3),
};
export const PALETTE_EXOTIC_ACID = {
    liquidDeep: rgb(0.05, 0.26, 0.04),
    liquidMid: rgb(0.12, 0.4, 0.08),
    liquidShelf: rgb(0.24, 0.52, 0.14),
    liquidShallow: rgb(0.32, 0.58, 0.18),
    beach: rgb(0.42, 0.48, 0.22),
    arid: rgb(0.48, 0.28, 0.52),
    aridHot: rgb(0.55, 0.32, 0.55),
    grassland: rgb(0.4, 0.35, 0.42),
    forest: rgb(0.26, 0.16, 0.38),
    forestDeep: rgb(0.18, 0.1, 0.28),
    lowland: rgb(0.38, 0.22, 0.48),
    highland: rgb(0.48, 0.3, 0.52),
    mountain: rgb(0.36, 0.32, 0.36),
    rockDark: rgb(0.25, 0.22, 0.25),
    snow: rgb(0.7, 0.65, 0.82),
    tundra: rgb(0.45, 0.4, 0.5),
    gasA: rgb(0.3, 0.5, 0.25),
    gasB: rgb(0.45, 0.55, 0.3),
    gasC: rgb(0.55, 0.4, 0.6),
    gasStorm: rgb(0.6, 0.2, 0.5),
};
/**
 * Molten basalt world: dark low-albedo crust + blackbody-glow liquid.
 * Research: lava worlds / molten silicates have geometric albedo ≲0.1 and
 * brightness is thermal emission (not water-like reflection). Crust is dark
 * basalt; melt reads deep red → orange → yellow-hot cores.
 */
export const PALETTE_LAVA = {
    // Liquid stops unused for paint (brightLavaColor owns melt), kept R-dom
    liquidDeep: rgb(0.55, 0.08, 0.02),
    liquidMid: rgb(0.95, 0.28, 0.03),
    liquidShelf: rgb(1.0, 0.48, 0.06),
    liquidShallow: rgb(1.0, 0.72, 0.18),
    beach: rgb(0.1, 0.08, 0.07),
    arid: rgb(0.11, 0.09, 0.075),
    aridHot: rgb(0.13, 0.1, 0.08),
    grassland: rgb(0.09, 0.075, 0.065),
    forest: rgb(0.08, 0.065, 0.055),
    forestDeep: rgb(0.065, 0.055, 0.05),
    lowland: rgb(0.09, 0.075, 0.065),
    highland: rgb(0.13, 0.11, 0.095),
    mountain: rgb(0.16, 0.14, 0.12),
    rockDark: rgb(0.05, 0.045, 0.04),
    snow: rgb(0.09, 0.08, 0.07),
    tundra: rgb(0.1, 0.085, 0.07),
    gasA: rgb(0.55, 0.12, 0.03),
    gasB: rgb(0.9, 0.35, 0.05),
    gasC: rgb(1.0, 0.65, 0.15),
    gasStorm: rgb(1.0, 0.45, 0.08),
};
export const PALETTE_GAS_JUPITER = {
    liquidDeep: rgb(0.2, 0.15, 0.1),
    liquidMid: rgb(0.3, 0.22, 0.15),
    liquidShelf: rgb(0.45, 0.35, 0.22),
    liquidShallow: rgb(0.5, 0.4, 0.28),
    beach: rgb(0.5, 0.4, 0.3),
    arid: rgb(0.7, 0.52, 0.32),
    aridHot: rgb(0.8, 0.58, 0.35),
    grassland: rgb(0.6, 0.48, 0.32),
    forest: rgb(0.5, 0.38, 0.25),
    forestDeep: rgb(0.4, 0.3, 0.2),
    lowland: rgb(0.55, 0.42, 0.3),
    highland: rgb(0.7, 0.55, 0.4),
    mountain: rgb(0.85, 0.7, 0.5),
    rockDark: rgb(0.4, 0.3, 0.2),
    snow: rgb(0.95, 0.9, 0.8),
    tundra: rgb(0.7, 0.6, 0.5),
    gasA: rgb(0.48, 0.32, 0.2),
    gasB: rgb(0.78, 0.58, 0.38),
    gasC: rgb(0.92, 0.82, 0.62),
    gasStorm: rgb(0.72, 0.22, 0.14),
};
export const PALETTE_GAS_ICE = {
    liquidDeep: rgb(0.05, 0.15, 0.4),
    liquidMid: rgb(0.1, 0.28, 0.55),
    liquidShelf: rgb(0.2, 0.42, 0.7),
    liquidShallow: rgb(0.3, 0.55, 0.8),
    beach: rgb(0.2, 0.4, 0.6),
    arid: rgb(0.3, 0.45, 0.65),
    aridHot: rgb(0.35, 0.5, 0.7),
    grassland: rgb(0.25, 0.45, 0.65),
    forest: rgb(0.2, 0.4, 0.6),
    forestDeep: rgb(0.15, 0.32, 0.5),
    lowland: rgb(0.25, 0.45, 0.65),
    highland: rgb(0.4, 0.6, 0.8),
    mountain: rgb(0.55, 0.7, 0.85),
    rockDark: rgb(0.2, 0.3, 0.45),
    snow: rgb(0.75, 0.85, 0.95),
    tundra: rgb(0.45, 0.6, 0.75),
    gasA: rgb(0.12, 0.32, 0.68),
    gasB: rgb(0.28, 0.52, 0.88),
    gasC: rgb(0.5, 0.72, 0.95),
    gasStorm: rgb(0.75, 0.88, 1),
};
/** Teal / cyan gas giant (Neptune-ish, not brown; B≥G so not “green land”). */
export const PALETTE_GAS_TEAL = {
    ...PALETTE_GAS_ICE,
    gasA: rgb(0.08, 0.36, 0.52),
    gasB: rgb(0.16, 0.48, 0.68),
    gasC: rgb(0.42, 0.68, 0.9),
    gasStorm: rgb(0.28, 0.45, 0.75),
};
/** Magenta–violet exotic gas (not brown/yellow). */
export const PALETTE_GAS_VIOLET = {
    ...PALETTE_GAS_JUPITER,
    gasA: rgb(0.42, 0.18, 0.48),
    gasB: rgb(0.62, 0.28, 0.55),
    gasC: rgb(0.88, 0.62, 0.78),
    gasStorm: rgb(0.72, 0.22, 0.55),
};
/** Pale cream–olive (not classic ochre; R≈G so not greenDom vegetation). */
export const PALETTE_GAS_PALE_GREEN = {
    ...PALETTE_GAS_JUPITER,
    gasA: rgb(0.62, 0.58, 0.38),
    gasB: rgb(0.8, 0.74, 0.5),
    gasC: rgb(0.94, 0.9, 0.72),
    gasStorm: rgb(0.55, 0.48, 0.28),
};
/** Deep copper–rose (warm but not yellow-brown Jupiter). */
export const PALETTE_GAS_ROSE = {
    ...PALETTE_GAS_JUPITER,
    gasA: rgb(0.55, 0.22, 0.28),
    gasB: rgb(0.78, 0.38, 0.4),
    gasC: rgb(0.95, 0.72, 0.68),
    gasStorm: rgb(0.62, 0.12, 0.22),
};
/**
 * Gas hue family index from seed + atmTint.
 * Exported so tests can assert multi-family variety across seeds.
 */
export function gasPaletteFamilyIndex(seed, atmTint) {
    // Prefer explicit cool atmTint → ice family (index 1)
    if (atmTint.b > atmTint.r * 1.2 && atmTint.b > atmTint.g)
        return 1;
    // Seed-stable family in [0,5]
    let h = (seed >>> 0) ^ 0x67e12cd9;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h ^= h >>> 13;
    return (h >>> 0) % 6;
}
export function gasPaletteByFamily(family) {
    switch (family % 6) {
        case 0:
            return PALETTE_GAS_JUPITER;
        case 1:
            return PALETTE_GAS_ICE;
        case 2:
            return PALETTE_GAS_TEAL;
        case 3:
            return PALETTE_GAS_VIOLET;
        case 4:
            return PALETTE_GAS_PALE_GREEN;
        default:
            return PALETTE_GAS_ROSE;
    }
}
export function paletteForParams(params) {
    const cls = params.planetClass;
    if (cls === "gas") {
        return gasPaletteByFamily(gasPaletteFamilyIndex(params.seed, params.atmTint));
    }
    if (cls === "ice")
        return PALETTE_ICE;
    if (cls === "rocky")
        return PALETTE_ROCKY;
    if (cls === "exotic") {
        if (params.liquidKind === "acid")
            return PALETTE_EXOTIC_ACID;
        if (params.liquidKind === "lava")
            return PALETTE_LAVA;
        return PALETTE_EXOTIC_METHANE;
    }
    return PALETTE_AZURE_OCEAN;
}
function lerpRgb(a, b, t) {
    const u = t < 0 ? 0 : t > 1 ? 1 : t;
    return {
        r: a.r + (b.r - a.r) * u,
        g: a.g + (b.g - a.g) * u,
        b: a.b + (b.b - a.b) * u,
    };
}
function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}
function smoothstep(e0, e1, x) {
    const t = clamp01((x - e0) / Math.max(1e-8, e1 - e0));
    return t * t * (3 - 2 * t);
}
/** Mild saturation boost — Blue Marble punch without neon. */
function boost(c, amount) {
    const m = (c.r + c.g + c.b) / 3;
    const s = 1 + amount * 0.32;
    return {
        r: clamp01(m + (c.r - m) * s),
        g: clamp01(m + (c.g - m) * s),
        b: clamp01(m + (c.b - m) * s),
    };
}
function mulRgb(c, k) {
    return { r: clamp01(c.r * k), g: clamp01(c.g * k), b: clamp01(c.b * k) };
}
/**
 * Base surface micro-grain scale for product paint (soft biomes / land).
 * Restored to working orbit-detail levels (pre-“cartoon flat” quiet regression).
 * Smoke asserts fleck present via landFine floor + these exports.
 */
/** Documented broken quiet floor (must stay above these). */
export const QUIET_BROKEN_LAND_GRAIN_AMP_EARTH = 1.05;
export const QUIET_BROKEN_LAND_GRAIN_N1 = 0.085;
/**
 * Satellite micro-grain on land — orbit fleck so biomes aren't flat fills.
 * Applied as zero-mean luminance noise (neutral, not a dark wash).
 */
export const BASE_LAND_GRAIN_AMP_EARTH = 1.85;
export const BASE_LAND_GRAIN_AMP_OTHER = 1.35;
export const BASE_LAND_GRAIN_AMP_POLAR = 0.35;
/** Peak fbm coeff for n1. */
export const BASE_LAND_GRAIN_N1 = 0.15;
/** Earth-like classes only: polar ice + green soft biomes are a climate biome, not a global layer. */
function isEarthlikeClass(cls) {
    return cls === "ocean" || cls === "temperate";
}
/**
 * Steepest-descent flow accumulation on equirect height (D8, U-wrap).
 * Lava uses this for real dendritic channels along valleys into basins —
 * not ridged-noise microlakes.
 * Returns log-normalized flow in [0,1] (0 at/under sea).
 */
export function computeLavaFlowMap(height, seaLevel) {
    const W = height.width;
    const H = height.height;
    const data = height.data;
    const sea = Math.max(0, Math.min(1, seaLevel));
    const flow = new Float32Array(W * H);
    flow.fill(1);
    const sweeps = W >= 1024 ? 6 : 5;
    for (let s = 0; s < sweeps; s++) {
        const add = new Float32Array(W * H);
        for (let y = 1; y < H - 1; y++) {
            for (let x = 0; x < W; x++) {
                const i = y * W + x;
                const h = data[i];
                if (h <= sea)
                    continue;
                let best = -1;
                let bestDrop = 0;
                const neigh = [
                    y * W + ((x + 1) % W),
                    y * W + ((x - 1 + W) % W),
                    (y + 1) * W + x,
                    (y - 1) * W + x,
                    (y + 1) * W + ((x + 1) % W),
                    (y + 1) * W + ((x - 1 + W) % W),
                    (y - 1) * W + ((x + 1) % W),
                    (y - 1) * W + ((x - 1 + W) % W),
                ];
                for (const j of neigh) {
                    const drop = h - data[j];
                    if (drop > bestDrop) {
                        bestDrop = drop;
                        best = j;
                    }
                }
                if (best >= 0 && bestDrop > 1e-5) {
                    add[best] += flow[i] * 0.92;
                }
            }
        }
        for (let i = 0; i < flow.length; i++) {
            if (data[i] > sea)
                flow[i] = 1 + add[i];
            else
                flow[i] = 0;
        }
    }
    let maxF = 1;
    for (let i = 0; i < flow.length; i++) {
        if (flow[i] > maxF)
            maxF = flow[i];
    }
    const invLog = 1 / Math.log1p(maxF);
    for (let i = 0; i < flow.length; i++) {
        flow[i] = flow[i] > 0 ? Math.log1p(flow[i]) * invLog : 0;
    }
    return flow;
}
/**
 * Ridge + province barriers that split one mega-sea into several lakes
 * (sphere-isotropic). High on “land bridges” so effective height stays above sea.
 */
export function lavaBasinBarrier(x, y, z, seed) {
    // Mild domain warp so barriers are not latitude-aligned
    const w = 0.07;
    const wx = fbm3(x * 1.5, y * 1.5, z * 1.5, seed + 50, 3) * w;
    const wy = fbm3(x * 1.5 + 3, y * 1.5, z * 1.5 - 2, seed + 60, 3) * w;
    const wz = fbm3(x * 1.5 - 2, y * 1.5 + 4, z * 1.5, seed + 70, 3) * w;
    let nx = x + wx;
    let ny = y + wy;
    let nz = z + wz;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    // Low–mid freqs — splits seas into ~handful of lakes, not fleck salt
    const b1 = ridged3(nx, ny, nz, seed + 901, 4, 1.15);
    const b2 = ridged3(nx, ny, nz, seed + 911, 3, 2.1);
    const b3 = ridged3(nx, ny, nz, seed + 921, 3, 3.6);
    const ridge = Math.max(b1, b2 * 0.92, b3 * 0.7);
    // Large-scale province walls (extra splits without tiny noise)
    const plate = fbm3(nx * 0.85, ny * 0.4, nz * 0.85, seed + 777, 4) * 0.5 + 0.5;
    const plateWall = Math.pow(Math.abs(plate * 2 - 1), 1.1); // high near 0.5 isolines
    const raw = Math.max(ridge, plateWall * 0.85);
    return clamp01(Math.pow(Math.max(0, raw), 1.25));
}
/**
 * @deprecated Ridged fleck rivers removed. Kept for export stability.
 */
export function lavaChannelField(_x, _y, _z, _seed) {
    return 0;
}
/** @deprecated */
export const LAVA_RIVER_CHANNEL_THR = 0;
/** @deprecated */
export const LAVA_RIVER_MIN_AREA = 0;
/**
 * @deprecated No-op: returns current liquid pixel count (export stability).
 */
export function cullSmallLavaRivers(_albedo, liquidMask, height, _params, _minArea) {
    const n = height.width * height.height;
    let c = 0;
    for (let i = 0; i < n; i++) {
        if (liquidMask[i * 4] >= 128)
            c++;
    }
    return c;
}
/**
 * Iteratively cut land bridges through oversized seas until lakes are
 * comparable: topShare ≲ 0.42 and top/second ≲ 2.5 (when a second exists).
 * Mutates albedo + liquidMask.
 */
export function splitMegaLavaSeas(albedo, liquidMask, height, params, maxTopShare = 0.42, maxTopRatio = 2.5) {
    const W = height.width;
    const H = height.height;
    const data = height.data;
    const sea = Math.max(0, Math.min(1, params.liquidLevel));
    const seed = params.seed | 0;
    const pal = paletteForParams(params);
    const boostAmt = params.colorBoost;
    const cls = params.planetClass;
    const liquidKind = params.liquidKind;
    const poleIceScale = poleIceExtentScale(params.poleSize);
    const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ];
    function listComps() {
        const seen = new Uint8Array(W * H);
        const comps = [];
        function flood(sx, sy) {
            const q = [sy * W + sx];
            const cells = [sy * W + sx];
            seen[sy * W + sx] = 1;
            while (q.length) {
                const i = q.pop();
                const x = i % W;
                const y = (i / W) | 0;
                for (const [dx, dy] of dirs) {
                    const nx = (x + dx + W) % W;
                    const ny = y + dy;
                    if (ny < 0 || ny >= H)
                        continue;
                    const j = ny * W + nx;
                    if (seen[j] || liquidMask[j * 4] < 128)
                        continue;
                    seen[j] = 1;
                    q.push(j);
                    cells.push(j);
                }
            }
            return cells;
        }
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const i = y * W + x;
                if (liquidMask[i * 4] < 128 || seen[i])
                    continue;
                comps.push(flood(x, y));
            }
        }
        comps.sort((a, b) => b.length - a.length);
        return comps;
    }
    function restoreLand(i) {
        const x = i % W;
        const y = (i / W) | 0;
        const h = data[i];
        const u = (x + 0.5) / W;
        const v = (y + 0.5) / H;
        const d = equirectToDir(u, v);
        const elev = sea >= 0.999 ? h : (h - sea) / Math.max(1e-4, 1 - sea);
        const land = landBiomeColor(pal, clamp01(elev), Math.abs(d.y), cls, liquidKind, d.x, d.y, d.z, seed, poleIceScale);
        const col = boost(land.col, boostAmt);
        const o = i * 4;
        albedo[o] = Math.round(col.r * 255);
        albedo[o + 1] = Math.round(col.g * 255);
        albedo[o + 2] = Math.round(col.b * 255);
        albedo[o + 3] = 255;
        liquidMask[o] = 0;
        liquidMask[o + 1] = Math.round(Math.min(1, land.spec) * 255);
        liquidMask[o + 2] = Math.round((land.mat / 15) * 255);
        liquidMask[o + 3] = 255;
    }
    // Progressively lower barrier cut until lakes are comparable
    const cuts = [0.48, 0.4, 0.32, 0.25, 0.18, 0.12, 0.08];
    for (const barrierCut of cuts) {
        const comps = listComps();
        if (!comps.length)
            return 0;
        let totalLiq = 0;
        for (const c of comps)
            totalLiq += c.length;
        if (totalLiq < 1)
            return 0;
        const top = comps[0];
        const second = comps[1]?.length ?? 0;
        const topShare = top.length / totalLiq;
        const topRatio = second > 0 ? top.length / second : 99;
        if (topShare <= maxTopShare && topRatio <= maxTopRatio)
            break;
        if (topShare <= maxTopShare && comps.length >= 5)
            break;
        // Cut high-barrier / shallow pixels in the dominant component
        let cutN = 0;
        for (const i of top) {
            const x = i % W;
            const y = (i / W) | 0;
            const u = (x + 0.5) / W;
            const v = (y + 0.5) / H;
            const d = equirectToDir(u, v);
            const barrier = lavaBasinBarrier(d.x, d.y, d.z, seed);
            const h = data[i];
            const shallow = h > sea - 0.05;
            // Also cut by relative depth rank in mega-sea: shallow shelves go first
            const depth = sea - h;
            if (barrier >= barrierCut ||
                (shallow && barrier >= barrierCut * 0.55) ||
                depth < 0.02 + barrierCut * 0.05) {
                restoreLand(i);
                cutN++;
            }
        }
        // Force progress: if nothing cut, drop shallowest quartile of top
        if (cutN === 0 && top.length > 8) {
            const depths = top.map((i) => ({ i, d: sea - data[i] }));
            depths.sort((a, b) => a.d - b.d);
            const nDrop = Math.max(1, Math.floor(top.length * 0.2));
            for (let k = 0; k < nDrop; k++)
                restoreLand(depths[k].i);
        }
    }
    let c = 0;
    for (let i = 0; i < W * H; i++)
        if (liquidMask[i * 4] >= 128)
            c++;
    return c;
}
/**
 * Sprinkle isolated 1px valley ponds (deterministic) so after targeted dilate
 * many small lakes land in the ~2–10px band. Skips near existing liquid.
 */
export function seedMicroLavaPonds(albedo, liquidMask, height, params, flow, targetCount = 40) {
    const W = height.width;
    const H = height.height;
    const data = height.data;
    const sea = Math.max(0, Math.min(1, params.liquidLevel));
    const seed = params.seed | 0;
    const pal = paletteForParams(params);
    const boostAmt = params.colorBoost;
    const candidates = [];
    for (let y = 1; y < H - 1; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            if (liquidMask[i * 4] >= 128)
                continue;
            const h = data[i];
            if (h > sea + 0.14 || h < sea - 0.03)
                continue;
            const f = flow[i];
            if (f < 0.2 || f > 0.85)
                continue;
            // Local valley
            const nMean = (h +
                data[y * W + ((x + 1) % W)] +
                data[y * W + ((x - 1 + W) % W)] +
                data[(y + 1) * W + x] +
                data[(y - 1) * W + x]) /
                5;
            if (h > nMean + 0.006)
                continue;
            // Isolation: no liquid in 1px neighborhood
            let near = false;
            for (const [dx, dy] of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
                [1, 1],
                [-1, 1],
                [1, -1],
                [-1, -1],
            ]) {
                const ny = y + dy;
                if (ny < 0 || ny >= H)
                    continue;
                const nx = (x + dx + W) % W;
                if (liquidMask[(ny * W + nx) * 4] >= 128) {
                    near = true;
                    break;
                }
            }
            if (near)
                continue;
            const u = (x + 0.5) / W;
            const v = (y + 0.5) / H;
            const d = equirectToDir(u, v);
            if (lavaBasinBarrier(d.x, d.y, d.z, seed) > 0.55)
                continue;
            candidates.push(i);
        }
    }
    // Deterministic subsample: plant 2×2 blobs (area 4) so dilate lands in ~2–10px
    const step = Math.max(1, Math.floor(candidates.length / Math.max(1, targetCount)));
    let planted = 0;
    function paintBlob(i, intensity) {
        const col = boost(brightLavaColor(pal, intensity), boostAmt);
        const x0 = i % W;
        const y0 = (i / W) | 0;
        for (const [dx, dy] of [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
        ]) {
            const x = (x0 + dx + W) % W;
            const y = y0 + dy;
            if (y < 0 || y >= H)
                continue;
            const j = y * W + x;
            if (data[j] > sea + 0.14)
                continue;
            const o = j * 4;
            albedo[o] = Math.round(col.r * 255);
            albedo[o + 1] = Math.round(col.g * 255);
            albedo[o + 2] = Math.round(col.b * 255);
            albedo[o + 3] = 255;
            liquidMask[o] = 255;
            liquidMask[o + 1] = Math.round(LAVA_LIQUID_SPEC * 255);
            liquidMask[o + 2] = Math.round((4 / 15) * 255);
            liquidMask[o + 3] = 255;
        }
    }
    for (let k = 0; k < candidates.length && planted < targetCount; k += step) {
        const i = candidates[k];
        const intensity = clamp01(0.9 + flow[i] * 0.08);
        paintBlob(i, intensity);
        planted++;
    }
    let c = 0;
    for (let i = 0; i < W * H; i++)
        if (liquidMask[i * 4] >= 128)
            c++;
    return c;
}
/**
 * Grow only *small* lava lakes outward (default maxCompSize=6) so 1–3px
 * ponds become ~2–10px without fattening primary seas. Mutates albedo+liquid.
 */
export function dilateLavaLakes(albedo, liquidMask, height, params, maxRise = 0.05, maxCompSize = 6) {
    const W = height.width;
    const H = height.height;
    const data = height.data;
    const sea = Math.max(0, Math.min(1, params.liquidLevel));
    const pal = paletteForParams(params);
    const boostAmt = params.colorBoost;
    // Label components; only expand those with size <= maxCompSize
    const label = new Int32Array(W * H);
    label.fill(-1);
    const sizes = [];
    const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ];
    let lab = 0;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            if (liquidMask[i * 4] < 128 || label[i] >= 0)
                continue;
            const q = [i];
            label[i] = lab;
            let c = 0;
            while (q.length) {
                const j = q.pop();
                c++;
                const jx = j % W;
                const jy = (j / W) | 0;
                for (const [dx, dy] of dirs) {
                    const nx = (jx + dx + W) % W;
                    const ny = jy + dy;
                    if (ny < 0 || ny >= H)
                        continue;
                    const k = ny * W + nx;
                    if (liquidMask[k * 4] < 128 || label[k] >= 0)
                        continue;
                    label[k] = lab;
                    q.push(k);
                }
            }
            sizes[lab] = c;
            lab++;
        }
    }
    const grow = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            if (liquidMask[i * 4] >= 128)
                continue;
            if (data[i] > sea + maxRise)
                continue;
            let nearSmall = false;
            for (const [dx, dy] of dirs) {
                const nx = (x + dx + W) % W;
                const ny = y + dy;
                if (ny < 0 || ny >= H)
                    continue;
                const j = ny * W + nx;
                const L = label[j];
                if (L >= 0 && (sizes[L] ?? 0) <= maxCompSize) {
                    nearSmall = true;
                    break;
                }
            }
            if (nearSmall)
                grow[i] = 1;
        }
    }
    let liquidCount = 0;
    for (let i = 0; i < W * H; i++) {
        if (liquidMask[i * 4] >= 128) {
            liquidCount++;
            continue;
        }
        if (!grow[i])
            continue;
        const h = data[i];
        const depth = clamp01((sea + maxRise - h) / Math.max(1e-4, sea + maxRise));
        // Dilated rim stays hot (hardenLavaShores finalizes binary shore)
        const intensity = clamp01(0.9 + depth * 0.1);
        const col = boost(brightLavaColor(pal, intensity), boostAmt);
        const o = i * 4;
        albedo[o] = Math.round(col.r * 255);
        albedo[o + 1] = Math.round(col.g * 255);
        albedo[o + 2] = Math.round(col.b * 255);
        albedo[o + 3] = 255;
        liquidMask[o] = 255;
        liquidMask[o + 1] = Math.round(LAVA_LIQUID_SPEC * 255);
        liquidMask[o + 2] = Math.round((4 / 15) * 255);
        liquidMask[o + 3] = 255;
        liquidCount++;
    }
    return liquidCount;
}
/**
 * Class-gated land color. Polar ice + Earth vegetation only on ocean/temperate.
 * Rocky/lava/exotic use rock/arid (or ice-world ice) paths — no universal snow poles.
 */
function landBiomeColor(pal, elev, absLat, cls, liquidKind, x, y, z, seed, poleIceScale = 1) {
    // ── Rocky Mars: arid rock; basins clearly darker than highlands ──
    if (cls === "rocky") {
        // Strong elev→albedo: low = dark basalt floor, high = bright dust/rock
        let col = lerpRgb(pal.rockDark, pal.lowland, smoothstep(0.0, 0.32, elev));
        col = lerpRgb(col, pal.arid, smoothstep(0.12, 0.5, elev) * 0.6);
        col = lerpRgb(col, pal.aridHot, smoothstep(0.35, 0.8, elev) * 0.4);
        col = lerpRgb(col, pal.mountain, smoothstep(0.5, 0.95, elev) * 0.5);
        col = lerpRgb(col, pal.highland, smoothstep(0.55, 0.98, elev) * 0.25);
        // Deep depression / “lake” floors — material contrast vs surrounding plain
        const basin = 1 - smoothstep(0.0, 0.2, elev);
        col = lerpRgb(col, mulRgb(pal.rockDark, 0.45), basin * 0.82);
        col = lerpRgb(col, { r: 0.08, g: 0.05, b: 0.04 }, basin * basin * 0.35);
        const n = fbm3(x * 22, y * 22, z * 22, seed + 40, 4) * 0.08 - 0.03;
        col = {
            r: clamp01(col.r + n * 0.7),
            g: clamp01(col.g + n * 0.45),
            b: clamp01(col.b + n * 0.3),
        };
        return {
            col,
            mat: basin > 0.55 ? 7 : 8,
            spec: 0.06 + basin * 0.04,
            climateClass: ClimateClass.Rock,
        };
    }
    // ── Ice world: global ice/cold rock (not Earth biomes + polar disk) ──
    if (cls === "ice") {
        // Structured ice (cracks / ridges) without loud global grit amp
        const iceN = fbm3(x * 1.15, y * 0.45, z * 1.15, seed + 50, 4) * 0.5 + 0.5;
        const iceN2 = fbm3(x * 2.8, y * 0.7, z * 2.8, seed + 61, 3) * 0.5 + 0.5;
        const iceN3 = ridged3(x, y, z, seed + 72, 4, 9) * 0.5 + 0.5;
        let col = lerpRgb(pal.tundra, pal.snow, 0.48 + iceN * 0.38);
        col = lerpRgb(col, pal.highland, elev * 0.28);
        col = lerpRgb(col, pal.rockDark, elev * elev * 0.22);
        col = lerpRgb(col, { r: 0.92, g: 0.95, b: 0.98 }, 0.22 + iceN * 0.18);
        // Crack/ridge structure for orbit fine-var floor + stamp readability
        const ridge = (iceN2 - 0.5) * 0.14 + (iceN3 - 0.5) * 0.12;
        const micro = valueNoise3(x * 48, y * 48, z * 48, seed + 88) * 0.05 - 0.025;
        col = {
            r: clamp01(col.r + ridge + micro),
            g: clamp01(col.g + ridge * 0.95 + micro * 0.9),
            b: clamp01(col.b + ridge * 0.9 + micro * 0.85),
        };
        return { col, mat: 9, spec: 0.28, climateClass: ClimateClass.EF };
    }
    // ── Lava world basalt crust (channels painted in paintSurface) ──
    if (liquidKind === "lava") {
        let col = lerpRgb(pal.rockDark, pal.lowland, elev * 0.5);
        col = lerpRgb(col, pal.mountain, smoothstep(0.35, 0.9, elev) * 0.45);
        col = lerpRgb(col, pal.arid, elev * 0.15);
        const n = fbm3(x * 28, y * 28, z * 28, seed + 60, 3) * 0.1 - 0.04;
        col = {
            r: clamp01(col.r + n),
            g: clamp01(col.g + n * 0.6),
            b: clamp01(col.b + n * 0.45),
        };
        return { col, mat: 8, spec: 0.12, climateClass: ClimateClass.Rock };
    }
    // ── Exotic (methane/acid): dry rock/organics, no Earth green/snow poles ──
    if (cls === "exotic") {
        let col = lerpRgb(pal.lowland, pal.highland, elev * 0.55);
        col = lerpRgb(col, pal.arid, 0.4 + elev * 0.2);
        col = lerpRgb(col, pal.mountain, smoothstep(0.4, 0.9, elev) * 0.35);
        col = lerpRgb(col, pal.rockDark, elev * 0.25);
        // No polar white — slight cool dust only at extreme elev
        if (elev > 0.7)
            col = lerpRgb(col, pal.highland, 0.2);
        const n = fbm3(x * 20, y * 20, z * 20, seed + 70, 4) * 0.1 - 0.04;
        col = {
            r: clamp01(col.r + n * 0.85),
            g: clamp01(col.g + n * 0.7),
            b: clamp01(col.b + n * 0.55),
        };
        return { col, mat: 11, spec: 0.07, climateClass: ClimateClass.BWh };
    }
    // ── Ocean / temperate: Earth soft biomes (polar ice is a biome here only) ──
    const drivers = sampleClimateDrivers(x, y, z, elev, seed);
    const climateCls = classifyClimate(drivers.temperature, drivers.precip, drivers.moisture, elev, absLat);
    const soft = softBiomeColor(pal, elev, absLat, drivers.temperature, drivers.moisture, drivers.precip, x, y, z, seed, poleIceScale);
    let col = soft.col;
    const snowW = isEarthlikeClass(cls) ? soft.snowW : 0;
    const aridW = soft.aridW;
    const forestW = soft.forestW;
    // iceAmt from softBiome: 1.0 = solid polar snow core
    const iceAmt = isEarthlikeClass(cls) ? clamp01(snowW) : 0;
    let mat = climateClassMatId(climateCls);
    if (iceAmt > 0.55)
        mat = 9;
    else if (elev > 0.55 && climateCls === ClimateClass.Rock)
        mat = 8;
    else if (forestW > 0.45)
        mat = 12;
    else if (aridW > 0.45)
        mat = 11;
    // Reinforce snow: full replace in solid core; soft only on partial fringe
    if (iceAmt > 0.02) {
        col = lerpRgb(col, pal.snow, iceAmt);
        col = lerpRgb(col, { r: 0.94, g: 0.97, b: 1.0 }, smoothstep(0.75, 1.0, iceAmt) * 0.35);
    }
    // Satellite micro-grain — zero-mean luminance fleck (neutral, not a dark tint).
    // Amp fades continuously into polar quiet.
    const landAmpBase = cls === "ocean" || cls === "temperate"
        ? BASE_LAND_GRAIN_AMP_EARTH
        : BASE_LAND_GRAIN_AMP_OTHER;
    const iceQuiet = smoothstep(0.2, 0.88, iceAmt);
    const landAmp = landAmpBase * (1 - iceQuiet) + BASE_LAND_GRAIN_AMP_POLAR * iceQuiet;
    // Whisper fleck only — biomes read clean (gray / green / deep green / desert)
    const grainSoft = 0.04; // half intensity (was 0.08)
    const n1 = (fbm3(x * 18, y * 18, z * 18, seed + 12, 4) * 2 - 1) *
        BASE_LAND_GRAIN_N1 *
        0.15 *
        grainSoft *
        landAmp;
    const n2 = (ridged3(x, y, z, seed + 44, 3, 18) * 2 - 1) * 0.012 * grainSoft * landAmp;
    const n3 = (valueNoise3(x * 55, y * 55, z * 55, seed + 19) * 2 - 1) *
        0.01 *
        grainSoft *
        landAmp;
    const n4 = (fbm3(x * 48, y * 48, z * 48, seed + 88, 3) * 2 - 1) *
        0.008 *
        grainSoft *
        landAmp;
    const n5 = cls === "ocean" || cls === "temperate"
        ? (ridged3(x, y, z, seed + 101, 4, 28) * 2 - 1) *
            0.008 *
            grainSoft *
            landAmp
        : 0;
    const aridN = clamp01(aridW);
    const grain = n1 * 0.55 + n2 * 0.3 + n3 * 0.22 + n4 * 0.18 + n5 * 0.15;
    const warmFleck = aridN * n3 * 0.03;
    const preR = col.r;
    const preG = col.g;
    const preB = col.b;
    const preL = 0.2126 * preR + 0.7152 * preG + 0.0722 * preB;
    col = {
        r: clamp01(col.r + grain + warmFleck * 0.25),
        g: clamp01(col.g + grain),
        b: clamp01(col.b + grain - warmFleck * 0.08),
    };
    {
        const oL = 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b;
        if (oL > 1e-5 && preL > 1e-5) {
            const target = preL * 0.92 + oL * 0.08;
            const k = target / oL;
            col = {
                r: clamp01(col.r * k),
                g: clamp01(col.g * k),
                b: clamp01(col.b * k),
            };
        }
    }
    // Re-assert after grain — keep desert visible when arid wins; green otherwise
    if (aridN > 0.22) {
        const aridFade = 1 - iceAmt * 0.92;
        col = lerpRgb(col, pal.arid, aridN * 0.18 * aridFade);
        col = lerpRgb(col, pal.aridHot, aridN * aridN * 0.1 * aridFade);
    }
    if (forestW > 0.12 && aridN < 0.5 && absLat < 0.9) {
        const fw = clamp01(forestW) * (1 - smoothstep(0.15, 0.75, iceAmt));
        if (fw > 0.02) {
            col = {
                r: clamp01(col.r - fw * 0.04),
                g: clamp01(col.g + fw * 0.08),
                b: clamp01(col.b - fw * 0.025),
            };
            col = lerpRgb(col, pal.forest, fw * 0.22);
        }
    }
    // Re-assert snow after grain: solid poles stay full white (short fringe only)
    if (iceAmt > 0.02) {
        col = lerpRgb(col, pal.snow, clamp01(iceAmt * iceAmt * 0.35 + iceAmt * 0.65));
        col = lerpRgb(col, { r: 0.95, g: 0.97, b: 1.0 }, smoothstep(0.88, 1.0, iceAmt) * 0.4);
    }
    // Mild valley shade (kept light — was stacking darkness with grain)
    {
        const valley = 1 -
            smoothstep(0.0, 0.12, elev) *
                0.03 *
                (aridW > 0.4 ? 0.3 : 1) *
                (1 - iceAmt * 0.95);
        col = mulRgb(col, valley);
    }
    // Mild green-cap only for neon minimap spam — keep boreal olive readable
    if (col.g > col.r + 0.1 && col.g > col.b + 0.1 && iceAmt < 0.25) {
        const over = Math.min(col.g - col.r, col.g - col.b) - 0.07;
        if (over > 0) {
            col = {
                r: clamp01(col.r + over * 0.2),
                g: clamp01(col.g - over * 0.3),
                b: clamp01(col.b + over * 0.08),
            };
        }
    }
    const spec = snowW > 0.45 ? 0.32 : aridW > 0.5 ? 0.07 : forestW > 0.5 ? 0.04 : 0.06;
    return { col, mat, spec, climateClass: climateCls };
}
/** Lava liquid is matte glow — not wet water. Spec/wet channel stays ~0. */
export const LAVA_LIQUID_SPEC = 0.04;
/**
 * Molten basalt blackbody continuum (intensity = heat / depth).
 * Cool rim deep red → orange → yellow-hot core. Not water blues; not pastel.
 * Glow is emissive appearance in albedo; specular is kept near-zero separately.
 * Hard shores: callers use intensity ≳0.85 so liquid never fades into basalt.
 */
function brightLavaColor(_pal, intensity) {
    const t = clamp01(intensity);
    // Steep curve — low-t only used if a caller slips below floor
    const s = Math.pow(t, 0.55);
    // ~1200°C deep orange-red → bright orange → yellow-hot core
    const dark = { r: 0.88, g: 0.16, b: 0.02 };
    const mid = { r: 0.98, g: 0.3, b: 0.03 };
    const hot = { r: 1.0, g: 0.48, b: 0.05 };
    const core = { r: 1.0, g: 0.75, b: 0.22 };
    if (s < 0.35)
        return lerpRgb(dark, mid, s / 0.35);
    if (s < 0.7)
        return lerpRgb(mid, hot, (s - 0.35) / 0.35);
    return lerpRgb(hot, core, (s - 0.7) / 0.3);
}
/**
 * Near-binary lava shores after layout is final:
 * 1) Re-heat every liquid pixel (high intensity floor — no soft cool rim).
 * 2) Dark 1px basalt lip on land that 4-touches liquid.
 * Mutates albedo (+ liquid wet channel stays matte). Layout/mask R unchanged.
 */
export function hardenLavaShores(albedo, liquidMask, height, params) {
    const W = height.width;
    const H = height.height;
    const data = height.data;
    const sea = Math.max(0, Math.min(1, params.liquidLevel));
    const pal = paletteForParams(params);
    const boostAmt = params.colorBoost;
    const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ];
    // 1) Binary-hot liquid: depth only nudges core yellow, never cool crust
    for (let i = 0; i < W * H; i++) {
        if (liquidMask[i * 4] < 128)
            continue;
        const h = data[i];
        const depth = clamp01((sea - h) / Math.max(1e-4, sea));
        const intensity = clamp01(0.9 + depth * 0.1);
        const col = boost(brightLavaColor(pal, intensity), boostAmt);
        const o = i * 4;
        albedo[o] = Math.round(col.r * 255);
        albedo[o + 1] = Math.round(col.g * 255);
        albedo[o + 2] = Math.round(col.b * 255);
        albedo[o + 3] = 255;
        liquidMask[o + 1] = Math.round(LAVA_LIQUID_SPEC * 255);
        liquidMask[o + 2] = Math.round((4 / 15) * 255);
    }
    // 2) Mark land 4-neighbors of liquid → dark basalt crust lip
    const lip = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            if (liquidMask[i * 4] >= 128)
                continue;
            for (const [dx, dy] of dirs) {
                const nx = (x + dx + W) % W;
                const ny = y + dy;
                if (ny < 0 || ny >= H)
                    continue;
                if (liquidMask[(ny * W + nx) * 4] >= 128) {
                    lip[i] = 1;
                    break;
                }
            }
        }
    }
    // Near-black basalt crust (cools at the shore) — strong contrast vs melt
    const crust = { r: 0.028, g: 0.022, b: 0.018 };
    const lipMix = 0.82;
    for (let i = 0; i < W * H; i++) {
        if (!lip[i])
            continue;
        const o = i * 4;
        const er = albedo[o] / 255;
        const eg = albedo[o + 1] / 255;
        const eb = albedo[o + 2] / 255;
        albedo[o] = Math.round((er * (1 - lipMix) + crust.r * lipMix) * 255);
        albedo[o + 1] = Math.round((eg * (1 - lipMix) + crust.g * lipMix) * 255);
        albedo[o + 2] = Math.round((eb * (1 - lipMix) + crust.b * lipMix) * 255);
        // Land stays dry rock; slightly matte
        liquidMask[o] = 0;
        liquidMask[o + 1] = Math.round(0.08 * 255);
        liquidMask[o + 2] = Math.round((8 / 15) * 255);
    }
}
/**
 * Frozen ice-basin color for ice-class worlds — snow family, cooler blue tone
 * than land snow (not open liquid navy).
 */
export function frozenIceSeaColor(depth, x, y, z, seed) {
    const d = clamp01(depth);
    // Distinct cooler blue ice vs bright white land snow
    const shallow = { r: 0.82, g: 0.9, b: 0.97 };
    const mid = { r: 0.62, g: 0.78, b: 0.92 };
    const deep = { r: 0.45, g: 0.65, b: 0.84 };
    let col;
    if (d < 0.4)
        col = lerpRgb(shallow, mid, d / 0.4);
    else
        col = lerpRgb(mid, deep, (d - 0.4) / 0.6);
    const n1 = fbm3(x * 1.2, y * 0.4, z * 1.2, seed + 501, 3) * 0.04 - 0.015;
    const n2 = fbm3(x * 4.5, y * 1.1, z * 4.5, seed + 511, 2) * 0.025;
    col = {
        r: clamp01(col.r + n1 * 0.7 + n2 * 0.4),
        g: clamp01(col.g + n1 * 0.85 + n2 * 0.5),
        b: clamp01(col.b + n1 * 0.95 + n2 * 0.55),
    };
    // Keep snow-like brightness floor (still ice, not dark sea)
    const L = (col.r + col.g + col.b) / 3;
    if (L < 0.55) {
        const lift = (0.55 - L) * 0.65;
        col = {
            r: clamp01(col.r + lift * 0.85),
            g: clamp01(col.g + lift * 0.95),
            b: clamp01(col.b + lift),
        };
    }
    return col;
}
/**
 * Liquid color by kind: water = dark navy; methane = orange-brown lakes;
 * acid = green; lava uses brightLavaColor separately.
 * Ice-class basins use frozenIceSeaColor instead (see paintSurface).
 */
function oceanColor(pal, depth, x, y, z, seed, atmTint, liquidKind = "water") {
    const d = clamp01(depth);
    const deep = pal.liquidDeep;
    const mid = pal.liquidMid;
    const shelf = pal.liquidShelf;
    let col;
    if (liquidKind === "methane" || liquidKind === "acid") {
        // Multi-stop from palette (methane = brown, acid = green)
        if (d < 0.35)
            col = lerpRgb(shelf, mid, d / 0.35);
        else if (d < 0.7)
            col = lerpRgb(mid, deep, (d - 0.35) / 0.35);
        else
            col = lerpRgb(deep, mulRgb(deep, 0.55), (d - 0.7) / 0.3);
    }
    else {
        // Water: earthmap teal-navy stops (shelf → mid → deep → dark deep)
        // Abyss keeps a greenish lift so open ocean does not crush to pure indigo.
        const midDark = lerpRgb(mid, deep, 0.35);
        const abyss = {
            r: deep.r * 0.55,
            g: deep.g * 0.68,
            b: deep.b * 0.78,
        };
        if (d < 0.4)
            col = lerpRgb(shelf, midDark, d / 0.4);
        else if (d < 0.72)
            col = lerpRgb(midDark, deep, (d - 0.4) / 0.32);
        else
            col = lerpRgb(deep, abyss, (d - 0.72) / 0.28);
    }
    const n1 = fbm3(x * 0.55, y * 0.28, z * 0.55, seed + 77, 2) * 0.012 - 0.004;
    const n2 = fbm3(x * 1.05, y * 0.45, z * 1.05, seed + 81, 1) * 0.005;
    // Methane: warm noise; water: teal (boost G a touch with blue)
    const warm = liquidKind === "methane" || liquidKind === "lava" ? 1 : 0;
    const water = liquidKind === "water" ? 1 : 0;
    col = {
        r: clamp01(col.r + n1 * (0.12 + warm * 0.15) + n2 * 0.08),
        g: clamp01(col.g + n1 * (0.22 - warm * 0.05 + water * 0.06) + n2 * 0.14),
        b: clamp01(col.b + n1 * (0.26 - warm * 0.2) + n2 * 0.15),
    };
    const tmax = Math.max(atmTint.r, atmTint.g, atmTint.b, 1e-4);
    const atmW = liquidKind === "water" ? 0.01 : 0.02;
    col = {
        r: col.r * 0.98 + (atmTint.r / tmax) * atmW,
        g: col.g * 0.985 + (atmTint.g / tmax) * (liquidKind === "water" ? 0.014 : atmW),
        b: col.b * 0.97 + (atmTint.b / tmax) * (liquidKind === "water" ? 0.016 : 0.01),
    };
    return col;
}
/**
 * Soft-ocean pass count by long edge. Heavy at preview res; capped at high res
 * so 4K/8K bakes are not dominated by O(passes × W×H) host blur.
 */
export function softOceanPassesForResolution(width) {
    // Firmer coasts: light liquid blur only (was over-soft mush)
    if (width >= 2048)
        return 1;
    return 1;
}
/**
 * Post-paint blur on liquid albedo only — damps residual high-frequency
 * light/dark blue mottling while leaving land untouched.
 * Mutates albedo in place. Cost O(passes × ocean pixels).
 * Reuses one scratch buffer (no per-pass full-map alloc).
 */
export function softOceanAlbedo(albedo, liquidMask, width, height, passes) {
    const W = width;
    const H = height;
    const nPass = Math.max(1, Math.min(16, Math.floor(passes ?? softOceanPassesForResolution(W))));
    // One scratch — ping-pong indices (avoid N× full equirect alloc + TS buffer types)
    const bufA = albedo;
    const bufB = new Uint8ClampedArray(albedo);
    let srcIsA = true;
    for (let p = 0; p < nPass; p++) {
        const src = srcIsA ? bufA : bufB;
        const dst = srcIsA ? bufB : bufA;
        // 3×3 only at high res (5×5 is too expensive at 4K/8K)
        const wide = p % 2 === 1 && W < 2048;
        for (let y = 1; y < H - 1; y++) {
            for (let x = 0; x < W; x++) {
                const o = (y * W + x) * 4;
                const liq = liquidMask[o] / 255;
                if (liq < 0.55)
                    continue; // land: leave dst as previous
                const xl = (x - 1 + W) % W;
                const xr = (x + 1) % W;
                let sr = 0;
                let sg = 0;
                let sb = 0;
                let sw = 0;
                const sample = (xx, yy, wt) => {
                    const j = (yy * W + xx) * 4;
                    const l = liquidMask[j] / 255;
                    // Liquid-only samples — never bleed land green into coastal ocean
                    if (l < 0.55)
                        return;
                    const w = wt * l;
                    sr += src[j] * w;
                    sg += src[j + 1] * w;
                    sb += src[j + 2] * w;
                    sw += w;
                };
                if (!wide || y < 2 || y > H - 3) {
                    sample(x, y, 1);
                    sample(xl, y, 1);
                    sample(xr, y, 1);
                    sample(x, y - 1, 1);
                    sample(x, y + 1, 1);
                    sample(xl, y - 1, 0.7);
                    sample(xr, y - 1, 0.7);
                    sample(xl, y + 1, 0.7);
                    sample(xr, y + 1, 0.7);
                }
                else {
                    for (let dy = -2; dy <= 2; dy++) {
                        const yy = y + dy;
                        for (let dx = -2; dx <= 2; dx++) {
                            const xx = (x + dx + W) % W;
                            const wt = dx === 0 && dy === 0 ? 1.2 : 1;
                            sample(xx, yy, wt);
                        }
                    }
                }
                if (sw <= 1e-6)
                    continue;
                const deep = Math.min(1, liq);
                const mix = 0.68 + 0.28 * deep;
                dst[o] = Math.round(src[o] * (1 - mix) + (sr / sw) * mix);
                dst[o + 1] = Math.round(src[o + 1] * (1 - mix) + (sg / sw) * mix);
                dst[o + 2] = Math.round(src[o + 2] * (1 - mix) + (sb / sw) * mix);
            }
        }
        srcIsA = !srcIsA;
    }
    // Result in B when nPass odd — copy back to caller's buffer
    if (!srcIsA) {
        albedo.set(bufB);
    }
}
/**
 * Mean |ΔRGB| between adjacent liquid pixels (horizontal). Lower = calmer ocean.
 * Used by smoke/quality gates.
 */
export function oceanNeighborAbs(albedo, liquidMask, width, height) {
    const W = width;
    const H = height;
    let s = 0;
    let n = 0;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W - 1; x++) {
            const i = (y * W + x) * 4;
            const j = (y * W + x + 1) * 4;
            if (liquidMask[i] < 128 || liquidMask[j] < 128)
                continue;
            s +=
                Math.abs(albedo[i] - albedo[j]) +
                    Math.abs(albedo[i + 1] - albedo[j + 1]) +
                    Math.abs(albedo[i + 2] - albedo[j + 2]);
            n++;
        }
    }
    return n > 0 ? s / n : 0;
}
/**
 * Classify height + climate → albedo + liquid mask.
 */
export function paintSurface(height, params, storms = null) {
    const { width: W, height: H, data } = height;
    const albedo = new Uint8ClampedArray(W * H * 4);
    const liquidMask = new Uint8ClampedArray(W * H * 4);
    const pal = paletteForParams(params);
    const sea = Math.max(0, Math.min(1, params.liquidLevel));
    const boostAmt = params.colorBoost;
    const seed = params.seed | 0;
    let liquidCount = 0;
    const isGas = params.planetClass === "gas";
    const liquidKind = params.liquidKind;
    const cls = params.planetClass;
    const poleIceScale = poleIceExtentScale(params.poleSize);
    // Lava: precompute drainage flow once (dendritic channels into basins)
    const lavaFlow = liquidKind === "lava" ? computeLavaFlowMap(height, sea) : null;
    // Channel thr: open enough for many small valley ponds (then targeted dilate)
    const lavaFlowThr = 0.42;
    // How far above sea lava rivers may climb (valleys only)
    const lavaChannelRise = 0.16;
    for (let y = 0; y < H; y++) {
        const v = (y + 0.5) / H;
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            const h = data[i];
            const u = (x + 0.5) / W;
            const d = equirectToDir(u, v);
            let col;
            let liq = 0;
            let spec = 0;
            let mat = 0;
            if (isGas) {
                // Stronger band contrast + storm punch so flow reads before stamps
                const flow = h;
                const st = storms ? storms.data[i] : 0;
                // Steeper palette ramps + latitude stripe boost for zonal structure
                const latStripe = 0.5 + 0.5 * Math.sin(d.y * Math.PI * 5.5 + flow * 3.2 + seed * 0.01);
                const f2 = clamp01(flow * 0.72 + latStripe * 0.28);
                if (f2 < 0.22)
                    col = lerpRgb(pal.gasA, pal.gasB, f2 / 0.22);
                else if (f2 < 0.48)
                    col = lerpRgb(pal.gasB, pal.gasC, (f2 - 0.22) / 0.26);
                else if (f2 < 0.72)
                    col = lerpRgb(pal.gasC, pal.gasB, (f2 - 0.48) / 0.24);
                else
                    col = lerpRgb(pal.gasB, pal.gasA, (f2 - 0.72) / 0.28);
                // Exaggerate band edges slightly
                const edge = Math.abs(fbm3(d.x * 6, d.y * 18, d.z * 6, seed + 3, 3)) * 0.12;
                col = {
                    r: clamp01(col.r * (1.08 + edge) - 0.04),
                    g: clamp01(col.g * (1.05 + edge * 0.8) - 0.03),
                    b: clamp01(col.b * (1.02 + edge * 0.5) - 0.02),
                };
                col = lerpRgb(col, pal.gasStorm, Math.min(1, st * 1.85));
                const n = fbm3(d.x * 14, d.y * 3.5, d.z * 14, seed + 9, 3) * 0.09 - 0.02;
                const n2 = fbm3(d.x * 40, d.y * 8, d.z * 40, seed + 11, 2) * 0.045;
                col = {
                    r: clamp01(col.r + n + n2),
                    g: clamp01(col.g + n * 0.85 + n2 * 0.7),
                    b: clamp01(col.b + n * 0.55 + n2 * 0.4),
                };
                liq = 0;
                spec = 0.18 + st * 0.25;
                mat = 10;
            }
            else if (liquidKind === "lava") {
                // Io-like: multi-basin seas (ridge barriers) + drainage channels + dilate
                const elev = sea >= 0.999 ? h : (h - sea) / Math.max(1e-4, 1 - sea);
                const elevC = clamp01(elev);
                const land = landBiomeColor(pal, elevC, Math.abs(d.y), cls, liquidKind, d.x, d.y, d.z, seed, poleIceScale);
                const flow = lavaFlow ? lavaFlow[i] : 0;
                // Barriers + min depth: split mega-seas into several pocket lakes
                const barrier = lavaBasinBarrier(d.x, d.y, d.z, seed);
                const hLiq = h + barrier * 0.28;
                // Local valley cue for channel paint
                let nSum = h;
                let nC = 1;
                {
                    const xl = data[y * W + ((x - 1 + W) % W)];
                    const xr = data[y * W + ((x + 1) % W)];
                    nSum += xl + xr;
                    nC += 2;
                    if (y > 0) {
                        nSum += data[(y - 1) * W + x];
                        nC++;
                    }
                    if (y < H - 1) {
                        nSum += data[(y + 1) * W + x];
                        nC++;
                    }
                }
                const nMean = nSum / nC;
                const inValley = h <= nMean + 0.01;
                // Only true basin pockets (not shallow connected shelves)
                const depthBelow = sea - h;
                const isSea = hLiq < sea && depthBelow > 0.012 + barrier * 0.04;
                // Valley ponds / short channels (dilate grows them to ~2–10px)
                const isRiver = !isSea &&
                    inValley &&
                    flow >= lavaFlowThr &&
                    h < sea + lavaChannelRise &&
                    barrier < 0.5;
                if (isSea || isRiver) {
                    const depth = isSea
                        ? clamp01((sea - h) / Math.max(1e-4, sea))
                        : 0;
                    // Near-binary hot melt; hardenLavaShores re-asserts floor after layout
                    const intensity = clamp01(isSea
                        ? 0.9 + depth * 0.1
                        : 0.88 +
                            ((flow - lavaFlowThr) /
                                Math.max(1e-4, 1 - lavaFlowThr)) *
                                0.12);
                    col = brightLavaColor(pal, intensity);
                    liq = 1;
                    // Matte melt: no water-class wet/spec (glow is albedo + night emissive)
                    spec = LAVA_LIQUID_SPEC;
                    mat = 4;
                    liquidCount++;
                }
                else {
                    col = land.col;
                    mat = land.mat;
                    spec = land.spec;
                    liq = 0;
                }
            }
            else if (liquidKind !== "none" && h < sea) {
                const shallow3d = sampleOceanBathymetry3d(d.x, d.y, d.z, seed + 40, params.heightFreq);
                const depth = oceanPaintDepth(sea, h, shallow3d);
                if (cls === "ice") {
                    // Ice world basins: frozen ice surface (cool blue snow), not open sea
                    col = frozenIceSeaColor(clamp01(depth), d.x, d.y, d.z, seed);
                    liq = 1;
                    spec = 0.38 + params.wetness * 0.12 * (1 - depth * 0.2);
                    mat = 9;
                }
                else {
                    col = oceanColor(pal, clamp01(depth), d.x, d.y, d.z, seed, params.atmTint, liquidKind);
                    liq = 1;
                    spec = 0.55 + params.wetness * 0.35 * (1 - depth * 0.25);
                    mat =
                        liquidKind === "acid"
                            ? 3
                            : liquidKind === "methane"
                                ? 2
                                : 1;
                }
                liquidCount++;
            }
            else {
                const elev = sea >= 0.999 ? h : (h - sea) / Math.max(1e-4, 1 - sea);
                const elevC = clamp01(elev);
                const land = landBiomeColor(pal, elevC, Math.abs(d.y), cls, liquidKind, d.x, d.y, d.z, seed, poleIceScale);
                col = land.col;
                mat = land.mat;
                spec = land.spec;
            }
            col = boost(col, boostAmt);
            const o = i * 4;
            albedo[o] = Math.round(col.r * 255);
            albedo[o + 1] = Math.round(col.g * 255);
            albedo[o + 2] = Math.round(col.b * 255);
            albedo[o + 3] = 255;
            liquidMask[o] = Math.round(liq * 255);
            liquidMask[o + 1] = Math.round(Math.min(1, spec) * 255);
            liquidMask[o + 2] = Math.round((mat / 15) * 255);
            liquidMask[o + 3] = 255;
        }
    }
    // Split mega-sea; seed micro ponds; grow only small comps into ~2–10px
    if (liquidKind === "lava") {
        liquidCount = splitMegaLavaSeas(albedo, liquidMask, height, params);
        liquidCount = seedMicroLavaPonds(albedo, liquidMask, height, params, lavaFlow);
        // One light dilate of small blobs only (2×2 seeds → ~5–10px)
        liquidCount = dilateLavaLakes(albedo, liquidMask, height, params, 0.05, 6);
        // Near-1px hard shore: hot liquid + dark basalt lip on land
        hardenLavaShores(albedo, liquidMask, height, params);
    }
    return {
        albedo,
        liquidMask,
        liquidFraction: liquidCount / (W * H),
    };
}
/**
 * Plain straight-alpha over weight (stamp A × strength already in srcA).
 * Lighten dual-pass removed — matte preserves natural transparency; compose as-is.
 */
export const CLOUD_COMPOSITE_LIGHTEN = 0;
export const CLOUD_COMPOSITE_NORMAL = 1;
/**
 * Composite one stamp sample onto a cloud-map pixel (pure, unit-testable).
 *
 * Single normal straight-alpha over of stamp RGB+A. No lighten, no darken,
 * no multiply. `lightenW` retained only for API compat and is ignored when 0.
 */
export function compositeCloudStampSample(dstR, dstG, dstB, dstA, srcR, srcG, srcB, srcA, lightenW = CLOUD_COMPOSITE_LIGHTEN, normalW = CLOUD_COMPOSITE_NORMAL) {
    const sa = Math.max(0, Math.min(1, srcA));
    if (sa < 0.004) {
        return {
            r: clamp01(dstR),
            g: clamp01(dstG),
            b: clamp01(dstB),
            a: clamp01(dstA),
        };
    }
    // Optional legacy lighten (default weight 0 — off)
    let r = dstR;
    let g = dstG;
    let b = dstB;
    let a = dstA;
    const lw = clamp01(sa * Math.max(0, lightenW));
    if (lw > 1e-5) {
        r = r + (Math.max(r, srcR) - r) * lw;
        g = g + (Math.max(g, srcG) - g) * lw;
        b = b + (Math.max(b, srcB) - b) * lw;
    }
    // Normal straight-alpha over (default normalW = 1)
    const nw = clamp01(sa * Math.max(0, normalW));
    if (nw > 1e-5) {
        const na = clamp01(a + nw * (1 - a));
        const m = nw / Math.max(na, 1e-4);
        r = r * (1 - m) + srcR * m;
        g = g * (1 - m) + srcG * m;
        b = b * (1 - m) + srcB * m;
        a = na;
    }
    return { r: clamp01(r), g: clamp01(g), b: clamp01(b), a: clamp01(a) };
}
export function generateClouds(params, width, height, cloudSources, land) {
    // Cloud stamps only on temperate (azure-ocean preset maps to temperate).
    if (params.cloudCover <= 0.01 ||
        params.planetClass === "gas" ||
        params.planetClass !== "temperate") {
        return null;
    }
    const seed = (params.seed | 0) + 9001;
    const cover = Math.max(0, Math.min(1, params.cloudCover));
    const out = new Uint8ClampedArray(width * height * 4);
    const bank = cloudSources && cloudSources.length > 0;
    // Bank path: no procedural noise base — stamps only (as-authored RGB+A).
    if (!bank) {
        for (let y = 0; y < height; y++) {
            const v = (y + 0.5) / height;
            for (let x = 0; x < width; x++) {
                const u = (x + 0.5) / width;
                const d = equirectToDir(u, v);
                const wx = fbm3(d.x * 1.4, d.y * 1.1, d.z * 1.4, seed + 1, 3) * 0.18 - 0.09;
                const wz = fbm3(d.x * 1.4 + 3, d.y * 1.1, d.z * 1.4, seed + 2, 3) * 0.18 - 0.09;
                const px = d.x + wx;
                const py = d.y * 0.85;
                const pz = d.z + wz;
                const deck = fbm3(px * 1.6, py * 1.2, pz * 1.6, seed, 5) * 0.5 + 0.5;
                const broken = ridged3(px, py, pz, seed + 11, 4, 3.8);
                const cells = fbm3(px * 4.5, py * 2.2, pz * 4.5, seed + 21, 4) * 0.5 + 0.5;
                const fluff = fbm3(px * 14, py * 6, pz * 14, seed + 31, 3) * 0.5 + 0.5;
                const ridgeEdge = ridged3(px, py, pz, seed + 41, 3, 11);
                let c = deck * 0.42 +
                    broken * 0.28 +
                    cells * 0.18 +
                    fluff * 0.08 +
                    ridgeEdge * 0.12;
                c *= 0.82 + 0.18 * (1 - Math.abs(d.y) * 0.55);
                const thresh = 1 - cover * 0.78;
                let a = smoothstep(thresh, Math.min(1, thresh + 0.22 + cover * 0.08), c);
                a = clamp01(a * a * (1.35 + cover * 0.25));
                if (broken < 0.22 && cover < 0.85)
                    a *= 0.35 + broken * 2;
                const o = (y * width + x) * 4;
                const g = Math.round(200 + a * 55);
                out[o] = g;
                out[o + 1] = g;
                out[o + 2] = Math.min(255, g + 12);
                out[o + 3] = Math.round(a * 255);
            }
        }
        return out;
    }
    // Land-driven wind field (Mapbox-inspired velocity map; procedural from land)
    let wind = null;
    if (land && (land.liquidRgba || land.heightRgba)) {
        const fw = Math.min(256, Math.max(64, width));
        const fh = Math.min(128, Math.max(32, height));
        const win = {
            seed: params.seed | 0,
            width: fw,
            height: fh,
            liquidRgba: land.liquidRgba ?? null,
            liquidW: land.liquidW ?? width,
            liquidH: land.liquidH ?? height,
            heightRgba: land.heightRgba ?? null,
            heightW: land.heightW ?? width,
            heightH: land.heightH ?? height,
        };
        wind = buildLandWindField(win);
    }
    stampCloudSourcesOntoMap(out, width, height, cloudSources, seed, cover, wind);
    return out;
}
/** Max cyclone stamps on the map (user QA: too many otherwise). */
export const CLOUD_CYCLONE_MAX = 7;
/**
 * Target fraction of the sphere covered by the huge-clouds haze layer
 * (soft overlapping mega decks). Independent of smaller cloud categories.
 */
export const CLOUD_HUGE_TARGET_COVER = 0.6;
/** Safety cap on huge-cloud stamps while chasing CLOUD_HUGE_TARGET_COVER. */
export const CLOUD_HUGE_MAX_STAMPS = 28;
/** Angular radius cap (radians) for huge haze discs (~½-hemisphere class). */
export const CLOUD_HUGE_ANG_CAP = 1.65;
/** Spherical cap solid-angle fraction of the unit sphere for angular radius r. */
export function sphereCapCoverFrac(angRadius) {
    const r = Math.max(0, Math.min(Math.PI, angRadius));
    return (1 - Math.cos(r)) * 0.5;
}
/**
 * Low-frequency cloud activity heat map on the unit sphere (0..1).
 * High = dense cloud belts / blobs; low = clearer skies.
 */
export function cloudDensityHeat(dx, dy, dz, seed) {
    const n1 = fbm3(dx * 1.15, dy * 0.95, dz * 1.15, seed + 0xc10d, 4) * 0.5 + 0.5;
    const n2 = fbm3(dx * 2.4, dy * 1.7, dz * 2.4, seed + 0xb10b, 3) * 0.5 + 0.5;
    // Mild tropical / mid-lat preference (not polar-only decks)
    const latW = 0.5 + 0.5 * (1 - Math.abs(dy) * 0.9);
    let h = (n1 * 0.68 + n2 * 0.32) * latW;
    // Stretch contrast so clear vs cloudy regions read clearly
    h = Math.pow(clamp01(h), 1.25);
    // Floor so high cover still gets a few wisps in "clear" zones
    return clamp01(0.06 + h * 0.94);
}
/**
 * Stamp offline cloud library onto an equirect cloud map.
 *
 * **Phase A — huge-clouds haze:** when the bank has `huge-clouds`, place
 * really large, quite transparent, freely-overlapping mega decks until
 * ~{@link CLOUD_HUGE_TARGET_COVER} (60%) of the sphere is covered. This layer
 * is independent of wind / detail categories.
 *
 * **Phase B — detail decks:** wind-steered smaller stamps (spread-out, long,
 * mixed, unique, cyclones). Same-type non-overlap; cross-type may stack.
 * Huge is not re-picked here (already laid as the global veil).
 */
export function stampCloudSourcesOntoMap(cloudRgba, W, H, sources, seed, cover, wind = null) {
    if (!sources.length || cover <= 0.01)
        return 0;
    // Dense non-cyclone fill; cyclone cap stays CLOUD_CYCLONE_MAX (not more storms).
    const nWant = Math.max(120, Math.min(900, Math.round(280 + cover * 620)));
    let a = (seed >>> 0) ^ 0xc10d00;
    const rnd = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const heatSeed = (seed >>> 0) ^ 0x4ea7;
    // Bucket sources by category
    const byCat = new Map();
    for (let i = 0; i < sources.length; i++) {
        const cat = sources[i].category ?? "mixed";
        let arr = byCat.get(cat);
        if (!arr) {
            arr = [];
            byCat.set(cat, arr);
        }
        arr.push(i);
    }
    for (const arr of byCat.values()) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(rnd() * (i + 1));
            const tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
        }
    }
    const catCursor = new Map();
    const takeFromCat = (cat) => {
        const pool = byCat.get(cat);
        if (!pool || !pool.length)
            return null;
        const k = catCursor.get(cat) ?? 0;
        catCursor.set(cat, k + 1);
        return pool[k % pool.length];
    };
    const fallbackCat = () => {
        // Prefer detail classes — huge is a dedicated phase, not a fallback
        for (const c of [
            "mixed",
            "unique-shapes",
            "long-and-sharp",
            "spread-out-small-cluster-of-clouds",
            "cyclones",
        ]) {
            if (byCat.has(c) && byCat.get(c).length)
                return c;
        }
        // No detail bank (huge-only load) — skip phase-B detail pass
        return null;
    };
    /**
     * Raster one stamp into the cloud map. Shared by huge haze + detail passes.
     */
    const rasterStamp = (src, u0, center, angR, boundR, stretch, alphaScale, rot) => {
        // Tangent: e1 = local east
        let cx = center.z;
        let cy = 0;
        let cz = -center.x;
        let len = Math.hypot(cx, cy, cz);
        if (len < 1e-6) {
            cx = 1;
            cy = 0;
            cz = 0;
            len = 1;
        }
        cx /= len;
        cy /= len;
        cz /= len;
        let e2x = center.y * cz - center.z * cy;
        let e2y = center.z * cx - center.x * cz;
        let e2z = center.x * cy - center.y * cx;
        len = Math.hypot(e2x, e2y, e2z) || 1;
        e2x /= len;
        e2y /= len;
        e2z /= len;
        const cr = Math.cos(rot);
        const sr = Math.sin(rot);
        const t1x = cx * cr + e2x * sr;
        const t1y = cy * cr + e2y * sr;
        const t1z = cz * cr + e2z * sr;
        const t2x = -cx * sr + e2x * cr;
        const t2y = -cy * sr + e2y * cr;
        const t2z = -cz * sr + e2z * cr;
        cx = t1x;
        cy = t1y;
        cz = t1z;
        e2x = t2x;
        e2y = t2y;
        e2z = t2z;
        const dLat = boundR * 1.08;
        const latC = Math.asin(Math.max(-1, Math.min(1, center.y)));
        const vLo = clamp01(0.5 - (latC + dLat) / Math.PI);
        const vHi = clamp01(0.5 - (latC - dLat) / Math.PI);
        const y0 = Math.max(0, Math.floor(Math.min(vLo, vHi) * H - 1));
        const y1 = Math.min(H - 1, Math.ceil(Math.max(vLo, vHi) * H + 1));
        const cosL = Math.max(0.12, Math.cos(latC));
        const dLon = Math.min(Math.PI, (boundR * 1.2) / cosL);
        const fullW = dLon >= Math.PI * 0.95;
        const du = dLon / (Math.PI * 2);
        const x0f = fullW ? 0 : Math.floor((u0 - du) * W - 2);
        const x1f = fullW ? W - 1 : Math.ceil((u0 + du) * W + 2);
        const sW = src.width;
        const sH = src.height;
        const sR = src.rgba;
        for (let y = y0; y <= y1; y++) {
            const v = (y + 0.5) / H;
            for (let xi = x0f; xi <= x1f; xi++) {
                const x = ((xi % W) + W) % W;
                const u = (x + 0.5) / W;
                const p = equirectToDir(u, v);
                const cosC = Math.max(-1, Math.min(1, center.x * p.x + center.y * p.y + center.z * p.z));
                const ang = Math.acos(cosC);
                if (ang >= boundR)
                    continue;
                const sinA = Math.sin(ang);
                let tx = 0;
                let ty = 0;
                let tz = 0;
                if (sinA > 1e-8) {
                    tx = (p.x - center.x * cosC) / sinA;
                    ty = (p.y - center.y * cosC) / sinA;
                    tz = (p.z - center.z * cosC) / sinA;
                }
                const scale = ang / Math.max(angR, 1e-6);
                const lx = (tx * cx + ty * cy + tz * cz) * scale;
                const ly = (tx * e2x + ty * e2y + tz * e2z) * scale;
                const ell = lx * lx + ly * stretch * (ly * stretch);
                if (ell > 1)
                    continue;
                const su = 0.5 + lx * 0.5;
                const sv = 0.5 + ly * stretch * 0.5;
                if (su < 0 || su > 1 || sv < 0 || sv > 1)
                    continue;
                const sx = Math.min(sW - 1, Math.max(0, Math.floor(su * sW)));
                const sy = Math.min(sH - 1, Math.max(0, Math.floor(sv * sH)));
                const si = (sy * sW + sx) * 4;
                // Hard cap: no fully opaque cloud pixels (max 90%)
                const srcA = Math.min(0.9, (sR[si + 3] / 255) * alphaScale);
                if (srcA < 0.008)
                    continue;
                const o = (y * W + x) * 4;
                const blended = compositeCloudStampSample(cloudRgba[o] / 255, cloudRgba[o + 1] / 255, cloudRgba[o + 2] / 255, cloudRgba[o + 3] / 255, sR[si] / 255, sR[si + 1] / 255, sR[si + 2] / 255, srcA, CLOUD_COMPOSITE_LIGHTEN, CLOUD_COMPOSITE_NORMAL);
                cloudRgba[o] = Math.round(blended.r * 255);
                cloudRgba[o + 1] = Math.round(blended.g * 255);
                cloudRgba[o + 2] = Math.round(blended.b * 255);
                // Map-level cap: stacked stamps never reach full opaque
                cloudRgba[o + 3] = Math.round(Math.min(0.9, blended.a) * 255);
            }
        }
    };
    let stamped = 0;
    // ── Phase A: huge-clouds global haze (~60% sphere cover, free overlap) ──
    const hugePool = byCat.get("huge-clouds");
    if (hugePool && hugePool.length) {
        /**
         * Sphere-uniform probe of map alpha — equirect-area mean is pole-biased;
         * we care about true planetary cover for the haze veil.
         */
        const measureHugeCover = () => {
            const N = 384;
            let hit = 0;
            // Fixed lattice in seed stream (deterministic, no extra RNG state)
            for (let i = 0; i < N; i++) {
                const u = (i + 0.5) / N;
                const cosLat = 1 - (2 * (i * 0.6180339887 % 1));
                const lat = Math.asin(Math.max(-1, Math.min(1, cosLat)));
                const v = 0.5 - lat / Math.PI;
                const x = Math.min(W - 1, Math.max(0, Math.floor(u * W)));
                const y = Math.min(H - 1, Math.max(0, Math.floor(v * H)));
                if (cloudRgba[(y * W + x) * 4 + 3] > 12)
                    hit++;
            }
            return hit / N;
        };
        let hugeN = 0;
        // Place until measured cover hits ~60% (overlap freely). Shrink stamp
        // size as we approach the target so the last few don't overshoot.
        while (hugeN < CLOUD_HUGE_MAX_STAMPS) {
            const cur = measureHugeCover();
            if (cur >= CLOUD_HUGE_TARGET_COVER)
                break;
            // Uniform on sphere (not heat-gated — we want broad planetary veil)
            const u0 = rnd();
            const cosLat = rnd() * 2 - 1;
            const lat = Math.asin(Math.max(-1, Math.min(1, cosLat)));
            const v0 = 0.5 - lat / Math.PI;
            const c = equirectToDir(u0, v0);
            const srcIndex = takeFromCat("huge-clouds");
            if (srcIndex == null)
                break;
            const src = sources[srcIndex];
            const gap = CLOUD_HUGE_TARGET_COVER - cur;
            // Really huge while far from target; tiny transparent fillers near end
            let radiusFrac;
            let alphaScale;
            if (gap > 0.22) {
                radiusFrac = 0.5 + rnd() * 0.2;
                alphaScale = 0.05 + rnd() * 0.09;
            }
            else if (gap > 0.1) {
                radiusFrac = 0.34 + rnd() * 0.12;
                alphaScale = 0.045 + rnd() * 0.07;
            }
            else {
                radiusFrac = 0.18 + rnd() * 0.1;
                alphaScale = 0.035 + rnd() * 0.05;
            }
            const stretch = 0.85 + rnd() * 0.35;
            const angR = Math.min(CLOUD_HUGE_ANG_CAP, Math.max(0.2, radiusFrac * Math.PI));
            const boundR = Math.min(CLOUD_HUGE_ANG_CAP * 1.05, angR * 1.05);
            const rot = rnd() * Math.PI * 2;
            rasterStamp(src, u0, { x: c.x, y: c.y, z: c.z }, angR, boundR, stretch, alphaScale, rot);
            hugeN++;
            stamped++;
        }
    }
    const placed = [];
    /**
     * Only same-category stamps are spaced apart — different types may freely
     * overlap (e.g. long streaks over soft decks). Huge already free-overlapped
     * in phase A and is not placed again here.
     */
    const sameCatClearance = (cat, rA, rB) => {
        // Full (rA+rB) so same-type discs barely touch; no cross-type test.
        const mul = cat === "long-and-sharp" ? 1.05 : 1.0;
        return (rA + rB) * mul;
    };
    let cycloneCount = 0;
    // ── Phase B: detail stamps (no huge re-pick; skip if only huge bank) ──
    const hasDetailBank = fallbackCat() != null;
    for (let attemptSlot = 0; hasDetailBank && attemptSlot < nWant; attemptSlot++) {
        // 1) Candidate site (heat map for density; wind boosts stormy cells)
        let u0 = 0.5;
        let v0 = 0.5;
        let cxP = 0;
        let cyP = 1;
        let czP = 0;
        let siteOk = false;
        for (let attempt = 0; attempt < 36; attempt++) {
            u0 = rnd();
            const cosLat = rnd() * 2 - 1;
            const lat = Math.asin(Math.max(-1, Math.min(1, cosLat)));
            v0 = 0.5 - lat / Math.PI;
            const c = equirectToDir(u0, v0);
            const heat = cloudDensityHeat(c.x, c.y, c.z, heatSeed);
            // Slightly higher accept rate so more non-cyclone stamps stick
            let acceptP = clamp01(0.12 + heat * (0.4 + cover * 0.7));
            if (wind) {
                const ws = sampleWindField(wind, u0, v0);
                acceptP = clamp01(acceptP * 0.5 +
                    (ws.speed * 0.4 + ws.vorticity * 0.35) * cover +
                    0.08);
            }
            if (rnd() > acceptP)
                continue;
            cxP = c.x;
            cyP = c.y;
            czP = c.z;
            siteOk = true;
            break;
        }
        if (!siteOk)
            continue;
        // 2) Wind → category policy (detail only — huge is phase A)
        let cat = fallbackCat();
        let freeSpin = false;
        let maxBend = 0.35;
        let windAngle = 0;
        if (wind) {
            const ws = sampleWindField(wind, u0, v0);
            const pick = pickCloudCategoryFromWind(ws);
            cat = pick.category;
            freeSpin = pick.freeSpin;
            maxBend = pick.maxBend;
            windAngle = longStampYawFromWind(ws, pick.maxBend);
            if (pick.suppressLong && cat === "long-and-sharp") {
                cat = byCat.has("unique-shapes") ? "unique-shapes" : fallbackCat();
            }
        }
        else {
            // No land wind: prefer decks/streaks; cyclones rare
            const roll = rnd();
            if (roll < 0.32)
                cat = "spread-out-small-cluster-of-clouds";
            else if (roll < 0.55)
                cat = "long-and-sharp";
            else if (roll < 0.78)
                cat = "mixed";
            else if (roll < 0.95)
                cat = "unique-shapes";
            else
                cat = "cyclones";
            if (!byCat.has(cat) || !byCat.get(cat).length)
                cat = fallbackCat();
        }
        // Huge already laid globally — never re-pick as a detail stamp
        if (cat === "huge-clouds") {
            cat = byCat.has("spread-out-small-cluster-of-clouds")
                ? "spread-out-small-cluster-of-clouds"
                : fallbackCat();
        }
        if (cat === "cyclones") {
            if (cycloneCount >= CLOUD_CYCLONE_MAX) {
                // Spill extra storm slots into non-cyclone types
                const spill = rnd();
                if (spill < 0.4 && byCat.has("mixed"))
                    cat = "mixed";
                else if (spill < 0.7 && byCat.has("spread-out-small-cluster-of-clouds"))
                    cat = "spread-out-small-cluster-of-clouds";
                else if (byCat.has("unique-shapes"))
                    cat = "unique-shapes";
                else
                    cat = fallbackCat();
            }
        }
        if (!cat || !byCat.has(cat) || !byCat.get(cat).length)
            cat = fallbackCat();
        if (!cat || cat === "huge-clouds")
            continue;
        const srcIndex = takeFromCat(cat);
        if (srcIndex == null)
            continue;
        const src = sources[srcIndex];
        // 3) Size / opacity by category (detail — no huge branch)
        const sizeRoll = rnd();
        let radiusFrac;
        let alphaScale = 0.85;
        let stretch = 1;
        // long-and-sharp stay relatively modest; all other ("not sharp") types bigger
        if (cat === "cyclones") {
            if (sizeRoll < 0.3)
                radiusFrac = 0.06 + rnd() * 0.04;
            else if (sizeRoll < 0.8)
                radiusFrac = 0.1 + rnd() * 0.05;
            else
                radiusFrac = 0.14 + rnd() * 0.04;
            alphaScale = 0.78 + rnd() * 0.12;
        }
        else if (cat === "long-and-sharp") {
            // Keep sharp streaks smaller / thinner than soft decks
            if (sizeRoll < 0.4)
                radiusFrac = 0.05 + rnd() * 0.04;
            else
                radiusFrac = 0.085 + rnd() * 0.045;
            stretch = 1.65 + rnd() * 0.55;
            alphaScale = 0.76 + rnd() * 0.14;
        }
        else if (cat === "spread-out-small-cluster-of-clouds") {
            if (sizeRoll < 0.3) {
                radiusFrac = 0.055 + rnd() * 0.05;
                alphaScale = 0.72 + rnd() * 0.16;
            }
            else if (sizeRoll < 0.6) {
                radiusFrac = 0.1 + rnd() * 0.07;
                alphaScale = 0.78 + rnd() * 0.12;
            }
            else if (sizeRoll < 0.82) {
                radiusFrac = 0.16 + rnd() * 0.08;
                alphaScale = 0.82 + rnd() * 0.08;
            }
            else {
                // large soft sheet (still smaller than dedicated huge phase)
                radiusFrac = 0.28 + rnd() * 0.1;
                alphaScale = 0.12 + rnd() * 0.08;
            }
        }
        else {
            // mixed / unique-shapes — bulk soft/feature decks, larger than sharp
            if (sizeRoll < 0.18) {
                radiusFrac = 0.06 + rnd() * 0.045;
                alphaScale = 0.72 + rnd() * 0.16;
            }
            else if (sizeRoll < 0.45) {
                radiusFrac = 0.11 + rnd() * 0.07;
                alphaScale = 0.78 + rnd() * 0.12;
            }
            else if (sizeRoll < 0.8) {
                radiusFrac = 0.18 + rnd() * 0.1;
                alphaScale = 0.82 + rnd() * 0.08;
            }
            else {
                radiusFrac = 0.26 + rnd() * 0.1;
                alphaScale = 0.84 + rnd() * 0.06;
            }
        }
        alphaScale = Math.min(0.9, Math.max(0.06, alphaScale));
        alphaScale *= 1 - rnd() * 0.3;
        const megaHaze = cat === "spread-out-small-cluster-of-clouds" && alphaScale <= 0.15;
        const angCap = megaHaze ? 1.05 : 0.72;
        const angR = Math.min(angCap, Math.max(0.03, radiusFrac * Math.PI));
        const boundR = Math.min(angCap * 1.05, angR * Math.max(1, stretch * 0.55));
        // Same-category separation at chosen site
        {
            let ok = true;
            for (const p of placed) {
                if (p.cat !== cat)
                    continue;
                const d = Math.acos(Math.max(-1, Math.min(1, cxP * p.x + cyP * p.y + czP * p.z)));
                if (d < sameCatClearance(cat, angR, p.r)) {
                    ok = false;
                    break;
                }
            }
            if (!ok)
                continue;
        }
        // Orient: free spin for cyclones/unique; else align to wind (mild bend)
        let rot;
        if (freeSpin || cat === "cyclones") {
            rot = rnd() * Math.PI * 2;
        }
        else if (wind) {
            rot = windAngle + (rnd() * 2 - 1) * Math.min(0.2, maxBend * 0.5);
        }
        else {
            const yawMax = cat === "long-and-sharp" ? 0.28 : 0.55;
            rot = (rnd() * 2 - 1) * yawMax;
        }
        placed.push({
            cat,
            x: cxP,
            y: cyP,
            z: czP,
            r: angR,
        });
        if (cat === "cyclones")
            cycloneCount++;
        rasterStamp(src, u0, { x: cxP, y: cyP, z: czP }, angR, boundR, stretch, alphaScale, rot);
        stamped++;
    }
    return stamped;
}
/**
 * Depress height under lava liquid so normals match bright river albedo.
 * Mutates height in place. Call before heightToNormalMap for lava worlds.
 */
export function carveLavaRiverHeight(height, liquidMask, amount = 0.045) {
    const W = height.width;
    const H = height.height;
    const data = height.data;
    const amt = Math.max(0.01, Math.min(0.12, amount));
    for (let i = 0; i < W * H; i++) {
        const liq = liquidMask[i * 4] / 255;
        if (liq < 0.5)
            continue;
        // Deeper carve for stronger liquid (brighter rivers)
        data[i] = Math.max(0, data[i] - amt * (0.55 + liq * 0.55));
    }
}
export function liquidKindForClass(cls, explicit) {
    if (cls === "gas")
        return "none";
    if (explicit !== "water" && explicit !== "none")
        return explicit;
    if (cls === "exotic")
        return explicit === "none" ? "methane" : explicit;
    if (cls === "rocky")
        return explicit === "none" ? "none" : explicit;
    if (cls === "ice")
        return "water";
    return "water";
}
//# sourceMappingURL=materials.js.map