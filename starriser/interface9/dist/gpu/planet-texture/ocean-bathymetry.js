/**
 * Sphere-native ocean bathymetry (unit-sphere 3D noise).
 *
 * Open-ocean depth must NOT come from equirect pixel distance-to-coast alone —
 * that pinches at the poles into concentric light/dark blue rings. Basins,
 * ridges, trenches, and abyssal plains are sampled in R³ on the unit sphere
 * (same seam-safe model as land micro noise).
 *
 * Returns a continuous field in [0,1]: 0 ≈ abyss, 1 ≈ shallow / ridge crest.
 * Shelf near continents can still lift height via a separate coast cue.
 */
import { fbm3, ridged3 } from "./noise.js";
function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}
/**
 * Continuous open-ocean depth cue at unit-sphere direction (no latitude lock).
 */
export function sampleOceanBathymetry3d(x, y, z, seed, freq = 1.65) {
    const f = Math.max(1e-4, freq);
    const s = seed | 0;
    // Large basins / abyssal provinces (very low frequency on sphere)
    const basin = fbm3(x * f * 0.28, y * f * 0.28, z * f * 0.28, s + 201, 5) * 0.5 + 0.5;
    // Secondary basin warp so poles are not a single lobe
    const basin2 = fbm3(x * f * 0.55 + 3.1, y * f * 0.55, z * f * 0.55 - 1.7, s + 207, 4) *
        0.5 +
        0.5;
    // Mid-ocean ridge network (ridged, anisotropic-ish via stretch in y)
    const ridge = ridged3(x * 0.85, y * 1.35, z * 0.85, s + 211, 5, f * 1.9);
    const ridge2 = ridged3(x * 1.4, y * 0.7, z * 1.4, s + 217, 4, f * 3.1);
    // Trenches (narrow deep)
    const trench = ridged3(x * 1.15, y * 0.55, z * 1.15, s + 221, 3, f * 3.6);
    // Abyssal plain micro-relief (low amplitude)
    const plain = fbm3(x * f * 1.35, y * f * 1.35, z * f * 1.35, s + 231, 4) * 0.5 + 0.5;
    // Seamounts / guyots (sparse high-freq)
    const seamount = ridged3(x, y, z, s + 241, 5, f * 7.5);
    // Fracture-zone / transform streaks (mid scale)
    const fracture = fbm3(x * f * 2.4 + 9, y * f * 0.4, z * f * 2.4, s + 251, 3) * 0.5 + 0.5;
    // Compose: higher = shallower. No |lat| terms. Biased deep (ISS: open ocean
    // is dark navy; ridges/trenches only modulate depth, not turquoise shelves).
    let shallow = 0.08 +
        basin * 0.18 +
        basin2 * 0.1 +
        ridge * 0.16 +
        ridge2 * 0.08 +
        plain * 0.08 +
        seamount * 0.08 +
        fracture * 0.04 -
        trench * 0.16;
    return clamp01(shallow);
}
/**
 * Map continuous shallow cue [0,1] → ocean height just below sea level.
 * ISS-like: almost always deep/mid; only extreme peaks approach sea.
 */
export function oceanHeightFromShallow(shallow01, sea, micro = 0) {
    const t = clamp01(shallow01);
    // Keep open ocean well below sea — land→dark blue almost immediately
    let band;
    if (t > 0.75) {
        // rare ridge crest / seamount (still not turquoise shelf)
        band = 0.42 + (t - 0.75) * 0.9;
    }
    else if (t > 0.4) {
        band = 0.18 + (t - 0.4) * 0.7;
    }
    else {
        band = 0.05 + t * 0.32;
    }
    const h = sea * clamp01(band) - micro * 0.02;
    return Math.max(0.02, Math.min(sea - 0.02, h));
}
/**
 * Depth fraction for paint: 0 = surface, 1 = abyss.
 * Field-dominant; open ocean stays in deep/mid navy (no broad light-blue shelves).
 */
export function oceanPaintDepth(sea, height, shallow01) {
    if (shallow01 != null && Number.isFinite(shallow01)) {
        const fromField = 1 - clamp01(shallow01);
        const fromH = (sea - height) / Math.max(1e-4, sea);
        // Bias deep (no turquoise) but keep mid-navy variation for 2+ lum bands
        return clamp01(0.28 + (fromField * 0.85 + clamp01(fromH) * 0.15) * 0.72);
    }
    const fromH = clamp01((sea - height) / Math.max(1e-4, sea));
    return clamp01(0.28 + fromH * 0.72);
}
/**
 * Shelf weight from structure prior, damped near poles where equirect BFS
 * coast-distance pinches into false “near land” rings.
 */
export function polarSafeShelfCue(prior01, absLat, priorLo = 0.22, priorHi = 0.77) {
    const raw = clamp01((prior01 - priorLo) / Math.max(1e-4, priorHi - priorLo));
    // |y| = sinφ; above ~0.72 trust open-ocean 3D field over equirect shelf
    const t = clamp01((absLat - 0.72) / 0.22);
    const polarDamp = t * t * (3 - 2 * t);
    return clamp01(raw * (1 - polarDamp * 0.92));
}
//# sourceMappingURL=ocean-bathymetry.js.map