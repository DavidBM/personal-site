/**
 * Multi-class climate map (Köppen-scale) for land albedo layout.
 *
 * Drivers: temperature (lat + elev), precip/moisture (Hadley + noise + coast),
 * then discrete class → Blue Marble–ish palette. Not a full GCM.
 */
import { fbm3 } from "./noise.js";
/**
 * Hard biome class after FBM partition (intermediate debug — no soft blend).
 * Order is display/legend only; classification uses priority in softBiomeColor.
 */
export const PureBiome = {
    Ocean: 0,
    Beach: 1,
    Grass: 2,
    Forest: 3,
    Deep: 4,
    Desert: 5,
    Gray: 6,
    Tundra: 7,
    Snow: 8,
};
/** Köppen-inspired class ids used in material B channel encoding. */
export const ClimateClass = {
    Af: 0, // tropical rainforest
    Am: 1, // tropical monsoon
    Aw: 2, // tropical savanna
    BWh: 3, // hot desert
    BWk: 4, // cold desert
    BSh: 5, // hot steppe
    BSk: 6, // cold steppe
    Csa: 7, // med hot-summer
    Csb: 8, // med warm-summer
    Cfa: 9, // humid subtropical
    Cfb: 10, // oceanic
    Cfc: 11, // subpolar oceanic
    Dfa: 12, // humid continental hot
    Dfb: 13, // humid continental warm
    Dfc: 14, // subarctic
    ET: 15, // tundra
    EF: 16, // ice cap
    Rock: 17, // high barren rock
    Beach: 18,
};
export const CLIMATE_CLASS_COUNT = 19;
function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}
function smoothstep(e0, e1, x) {
    const t = Math.max(0, Math.min(1, (x - e0) / Math.max(1e-8, e1 - e0)));
    return t * t * (3 - 2 * t);
}
/**
 * Climate drivers at a sphere point.
 */
export function sampleClimateDrivers(x, y, z, elevAboveSea, seed) {
    const absLat = Math.abs(y);
    // Subtropical dry band
    const subtropDry = smoothstep(0.15, 0.28, absLat) * (1 - smoothstep(0.48, 0.65, absLat));
    // cos(φ) = sqrt(1 − sin²φ) ≈ insolation; keeps mid/high lats warmer than
    // linear |y| so boreal forests can exist (Canada/Siberia) before polar ice.
    const cosLat = Math.sqrt(Math.max(0, 1 - absLat * absLat));
    let moisture = fbm3(x * 1.2, y * 0.9, z * 1.2, seed + 500, 5) * 0.5 + 0.5;
    moisture =
        moisture * 0.48 +
            (fbm3(x * 3.8, y * 2.8, z * 3.8, seed + 511, 4) * 0.5 + 0.5) * 0.28 +
            cosLat * 0.12;
    // Stronger subtropical arid provinces (Sahara/Australia scale)
    moisture *= 1 - subtropDry * 0.82;
    // Mid/high-lat wetter continents (taiga moisture, not desert-to-ice)
    moisture = clamp01(moisture +
        smoothstep(0.45, 0.7, absLat) *
            (1 - smoothstep(0.88, 0.97, absLat)) *
            0.14);
    // ITCZ / monsoon pulse near equator (stronger so tropics stay forest-capable)
    const itcz = (1 - smoothstep(0.0, 0.28, absLat)) *
        (0.6 +
            0.4 *
                (fbm3(x * 2.5, y * 0.4, z * 2.5, seed + 530, 3) * 0.5 + 0.5));
    moisture = clamp01(moisture * 0.68 + itcz * 0.42);
    // Coast wetness
    const coastWet = 1 - smoothstep(0.0, 0.2, elevAboveSea);
    moisture = clamp01(moisture * 0.72 + coastWet * 0.3);
    if (elevAboveSea > 0.1) {
        const dry = fbm3(x * 1.8 + 3, y * 1.8, z * 1.8 - 2, seed + 520, 3) * 0.5 + 0.5;
        moisture *= 1 - elevAboveSea * 0.42 * dry;
    }
    moisture = clamp01(moisture);
    // Dual precip proxy (orographic + base moisture)
    const orographic = elevAboveSea * elevAboveSea *
        (fbm3(x * 4.0, y * 2.0, z * 4.0, seed + 540, 3) * 0.5 + 0.5);
    const precip = clamp01(moisture * 0.75 + orographic * 0.35 + itcz * 0.15);
    // Insolation-like temperature (not linear |sin lat| — that iced out ~50°)
    let temperature = cosLat * 0.92 - elevAboveSea * 0.34;
    temperature +=
        (fbm3(x * 1.2, y * 0.6, z * 1.2, seed + 600, 3) * 0.5 - 0.25) * 0.14;
    // Continental seasonality proxy (drier interiors slightly cooler variance)
    temperature -= (1 - coastWet) * 0.03 * absLat;
    temperature = clamp01(temperature);
    return { temperature, moisture, precip };
}
/**
 * Classify into Köppen-scale discrete biome.
 */
