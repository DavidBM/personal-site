/**
 * Live-tunable atmosphere / limb params for the solar-system showcase.
 * Pure defaults + serialize for copy-paste / URL query.
 * Keep numeric defaults in sync with planet-disc.wgsl.ts initial values.
 */
export const PLANET_ATM_DEFAULTS = Object.freeze({
    edgeInner: 0.992,
    edgeOuter: 1.0,
    atmOuter: 1.28,
    atmThick: 0.18,
    intensity: 16,
    extScale: 0.55,
    atmGain: 1.15,
    camDist: 10,
    rInner: 1.0,
    drawMarginMul: 1.0,
    mieEmit: 18,
    colorR: 4.2,
    colorG: 14.5,
    colorB: 36.0,
    glowMul: 1.0,
    texIntensity: 1.15,
    ambient: 0.06,
    dayStrength: 0.94,
    specStrength: 0.55,
    specPower: 48,
    cloudAmount: 0.55,
    nightLights: 1.15,
    normalStrength: 0.55,
    edgeAaPx: 1.25,
});
/**
 * User-tuned Azure (ocean multi-map) look — restored after 30-planet expand.
 * Paste-compatible with body=azure.
 */
export const AZURE_ATM_PRESET = Object.freeze({
    edgeInner: 0.995,
    edgeOuter: 1.0,
    atmOuter: 1.28,
    atmThick: 0.18,
    intensity: 9,
    extScale: 0.3,
    atmGain: 0.65,
    camDist: 40,
    rInner: 0.99,
    drawMarginMul: 2.23,
    mieEmit: 18,
    colorR: 4.2,
    colorG: 14.5,
    colorB: 36.0,
    glowMul: 0.35,
    texIntensity: 1.15,
    ambient: 0.06,
    dayStrength: 0.78,
    specStrength: 0.8,
    specPower: 91,
    cloudAmount: 0.86,
    nightLights: 1.15,
    normalStrength: 0.04,
    edgeAaPx: 1.0,
});
/** Per-body showcase presets keyed by stable body id. */
export const BODY_ATM_PRESETS = Object.freeze({
    azure: AZURE_ATM_PRESET,
});
/** Default atm for a body id (preset if any, else global defaults). */
export function defaultAtmForBodyId(bodyId) {
    const p = BODY_ATM_PRESETS[bodyId];
    return cloneAtmParams(p ?? PLANET_ATM_DEFAULTS);
}
const CLAMP = {
    edgeInner: { min: 0.9, max: 1.0 },
    edgeOuter: { min: 0.95, max: 1.05 },
    atmOuter: { min: 1.02, max: 1.8 },
    atmThick: { min: 0.02, max: 0.5 },
    intensity: { min: 0.5, max: 80 },
    extScale: { min: 0.05, max: 2 },
    atmGain: { min: 0.1, max: 5 },
    camDist: { min: 2, max: 40 },
    rInner: { min: 0.9, max: 1.1 },
    drawMarginMul: { min: 0.8, max: 2.5 },
    mieEmit: { min: 1, max: 60 },
    colorR: { min: 0, max: 80 },
    colorG: { min: 0, max: 80 },
    colorB: { min: 0, max: 80 },
    glowMul: { min: 0.1, max: 4 },
    texIntensity: { min: 0.2, max: 3 },
    ambient: { min: 0, max: 0.5 },
    dayStrength: { min: 0.2, max: 1.5 },
    specStrength: { min: 0, max: 4 },
    specPower: { min: 4, max: 256 },
    cloudAmount: { min: 0, max: 1 },
    nightLights: { min: 0, max: 4 },
    normalStrength: { min: 0, max: 2 },
    edgeAaPx: { min: 0.25, max: 4 },
};
export function clampAtmParams(p) {
    const o = { ...p };
    for (const k of Object.keys(CLAMP)) {
        const { min, max } = CLAMP[k];
        let v = o[k];
        if (!Number.isFinite(v))
            v = PLANET_ATM_DEFAULTS[k];
        o[k] = Math.min(max, Math.max(min, v));
    }
    // Keep inner < outer for softstep
    if (o.edgeInner >= o.edgeOuter) {
        o.edgeInner = Math.max(CLAMP.edgeInner.min, o.edgeOuter - 0.005);
    }
    if (o.atmOuter <= o.edgeOuter) {
        o.atmOuter = o.edgeOuter + 0.05;
    }
    return o;
}
export function cloneAtmParams(p = PLANET_ATM_DEFAULTS) {
    return clampAtmParams({ ...p });
}
export function atmParamBounds(key) {
    const c = CLAMP[key];
    const ui = ATM_PARAM_UI.find((u) => u.key === key);
    return {
        min: c.min,
        max: c.max,
        step: ui?.step ?? 0.01,
    };
}
/** Single-body block (also used inside multi-body export). */
export function formatAtmParams(p, meta) {
    const c = clampAtmParams(p);
    const keys = Object.keys(PLANET_ATM_DEFAULTS);
    const lines = [
        "planet-atm v3",
        `# paste this block to retune atmosphere / planet surface / limb`,
    ];
    if (meta?.bodyId)
        lines.push(`body=${meta.bodyId}`);
    if (meta?.bodyName)
        lines.push(`bodyName=${meta.bodyName}`);
    lines.push(...keys.map((k) => `${k}=${c[k]}`));
    return lines.join("\n");
}
/**
 * Multi-body export: one section per body so you can round-trip the whole system.
 */
