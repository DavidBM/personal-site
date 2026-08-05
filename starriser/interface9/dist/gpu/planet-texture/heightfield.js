/**
 * Hierarchical multi-field PLANET height (not a local terrain patch).
 *
 * Scale hierarchy (research-backed planet-map practice):
 *   plates → continents → continental shelf/basin → orogeny masks →
 *   mountain-chain ridged ranges → foothills → dense peak noise →
 *   micro-relief → ocean trenches / abyssal plains
 *
 * Continents stay low-frequency; dense peaks use independent HIGH-frequency
 * ridged fields masked to land so tens of thousands of local maxima appear
 * at 2K without destroying basin structure.
 *
 * All samples are 3D noise on the unit sphere → equirect U-wrap continuous.
 */
import { ridged3, warpedFbm3, fbm3, valueNoise3 } from "./noise.js";
import { equirectToDir } from "./sphere-map.js";
import { buildPlanetStructure, } from "./structure.js";
import { sampleOceanBathymetry3d, oceanHeightFromShallow, polarSafeShelfCue, } from "./ocean-bathymetry.js";
/**
 * Full planetary composition depth. Count = sum(octaves).
 * Includes warp-vector fields, climate-side fields sampled in materials, and
 * post-erosion peak re-injection fields (same module family).
 */
export const PLANET_HEIGHT_LAYER_STACK = Object.freeze([
    // --- Macro structure ---
    { name: "plate_primary", octaves: 3, freqHint: 0.22 },
    { name: "plate_secondary", octaves: 3, freqHint: 0.35 },
    { name: "continent_core", octaves: 4, freqHint: 0.55 },
    { name: "continent_warp_x", octaves: 3, freqHint: 0.4 },
    { name: "continent_warp_y", octaves: 3, freqHint: 0.4 },
    { name: "continent_warp_z", octaves: 3, freqHint: 0.4 },
    { name: "archipelago", octaves: 4, freqHint: 1.1 },
    { name: "craton_shield", octaves: 3, freqHint: 0.7 },
    // --- Shelf / bathymetry ---
    { name: "shelf_mask", octaves: 3, freqHint: 0.9 },
    { name: "abyssal_plain", octaves: 5, freqHint: 1.4 },
    { name: "ocean_ridge", octaves: 4, freqHint: 2.2 },
    { name: "trench", octaves: 3, freqHint: 3.5 },
    { name: "seamount", octaves: 5, freqHint: 8.0 },
    // --- Orogeny / chains ---
    { name: "orogeny_mask_a", octaves: 4, freqHint: 1.8 },
    { name: "orogeny_mask_b", octaves: 4, freqHint: 2.6 },
    { name: "range_ridged_primary", octaves: 6, freqHint: 4.5 },
    { name: "range_ridged_secondary", octaves: 5, freqHint: 7.0 },
    { name: "foothills", octaves: 5, freqHint: 9.0 },
    // --- Dense peaks (planet density driver) ---
    { name: "dense_peaks_a", octaves: 8, freqHint: 22 },
    { name: "dense_peaks_b", octaves: 7, freqHint: 36 },
    { name: "dense_peaks_c", octaves: 6, freqHint: 52 },
    { name: "volcanic_cones", octaves: 5, freqHint: 18 },
    // --- Micro ---
    { name: "hills", octaves: 5, freqHint: 12 },
    { name: "micro_relief", octaves: 6, freqHint: 48 },
    { name: "micro_ridges", octaves: 4, freqHint: 64 },
    { name: "erosion_carve_noise", octaves: 3, freqHint: 14 },
    // --- Climate / materials companion fields (sampled at paint; same sphere) ---
    { name: "moisture_macro", octaves: 5, freqHint: 1.4 },
    { name: "moisture_fine", octaves: 3, freqHint: 4.2 },
    { name: "temperature_mod", octaves: 2, freqHint: 1.5 },
    { name: "albedo_fleck_a", octaves: 3, freqHint: 22 },
    { name: "albedo_fleck_b", octaves: 2, freqHint: 48 },
    { name: "albedo_fleck_c", octaves: 2, freqHint: 14 },
    // --- Post-erosion peak reinjection ---
    { name: "peak_reinject_a", octaves: 6, freqHint: 28 },
    { name: "peak_reinject_b", octaves: 5, freqHint: 44 },
]);
export function allocateHeightMap(width, height) {
    return { width, height, data: new Float32Array(width * height) };
}
function smoothstep(e0, e1, x) {
    const t = Math.max(0, Math.min(1, (x - e0) / Math.max(1e-8, e1 - e0)));
    return t * t * (3 - 2 * t);
}
function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}
/**
 * Sample tectonic control maps at a unit-sphere point.
 * Pure + seed-stable — used by height composition and tests.
 */
