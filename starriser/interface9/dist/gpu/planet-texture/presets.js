/**
 * Named planet-texture presets. Ocean/temperate defaults are Azure-rooted
 * (PLANET_ATM_DEFAULTS cool blue atmosphere family + surface lighting knobs).
 */
import { PLANET_ATM_DEFAULTS } from "../solar-system/planet-atm-params.js";
import { MAX_RESOLUTION, MIN_RESOLUTION } from "./types.js";
import { DEFAULT_POLE_SIZE, clampPoleCapSide, } from "./pole-cap.js";
function atmTintFromAzure() {
    const a = PLANET_ATM_DEFAULTS;
    const m = Math.max(a.colorR, a.colorG, a.colorB, 1e-4);
    return {
        r: a.colorR / m,
        g: a.colorG / m,
        b: a.colorB / m,
    };
}
export function clampResolution(r) {
    if (!Number.isFinite(r))
        return 512;
    const n = Math.floor(r);
    return Math.max(MIN_RESOLUTION, Math.min(MAX_RESOLUTION, n));
}
export function defaultParams(resolution = 512, planetClass = "ocean") {
    const res = clampResolution(resolution);
    return {
        seed: 42,
        resolution: res,
        // Ice footprint control (250 = full ice) — product maps use poleProductSide(res)
        poleSize: DEFAULT_POLE_SIZE,
        planetClass,
        liquidLevel: 0.55,
        liquidKind: "water",
        heightOctaves: 8,
        heightFreq: 1.65,
        warp: 0.6,
        thermalIters: 6,
        hydraulicDrops: 0, // 0 = auto density (not off)
        bandStrength: 0.85,
        stormDensity: 0.35,
        cloudCover: 0.8,
        colorBoost: 0.55,
        atmTint: atmTintFromAzure(),
        wetness: PLANET_ATM_DEFAULTS.specStrength > 0.5 ? 0.85 : 0.5,
        continentScale: 1.1,
        mountainScale: 0.85,
        // Soft-coast removed from product path
        softCoastEnabled: false,
        // Terrain-features: mid-grey-neutral linear blend at full strength
        terrainFeatureBlend: "linear",
        terrainFeatureStrength: 1,
    };
}
export const PRESET_NAMES = [
    "azure-ocean",
    "temperate",
    "rocky-mars",
    "ice-world",
    "gas-jupiter",
    "gas-ice-giant",
    "exotic-methane",
    "exotic-acid",
    "lava-world",
];
/**
 * Named preset params. Does not encode resolution-dependent pole size —
 * always starts from DEFAULT_POLE_SIZE (250). Callers that re-apply a preset
 * over existing form state should preserve the user's poleSize (see UI apply).
 */
