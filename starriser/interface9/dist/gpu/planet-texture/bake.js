/**
 * Offline batch planet texture bake (CPU, pure, deterministic).
 *
 * Pipeline:
 *   seed+class → height/flow field → thermal+hydraulic (terrain) or gas bands
 *   → material/liquid paint → normals → clouds → pole caps → stats
 *
 * Resolution: equirect width = resolution, height = resolution/2.
 * 8K (8192) supported; expensive passes scale with area (ok ≤~30s).
 *
 * Look: NASA-colorized Blue Marble / EVE-style multi-biome (not minimap).
 * Height is a hierarchical PLANET stack (plates→continents→orogenies→dense
 * peaks→micro) with stylized stream-power uplift×erosion (full plate solvers
 * and GCM deferred). Peak reinjection after erosion preserves dense maxima.
 * EVE vs this tool: EVE Dominion runtime height→normal dual-UV; we batch
 * offline equirect + N/S pole α-caps.
 */
import { MAX_RESOLUTION, MIN_RESOLUTION } from "./types.js";
import { cloneParams } from "./presets.js";
import { flattenLiquidNormals, generateBaseHeight, heightToGrayRgba, heightToNormalMap, reinjectPeakDetail, sampleTectonicControls, sealEquirectSeam, enforceStructureLandMask, pullCoastHeightsTowardSea, softCoastFilter, } from "./heightfield.js";
import { runHydraulicErosion, runThermalErosion } from "./erosion.js";
import { buildUpliftField, runStreamPowerErosion, } from "./stream-power.js";
import { generateGasField } from "./gas-flow.js";
import { carveLavaRiverHeight, generateClouds, liquidKindForClass, paintSurface, softOceanAlbedo, } from "./materials.js";
import { clampPoleCapSide, rasterizePoleCap } from "./pole-cap.js";
import { buildPlanetStructure } from "./structure.js";
import { countLandLocalMaxima, effectiveLayerTally, } from "./density.js";
import { equirectToDir } from "./sphere-map.js";
/** Throw AbortError when the authoring UI (or caller) cancelled the bake. */
export function throwIfBakeAborted(signal) {
    if (!signal?.aborted)
        return;
    const reason = signal.reason;
    if (reason instanceof DOMException && reason.name === "AbortError") {
        throw reason;
    }
    throw new DOMException(typeof reason === "string" && reason.length > 0
        ? reason
        : "Bake cancelled", "AbortError");
}
export function isBakeAbortError(e) {
    return ((e instanceof DOMException && e.name === "AbortError") ||
        (e instanceof Error && e.name === "AbortError"));
}
function clampParams(p) {
    const o = cloneParams(p);
    o.resolution = Math.max(MIN_RESOLUTION, Math.min(MAX_RESOLUTION, Math.floor(o.resolution)));
    // Force even width for clean half-height
    if (o.resolution % 2 !== 0)
        o.resolution -= 1;
    // Pole maps are independent of equirect long-edge (not min(resolution,…))
    o.poleSize = clampPoleCapSide(o.poleSize);
    o.liquidLevel = Math.max(0, Math.min(1, o.liquidLevel));
    o.liquidKind = liquidKindForClass(o.planetClass, o.liquidKind);
    o.heightOctaves = Math.max(1, Math.min(10, Math.floor(o.heightOctaves)));
    o.thermalIters = Math.max(0, Math.min(80, Math.floor(o.thermalIters)));
    // Soft-coast removed from product path; keep field for URL/API stability
    o.softCoastEnabled = false;
    return o;
}
/**
 * Hydraulic drops — kept light so multi-field mountain density is not
 * erased into a few blobs (planet generator, not heavy terrain sim).
 */