export function sampleTectonicControls(x, y, z, seed, freq, warp, continentScale) {
    const f = Math.max(1e-4, freq);
    const w = Math.max(0.2, warp);
    // Continentalness: plates + secondary land + archipelago
    const plateA = warpedFbm3(x, y, z, seed + 1, 3, w * 0.9, f * 0.22) * 0.5 + 0.5;
    const plateB = warpedFbm3(x, y, z, seed + 71, 3, w * 0.7, f * 0.35) * 0.5 + 0.5;
    let cont = warpedFbm3(x, y, z, seed + 11, 4, w * 1.15, f * 0.5) * 0.5 + 0.5;
    cont = cont * 0.55 + plateA * 0.28 + plateB * 0.17;
    // Lower-frequency archipelago — reduces spiky micro-coasts
    const arch = warpedFbm3(x, y, z, seed + 131, 3, w * 0.4, f * 0.75) * 0.5 + 0.5;
    const craton = fbm3(x * f * 0.7, y * f * 0.7, z * f * 0.7, seed + 91, 3) * 0.5 + 0.5;
    const cPow = 1 / Math.max(0.5, Math.min(2.0, continentScale));
    cont = Math.pow(clamp01(cont), cPow);
    cont = clamp01(cont * 0.92 + arch * 0.1 * continentScale * 0.45);
    cont = clamp01(cont + (craton - 0.5) * 0.08);
    // Uplift / orogeny (elongated anisotropic ridges = collision belts)
    const orogA = ridged3(x * 0.7, y * 1.4, z * 0.7, seed + 301, 4, f * 1.8);
    const orogB = ridged3(x * 1.3, y * 0.6, z * 1.3, seed + 311, 4, f * 2.6);
    // Plate-boundary proxy: where plate fields disagree → higher uplift chance
    const plateEdge = Math.abs(plateA - plateB);
    const uplift = clamp01(orogA * 0.45 + orogB * 0.4 + plateEdge * 0.55);
    // Erosion field — higher flattens mid-frequency relief (not peaks)
    const erosion = fbm3(x * f * 1.6, y * f * 1.6, z * f * 1.6, seed + 350, 4) * 0.5 + 0.5;
    // Dense peaks (high-freq ridged stack)
    const peakA = ridged3(x, y, z, seed + 401, 8, f * 22);
    const peakB = ridged3(x, y, z, seed + 411, 7, f * 36);
    const peakC = ridged3(x, y, z, seed + 421, 6, f * 52);
    const volcanic = ridged3(x, y, z, seed + 431, 5, f * 18);
    const peaks = clamp01(peakA * 0.42 + peakB * 0.32 + peakC * 0.2 + volcanic * 0.12);
    return {
        continentalness: cont,
        uplift,
        erosion: clamp01(erosion),
        peaks,
        craton: clamp01(craton),
    };
}
/**
 * Full planetary height sample at unit-sphere direction.
 * Driven by tectonic control fields → multi-scale relief (not RTS height tint).
 */