export function classifyClimate(temperature, precip, moisture, elevAboveSea, absLat) {
    if (elevAboveSea < 0.028)
        return ClimateClass.Beach;
    // High barren rock only at extreme elev (keep rare — avoids grey ramps)
    if (elevAboveSea > 0.78 && temperature < 0.28 && absLat < 0.7) {
        return ClimateClass.Rock;
    }
    // Ice / tundra — true polar only (class ids; albedo uses softBiomeColor)
    if (absLat > 0.96 || (absLat > 0.9 && temperature < 0.14)) {
        return ClimateClass.EF;
    }
    if (absLat > 0.82 && temperature < 0.28) {
        return ClimateClass.ET;
    }
    // Arid / semi-arid (B) — wide subtropical dry belts (beauty aridFrac ≥ 0.08)
    const aridThresh = 0.38 + temperature * 0.14;
    if (precip < aridThresh * 0.62 && temperature > 0.28) {
        if (temperature > 0.5)
            return ClimateClass.BWh;
        return ClimateClass.BWk;
    }
    if (precip < aridThresh * 1.05 && temperature > 0.24) {
        if (temperature > 0.44)
            return ClimateClass.BSh;
        return ClimateClass.BSk;
    }
    // Tropical (A)
    if (temperature > 0.68 && absLat < 0.35) {
        if (precip > 0.68 && moisture > 0.6)
            return ClimateClass.Af;
        if (precip > 0.5)
            return ClimateClass.Am;
        return ClimateClass.Aw;
    }
    // Cold continental (D) — mid/high lat, not polar ice
    if (temperature < 0.4 && absLat > 0.35) {
        if (temperature < 0.26)
            return ClimateClass.Dfc;
        if (precip > 0.48)
            return ClimateClass.Dfb;
        return ClimateClass.Dfa;
    }
    // Temperate (C)
    const medDry = temperature > 0.48 &&
        moisture < 0.48 &&
        precip < 0.55 &&
        absLat > 0.22 &&
        absLat < 0.55;
    if (medDry) {
        return temperature > 0.58 ? ClimateClass.Csa : ClimateClass.Csb;
    }
    if (temperature > 0.52 && precip > 0.45)
        return ClimateClass.Cfa;
    if (temperature > 0.36 && precip > 0.38)
        return ClimateClass.Cfb;
    return ClimateClass.Cfc;
}
function lerpRgb(a, b, t) {
    const u = clamp01(t);
    return {
        r: a.r + (b.r - a.r) * u,
        g: a.g + (b.g - a.g) * u,
        b: a.b + (b.b - a.b) * u,
    };
}
/**
 * Map climate class → RGB using surface palette stops.
 */
export function climateClassColor(cls, pal, elev) {
    switch (cls) {
        case ClimateClass.Beach:
            return { ...pal.beach };
        case ClimateClass.Af:
            return lerpRgb(pal.forestDeep, pal.forest, 0.25);
        case ClimateClass.Am:
            return lerpRgb(pal.forest, pal.forestDeep, 0.35);
        case ClimateClass.Aw:
            return lerpRgb(pal.grassland, pal.forest, 0.35);
        case ClimateClass.BWh:
            return lerpRgb(pal.arid, pal.aridHot, 0.75);
        case ClimateClass.BWk:
            return lerpRgb(pal.arid, pal.aridHot, 0.25);
        case ClimateClass.BSh:
            return lerpRgb(pal.arid, pal.aridHot, 0.35);
        case ClimateClass.BSk:
            return lerpRgb(pal.arid, pal.grassland, 0.35);
        case ClimateClass.Csa:
            return lerpRgb(pal.grassland, pal.arid, 0.35);
        case ClimateClass.Csb:
            return lerpRgb(pal.grassland, pal.lowland, 0.4);
        case ClimateClass.Cfa:
            return lerpRgb(pal.forest, pal.grassland, 0.45);
        case ClimateClass.Cfb:
            return lerpRgb(pal.lowland, pal.forest, 0.55);
        case ClimateClass.Cfc:
            return lerpRgb(pal.tundra, pal.lowland, 0.4);
        case ClimateClass.Dfa:
            return lerpRgb(pal.grassland, pal.forest, 0.3);
        case ClimateClass.Dfb:
            // Humid continental / mixed forest — not hard tundra cut
            return lerpRgb(pal.forest, pal.lowland, 0.4);
        case ClimateClass.Dfc:
            // Boreal taiga — dark olive forest, not bare rock
            return lerpRgb(pal.forestDeep, pal.tundra, 0.35);
        case ClimateClass.ET:
            // Soft tundra moss/olive (Blue Marble high-lat land)
            return lerpRgb(pal.tundra, pal.grassland, 0.35);
        case ClimateClass.EF:
            // Soft ice blue-white (not a hard grey disk)
            return lerpRgb(pal.snow, { r: 0.72, g: 0.82, b: 0.9 }, 0.35);
        case ClimateClass.Rock:
            // Warm brown rock, not grey
            return lerpRgb(pal.mountain, pal.arid, 0.35 + elev * 0.1);
        default:
            return { ...pal.lowland };
    }
}
/**
 * Soft continuous biome albedo (Blue Marble–style).
 * Blends forest / grass / arid / boreal / tundra / snow with wide lat & climate
 * falloffs — no hard Köppen class edges or razor polar rings.
 */