export function formatAllBodyAtmParams(bodies, paramsByIndex, selectedId) {
    const parts = [
        "planet-atm v3-multi",
        `# each --- body=id section is independent; selected= focuses UI`,
    ];
    if (selectedId)
        parts.push(`selected=${selectedId}`);
    for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        const p = paramsByIndex[i] ?? PLANET_ATM_DEFAULTS;
        parts.push("---");
        parts.push(formatAtmParams(p, { bodyId: b.id, bodyName: b.name }));
    }
    return parts.join("\n");
}
/** Parse a single body key=value block. Unknown keys ignored. */
export function parseAtmParams(text, base = PLANET_ATM_DEFAULTS) {
    const out = cloneAtmParams(base);
    const keys = new Set(Object.keys(PLANET_ATM_DEFAULTS));
    for (const raw of text.split(/[\n&]/)) {
        const line = raw.trim();
        if (!line ||
            line.startsWith("#") ||
            line.startsWith("planet-atm") ||
            line === "---" ||
            line.startsWith("body=") ||
            line.startsWith("bodyName=") ||
            line.startsWith("selected=")) {
            continue;
        }
        const eq = line.indexOf("=");
        if (eq < 0)
            continue;
        const k = line.slice(0, eq).trim();
        const v = Number(line.slice(eq + 1).trim());
        if (keys.has(k) && Number.isFinite(v)) {
            out[k] = v;
        }
    }
    return clampAtmParams(out);
}
/** Parse multi-body or single-body paste. */
export function parseAllBodyAtmParams(text, base = PLANET_ATM_DEFAULTS) {
    const t = text.trim();
    if (!t)
        return { byId: new Map() };
    let selectedId;
    for (const raw of t.split("\n")) {
        const line = raw.trim();
        if (line.startsWith("selected=")) {
            selectedId = line.slice("selected=".length).trim();
        }
    }
    if (t.includes("v3-multi") || t.includes("\n---")) {
        const sections = t.split(/\n---\n|\n---$/m);
        const byId = new Map();
        for (const sec of sections) {
            let bodyId;
            for (const raw of sec.split("\n")) {
                const line = raw.trim();
                if (line.startsWith("body="))
                    bodyId = line.slice(5).trim();
            }
            if (!bodyId)
                continue;
            byId.set(bodyId, parseAtmParams(sec, base));
        }
        return { byId, selectedId };
    }
    // Single-body block (optional body= line)
    let bodyId;
    for (const raw of t.split("\n")) {
        const line = raw.trim();
        if (line.startsWith("body="))
            bodyId = line.slice(5).trim();
    }
    const single = parseAtmParams(t, base);
    const byId = new Map();
    if (bodyId)
        byId.set(bodyId, single);
    return { byId, selectedId: selectedId ?? bodyId, single };
}
/** URL query: compact JSON of all bodies + selected id. */
export function allBodyAtmToQuery(bodies, paramsByIndex, selectedId) {
    const obj = { sel: selectedId, v: 3 };
    for (let i = 0; i < bodies.length; i++) {
        obj[bodies[i].id] = clampAtmParams(paramsByIndex[i] ?? PLANET_ATM_DEFAULTS);
    }
    return `atm=${encodeURIComponent(JSON.stringify(obj))}`;
}
/**
 * Read `atm=` JSON from the URL. Bodies missing from the JSON keep their
 * per-id preset (via `presetForId`) — never silently wipe Azure (etc.) back
 * to global defaults when the URL was saved under old body ids.
 */