export function sampleHeightAtDir(x, y, z, seed, octaves, freq, warp, cls, continentScale, mountainScale) {
    if (cls === "gas") {
        return (fbm3(x * freq * 0.5, y * freq * 2.5, z * freq * 0.5, seed, 5) * 0.5 + 0.5);
    }
    const f = Math.max(1e-4, freq);
    const mtn = Math.max(0.35, mountainScale);
    const oct = Math.max(4, Math.min(10, Math.floor(octaves)));
    const tec = sampleTectonicControls(x, y, z, seed, freq, warp, continentScale);
    const landMask = smoothstep(0.34, 0.56, tec.continentalness);
    const landSoft = smoothstep(0.28, 0.62, tec.continentalness);
    const chainMask = smoothstep(0.25, 0.65, tec.uplift) * landMask;
    // Erosion reduces mid-relief; peaks partially resist
    const erode = tec.erosion;
    const reliefKeep = 1 - erode * 0.55;
    // ========== OCEAN BATHYMETRY (multi-scale) ==========
    const abyssal = fbm3(x * f * 1.4, y * f * 1.4, z * f * 1.4, seed + 201, 5) * 0.5 + 0.5;
    const ridge = ridged3(x, y, z, seed + 211, 4, f * 2.2) * 0.5;
    const trench = ridged3(x * 1.1, y * 0.6, z * 1.1, seed + 221, 3, f * 3.5);
    const seamount = ridged3(x, y, z, seed + 231, 5, f * 8.0);
    const shelfNoise = fbm3(x * f * 0.9, y * f * 0.9, z * f * 0.9, seed + 241, 3) * 0.5 + 0.5;
    const shelf = landSoft * 0.35 + shelfNoise * 0.15 * (1 - landMask);
    let oceanFloor = 0.08 +
        abyssal * 0.22 +
        ridge * 0.12 +
        seamount * 0.08 * (1 - landMask) -
        trench * 0.1 * (1 - landMask) +
        shelf * 0.35;
    // Range detail (medium-high freq) under uplift mask
    const rangeA = ridged3(x, y, z, seed + 321, 6, f * 4.5);
    const rangeB = ridged3(x, y, z, seed + 331, 5, f * 7.0);
    const foothills = fbm3(x * f * 9, y * f * 9, z * f * 9, seed + 341, 5) * 0.5 + 0.5;
    const hills = fbm3(x * f * 12, y * f * 12, z * f * 12, seed + 501, 5) * 0.5 + 0.5;
    const micro = fbm3(x * f * 48, y * f * 48, z * f * 48, seed + 511, Math.min(6, oct)) *
        0.5 +
        0.5;
    const microRidge = ridged3(x, y, z, seed + 521, 4, f * 64);
    const carve = fbm3(x * f * 14, y * f * 14, z * f * 14, seed + 531, 3) * 0.5 + 0.5;
    // ========== COMPOSE via tectonic controls ==========
    let land = 0.36 +
        tec.continentalness * 0.12 +
        tec.craton * 0.07 +
        hills * 0.09 * reliefKeep +
        foothills * 0.07 * landMask * reliefKeep;
    // Uplift-driven mountain belts
    land +=
        chainMask * (rangeA * 0.3 + rangeB * 0.2) * mtn * (0.65 + 0.35 * reliefKeep);
    // Peak field (dense local maxima) — erosion only lightly reduces
    land += landMask * tec.peaks * (0.24 + 0.16 * mtn) * (1 - erode * 0.2);
    land += chainMask * tec.peaks * 0.14 * mtn;
    land += landMask * (micro * 0.05 + microRidge * 0.04);
    land -= landMask * carve * 0.03 * (0.5 + erode * 0.5);
    if (cls === "rocky") {
        land += landMask * (rangeA * 0.12 + tec.peaks * 0.1) * mtn;
        oceanFloor *= 0.85;
    }
    else if (cls === "ice") {
        land += landMask * (rangeB * 0.15 + microRidge * 0.08);
        land += Math.abs(y) * 0.06;
    }
    else if (cls === "exotic") {
        const chaos = ridged3(x * 1.5, y * 1.5, z * 1.5, seed + 601, 5, f * 11);
        land += landMask * chaos * 0.15;
    }
    let h = oceanFloor * (1 - landMask) + land * landMask;
    if (cls === "temperate" || cls === "ocean") {
        h += 0.02 * (1 - Math.abs(y)) * landMask;
    }
    return h;
}
/**
 * Micro / meso relief sampled on the unit sphere (does not decide land/ocean).
 * Land/ocean silhouette comes from discrete structure maps.
 */
export function sampleMicroReliefAtDir(x, y, z, seed, freq, mountainScale, isLand, 
/** Height octaves UI (2–8) — scales micro fBm depth. */
heightOctaves = 5) {
    const f = Math.max(1e-4, freq);
    const mtn = Math.max(0.35, mountainScale);
    const oct = Math.max(2, Math.min(8, Math.floor(heightOctaves)));
    const octLo = Math.max(2, oct - 1);
    const octHi = Math.min(8, oct + 1);
    const hills = fbm3(x * f * 12, y * f * 12, z * f * 12, seed + 501, oct) * 0.5 + 0.5;
    const foothills = fbm3(x * f * 9, y * f * 9, z * f * 9, seed + 341, oct) * 0.5 + 0.5;
    const micro = fbm3(x * f * 48, y * f * 48, z * f * 48, seed + 511, octHi) * 0.5 + 0.5;
    const microRidge = ridged3(x, y, z, seed + 521, octLo, f * 64);
    const rangeA = ridged3(x, y, z, seed + 321, Math.min(8, oct + 1), f * 4.5);
    const rangeB = ridged3(x, y, z, seed + 331, oct, f * 7.0);
    const peaks = ridged3(x, y, z, seed + 401, Math.min(8, oct + 2), f * 22) * 0.45 +
        ridged3(x, y, z, seed + 411, Math.min(8, oct + 1), f * 36) * 0.35 +
        ridged3(x, y, z, seed + 421, oct, f * 52) * 0.2;
    if (!isLand) {
        const abyssal = fbm3(x * f * 1.4, y * f * 1.4, z * f * 1.4, seed + 201, oct) * 0.5 + 0.5;
        const seamount = ridged3(x, y, z, seed + 231, oct, f * 8.0);
        return abyssal * 0.08 + seamount * 0.04;
    }
    return (hills * 0.06 +
        foothills * 0.045 +
        micro * 0.04 +
        microRidge * 0.035 +
        rangeA * 0.09 * mtn +
        rangeB * 0.06 * mtn +
        // Dense peaks keep landLocalMaxima floors after structure silhouette
        peaks * 0.18 * mtn);
}
/**
 * Build base height: Orogen-class structure prior + hierarchical micro detail.
 * Hard land mask constrains silhouettes; liquidLevel sits at the coast band.
 */