export function paramsForPreset(name, resolution = 512, seed = 42, 
/** When set, keep this pole size instead of resetting to default 250. */
preservePoleSize) {
    const base = defaultParams(resolution, "ocean");
    base.seed = seed >>> 0;
    if (preservePoleSize != null && Number.isFinite(preservePoleSize)) {
        base.poleSize = clampPoleCapSide(preservePoleSize);
    }
    const azure = atmTintFromAzure();
    switch (name) {
        case "azure-ocean":
            // Merged with temperate (same Earth-like class + clouds). Name kept for UI.
            return {
                ...base,
                planetClass: "temperate",
                liquidLevel: 0.5,
                liquidKind: "water",
                cloudCover: 0.8,
                colorBoost: 0.68,
                atmTint: azure,
                wetness: 0.9,
                continentScale: 1.06,
                mountainScale: 1.02,
                heightFreq: 1.55,
                heightOctaves: 8,
                warp: 0.58,
                thermalIters: 8,
                hybridLandDetail: 0.76,
                hybridOceanDetail: 0.07,
            };
        case "temperate":
            // Earth-like: 3–7 big continents (~45% land), open oceans between them.
            // Only temperate (and azure alias) gets cloud stamps.
            return {
                ...base,
                planetClass: "temperate",
                liquidLevel: 0.48,
                liquidKind: "water",
                cloudCover: 0.8,
                colorBoost: 0.72,
                atmTint: azure,
                continentScale: 1.05,
                mountainScale: 1.0,
                heightFreq: 1.4,
                heightOctaves: 8,
                warp: 0.55,
                thermalIters: 12,
                hybridLandDetail: 0.75,
                hybridOceanDetail: 0.06,
            };
        case "rocky-mars":
            return {
                ...base,
                planetClass: "rocky",
                liquidLevel: 0.08,
                liquidKind: "none",
                cloudCover: 0.05,
                colorBoost: 0.55,
                atmTint: { r: 0.9, g: 0.45, b: 0.25 },
                continentScale: 0.9,
                mountainScale: 1.15,
                heightFreq: 2.2,
                thermalIters: 18,
            };
        case "ice-world":
            return {
                ...base,
                planetClass: "ice",
                // More land / less open water (frozen crust dominates)
                liquidLevel: 0.14,
                liquidKind: "water",
                cloudCover: 0.8,
                colorBoost: 0.42,
                atmTint: { r: 0.4, g: 0.6, b: 1 },
                continentScale: 1.35,
                mountainScale: 1.25,
                heightFreq: 1.85,
                thermalIters: 10,
                wetness: 0.35,
            };
        case "gas-jupiter":
            return {
                ...base,
                planetClass: "gas",
                liquidLevel: 0,
                liquidKind: "none",
                cloudCover: 0,
                bandStrength: 0.95,
                stormDensity: 0.4,
                colorBoost: 0.75,
                atmTint: { r: 0.85, g: 0.55, b: 0.3 },
                warp: 0.65,
                thermalIters: 0,
                hydraulicDrops: 0,
            };
        case "gas-ice-giant":
            return {
                ...base,
                planetClass: "gas",
                liquidLevel: 0,
                liquidKind: "none",
                cloudCover: 0,
                bandStrength: 0.7,
                stormDensity: 0.25,
                colorBoost: 0.55,
                atmTint: azure,
                warp: 0.5,
                thermalIters: 0,
            };
        case "exotic-methane":
            return {
                ...base,
                planetClass: "exotic",
                liquidLevel: 0.38,
                liquidKind: "methane",
                cloudCover: 0.8,
                colorBoost: 0.65,
                // Warm orange haze (Titan), not cool blue Earth sky
                atmTint: { r: 0.75, g: 0.5, b: 0.28 },
                continentScale: 1.15,
                mountainScale: 0.9,
                thermalIters: 14,
                wetness: 0.55,
            };
        case "exotic-acid":
            return {
                ...base,
                planetClass: "exotic",
                liquidLevel: 0.5,
                liquidKind: "acid",
                cloudCover: 0.8,
                colorBoost: 0.85,
                atmTint: { r: 0.4, g: 0.7, b: 0.3 },
                warp: 0.7,
                thermalIters: 12,
            };
        case "lava-world":
            return {
                ...base,
                planetClass: "exotic",
                // Multi-basin lakes (barriers split seas) + drainage channels
                liquidLevel: 0.18,
                liquidKind: "lava",
                cloudCover: 0.06,
                colorBoost: 0.9,
                atmTint: { r: 1, g: 0.4, b: 0.12 },
                mountainScale: 1.15,
                heightFreq: 2.2,
                heightOctaves: 6,
                continentScale: 1.05,
                warp: 0.55,
                thermalIters: 4,
                wetness: 0.15,
            };
        default:
            return base;
    }
}
export function cloneParams(p) {
    return {
        ...p,
        atmTint: { ...p.atmTint },
        resolution: clampResolution(p.resolution),
        poleSize: clampPoleCapSide(p.poleSize),
        seed: p.seed >>> 0,
        softCoastEnabled: false,
    };
}
//# sourceMappingURL=presets.js.map