export function allBodyAtmFromQuery(search, bodies, base = PLANET_ATM_DEFAULTS, presetForId) {
    const fallback = (id) => clampAtmParams(presetForId ? presetForId(id) : { ...base });
    const q = search.startsWith("?") ? search.slice(1) : search;
    const sp = new URLSearchParams(q);
    const raw = sp.get("atm");
    if (!raw) {
        // Legacy single-body query (flat keys only — ignore sun= / other params)
        const hasAtmKey = [...sp.keys()].some((k) => k in PLANET_ATM_DEFAULTS);
        if (hasAtmKey) {
            const single = parseAtmParams(q.replace(/&/g, "\n"), base);
            return {
                params: bodies.map((b) => {
                    // Only apply legacy flat query to the selected/focused body is unknown —
                    // keep presets for showcase bodies so azure is not mass-overwritten.
                    if (BODY_ATM_PRESETS[b.id])
                        return fallback(b.id);
                    return cloneAtmParams(single);
                }),
                selectedId: undefined,
                explicitIds: new Set(),
            };
        }
        return null;
    }
    try {
        const obj = JSON.parse(raw);
        const selectedId = typeof obj.sel === "string" ? obj.sel : undefined;
        const explicitIds = new Set();
        const params = bodies.map((b) => {
            const p = obj[b.id];
            if (p && typeof p === "object") {
                explicitIds.add(b.id);
                // Merge onto that body's preset/default so missing keys stay sensible
                return clampAtmParams({
                    ...fallback(b.id),
                    ...p,
                });
            }
            return fallback(b.id);
        });
        return { params, selectedId, explicitIds };
    }
    catch {
        return null;
    }
}
/** @deprecated prefer allBodyAtmToQuery — kept for single-body helpers/tests */
export function atmParamsToQuery(p) {
    const c = clampAtmParams(p);
    return Object.keys(PLANET_ATM_DEFAULTS)
        .map((k) => `${k}=${c[k]}`)
        .join("&");
}
export function atmParamsFromQuery(search, base = PLANET_ATM_DEFAULTS) {
    const q = search.startsWith("?") ? search.slice(1) : search;
    return parseAtmParams(q.replace(/&/g, "\n"), base);
}
/** UI metadata for building controls. */
export const ATM_PARAM_UI = [
    { key: "edgeInner", label: "Planet cut (inner soft)", step: 0.001, group: "limb" },
    { key: "edgeOuter", label: "Planet limb (outer)", step: 0.001, group: "limb" },
    { key: "edgeAaPx", label: "Limb AA (pixels)", step: 0.05, group: "limb" },
    { key: "rInner", label: "Scatter R_INNER (limb)", step: 0.001, group: "limb" },
    { key: "atmOuter", label: "Atmosphere outer (rr)", step: 0.01, group: "limb" },
    { key: "drawMarginMul", label: "Draw margin ×", step: 0.01, group: "limb" },
    { key: "texIntensity", label: "Texture / albedo ×", step: 0.02, group: "surface" },
    { key: "ambient", label: "Ambient light", step: 0.01, group: "surface" },
    { key: "dayStrength", label: "Day lighting", step: 0.02, group: "surface" },
    { key: "specStrength", label: "Specular / glare", step: 0.05, group: "surface" },
    { key: "specPower", label: "Specular power (tightness)", step: 1, group: "surface" },
    { key: "cloudAmount", label: "Cloud whitening", step: 0.02, group: "surface" },
    { key: "nightLights", label: "Night city lights", step: 0.05, group: "surface" },
    { key: "normalStrength", label: "Normal map bump", step: 0.02, group: "surface" },
    { key: "atmThick", label: "Atmosphere thickness", step: 0.01, group: "scatter" },
    { key: "intensity", label: "Scatter intensity", step: 0.5, group: "scatter" },
    { key: "extScale", label: "Extinction (lower=brighter)", step: 0.02, group: "scatter" },
    { key: "atmGain", label: "Atmosphere gain", step: 0.05, group: "scatter" },
    { key: "glowMul", label: "Body glow ×", step: 0.05, group: "scatter" },
    { key: "camDist", label: "Scatter camera dist", step: 0.5, group: "scatter" },
    { key: "mieEmit", label: "Mie emit", step: 0.5, group: "color" },
    { key: "colorR", label: "Atm color R", step: 0.2, group: "color" },
    { key: "colorG", label: "Atm color G", step: 0.2, group: "color" },
    { key: "colorB", label: "Atm color B", step: 0.2, group: "color" },
];
//# sourceMappingURL=planet-atm-params.js.map