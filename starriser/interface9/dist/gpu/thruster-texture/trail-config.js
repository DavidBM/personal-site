/**
 * The trail texture settings as stored and exported by the model viewer
 * (`trailTextures` in its JSON): up to eight ribbon styles (each one ribbon
 * texture's generator parameters) and up to eight glow styles. Emitters and
 * glows name a style by id. Normalising fills anything missing from older or
 * partial JSON with defaults and drops what does not fit, so the viewer (from
 * localStorage) and the bake script (from an export) read the same JSON into
 * the same parameters, and so the same pixels. Pure — no DOM / WebGPU.
 */
import { cloneParams, generateThrusterTexture, paramsForPreset } from "./generator.js";
import { generateGlowTexture, GLOW_LAYER_TYPES, glowStyleForPreset, makeGlowLayer } from "./glow-generator.js";
export const RIBBON_TEXTURE_W = 512;
export const RIBBON_TEXTURE_H = 128;
export const GLOW_TEXTURE_SIZE = 256;
export const MAX_RIBBON_STYLES = 8;
export const MAX_GLOW_STYLES = 8;
export const TRAIL_TEXTURE_UNIT = "generator parameters (js/gpu/thruster-texture: generator.ts for ribbon styles, glow-generator.ts for glow styles), "
    + "colours linear 0-1; ribbon styles: u along the trail (column 0 = emitter at full strength, last = tail end), v across; "
    + "glow styles: square sprites with the light at the centre; images: node scripts/bake-trail-textures.mjs";
const asObj = (value) => (value && typeof value === "object" ? value : {});
/** `stored` values replace `base` values of the same type, key by key; anything else keeps the default. */
export function mergeDefaults(base, stored) {
    if (typeof base !== "object" || base === null)
        return (typeof stored === typeof base ? stored : base);
    if (!stored || typeof stored !== "object")
        return base;
    const out = { ...base };
    for (const key of Object.keys(out))
        out[key] = mergeDefaults(out[key], stored[key]);
    return out;
}
export function normalizeRibbon(stored) {
    const ribbon = mergeDefaults(paramsForPreset("blue-jet", RIBBON_TEXTURE_W, RIBBON_TEXTURE_H), stored);
    return { ...ribbon, widthPx: RIBBON_TEXTURE_W, heightPx: RIBBON_TEXTURE_H };
}
export function ribbonStyleForPreset(preset, id = "ribbon-1", name = "Engine trail") {
    return { id, name, params: cloneParams(paramsForPreset(preset, RIBBON_TEXTURE_W, RIBBON_TEXTURE_H)) };
}
export function normalizeRibbonStyle(stored, index) {
    const s = asObj(stored);
    return {
        id: typeof s.id === "string" ? s.id : `ribbon-${index + 1}`,
        name: typeof s.name === "string" ? s.name : index ? `Trail ${index + 1}` : "Engine trail",
        params: normalizeRibbon(s.params),
    };
}
export function normalizeGlowStyle(stored, index) {
    const { layers: defaultLayers, ...head } = glowStyleForPreset("blue-ion", `glow-${index + 1}`, index ? `Glow ${index + 1}` : "Engine glow", GLOW_TEXTURE_SIZE);
    const s = asObj(stored);
    const layers = Array.isArray(s.layers)
        ? s.layers.filter((l) => GLOW_LAYER_TYPES.includes(l?.type)).map((l) => mergeDefaults(makeGlowLayer(l.type), l))
        : defaultLayers;
    return { ...mergeDefaults(head, s), sizePx: GLOW_TEXTURE_SIZE, layers };
}
/** At least one style, at most `max`, with unique ids (a repeated id gets a fresh one). */
function normalizeStyles(stored, max, read) {
    const list = Array.isArray(stored) ? stored.slice(0, max) : [];
    const seen = new Set();
    return (list.length ? list : [undefined]).map(read).map((style, i) => {
        const id = seen.has(style.id) ? `${style.id}-${i + 1}` : style.id;
        seen.add(id);
        return { ...style, id };
    });
}
/** Ribbon styles; JSON from before styles (one `ribbon` parameter set) becomes the first style. */
export function normalizeRibbonStyles(stored, legacyRibbon) {
    if (!Array.isArray(stored) || !stored.length)
        return [normalizeRibbonStyle(legacyRibbon ? { params: legacyRibbon } : undefined, 0)];
    return normalizeStyles(stored, MAX_RIBBON_STYLES, normalizeRibbonStyle);
}
export const normalizeGlowStyles = (stored) => normalizeStyles(stored, MAX_GLOW_STYLES, normalizeGlowStyle);
export function normalizeTrailTextures(stored) {
    const s = asObj(stored);
    return { ribbons: normalizeRibbonStyles(s.ribbons, s.ribbon), glows: normalizeGlowStyles(s.glows) };
}
/** File-safe image names for style ids. */
const fileId = (id) => id.replace(/[^\w-]+/g, "-");
export const ribbonImageName = (id) => `trail-ribbon-${fileId(id)}.png`;
export const glowImageName = (id) => `trail-glow-${fileId(id)}.png`;
/**
 * Every image a `trailTextures` block describes: one per ribbon style, then one
 * per glow style. Glow sprites render at `glowSizePx` (the viewer's
 * GLOW_TEXTURE_SIZE by default; the game bakes them larger).
 */
export function trailTextureImages(stored, glowSizePx = GLOW_TEXTURE_SIZE) {
    const config = normalizeTrailTextures(stored);
    return [
        ...config.ribbons.map((style) => ({ name: ribbonImageName(style.id), image: generateThrusterTexture(style.params) })),
        ...config.glows.map((style) => ({ name: glowImageName(style.id), image: generateGlowTexture({ ...style, sizePx: glowSizePx }) })),
    ];
}
//# sourceMappingURL=trail-config.js.map