/**
 * Map absLat ice threshold toward the pole when poleIceScale < 1.
 * scale=1 → unchanged; scale→0 → thresholds → 1 (ice only at true pole).
 */
export function scalePoleLatThresh(thresh, poleIceScale) {
    const s = poleIceScale < 0.004 ? 0.004 : poleIceScale > 2 ? 2 : poleIceScale;
    return 1 - (1 - thresh) * s;
}
export function softBiomeColor(pal, elev, absLat, temperature, moisture, precip, x, y, z, seed, 
/** Relative polar ice footprint (1 = default; from poleIceExtentScale). */
poleIceScale = 1) {
    const pScale = poleIceScale < 0.004 ? 0.004 : poleIceScale > 2 ? 2 : poleIceScale;
    // ── Gas-style domain warp (before biome/color) ─────────────────────────
    // LF sphere warp so climate belts bend off pure latitude lines; poles held.
    const poleHold0 = smoothstep(0.62, 0.9, absLat);
    const warpAmt = 0.28 * (1 - poleHold0 * 0.95);
    const wx = (fbm3(x * 0.32, y * 0.18, z * 0.32, seed + 640, 3) * 2 - 1) * warpAmt;
    const wy = (fbm3(x * 0.32 + 2.4, y * 0.18, z * 0.32, seed + 641, 3) * 2 - 1) *
        warpAmt *
        0.55;
    const wz = (fbm3(x * 0.32 - 1.7, y * 0.18, z * 0.32, seed + 642, 3) * 2 - 1) *
        warpAmt;
    let px = x + wx;
    let py = y + wy;
    let pz = z + wz;
    {
        const len = Math.hypot(px, py, pz) || 1;
        px /= len;
        py /= len;
        pz /= len;
    }
    // All province noise samples warped domain; lat uses warped |y|
    const absLatW = Math.abs(py);
    const poleHold = smoothstep(0.62, 0.9, absLatW);
    // Extra LF lat scatter on top of domain warp (big biomes, not fleck)
    const latBig = (fbm3(px * 0.18, py * 0.1, pz * 0.18, seed + 680, 3) * 2 - 1) * 0.2 +
        (fbm3(px * 0.4 + 2.1, py * 0.14, pz * 0.4, seed + 690, 3) * 2 - 1) * 0.12;
    const lat = clamp01(absLatW + latBig * (1 - poleHold * 0.96));
    const edgeNoise = fbm3(px * 2.0, py * 0.85, pz * 2.0, seed + 731, 3) * 0.5 + 0.5;
    // Continent-scale provinces on warped domain
    const vegProv = smoothstep(0.34, 0.64, fbm3(px * 0.2, py * 0.11, pz * 0.2, seed + 820, 4) * 0.5 + 0.5) *
        (0.4 + 0.6 * smoothstep(0.15, 0.5, moisture)) *
        (1 - smoothstep(0.8, 0.97, lat));
    const forestBlob = smoothstep(0.38, 0.7, fbm3(px * 0.45 + 3, py * 0.16, pz * 0.45, seed + 830, 3) * 0.5 + 0.5) *
        (0.45 + 0.55 * smoothstep(0.2, 0.55, moisture)) *
        (0.5 + 0.5 * edgeNoise);
    // Gray highland / barren rock provinces (third land color — elev + LF)
    const grayLobe = smoothstep(0.38, 0.68, fbm3(px * 0.24 - 2, py * 0.12, pz * 0.24, seed + 870, 3) * 0.5 + 0.5) *
        (0.25 + 0.75 * smoothstep(0.12, 0.48, elev)) *
        (1 - smoothstep(0.78, 0.95, lat));
    // Arid provinces — minority dry lobes (~8–12% of land). Sphere LF FBM is
    // low-contrast; mid-freq mix + range-matched threshold (same lesson as rock).
    const aridRaw = fbm3(px * 0.35 + 5, py * 0.14, pz * 0.35, seed + 850, 4) * 0.5 + 0.5;
    const aridRaw2 = fbm3(px * 0.9 - 3, py * 0.3, pz * 0.9, seed + 851, 3) * 0.5 + 0.5;
    const aridMix = aridRaw * 0.6 + aridRaw2 * 0.4;
    // Desert provinces with *wide* soft falloff (not a hard sand cliff into forest).
    // smoothstep span ~0.08 → soft Sahel-style fringes on pure + product paint.
    const aridLobe = smoothstep(0.54, 0.62, aridMix) *
        (1 - vegProv * 0.35) *
        (1 - smoothstep(0.55, 0.82, lat)) *
        // Prefer subtropical / warm mid-lats (Sahara-ish belt, not full tropics wipe)
        (0.35 +
            0.65 *
                smoothstep(0.05, 0.28, lat) *
                (1 - smoothstep(0.42, 0.65, lat)));
    // Moisture: green majority; dry lobes open desert; elev for gray
    const moistEff = clamp01(moisture * 0.65 +
        0.12 +
        (fbm3(px * 0.26, py * 0.13, pz * 0.26, seed + 840, 3) * 2 - 1) * 0.18 +
        vegProv * 0.15 -
        aridLobe * 0.4 -
        grayLobe * 0.08);
    const tempEff = clamp01(temperature +
        (fbm3(px * 0.24 - 1.4, py * 0.11, pz * 0.24, seed + 860, 3) * 2 - 1) *
            0.12 *
            (1 - poleHold));
    // Arid: province lobes + soft subtropical hint (deserts co-exist with green)
    const aridProv = smoothstep(0.42, 0.72, fbm3(px * 0.24, py * 0.12, pz * 0.24, seed + 800, 3) * 0.5 + 0.5) *
        smoothstep(0.28, 0.72, tempEff) *
        (1 - smoothstep(0.7, 0.92, lat)) *
        (1 - moistEff * 0.7) *
        (1 - vegProv * 0.45) *
        (0.5 + 0.5 * aridLobe);
    const aridBelt = smoothstep(0.08, 0.34, lat) *
        (1 - smoothstep(0.4, 0.62, lat)) *
        (1 - smoothstep(0.35, 0.65, moistEff)) *
        (1 - vegProv * 0.4) *
        0.55;
    const aridHot = clamp01(aridBelt * 0.5 + aridProv * 0.75 + aridLobe * 0.55) *
        smoothstep(0.4, 0.85, tempEff) *
        (1 - elev * 0.22) *
        (1 - forestBlob * 0.4) *
        (1 - moistEff * 0.35);
    const aridCool = clamp01(aridBelt * 0.35 + aridProv * 0.45) *
        (1 - smoothstep(0.4, 0.72, tempEff)) *
        (1 - moistEff * 0.45);
    // Visible desert minority (dry lobes read as tan/sand, not wiped by green)
    const aridW0 = clamp01(aridHot + aridCool + aridLobe * 0.45) * 0.95;
    // Gray highland / rock cores (third color — coexists with green + desert)
    const plateau = smoothstep(0.28, 0.62, elev) *
        smoothstep(0.38, 0.68, fbm3(px * 0.4 + 4, py * 0.2, pz * 0.4, seed + 810, 3) * 0.5 + 0.5) *
        (1 - smoothstep(0.8, 0.96, lat)) *
        (0.4 + 0.6 * grayLobe) *
        (0.5 + 0.5 * (1 - moistEff));
    // Open grassland lobe (LF) — large plains that are NOT forest
    const openLobe = smoothstep(0.4, 0.7, fbm3(px * 0.22 + 7, py * 0.12, pz * 0.22, seed + 880, 3) * 0.5 + 0.5) *
        (1 - forestBlob * 0.65) *
        (1 - smoothstep(0.72, 0.92, lat));
    // Canopy / deep-forest lobe (wet + LF)
    const canopyLobe = smoothstep(0.42, 0.72, fbm3(px * 0.28 - 3, py * 0.14, pz * 0.28, seed + 890, 3) * 0.5 + 0.5) *
        smoothstep(0.28, 0.62, moistEff) *
        (0.4 + 0.6 * forestBlob);
    // Forests — exclusive vs open grass (no universal forest floor)
    const forestTrop = smoothstep(0.18, 0.48, moistEff) *
        smoothstep(0.26, 0.72, tempEff) *
        (1 - smoothstep(0.5, 0.8, lat)) *
        (1 - smoothstep(0.55, 0.92, elev)) *
        (1 - aridW0 * 0.75) *
        (1 - plateau * 0.4) *
        (1 - openLobe * 0.85) *
        (0.25 + 0.5 * vegProv + 0.55 * forestBlob + 0.45 * canopyLobe);
    const forestTemp = smoothstep(0.15, 0.5, moistEff) *
        smoothstep(0.16, 0.7, tempEff) *
        (1 - smoothstep(0.68, 0.92, lat)) *
        (1 - aridW0 * 0.7) *
        (1 - plateau * 0.35) *
        (1 - openLobe * 0.8) *
        (0.25 + 0.45 * vegProv + 0.5 * forestBlob + 0.35 * canopyLobe);
    // Boreal / taiga — stop before polar ice
    const boreal = smoothstep(0.35, 0.58, lat) *
        (1 - smoothstep(0.8, 0.94, lat)) *
        smoothstep(0.12, 0.48, moistEff) *
        (1 - smoothstep(0.5, 0.85, elev)) *
        smoothstep(0.06, 0.48, tempEff) *
        (0.5 + 0.5 * edgeNoise) *
        (1 - aridW0 * 0.55) *
        (1 - plateau * 0.3) *
        (1 - openLobe * 0.5) *
        (0.55 + 0.3 * vegProv + 0.25 * canopyLobe);
    // Open grass / lowland green — large share, not wiped by forest
    const grass = smoothstep(0.1, 0.55, moistEff) *
        smoothstep(0.18, 0.8, tempEff) *
        (1 - forestTrop * 0.35) *
        (1 - forestTemp * 0.3) *
        (1 - boreal * 0.35) *
        (1 - canopyLobe * 0.75) *
        (1 - aridW0 * 0.7) *
        (1 - plateau * 0.45) *
        (1 - smoothstep(0.75, 0.94, lat)) *
        (0.4 + 0.7 * openLobe + 0.25 * (1 - forestBlob));
    // Tundra before ice — short soft belt just below the polar cap
    const tundra = smoothstep(scalePoleLatThresh(0.78, pScale), scalePoleLatThresh(0.88, pScale), absLat) *
        (1 - smoothstep(scalePoleLatThresh(0.93, pScale), scalePoleLatThresh(0.995, pScale), absLat)) *
        (1 - boreal * 0.75) *
        (1 - smoothstep(0.55, 0.88, elev) * 0.2);
    // Polar ice: solid 100% snow core + short soft gradient (not a full-cap fade).
    // iceSolid → 1 near poles so paint can replace land color completely.
    const iceWarp = Math.min(1, pScale); // small caps: less mid-lat warble
    const iceN1 = fbm3(x * 1.15, y * 0.32, z * 1.15, seed + 901, 5) * 0.5 + 0.5;
    const iceN2 = fbm3(x * 2.9 + 4, y * 0.55, z * 2.9, seed + 911, 4) * 0.5 + 0.5;
    const iceN3 = fbm3(x * 5.5 - 2, y * 0.9, z * 5.5, seed + 921, 3) * 0.5 + 0.5;
    // Mild edge warble only (keep solid core compact and white)
    const iceLat = clamp01(absLat +
        (iceN1 * 2 - 1) * 0.035 * iceWarp +
        (iceN2 * 2 - 1) * 0.02 * iceWarp +
        (iceN3 * 2 - 1) * 0.01 * iceWarp);
    const iceLobe = smoothstep(0.28, 0.62, iceN1 * 0.5 + iceN2 * 0.35 + iceN3 * 0.15);
    // Solid white cap: short ramp into full ice (was a long partial-blend fade)
    const iceSolid = smoothstep(scalePoleLatThresh(0.905, pScale), scalePoleLatThresh(0.955, pScale), iceLat);
    // Short soft fringe just equatorward of solid (narrower than old 0.74→0.97 band)
    const iceFringe = clamp01(smoothstep(scalePoleLatThresh(0.84, pScale), scalePoleLatThresh(0.92, pScale), iceLat) *
        (1 - iceSolid) *
        (0.55 + 0.45 * iceLobe) *
        (0.55 + 0.45 * (1 - temperature)));
    const iceCap = clamp01(iceSolid + iceFringe * 0.92);
    const alpine = smoothstep(0.55, 0.88, elev) *
        (1 - smoothstep(0.28, 0.55, temperature)) *
        (1 - smoothstep(0.88, 0.99, absLat) * 0.4) *
        0.45 +
        plateau * 0.55;
    // snowW = 1 in solid core; fringe partial; alpine residual
    const snowW = clamp01(iceSolid + (1 - iceSolid) * (iceFringe * 0.88 + alpine * 0.5));
    // Kill vegetation under solid ice + fringe
    const vegKill = 1 - clamp01(iceSolid * 1.0 + snowW * 0.9 + iceCap * 0.25);
    // Beach strip (thin)
    const beachW = 1 - smoothstep(0.0, 0.035, elev);
    // Soft multi-class land: grassland base + forest *patches* (not exclusive sectors).
    // Longitude pie-slices made whole continents pure grass OR pure forest; Earth-like
    // needs both on the same landmass — open lowland sea with mid-scale canopy islands.
    // Note: continuous forestTrop/grass fields are weak under product moisture; patch
    // noise is the primary driver so both classes always appear.
    const landAlive = vegKill * (1 - snowW);
    // Mid-freq forest patch field (continent interior blobs, not lat belts).
    // Sphere LF FBM is low-contrast; stretch + mid-freq mix so grassland plains and
    // forest islands interleave on the same landmass (not exclusive longitude sectors).
    const patchN = fbm3(px * 0.7 + 1.3, py * 0.28, pz * 0.7, seed + 900, 4) * 0.5 + 0.5;
    const patchN2 = fbm3(px * 1.9 - 2.1, py * 0.55, pz * 1.9, seed + 910, 3) * 0.5 + 0.5;
    const patchN3 = fbm3(px * 3.4 + 0.7, py * 0.9, pz * 3.4, seed + 920, 3) * 0.5 + 0.5;
    const patchRaw = patchN * 0.42 + patchN2 * 0.36 + patchN3 * 0.22;
    // Map typical sphere range ~0.2…0.55 → 0…1 with headroom
    const patch01 = clamp01((patchRaw - 0.22) / 0.3);
    // Grassland-majority plains (~55%) with mid-forest islands (~28%) and deep cores (~15%)
    const forestPatch = smoothstep(0.58, 0.82, patch01);
    // Peaks only — mid forest fills the rest of the island
    const deepCore = smoothstep(0.72, 0.9, patch01) * forestPatch;
    // Mild climate modulation — boost ≥1 in cores so deep can reach pure forestDeep
    // (a sub-1 ceiling mixed residual grass into every canopy pixel).
    const forestBoost = clamp01(0.92 +
        forestBlob * 0.12 +
        canopyLobe * 0.08 +
        forestTrop * 0.05 +
        forestTemp * 0.08 +
        boreal * 0.05);
    // Soft densities 0..1 — patch-primary so grass + forest always coexist
    // Soften (not kill) canopy inside arid lobes so desert–forest fringes mix
    let forestDensity = clamp01(forestPatch *
        forestBoost *
        (1 - openLobe * 0.15) *
        (1 - aridW0 * 0.55) *
        (1 - aridLobe * 0.55) *
        (1 - plateau * 0.3) *
        (1 - smoothstep(0.78, 0.96, lat) * 0.45));
    // Sharpen deep so cores hit the pure forestDeep stop (not muddy mid-forest)
    let deepDensity = clamp01(smoothstep(0.25, 0.75, deepCore *
        (0.9 + 0.1 * canopyLobe) *
        (1 - openLobe * 0.12) *
        (1 - aridW0 * 0.45)));
    deepDensity = Math.min(deepDensity, forestDensity);
    // Desert / gray soft overlays — minority dry + highland islands.
    // desertPri driven mainly by aridLobe (aridW0 alone rarely clears thresholds).
    const desertPri = clamp01(aridLobe * 1.15 + aridW0 * 0.5 + aridLobe * aridW0 * 0.35);
    const rockRaw = fbm3(px * 0.55 + 6.2, py * 0.2, pz * 0.55, seed + 875, 4) * 0.5 + 0.5;
    const rockRaw2 = fbm3(px * 1.3 - 1.1, py * 0.4, pz * 1.3, seed + 876, 3) * 0.5 + 0.5;
    const rockMix = rockRaw * 0.65 + rockRaw2 * 0.35;
    // Top ~12–18% of rockMix → stone islands; elev gate trims coasts
    const rockLobe = smoothstep(0.44, 0.52, rockMix) *
        smoothstep(0.12, 0.36, elev) *
        (1 - smoothstep(0.7, 0.92, lat)) *
        (0.5 + 0.5 * (1 - moistEff));
    const grayPri = clamp01(grayLobe * 0.35 + plateau * 0.35 + rockLobe * 1.05) *
        (1 - desertPri * 0.35) *
        smoothstep(0.12, 0.38, elev);
    // Soft desert amount: wide falloff, never full landAlive wipe (keeps green fringe)
    const aDesert = landAlive *
        (desertPri > 0.16 ? smoothstep(0.16, 0.72, desertPri) : 0) *
        0.78;
    const aGray = landAlive *
        (grayPri > 0.38 ? smoothstep(0.38, 0.65, grayPri) : 0) *
        (1 - aDesert * 0.65 / Math.max(landAlive, 1e-6)) *
        0.92;
    // Keep vegetation underpaint under partial desert (Sahel / scrub transition)
    const vegLand = Math.max(0, landAlive * (1 - aDesert * 0.55) - aGray * 0.85);
    // Partition weights (sum ≈ 1): grass | mid forest | deep — exclusive soft classes
    // so each stop paints pure (no sequential-lerp mud that collapses deep→forest).
    const wDeep = deepDensity;
    const wForest = Math.max(0, forestDensity - deepDensity);
    const wGrass = Math.max(0, 1 - forestDensity);
    const wSum = Math.max(1e-6, wDeep + wForest + wGrass);
    const aDeep = vegLand * (wDeep / wSum);
    const aForest = vegLand * (wForest / wSum);
    const aGrass = vegLand * (wGrass / wSum);
    let col = { ...pal.lowland };
    col = lerpRgb(col, { r: 0.88, g: 0.91, b: 0.94 }, snowW * 0.2);
    // Pure weighted mix of the three green stops (coexist on same landmass)
    col = {
        r: col.r * (1 - vegLand) +
            (pal.grassland.r * aGrass + pal.forest.r * aForest + pal.forestDeep.r * aDeep),
        g: col.g * (1 - vegLand) +
            (pal.grassland.g * aGrass + pal.forest.g * aForest + pal.forestDeep.g * aDeep),
        b: col.b * (1 - vegLand) +
            (pal.grassland.b * aGrass + pal.forest.b * aForest + pal.forestDeep.b * aDeep),
    };
    // Desert: muted sand over green base; hot core only where aDesert is strong
    // Edge fringe: partial desert × remaining green → soft steppe, not sand cliff
    const desertEdge = aDesert * (1 - aDesert);
    col = lerpRgb(col, pal.grassland, desertEdge * 0.45);
    col = lerpRgb(col, pal.arid, aDesert * 0.82);
    col = lerpRgb(col, pal.aridHot, aDesert * aDesert * 0.28);
    col = lerpRgb(col, pal.mountain, aGray * 0.85);
    col = lerpRgb(col, pal.rockDark, aGray * 0.3);
    col = lerpRgb(col, pal.highland, aGray * 0.25);
    const peak = (w) => Math.pow(clamp01(w), 1.65);
    // Soft tundra only where ice is still weak
    col = lerpRgb(col, pal.tundra, clamp01(peak(tundra) * vegKill) * 0.62);
    // Snow paint: solid core → full snow; fringe → short soft gradient.
    // iceSolid drives complete white (not partial *0.58 mixes that never hit 100%).
    col = lerpRgb(col, pal.tundra, clamp01(iceFringe * (1 - iceSolid) * 0.75 + snowW * (1 - snowW) * 1.2 * 0.35));
    col = lerpRgb(col, pal.snow, clamp01(iceSolid * 1.0 + iceFringe * 0.72));
    col = lerpRgb(col, { r: 0.94, g: 0.97, b: 1.0 }, clamp01(iceSolid * 0.55 + iceFringe * 0.2));
    col = lerpRgb(col, pal.beach, peak(beachW) * 0.92 * vegKill);
    // Extra mountain rock on high elev + rock lobes (stone reads on product albedo)
    if (snowW < 0.4 && absLat < 0.78) {
        const peakRock = smoothstep(0.5, 0.88, elev) * 0.32 * (1 - aridW0 * 0.3) +
            rockLobe * 0.7 +
            aGray * 0.45;
        col = lerpRgb(col, pal.mountain, clamp01(peakRock) * (1 - snowW));
        col = lerpRgb(col, pal.rockDark, clamp01(rockLobe * 0.45 + aGray * 0.3) * (1 - snowW));
    }
    // Hard class for intermediate debug maps — density fields + minority rock/desert.
    // Rock before forest so highland stone islands punch through canopy patches.
    // Target ~10–15% rock of land, not zero and not continent fill.
    let pureClass = PureBiome.Grass;
    if (iceSolid > 0.55) {
        pureClass = PureBiome.Snow;
    }
    else if (beachW > 0.55) {
        pureClass = PureBiome.Beach;
    }
    else if (tundra * vegKill > 0.5 && snowW < 0.4) {
        pureClass = PureBiome.Tundra;
    }
    else if (desertPri > 0.36 || aridLobe > 0.42) {
        pureClass = PureBiome.Desert;
    }
    else if (rockLobe > 0.42 || (grayPri > 0.42 && elev > 0.25)) {
        pureClass = PureBiome.Gray;
    }
    else if (deepDensity > 0.42) {
        pureClass = PureBiome.Deep;
    }
    else if (forestDensity > 0.38) {
        pureClass = PureBiome.Forest;
    }
    else {
        pureClass = PureBiome.Grass;
    }
    return {
        col,
        snowW,
        aridW: clamp01(aDesert),
        forestW: clamp01(aForest + aDeep),
        pureClass,
    };
}
/** Diagnostic flat colors for pure biome split map (not product albedo). */
export const PURE_BIOME_DEBUG_RGB = {
    [PureBiome.Ocean]: { r: 0.08, g: 0.22, b: 0.55 },
    [PureBiome.Beach]: { r: 0.92, g: 0.82, b: 0.45 },
    [PureBiome.Grass]: { r: 0.35, g: 0.85, b: 0.25 },
    [PureBiome.Forest]: { r: 0.12, g: 0.52, b: 0.18 },
    [PureBiome.Deep]: { r: 0.04, g: 0.22, b: 0.1 },
    [PureBiome.Desert]: { r: 0.78, g: 0.62, b: 0.4 },
    [PureBiome.Gray]: { r: 0.55, g: 0.55, b: 0.58 },
    [PureBiome.Tundra]: { r: 0.55, g: 0.62, b: 0.7 },
    [PureBiome.Snow]: { r: 0.95, g: 0.97, b: 1.0 },
};
export const PURE_BIOME_LABELS = {
    [PureBiome.Ocean]: "ocean",
    [PureBiome.Beach]: "beach",
    [PureBiome.Grass]: "grass / lowland",
    [PureBiome.Forest]: "forest",
    [PureBiome.Deep]: "forest deep",
    [PureBiome.Desert]: "desert",
    [PureBiome.Gray]: "gray / rock",
    [PureBiome.Tundra]: "tundra",
    [PureBiome.Snow]: "snow",
};
/**
 * Pure biome class map after FBM/domain-warp partition — hard class colors only
 * (no soft blend, grain, stamps, clouds). For intermediate debug UI.
 *
 * @param heightRgba equirect height as grayscale R (A unused)
 * @param maxWidth cap output width (default 1024) for interactive speed
 */