export function generateBaseHeight(params, width, height, outStructure) {
    const map = allocateHeightMap(width, height);
    const { data } = map;
    const seed = params.seed | 0;
    const freq = params.heightFreq;
    const cls = params.planetClass;
    const mtn = params.mountainScale;
    const sea = Math.max(0.05, Math.min(0.95, params.liquidLevel));
    if (cls === "gas") {
        let minH = Infinity;
        let maxH = -Infinity;
        for (let y = 0; y < height; y++) {
            const v = (y + 0.5) / height;
            for (let x = 0; x < width; x++) {
                const u = (x + 0.5) / width;
                const d = equirectToDir(u, v);
                const h = sampleHeightAtDir(d.x, d.y, d.z, seed, params.heightOctaves, freq, params.warp, cls, params.continentScale, mtn);
                data[y * width + x] = h;
                if (h < minH)
                    minH = h;
                if (h > maxH)
                    maxH = h;
            }
        }
        const span = Math.max(1e-8, maxH - minH);
        for (let i = 0; i < data.length; i++) {
            data[i] = (data[i] - minH) / span;
        }
        if (outStructure)
            outStructure.maps = null;
        return map;
    }
    const structure = buildPlanetStructure(params, width, height);
    if (outStructure)
        outStructure.maps = structure;
    const { landMask, elevationPrior, mountain } = structure;
    const n = width * height;
    // Compose: structure macro + micro; keep land/ocean bands split by sea
    for (let y = 0; y < height; y++) {
        const v = (y + 0.5) / height;
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const d = equirectToDir((x + 0.5) / width, v);
            const isLand = landMask[i] === 1;
            const micro = sampleMicroReliefAtDir(d.x, d.y, d.z, seed, freq, mtn, isLand, params.heightOctaves);
            const prior = elevationPrior[i];
            const mtnW = mountain[i];
            let h;
            if (isLand) {
                // Land band sits above sea; micro + mountains add relief inland
                // Cap extreme heights so paint stays in chromatic elev bands
                h =
                    sea +
                        0.035 +
                        (prior - 0.45) * 0.28 +
                        micro * 0.42 +
                        mtnW * 0.1 * mtn;
                h = Math.min(h, sea + 0.52);
                if (cls === "rocky")
                    h += micro * 0.08 + mtnW * 0.06;
                if (cls === "ice")
                    h += Math.abs(d.y) * 0.04;
                if (cls === "exotic") {
                    h += ridged3(d.x * 1.5, d.y * 1.5, d.z * 1.5, seed + 601, 4, freq * 11) * 0.08;
                }
            }
            else {
                // Sphere-native open-ocean bathymetry (3D on unit sphere).
                // Equirect coast prior only soft-lifts true shelves — damped at poles
                // so BFS pinching cannot force polar light-blue discs.
                const shallow3d = sampleOceanBathymetry3d(d.x, d.y, d.z, seed + 40, freq);
                const shelfCue = polarSafeShelfCue(prior, Math.abs(d.y));
                const shallow = clamp01(shallow3d * (1 - shelfCue * 0.5) + shelfCue * 0.82);
                h = oceanHeightFromShallow(shallow, sea, micro - mtnW * 0.02);
                if (cls === "rocky")
                    h *= 0.92;
            }
            data[i] = clamp01(h);
        }
    }
    // Soft contrast only on land relief — mild, preserves structure silhouette
    for (let i = 0; i < n; i++) {
        if (!landMask[i])
            continue;
        const t = data[i];
        const c = t * t * (3 - 2 * t);
        data[i] = t * 0.78 + c * 0.22;
    }
    // Soft land/ocean band after contrast (not razor-hard yet)
    const eps = 0.012;
    for (let i = 0; i < n; i++) {
        if (landMask[i]) {
            if (data[i] < sea + eps)
                data[i] = sea + eps + data[i] * 0.02;
        }
        else {
            if (data[i] > sea - eps)
                data[i] = sea - eps - (1 - data[i]) * 0.02;
        }
        data[i] = clamp01(data[i]);
    }
    // Product coasts: structure leaves a multi-tenths height cliff at the mask
    // edge. Pull near-shore heights toward sea, mild Jacobi soft-coast, then
    // re-lock classification with a small ε (not a razor 0.5 step).
    pullCoastHeightsTowardSea(map, landMask, sea, 5, 0.72);
    softCoastFilter(map, sea, 3, 0.22, 0.42);
    enforceStructureLandMask(map, landMask, sea, 0.008);
    return map;
}
/**
 * Re-lock height to structure land mask: land ≥ sea+ε, ocean ≤ sea−ε.
 * Call after soft-coast / erosion so the painted coastline matches continents.
 */
