/**
 * Live-tunable sun layer params for the solar-system showcase.
 * Pure defaults + clamp + serialize — host packs into sun body UBO look slots.
 * Keep defaults in sync with sun-impostor.wgsl.ts layer multiplies.
 */
/**
 * User-tuned baseline (tight halo, bright disc) + visible internal granulation.
 */
export const SUN_LOOK_DEFAULTS = Object.freeze({
    discGain: 2.5,
    coreLift: 0,
    discWarm: 0.95,
    granGain: 0.72,
    chromGain: 0.52,
    sheathGain: 0.38,
    rayGain: 0.68,
    veilGain: 0.14,
    flareGain: 0,
    outerGain: 0.16,
    outerFalloff: 6,
    outerFadeStart: 1.02,
    // Slightly tighter shell than 2.44 — less empty corona fill, same soft fade feel.
    outerFadeEnd: 2.05,
    drawMarginMul: 0.85,
    glowMul: 0.9,
    limbSoft: 0.021,
});
const CLAMP = {
    discGain: { min: 0.2, max: 4 },
    coreLift: { min: 0, max: 0.25 },
    discWarm: { min: 0, max: 1 },
    granGain: { min: 0, max: 2 },
    chromGain: { min: 0, max: 3 },
    sheathGain: { min: 0, max: 3 },
    rayGain: { min: 0, max: 3 },
    veilGain: { min: 0, max: 1.5 },
    flareGain: { min: 0, max: 3 },
    outerGain: { min: 0, max: 1.5 },
    outerFalloff: { min: 0.3, max: 8 },
    outerFadeStart: { min: 1.02, max: 2.8 },
    outerFadeEnd: { min: 1.2, max: 4.5 },
    drawMarginMul: { min: 0.8, max: 2.5 },
    glowMul: { min: 0.1, max: 3 },
    limbSoft: { min: 0.004, max: 0.05 },
};
export function clampSunLookParams(p) {
    const o = { ...p };
    for (const k of Object.keys(CLAMP)) {
        const { min, max } = CLAMP[k];
        let v = o[k];
        if (!Number.isFinite(v))
            v = SUN_LOOK_DEFAULTS[k];
        o[k] = Math.min(max, Math.max(min, v));
    }
    // Fade end must be after start; leave room under typical margin
    if (o.outerFadeEnd <= o.outerFadeStart + 0.05) {
        o.outerFadeEnd = Math.min(CLAMP.outerFadeEnd.max, o.outerFadeStart + 0.2);
    }
    return o;
}
export function cloneSunLookParams(p = SUN_LOOK_DEFAULTS) {
    return clampSunLookParams({ ...p });
}
export function sunLookParamBounds(key) {
    const c = CLAMP[key];
    const ui = SUN_LOOK_PARAM_UI.find((u) => u.key === key);
    return {
        min: c.min,
        max: c.max,
        step: ui?.step ?? 0.01,
    };
}
export const SUN_LOOK_PARAM_UI = Object.freeze([
    { key: "discGain", label: "Disc gain", step: 0.02, group: "disc" },
    { key: "coreLift", label: "Core lift", step: 0.005, group: "disc" },
    { key: "discWarm", label: "Warm tint (Y→R)", step: 0.02, group: "disc" },
    { key: "granGain", label: "Granulation", step: 0.02, group: "disc" },
    { key: "limbSoft", label: "Limb soft (rr)", step: 0.001, group: "disc" },
    { key: "chromGain", label: "Chromosphere", step: 0.02, group: "rim" },
    { key: "sheathGain", label: "Inner sheath", step: 0.02, group: "rim" },
    { key: "rayGain", label: "Rays / streamers", step: 0.02, group: "rays" },
    { key: "veilGain", label: "Ray veil", step: 0.01, group: "rays" },
    { key: "outerGain", label: "Outer halo", step: 0.01, group: "corona" },
    { key: "outerFalloff", label: "Halo falloff", step: 0.05, group: "corona" },
    { key: "glowMul", label: "Glow ×", step: 0.05, group: "corona" },
    { key: "outerFadeStart", label: "Shell fade start", step: 0.02, group: "shell" },
    { key: "outerFadeEnd", label: "Shell fade end", step: 0.02, group: "shell" },
    { key: "drawMarginMul", label: "Draw margin ×", step: 0.02, group: "shell" },
]);
/** Single-block export for copy/paste. */
export function formatSunLookParams(p) {
    const c = clampSunLookParams(p);
    const keys = Object.keys(SUN_LOOK_DEFAULTS);
    const lines = [
        "sun-look v1",
        `# paste to retune sun disc / rim / rays / corona`,
        ...keys.map((k) => `${k}=${c[k]}`),
    ];
    return lines.join("\n");
}
export function parseSunLookParams(text, base = SUN_LOOK_DEFAULTS) {
    const out = cloneSunLookParams(base);
    const keys = new Set(Object.keys(SUN_LOOK_DEFAULTS));
    for (const raw of text.split(/[\n&]/)) {
        const line = raw.trim();
        if (!line ||
            line.startsWith("#") ||
            line.startsWith("sun-look") ||
            line.startsWith("---")) {
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
    return clampSunLookParams(out);
}
/** Effective corona shell end used by host when packing drawMargin. */
export function sunEffectiveDrawMargin(baseMargin, p) {
    const c = clampSunLookParams(p);
    // Quad must extend past fade end so soft falloff is visible, not clipped.
    const need = c.outerFadeEnd / 0.92;
    return Math.max(baseMargin * c.drawMarginMul, need);
}
//# sourceMappingURL=sun-look-params.js.map