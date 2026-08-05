/**
 * URL query persistence for planet texture authoring params.
 */
import { cloneParams, defaultParams } from "./presets.js";
const NUM_KEYS = [
    "seed",
    "resolution",
    "poleSize",
    "liquidLevel",
    "heightOctaves",
    "heightFreq",
    "warp",
    "thermalIters",
    "hydraulicDrops",
    "bandStrength",
    "stormDensity",
    "cloudCover",
    "colorBoost",
    "wetness",
    "continentScale",
    "mountainScale",
    "terrainFeatureStrength",
];
const TF_BLEND_MODES = [
    "luminosity",
    "multiply",
    "softLight",
    "overlay",
    "screen",
    "linear",
    "lerp",
];
function parseTfBlend(raw) {
    if (!raw)
        return null;
    return TF_BLEND_MODES.includes(raw)
        ? raw
        : null;
}
export function paramsToQuery(p) {
    const c = cloneParams(p);
    const q = new URLSearchParams();
    q.set("class", c.planetClass);
    q.set("liquid", c.liquidKind);
    for (const k of NUM_KEYS) {
        const v = c[k];
        if (v === undefined)
            continue;
        q.set(k, String(v));
    }
    q.set("atmR", String(c.atmTint.r));
    q.set("atmG", String(c.atmTint.g));
    q.set("atmB", String(c.atmTint.b));
    q.set("softCoast", c.softCoastEnabled !== false ? "1" : "0");
    if (c.terrainFeatureBlend) {
        q.set("tfBlend", c.terrainFeatureBlend);
    }
    return q.toString();
}
export function paramsFromQuery(search, fallback = defaultParams()) {
    const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const p = cloneParams(fallback);
    const cls = q.get("class");
    if (cls === "rocky" ||
        cls === "ocean" ||
        cls === "temperate" ||
        cls === "gas" ||
        cls === "ice" ||
        cls === "exotic") {
        p.planetClass = cls;
    }
    const liq = q.get("liquid");
    if (liq === "water" ||
        liq === "methane" ||
        liq === "acid" ||
        liq === "lava" ||
        liq === "none") {
        p.liquidKind = liq;
    }
    for (const k of NUM_KEYS) {
        const raw = q.get(k);
        if (raw == null)
            continue;
        const n = Number(raw);
        if (Number.isFinite(n)) {
            // NUM_KEYS are numeric fields only
            p[k] = n;
        }
    }
    const ar = Number(q.get("atmR"));
    const ag = Number(q.get("atmG"));
    const ab = Number(q.get("atmB"));
    if (Number.isFinite(ar) && Number.isFinite(ag) && Number.isFinite(ab)) {
        p.atmTint = { r: ar, g: ag, b: ab };
    }
    const softCoast = q.get("softCoast");
    if (softCoast === "0" || softCoast === "false" || softCoast === "off") {
        p.softCoastEnabled = false;
    }
    else if (softCoast === "1" || softCoast === "true" || softCoast === "on") {
        p.softCoastEnabled = true;
    }
    const tfBlend = parseTfBlend(q.get("tfBlend") ?? q.get("terrainFeatureBlend"));
    if (tfBlend)
        p.terrainFeatureBlend = tfBlend;
    if (p.terrainFeatureStrength !== undefined &&
        Number.isFinite(p.terrainFeatureStrength)) {
        p.terrainFeatureStrength = Math.max(0, Math.min(1, p.terrainFeatureStrength));
    }
    return cloneParams(p);
}
//# sourceMappingURL=url-state.js.map