export function enforceStructureLandMask(map, landMask, sea, eps = 0.01) {
    const { data } = map;
    const n = data.length;
    const e = Math.max(0.004, eps);
    for (let i = 0; i < n; i++) {
        if (landMask[i]) {
            if (data[i] < sea + e)
                data[i] = sea + e;
        }
        else {
            if (data[i] > sea - e)
                data[i] = sea - e;
        }
        data[i] = clamp01(data[i]);
    }
}
/**
 * Pull structure land/ocean heights near the mask boundary toward sea so the
 * softCoastFilter |h−sea| band can reach the true shoreline. Without this,
 * product coasts sit ~sea±0.2…0.4 and mild soft-coast never touches them.
 * Mutates map. Does not change landMask topology.
 */
export function pullCoastHeightsTowardSea(map, landMask, sea, 
/** Rings of 4-neighbor expansion from the land/ocean edge. */
rings = 5, 
/** How hard to pull ring-0 edge cells toward sea±eps (0–1). */
edgePull = 0.72) {
    const { width: W, height: H, data } = map;
    const n = W * H;
    const seaC = Math.max(0.05, Math.min(0.95, sea));
    const nRings = Math.max(1, Math.min(12, Math.floor(rings)));
    const pull0 = Math.max(0.15, Math.min(0.95, edgePull));
    // dist 0 = edge pixel (has opposite-type 4-neigh); higher = inland/ocean
    const dist = new Int16Array(n);
    dist.fill(32767);
    const q = [];
    for (let y = 1; y < H - 1; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            const land = landMask[i] ? 1 : 0;
            const xl = (x - 1 + W) % W;
            const xr = (x + 1) % W;
            const opp = (landMask[y * W + xl] ? 1 : 0) !== land ||
                (landMask[y * W + xr] ? 1 : 0) !== land ||
                (landMask[(y - 1) * W + x] ? 1 : 0) !== land ||
                (landMask[(y + 1) * W + x] ? 1 : 0) !== land;
            if (opp) {
                dist[i] = 0;
                q.push(i);
            }
        }
    }
    // BFS expand distance (U-wrap)
    let qi = 0;
    while (qi < q.length) {
        const i = q[qi++];
        const d = dist[i];
        if (d >= nRings)
            continue;
        const y = Math.floor(i / W);
        const x = i - y * W;
        const neigh = [
            y * W + ((x + 1) % W),
            y * W + ((x - 1 + W) % W),
            y > 0 ? (y - 1) * W + x : -1,
            y < H - 1 ? (y + 1) * W + x : -1,
        ];
        for (const j of neigh) {
            if (j < 0)
                continue;
            if (dist[j] > d + 1) {
                dist[j] = d + 1;
                q.push(j);
            }
        }
    }
    for (let i = 0; i < n; i++) {
        const d = dist[i];
        if (d > nRings)
            continue;
        const t = 1 - d / (nRings + 0.5);
        const pull = pull0 * t * t; // stronger at true edge
        const isLand = !!landMask[i];
        // Aim just across sea so land stays land / ocean stays ocean after pull
        const aim = isLand ? seaC + 0.028 : seaC - 0.035;
        data[i] = clamp01(data[i] * (1 - pull) + aim * pull);
    }
}
/**
 * Smooth only the band around sea-ish mid heights so shorelines lose
 * high-frequency spikes while inland peaks stay sharp.
 * Mutates map. seaCenter ~ liquidLevel default (~0.5–0.55).
 *
 * Firm coasts with mild smoothing (few passes, narrow band, moderate mix).
 * inland |h−sea| > band is untouched (preserves mountain density / avoids mush).
 *
 * Call {@link pullCoastHeightsTowardSea} first on product structure heights so
 * real coasts fall inside `band` (otherwise this is a no-op on shorelines).
 */