export function scaledHydraulicDrops(params, width, height) {
    if (params.planetClass === "gas")
        return 0;
    if (params.hydraulicDrops > 0)
        return params.hydraulicDrops;
    const area = width * height;
    // Sparse droplets: carve a few valleys without flattening peaks
    const density = 0.02;
    return Math.min(80000, Math.max(0, Math.floor(area * density)));
}
function albedoVariance(rgba) {
    let n = 0;
    let sum = 0;
    let sum2 = 0;
    for (let i = 0; i < rgba.length; i += 4) {
        const lum = (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3;
        sum += lum;
        sum2 += lum * lum;
        n++;
    }
    if (n < 2)
        return 0;
    const mean = sum / n;
    return Math.max(0, sum2 / n - mean * mean);
}
function heightStats(map) {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    const { data } = map;
    for (let i = 0; i < data.length; i++) {
        const h = data[i];
        if (h < min)
            min = h;
        if (h > max)
            max = h;
        sum += h;
    }
    return { min, max, mean: sum / data.length };
}
/**
 * Finish bake after base height exists: erosion (same policy as always) →
 * paint → normals → clouds → poles. Shared by CPU and GPU-height paths.
 */
export function completeBakeFromHeight(height, input, storms = null, onProgress, 
/** If true, height is already post-generateBaseHeight (normalized/coast); skip re-gen. */
heightIsFinalBase = true, 
/** Optional prior stage times (e.g. height field) merged into stats.stageMs. */
priorStageMs) {
    const params = clampParams(input);
    const W = height.width;
    const H = height.height;
    const report = onProgress ?? (() => { });
    const stageMs = { ...(priorStageMs ?? {}) };
    let mark = performance.now();
    const finish = (name, frac) => {
        const ms = Math.round((performance.now() - mark) * 10) / 10;
        stageMs[name] = ms;
        report(`${name} ${ms}ms`, frac);
        mark = performance.now();
    };
    if (!heightIsFinalBase) {
        // caller provided raw samples — not used currently
    }
    if (params.planetClass !== "gas") {
        report("thermal", 0.22);
        const thermalN = Math.min(params.thermalIters, 8);
        if (thermalN > 0) {
            const talus = 0.014 + 3 / W;
            runThermalErosion(height, thermalN, talus);
        }
        finish("thermal", 0.28);
        report("drainage", 0.32);
        const uplift = buildUpliftField(W, H, params.seed, (x, y, z) => sampleTectonicControls(x, y, z, params.seed, params.heightFreq, params.warp, params.continentScale).uplift, equirectToDir);
        // Priority-flood drainage + stronger stream-power (dendritic valleys)
        const spIters = W >= 4096 ? 2 : W >= 2048 ? 3 : 4;
        runStreamPowerErosion(height, uplift, spIters, 0.09, params.liquidLevel);
        finish("drainage", 0.42);
        report("hydraulic", 0.45);
        const drops = scaledHydraulicDrops(params, W, H);
        if (drops > 0) {
            const maxSteps = W >= 4096 ? 12 : W >= 2048 ? 16 : 20;
            runHydraulicErosion(height, params.seed, drops, { maxSteps, radius: 1 });
        }
        finish("hydraulic", 0.52);
        report("reinject", 0.55);
        // Throttled reinject — structure silhouettes must survive
        reinjectPeakDetail(height, params, 0.12);
        // Mild soft-coast after erosion: pull mask-edge heights into band first
        const struct = buildPlanetStructure(params, W, H);
        pullCoastHeightsTowardSea(height, struct.landMask, params.liquidLevel, 5, 0.72);
        softCoastFilter(height, params.liquidLevel, 3, 0.22, 0.42);
        sealEquirectSeam(height, Math.max(2, Math.floor(W / 128)));
        enforceStructureLandMask(height, struct.landMask, params.liquidLevel, 0.008);
        finish("reinject", 0.58);
    }
    report("paint", 0.65);
    const mats = paintSurface(height, params, storms);
    finish("paint", 0.68);
    if (params.planetClass !== "gas" && params.liquidKind !== "lava") {
        // Ocean blur (skip lava — would dim bright channel rivers)
        report("soft-ocean", 0.69);
        softOceanAlbedo(mats.albedo, mats.liquidMask, W, H);
        finish("soft-ocean", 0.72);
    }
    // Lava rivers: carve height so normals match bright channel albedo
    if (params.liquidKind === "lava") {
        carveLavaRiverHeight(height, mats.liquidMask, 0.05);
    }
    report("normals", 0.78);
    const normalRgba = heightToNormalMap(height, params.planetClass === "gas" ? 4 : 14);
    // Flatten open water only — lava channels must keep relief for normal correlation
    if (params.liquidKind !== "none" &&
        params.liquidKind !== "lava" &&
        params.planetClass !== "gas") {
        flattenLiquidNormals(normalRgba, mats.liquidMask, W, H, params.seed);
    }
    const heightRgba = heightToGrayRgba(height);
    finish("normals", 0.82);
    report("clouds", 0.85);
    const cloudRgba = generateClouds(params, W, H);
    finish("clouds", 0.88);
    report("poles", 0.92);
    const poleNorth = rasterizePoleCap(mats.albedo, W, H, params.poleSize, true);
    const poleSouth = rasterizePoleCap(mats.albedo, W, H, params.poleSize, false);
    finish("poles", 0.96);
    const hs = heightStats(height);
    const landPeaks = params.planetClass === "gas"
        ? 0
        : countLandLocalMaxima(height, params.liquidLevel);
    const layers = effectiveLayerTally(params);
    finish("stats", 0.99);
    let totalMs = 0;
    for (const v of Object.values(stageMs))
        totalMs += v;
    totalMs = Math.round(totalMs * 10) / 10;
    const set = {
        params,
        albedo: { width: W, height: H, rgba: mats.albedo },
        height: { width: W, height: H, rgba: heightRgba },
        normal: { width: W, height: H, rgba: normalRgba },
        liquidMask: { width: W, height: H, rgba: mats.liquidMask },
        clouds: cloudRgba
            ? { width: W, height: H, rgba: cloudRgba }
            : null,
        poleNorth,
        poleSouth,
        stats: {
            liquidFraction: mats.liquidFraction,
            albedoVariance: albedoVariance(mats.albedo),
            heightMin: hs.min,
            heightMax: hs.max,
            heightMean: hs.mean,
            landLocalMaxima: landPeaks,
            effectiveLayers: layers,
            stageMs,
            totalMs,
        },
    };
    report(`done ${totalMs}ms`, 1);
    return set;
}
/**
 * Sequential pure-JS bake for Node smoke / gpu-cpu-ref when WebGPU is unavailable.
 * Not the product UI path — browser uses bakePlanetTexturesAuto → WebGPU.
 */
export function bakePlanetTextures(input, onProgress) {
    const params = clampParams(input);
    const W = params.resolution;
    const H = Math.max(1, Math.floor(W / 2));
    const report = onProgress ?? (() => { });
    const priorStageMs = {};
    report("height", 0.05);
    const tH = performance.now();
    let height;
    let storms = null;
    if (params.planetClass === "gas") {
        const gas = generateGasField(params.seed, W, H, params.bandStrength, params.stormDensity, params.warp);
        height = gas.flow;
        storms = gas.storms;
        sealEquirectSeam(height, 2);
        if (storms)
            sealEquirectSeam(storms, 2);
    }
    else {
        height = generateBaseHeight(params, W, H);
    }
    const heightMs = Math.round((performance.now() - tH) * 10) / 10;
    priorStageMs.height = heightMs;
    report(`height ${heightMs}ms`, 0.18);
    return completeBakeFromHeight(height, params, storms, report, true, priorStageMs);
}
/**
 * FNV-1a 32-bit hash of RGBA bytes — for determinism tests.
 */
export function hashRgba(rgba) {
    let h = 0x811c9dc5;
    for (let i = 0; i < rgba.length; i++) {
        h ^= rgba[i];
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
}
export function hashTextureSet(set) {
    return [
        hashRgba(set.albedo.rgba),
        hashRgba(set.height.rgba),
        hashRgba(set.normal.rgba),
        hashRgba(set.liquidMask.rgba),
        hashRgba(set.poleNorth.rgba),
        hashRgba(set.poleSouth.rgba),
    ].join("-");
}
//# sourceMappingURL=bake.js.map