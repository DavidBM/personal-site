/**
 * Pure stellar-type presets for the solar-system showcase sun impostor.
 * Sol / yellow dwarf = current realistic baseline (SUN_LOOK_DEFAULTS + Sol body).
 * Other types vary radius, glow tint/strength, look knobs, and planet light mul.
 * No GPU — unit-testable from Node after build.
 */
import { SUN_LOOK_DEFAULTS, clampSunLookParams, cloneSunLookParams, } from "./sun-look-params.js";
/** Matches solar-bodies Sol showcase radius (keep in sync). */
export const SOL_SHOWCASE_RADIUS = 2.8;
/** Matches solar-bodies Sol corona drawMargin. */
export const SOL_SHOWCASE_DRAW_MARGIN = 3.0;
/** Matches solar-bodies Sol glow RGB. */
export const SOL_SHOWCASE_GLOW = Object.freeze([
    1.0, 0.72, 0.28,
]);
export const SOL_SHOWCASE_GLOW_STRENGTH = 1.0;
/**
 * Well-known stellar variants for the showcase.
 * yellow-dwarf (Sol) is the current realistic baseline — empty look partial.
 */
export const SUN_TYPE_PRESETS = Object.freeze([
    {
        id: "yellow-dwarf",
        label: "Yellow dwarf (Sol)",
        subtitle: "G-type · our sun baseline",
        radiusScale: 1,
        glow: SOL_SHOWCASE_GLOW,
        glowStrength: SOL_SHOWCASE_GLOW_STRENGTH,
        look: {},
        planetLightMul: 1,
        spinScale: 1,
    },
    {
        id: "orange-dwarf",
        label: "Orange dwarf",
        subtitle: "K-type · cooler, amber",
        radiusScale: 0.82,
        glow: [1.0, 0.55, 0.18],
        glowStrength: 0.85,
        look: {
            discWarm: 1,
            discGain: 2.2,
            rayGain: 0.55,
            chromGain: 0.45,
            sheathGain: 0.32,
            outerGain: 0.14,
            granGain: 0.8,
            glowMul: 0.85,
        },
        planetLightMul: 0.78,
        spinScale: 0.9,
    },
    {
        id: "red-dwarf",
        label: "Red dwarf",
        subtitle: "M-type · small, deep red",
        radiusScale: 0.38,
        // Orange-red (less pure crimson) so disc reads warm, not pink-white
        glow: [1.0, 0.48, 0.1],
        glowStrength: 0.62,
        look: {
            discWarm: 1,
            // Less white push than Sol/brown-dwarf; leave some core heat
            discGain: 1.55,
            coreLift: 0.02,
            rayGain: 0.48,
            chromGain: 0.75,
            sheathGain: 0.32,
            outerGain: 0.12,
            outerFalloff: 7,
            granGain: 0.78,
            glowMul: 1.05,
            limbSoft: 0.028,
        },
        planetLightMul: 0.42,
        spinScale: 1.4,
    },
    {
        id: "yellow-white",
        label: "Yellow-white",
        subtitle: "F-type · hotter Sol cousin",
        radiusScale: 1.15,
        glow: [1.0, 0.88, 0.55],
        glowStrength: 1.15,
        look: {
            discWarm: 0.55,
            discGain: 2.7,
            rayGain: 0.75,
            chromGain: 0.48,
            sheathGain: 0.4,
            outerGain: 0.18,
            granGain: 0.65,
            glowMul: 1.05,
        },
        planetLightMul: 1.25,
        spinScale: 1.05,
    },
    {
        id: "blue-white",
        label: "Blue-white",
        subtitle: "A-type · hot white-blue",
        radiusScale: 1.45,
        // Stronger B than R so spectralTint reads blue-white, not grey-white
        glow: [0.55, 0.78, 1.0],
        glowStrength: 1.45,
        look: {
            discWarm: 0.12,
            discGain: 2.55,
            coreLift: 0.02,
            rayGain: 0.85,
            chromGain: 0.35,
            sheathGain: 0.45,
            outerGain: 0.22,
            outerFalloff: 5.2,
            granGain: 0.45,
            glowMul: 1.2,
            limbSoft: 0.018,
        },
        planetLightMul: 1.7,
        spinScale: 1.2,
    },
    {
        id: "blue",
        label: "Blue star",
        subtitle: "O/B · fierce blue",
        radiusScale: 2.1,
        // Clear sky-blue (not navy): keep B-dominant but lift R/G so disc stays luminous
        glow: [0.22, 0.52, 1.0],
        glowStrength: 2.4,
        look: {
            discWarm: 0.02,
            // Brighter disc — cool tint still colors, less crushed dark blue
            discGain: 2.4,
            coreLift: 0.05,
            rayGain: 1.1,
            chromGain: 0.32,
            sheathGain: 0.6,
            veilGain: 0.24,
            outerGain: 0.32,
            outerFalloff: 4.4,
            granGain: 0.28,
            glowMul: 1.55,
            limbSoft: 0.016,
        },
        planetLightMul: 2.4,
        spinScale: 1.35,
    },
    {
        id: "white-dwarf",
        label: "White dwarf",
        subtitle: "Compact remnant · tiny, hot",
        radiusScale: 0.14,
        glow: [0.9, 0.95, 1.0],
        glowStrength: 1.6,
        look: {
            discWarm: 0.12,
            discGain: 3.2,
            coreLift: 0.12,
            rayGain: 0.35,
            chromGain: 0.2,
            sheathGain: 0.55,
            veilGain: 0.08,
            outerGain: 0.2,
            outerFalloff: 8,
            outerFadeEnd: 2.1,
            granGain: 0.25,
            glowMul: 1.3,
            limbSoft: 0.03,
            drawMarginMul: 1.1,
        },
        planetLightMul: 0.55,
        spinScale: 2.2,
    },
    {
        id: "red-giant",
        label: "Red giant",
        subtitle: "Bloated · deep orange-red",
        radiusScale: 3.4,
        glow: [1.0, 0.38, 0.1],
        glowStrength: 1.35,
        look: {
            discWarm: 1,
            discGain: 2.0,
            rayGain: 0.9,
            chromGain: 0.65,
            sheathGain: 0.5,
            veilGain: 0.22,
            outerGain: 0.28,
            outerFalloff: 4.2,
            outerFadeEnd: 2.8,
            granGain: 0.85,
            glowMul: 1.1,
            limbSoft: 0.03,
            drawMarginMul: 1.05,
        },
        planetLightMul: 1.55,
        spinScale: 0.35,
    },
    {
        id: "red-supergiant",
        label: "Red supergiant",
        subtitle: "Extreme · Betelgeuse-class",
        radiusScale: 5.2,
        glow: [1.0, 0.22, 0.05],
        glowStrength: 1.7,
        look: {
            discWarm: 1,
            // Hotter core push so fine grain reads less “dirty” (was 1.75 / gran 1.05)
            discGain: 2.35,
            coreLift: 0.06,
            rayGain: 1.15,
            chromGain: 0.85,
            sheathGain: 0.6,
            veilGain: 0.28,
            outerGain: 0.35,
            outerFalloff: 3.5,
            outerFadeStart: 1.05,
            outerFadeEnd: 3.1,
            granGain: 0.72,
            glowMul: 1.25,
            limbSoft: 0.035,
            drawMarginMul: 1.15,
        },
        planetLightMul: 2.1,
        spinScale: 0.22,
    },
    {
        id: "blue-giant",
        label: "Blue giant",
        subtitle: "Luminous · blue corona",
        radiusScale: 3.0,
        glow: [0.32, 0.6, 1.0],
        glowStrength: 2.2,
        look: {
            discWarm: 0.04,
            discGain: 2.45,
            coreLift: 0.04,
            rayGain: 1.1,
            chromGain: 0.32,
            sheathGain: 0.58,
            veilGain: 0.22,
            outerGain: 0.32,
            outerFalloff: 4.0,
            outerFadeEnd: 2.9,
            granGain: 0.4,
            glowMul: 1.5,
            limbSoft: 0.017,
            drawMarginMul: 1.05,
        },
        planetLightMul: 2.8,
        spinScale: 0.85,
    },
    {
        // Built from red-dwarf look, then cooled/dimmed (failed star / IR)
        id: "brown-dwarf",
        label: "Brown dwarf",
        subtitle: "Failed star · dim infrared",
        // Slightly larger than red dwarf (Jupiter-class bulk)
        radiusScale: 0.48,
        // Muddy orange-IR vs red-dwarf [1.0, 0.48, 0.1]
        glow: [0.95, 0.38, 0.08],
        glowStrength: 0.4,
        look: {
            discWarm: 1,
            // From red-dwarf 1.55 / 0.02 — a bit less white push
            discGain: 1.4,
            coreLift: 0.015,
            // Weak corona vs red-dwarf rays/chrom
            rayGain: 0.22,
            chromGain: 0.4,
            sheathGain: 0.18,
            veilGain: 0.08,
            outerGain: 0.07,
            outerFalloff: 7.5,
            granGain: 0.85,
            glowMul: 0.75,
            limbSoft: 0.03,
        },
        // Dimmer than red-dwarf 0.42, still readable on planets
        planetLightMul: 0.32,
        spinScale: 1.55,
    },
]);
const BY_ID = new Map(SUN_TYPE_PRESETS.map((p) => [p.id, p]));
export const DEFAULT_SUN_TYPE_ID = "yellow-dwarf";
export function listSunTypeIds() {
    return SUN_TYPE_PRESETS.map((p) => p.id);
}
export function getSunTypePreset(id) {
    return BY_ID.get(id);
}
export function isSunTypeId(id) {
    return BY_ID.has(id);
}
/** Resolved look for a type (Sol = exact defaults). */
export function resolveSunTypeLook(id) {
    const p = getSunTypePreset(id) ?? getSunTypePreset(DEFAULT_SUN_TYPE_ID);
    return clampSunLookParams({
        ...cloneSunLookParams(SUN_LOOK_DEFAULTS),
        ...p.look,
    });
}
export function resolveSunType(id) {
    const p = getSunTypePreset(id) ?? getSunTypePreset(DEFAULT_SUN_TYPE_ID);
    return {
        id: p.id,
        label: p.label,
        radius: SOL_SHOWCASE_RADIUS * p.radiusScale,
        drawMargin: SOL_SHOWCASE_DRAW_MARGIN,
        glow: [p.glow[0], p.glow[1], p.glow[2]],
        glowStrength: p.glowStrength,
        planetLightMul: p.planetLightMul,
        spinScale: p.spinScale,
        look: resolveSunTypeLook(p.id),
    };
}
/** True if resolved look matches Sol defaults for key knobs. */
export function isSolBaselineLook(look, eps = 1e-9) {
    const d = SUN_LOOK_DEFAULTS;
    return (Math.abs(look.discGain - d.discGain) <= eps &&
        Math.abs(look.rayGain - d.rayGain) <= eps &&
        Math.abs(look.glowMul - d.glowMul) <= eps &&
        Math.abs(look.discWarm - d.discWarm) <= eps &&
        Math.abs(look.granGain - d.granGain) <= eps &&
        Math.abs(look.outerGain - d.outerGain) <= eps);
}
//# sourceMappingURL=sun-types.js.map