export function softCoastFilter(map, seaCenter = 0.52, passes = 2, band = 0.14, mix = 0.48) {
    const { width: W, height: H, data } = map;
    const b = Math.max(0.06, band);
    const m = Math.max(0, Math.min(1, mix));
    const nPass = Math.max(1, Math.min(20, Math.floor(passes)));
    for (let p = 0; p < nPass; p++) {
        const next = new Float32Array(data);
        // Alternate 3×3 and wider 5×5 for extra coastline smoothing
        const wide = p % 2 === 1;
        for (let y = 1; y < H - 1; y++) {
            for (let x = 0; x < W; x++) {
                const i = y * W + x;
                const h = data[i];
                const dist = Math.abs(h - seaCenter);
                if (dist > b)
                    continue;
                // Stronger blur closer to sea level
                const w = 1 - dist / b;
                const xl = (x - 1 + W) % W;
                const xr = (x + 1) % W;
                let avg;
                if (!wide || y < 2 || y > H - 3) {
                    avg =
                        (data[i] +
                            data[y * W + xl] +
                            data[y * W + xr] +
                            data[(y - 1) * W + x] +
                            data[(y + 1) * W + x] +
                            data[(y - 1) * W + xl] +
                            data[(y - 1) * W + xr] +
                            data[(y + 1) * W + xl] +
                            data[(y + 1) * W + xr]) /
                            9;
                }
                else {
                    // 5×5 box (U-wrap) for extra coastal soft when budget allows
                    let s = 0;
                    let c = 0;
                    for (let dy = -2; dy <= 2; dy++) {
                        const yy = y + dy;
                        for (let dx = -2; dx <= 2; dx++) {
                            const xx = (x + dx + W) % W;
                            s += data[yy * W + xx];
                            c++;
                        }
                    }
                    avg = s / c;
                }
                next[i] = h * (1 - w * m) + avg * (w * m);
            }
        }
        data.set(next);
    }
}
/**
 * Coast spikiness metric for tests: fraction of land-edge pixels whose
 * 4-neighbor land count is 1 (thin spike / micro-peninsula).
 * Lower is smoother. Uses liquidMask R>127 as ocean if provided, else seaLevel.
 */
export function coastSpikeRatio(height, seaLevel) {
    const { width: W, height: H, data } = height;
    const sea = Math.max(0, Math.min(1, seaLevel));
    let edge = 0;
    let spikes = 0;
    for (let y = 1; y < H - 1; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            const land = data[i] > sea;
            if (!land)
                continue;
            const nLand = (data[y * W + ((x + 1) % W)] > sea ? 1 : 0) +
                (data[y * W + ((x - 1 + W) % W)] > sea ? 1 : 0) +
                (data[(y + 1) * W + x] > sea ? 1 : 0) +
                (data[(y - 1) * W + x] > sea ? 1 : 0);
            const isEdge = nLand < 4;
            if (!isEdge)
                continue;
            edge++;
            // Spike: only one land neighbor (or zero)
            if (nLand <= 1)
                spikes++;
        }
    }
    return edge > 0 ? spikes / edge : 0;
}
/**
 * Re-inject high-frequency peak detail after erosion so mountain density
 * survives smoothing. Only adds on land (above sea). Mutates map.
 */
export function reinjectPeakDetail(map, params, amount = 0.14) {
    if (params.planetClass === "gas")
        return;
    const { width: W, height: H, data } = map;
    const seed = (params.seed | 0) + 900;
    const f = Math.max(1e-4, params.heightFreq);
    const sea = Math.max(0, Math.min(1, params.liquidLevel));
    // heightOctaves strongly scales reinject so the UI knob changes full-bake height
    const oct = Math.max(2, Math.min(8, Math.floor(params.heightOctaves)));
    const octScale = 0.45 + (oct / 8) * 1.35; // 2→0.79, 5→1.29, 8→1.8
    const amt = Math.max(0, amount) *
        Math.max(0.35, params.mountainScale) *
        0.95 *
        octScale;
    if (amt < 1e-4)
        return;
    for (let y = 0; y < H; y++) {
        const v = (y + 0.5) / H;
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            const h0 = data[i];
            if (h0 <= sea + 0.02)
                continue;
            const u = (x + 0.5) / W;
            const d = equirectToDir(u, v);
            const pA = ridged3(d.x, d.y, d.z, seed + 1, Math.min(8, oct + 1), f * 28);
            const pB = ridged3(d.x, d.y, d.z, seed + 2, oct, f * 44);
            const pC = ridged3(d.x, d.y, d.z, seed + 3, Math.max(2, oct - 1), f * 56);
            const peaks = pA * 0.5 + pB * 0.35 + pC * 0.15;
            // Stronger inland gate — never re-noise coast silhouette
            const inland = smoothstep(sea + 0.14, sea + 0.48, h0);
            data[i] = clamp01(h0 + peaks * amt * inland);
        }
    }
}
/**
 * Build equirect normal map from heightfield (central differences with U-wrap).
 */
