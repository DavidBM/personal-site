/**
 * Pure CPU maps for the Earth + crack planet page.
 * Height / normal / cone come from the sphere-surface natural fissure heightfield;
 * albedo is replaced with a proper equirect Earth photo (not procedural dirt).
 */
import { BELLY_FEATURE, sampleFissureCavity, sampleHeightUV, } from "../sphere-surface-methods/heightfield.js";
import { bakeSurfaceMaps, } from "../sphere-surface-methods/maps.js";
import { EARTH_CRACK_ALBEDO_PATH, EARTH_CRACK_HEIGHT_SOURCE, EARTH_CRACK_MAP_SIZE, } from "./config.js";
/**
 * Bake fissure structural height + normals + cone, then paint Earth equirect
 * as the sole surface albedo (with cavity darkening so trenches still read).
 *
 * `earthRgba` is optional: when omitted (Node smoke), albedo stays a neutral
 * placeholder but maps still carry the real fissure heightfield; the page
 * always loads `EARTH_CRACK_ALBEDO_PATH` in the browser.
 */
export function bakeEarthCrackMaps(width = EARTH_CRACK_MAP_SIZE, height = EARTH_CRACK_MAP_SIZE, earthRgba) {
    // Structural height = natural crack / geological fissure path (not test shapes).
    const maps = bakeSurfaceMaps(width, height);
    if (earthRgba && earthRgba.width > 0 && earthRgba.height > 0) {
        applyEarthEquirectAlbedo(maps, earthRgba.data, earthRgba.width, earthRgba.height);
    }
    else {
        // Placeholder: blue-ish Earth-like tint (not dirt/grass procedural ground).
        // Browser path overwrites with earthmap.jpg before upload.
        paintNeutralOceanLandPlaceholder(maps);
    }
    return {
        ...maps,
        albedoPath: EARTH_CRACK_ALBEDO_PATH,
        heightSource: EARTH_CRACK_HEIGHT_SOURCE,
    };
}
/**
 * Paint full equirect Earth as albedo. Deep structural cavities are darkened
 * so the belly fissure still reads without swapping to procedural dirt.
 */
export function applyEarthEquirectAlbedo(maps, rgba, srcW, srcH) {
    const { width, height, albedo, heightFloat } = maps;
    if (srcW < 1 || srcH < 1)
        return;
    for (let y = 0; y < height; y++) {
        const v = y / Math.max(1, height - 1);
        const sy = Math.min(srcH - 1, Math.floor(v * (srcH - 1)));
        for (let x = 0; x < width; x++) {
            const u = x / width;
            const sx = Math.min(srcW - 1, Math.floor(u * srcW) % srcW);
            const si = (sy * srcW + sx) * 4;
            const o = (y * width + x) * 4;
            let er = rgba[si] / 255;
            let eg = rgba[si + 1] / 255;
            let eb = rgba[si + 2] / 255;
            // Darken trench floors (structural height low → deep)
            const h = heightFloat[y * width + x];
            if (h < 0.55) {
                const t = h / 0.55;
                const shade = 0.18 + 0.82 * t * t;
                er *= shade;
                eg *= shade;
                eb *= shade;
            }
            albedo[o] = Math.min(255, (er * 255) | 0);
            albedo[o + 1] = Math.min(255, (eg * 255) | 0);
            albedo[o + 2] = Math.min(255, (eb * 255) | 0);
            albedo[o + 3] = 255;
        }
    }
}
/** Soft blue oceans / green land stand-in when no photo is loaded yet. */
function paintNeutralOceanLandPlaceholder(maps) {
    const { width, height, albedo, heightFloat } = maps;
    for (let y = 0; y < height; y++) {
        const v = y / Math.max(1, height - 1);
        for (let x = 0; x < width; x++) {
            const u = x / width;
            const o = (y * width + x) * 4;
            const h = heightFloat[y * width + x];
            // Pseudo continents from low-frequency noise on UV (not dirt fbm bake)
            const land = 0.5 +
                0.35 * Math.sin(u * Math.PI * 4 + 0.4) * Math.cos(v * Math.PI * 3) +
                0.2 * Math.sin(u * Math.PI * 9 - v * 5);
            const isLand = land > 0.52;
            let r = isLand ? 0.28 + 0.12 * land : 0.08;
            let g = isLand ? 0.38 + 0.1 * land : 0.22;
            let b = isLand ? 0.18 : 0.48;
            if (h < 0.55) {
                const t = h / 0.55;
                const shade = 0.2 + 0.8 * t * t;
                r *= shade;
                g *= shade;
                b *= shade;
            }
            albedo[o] = (r * 255) | 0;
            albedo[o + 1] = (g * 255) | 0;
            albedo[o + 2] = (b * 255) | 0;
            albedo[o + 3] = 255;
        }
    }
}
/**
 * Known UV probes for smoke: crust high vs belly fissure deep.
 * Uses shipped `sampleHeightUV` / `sampleFissureCavity` — not a reimplementation.
 */
export function probeFissureVsCrust() {
    // Crust far from belly trench (back / polar-ish)
    const crustH = sampleHeightUV(0.05, 0.12);
    // Near known collapse pit on main trench (heightfield.ts pits)
    const fissureU = 0.52;
    const fissureV = 0.52;
    const fissureH = sampleHeightUV(fissureU, fissureV);
    const fissureCavity = sampleFissureCavity(fissureU, fissureV);
    return {
        crustH,
        fissureH,
        fissureCavity,
        bellyFeature: BELLY_FEATURE,
        heightSource: EARTH_CRACK_HEIGHT_SOURCE,
    };
}
/** Mean RGB of albedo atlas (smoke: after Earth apply, blue channel present). */
export function albedoMeanRgb(albedo, width, height) {
    const n = width * height;
    if (n < 1)
        return { r: 0, g: 0, b: 0 };
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        sr += albedo[o];
        sg += albedo[o + 1];
        sb += albedo[o + 2];
    }
    return { r: sr / n, g: sg / n, b: sb / n };
}
//# sourceMappingURL=earth-maps.js.map