export function renderPureBiomeSplitMap(heightRgba, width, height, seaLevel, seed, poleIceScale = 1, maxWidth = 1024) {
    const scale = width > maxWidth ? maxWidth / width : 1;
    const W = Math.max(1, Math.floor(width * scale));
    const H = Math.max(1, Math.floor(height * scale));
    const rgba = new Uint8ClampedArray(W * H * 4);
    const sea = Math.max(0, Math.min(1, seaLevel));
    const counts = {};
    // Dummy palette — only pureClass is used
    const pal = {
        beach: { r: 0, g: 0, b: 0 },
        arid: { r: 0, g: 0, b: 0 },
        aridHot: { r: 0, g: 0, b: 0 },
        grassland: { r: 0, g: 0, b: 0 },
        forest: { r: 0, g: 0, b: 0 },
        forestDeep: { r: 0, g: 0, b: 0 },
        lowland: { r: 0, g: 0, b: 0 },
        highland: { r: 0, g: 0, b: 0 },
        mountain: { r: 0, g: 0, b: 0 },
        rockDark: { r: 0, g: 0, b: 0 },
        snow: { r: 0, g: 0, b: 0 },
        tundra: { r: 0, g: 0, b: 0 },
    };
    for (let y = 0; y < H; y++) {
        const srcY = Math.min(height - 1, Math.floor((y + 0.5) * (height / H)));
        for (let x = 0; x < W; x++) {
            const srcX = Math.min(width - 1, Math.floor((x + 0.5) * (width / W)));
            const si = (srcY * width + srcX) * 4;
            const h = (heightRgba[si] ?? 0) / 255;
            const u = (x + 0.5) / W;
            const v = (y + 0.5) / H;
            // equirect → unit dir (inline to avoid sphere-map cycle)
            const lon = (u - 0.5) * Math.PI * 2;
            const lat = (0.5 - v) * Math.PI;
            const cosLat = Math.cos(lat);
            const px = cosLat * Math.cos(lon);
            const py = Math.sin(lat);
            const pz = cosLat * Math.sin(lon);
            let cls;
            if (h <= sea) {
                cls = PureBiome.Ocean;
            }
            else {
                const elev = sea >= 0.999 ? h : (h - sea) / Math.max(1e-4, 1 - sea);
                const elevC = clamp01(elev);
                const drivers = sampleClimateDrivers(px, py, pz, elevC, seed);
                const soft = softBiomeColor(pal, elevC, Math.abs(py), drivers.temperature, drivers.moisture, drivers.precip, px, py, pz, seed, poleIceScale);
                cls = soft.pureClass;
            }
            counts[cls] = (counts[cls] ?? 0) + 1;
            const c = PURE_BIOME_DEBUG_RGB[cls];
            const o = (y * W + x) * 4;
            rgba[o] = Math.round(c.r * 255);
            rgba[o + 1] = Math.round(c.g * 255);
            rgba[o + 2] = Math.round(c.b * 255);
            rgba[o + 3] = 255;
        }
    }
    return { width: W, height: H, rgba, counts };
}
/**
 * Material id-ish for liquid mask B from climate class.
 */
export function climateClassMatId(cls) {
    if (cls === ClimateClass.Beach)
        return 5;
    if (cls === ClimateClass.EF || cls === ClimateClass.ET)
        return 9;
    if (cls === ClimateClass.BWh || cls === ClimateClass.BWk)
        return 11;
    if (cls === ClimateClass.Af || cls === ClimateClass.Am || cls === ClimateClass.Cfa)
        return 12;
    if (cls === ClimateClass.Rock)
        return 8;
    return 6;
}
//# sourceMappingURL=climate.js.map