export function heightToNormalMap(height, strength = 8) {
    const { width: W, height: H, data } = height;
    const out = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
        const lat = (0.5 - (y + 0.5) / H) * Math.PI;
        const cosLat = Math.max(0.08, Math.cos(lat));
        for (let x = 0; x < W; x++) {
            const xl = (x - 1 + W) % W;
            const xr = (x + 1) % W;
            const yu = Math.max(0, y - 1);
            const yd = Math.min(H - 1, y + 1);
            const hL = data[y * W + xl];
            const hR = data[y * W + xr];
            const hU = data[yu * W + x];
            const hD = data[yd * W + x];
            const dx = ((hR - hL) * strength) / cosLat;
            const dy = (hD - hU) * strength;
            let nx = -dx;
            let ny = -dy;
            let nz = 1;
            const len = Math.hypot(nx, ny, nz) || 1;
            nx /= len;
            ny /= len;
            nz /= len;
            const i = (y * W + x) * 4;
            out[i] = Math.round((nx * 0.5 + 0.5) * 255);
            out[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
            out[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
            out[i + 3] = 255;
        }
    }
    return out;
}
/**
 * Open-ocean wave tilt in tangent space (illumination sparkle only).
 * ~0.03–0.05 mean |slope| — visible under light, still far below land relief.
 */
export const OCEAN_MICROWAVE_AMP = 0.2;
/** Base frequency on the unit sphere (across wave crests). */
export const OCEAN_MICROWAVE_FREQ = 960;
/**
 * Stretch along crests: sample freq along-axis = base / stretch.
 * Higher → more elongated wave-like ridges (not isotropic grain).
 */
export const OCEAN_MICROWAVE_STRETCH = 10;
/**
 * Soft coastal normal blend radius in texels.
 * Wide enough that land cliff normals at the shoreline fully damp to flat
 * (no lighting rim between land and water).
 */
export const COAST_NORMAL_SOFT_RADIUS = 8;
/**
 * Box-blur liquid R channel → soft 0–1 field for coastal normal blending.
 * U-wrap; V-clamp. Pure helper for flattenLiquidNormals.
 */
function softLiquidField(liquidMaskRgba, W, H, radius) {
    const r = Math.max(1, Math.min(12, radius | 0));
    const n = W * H;
    const hard = new Float32Array(n);
    for (let i = 0; i < n; i++)
        hard[i] = liquidMaskRgba[i * 4] / 255;
    // Separable box blur (2 passes H then V) ≈ soft distance band at coast
    const tmp = new Float32Array(n);
    const out = new Float32Array(n);
    const span = 2 * r + 1;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            let s = 0;
            for (let k = -r; k <= r; k++) {
                const xx = (x + k + W) % W;
                s += hard[y * W + xx];
            }
            tmp[y * W + x] = s / span;
        }
    }
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            let s = 0;
            for (let k = -r; k <= r; k++) {
                const yy = Math.max(0, Math.min(H - 1, y + k));
                s += tmp[yy * W + x];
            }
            out[y * W + x] = s / span;
        }
    }
    return out;
}
/**
 * Space-view oceans: kill large bathymetry relief, then add micro wave-scale
 * normal noise so lighting has faint sea sparkle (elongated wave-like).
 *
 * Soft coastal band: land normals near water and ocean normals near shore
 * blend toward flat so height-cliff rims do not light as a hard white border.
 * Mutates normalRgba in place.
 */
export function flattenLiquidNormals(normalRgba, liquidMaskRgba, width, height, seed = 0) {
    const W = width;
    const H = height;
    const n = W * H;
    const freq = OCEAN_MICROWAVE_FREQ;
    const stretch = Math.max(1.5, OCEAN_MICROWAVE_STRETCH);
    const fAcross = freq; // short wavelength perpendicular to crests
    const fAlong = freq / stretch; // long wavelength along crests
    const fY = freq * 0.28;
    const amp0 = OCEAN_MICROWAVE_AMP;
    const sWave = (seed | 0) + 4401;
    const softL = softLiquidField(liquidMaskRgba, W, H, COAST_NORMAL_SOFT_RADIUS);
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        const hardLiq = liquidMaskRgba[o] / 255;
        const soft = softL[i];
        // Pure dry land far from sea — keep full terrain normal
        if (hardLiq < 0.04 && soft < 0.02)
            continue;
        // Flatten weight — kill land/sea normal step completely:
        //  - all water → fully flat base
        //  - land with any soft water proximity → ramp fully to flat (no cliff rim)
        let t;
        if (hardLiq >= 0.5) {
            t = 1;
        }
        else {
            // soft 0 → 0; soft ≳ 0.22 → full flat on land side of shore
            const u = Math.min(1, Math.max(0, soft / 0.22));
            t = u * u * (3 - 2 * u); // smoothstep to 1
        }
        if (t < 0.015)
            continue;
        let nx = ((normalRgba[o] / 255) * 2 - 1) * (1 - t);
        let ny = ((normalRgba[o + 1] / 255) * 2 - 1) * (1 - t);
        let nz = ((normalRgba[o + 2] / 255) * 2 - 1) * (1 - t) + 1 * t;
        // Micro waves only far from shore (not in the flat coastal band)
        if (hardLiq > 0.55 && soft > 0.72) {
            const x = i % W;
            const y = (i / W) | 0;
            const u = (x + 0.5) / W;
            const v = (y + 0.5) / H;
            const d = equirectToDir(u, v);
            const cosLat = Math.max(0.12, Math.sqrt(Math.max(0, 1 - d.y * d.y)));
            // Fade waves in only well offshore
            const open = Math.min(1, Math.max(0, (soft - 0.72) / 0.25));
            const amp = amp0 * open * (0.7 + 0.3 * cosLat);
            const ca = 0.92;
            const sa = 0.39;
            const qx = d.x * ca + d.z * sa;
            const qz = -d.x * sa + d.z * ca;
            const h1 = valueNoise3(qx * fAcross, d.y * fY, qz * fAlong, sWave) * 2 - 1;
            const h2 = valueNoise3(qx * fAcross * 2.05 + 2.1, d.y * fY * 1.4 - 0.7, qz * fAlong * 2.05, sWave + 31) *
                2 -
                1;
            const ca2 = 0.34;
            const sa2 = 0.94;
            const rx = d.x * ca2 + d.z * sa2;
            const rz = -d.x * sa2 + d.z * ca2;
            const h3 = valueNoise3(rx * fAcross * 0.85, d.y * fY, rz * fAlong * 0.85, sWave + 17) *
                2 -
                1;
            const across = h1 * 0.7 + h2 * 0.3;
            const along = h3 * 0.45 + h1 * 0.15;
            nx += across * amp;
            ny += along * amp * 0.45;
        }
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        normalRgba[o] = Math.round((nx * 0.5 + 0.5) * 255);
        normalRgba[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        normalRgba[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    }
}
/**
 * Soft-match left/right equirect columns so thresholded biomes don't
 * flip across the longitude seam.
 */
export function sealEquirectSeam(map, blendCols = 3) {
    const { width: W, height: H, data } = map;
    if (W < 4)
        return;
    const k = Math.max(1, Math.min(Math.floor(W / 8), Math.floor(blendCols)));
    for (let y = 0; y < H; y++) {
        const hL = data[y * W + 0];
        const hR = data[y * W + (W - 1)];
        const mid = (hL + hR) * 0.5;
        data[y * W + 0] = mid;
        data[y * W + (W - 1)] = mid;
        for (let c = 1; c < k; c++) {
            const t = 1 - c / k;
            const iL = y * W + c;
            const iR = y * W + (W - 1 - c);
            data[iL] = data[iL] * (1 - t * 0.5) + mid * (t * 0.5);
            data[iR] = data[iR] * (1 - t * 0.5) + mid * (t * 0.5);
        }
    }
}
export function heightToGrayRgba(height) {
    const { width: W, height: H, data } = height;
    const out = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
        const g = Math.round(Math.max(0, Math.min(1, data[i])) * 255);
        const o = i * 4;
        out[o] = g;
        out[o + 1] = g;
        out[o + 2] = g;
        out[o + 3] = 255;
    }
    return out;
}
//# sourceMappingURL=heightfield.js.map