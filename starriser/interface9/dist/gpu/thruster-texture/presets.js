/**
 * Named starting points for the thruster texture creator UI.
 * Values are equation params — not baked bitmaps.
 */
function glow(partial) {
    return {
        enabled: true,
        intensity: 1,
        radialSigma: 0.12,
        lengthDecay: 1.2,
        lengthPower: 1.4,
        lengthExtent: 1,
        lengthOffset: 0,
        ...partial,
    };
}
export function defaultParams(widthPx = 512, heightPx = 128) {
    return {
        widthPx,
        heightPx,
        trailWidth: 1,
        trailLength: 1,
        core: glow({
            color: { r: 0.95, g: 0.98, b: 1 },
            intensity: 2.4,
            radialSigma: 0.07,
            lengthDecay: 0.9,
            lengthPower: 1.1,
            lengthExtent: 0.85,
        }),
        midGlow: glow({
            color: { r: 0.25, g: 0.65, b: 1 },
            intensity: 1.35,
            radialSigma: 0.18,
            lengthDecay: 1.1,
            lengthPower: 1.3,
            lengthExtent: 1,
        }),
        outerGlow: glow({
            color: { r: 0.08, g: 0.28, b: 0.85 },
            intensity: 0.75,
            radialSigma: 0.42,
            lengthDecay: 1.4,
            lengthPower: 1.6,
            lengthExtent: 1,
        }),
        wash: glow({
            color: { r: 0.12, g: 0.35, b: 0.7 },
            intensity: 0.28,
            radialSigma: 0.65,
            lengthDecay: 0.6,
            lengthPower: 0.9,
            lengthExtent: 1,
        }),
        rings: {
            enabled: true,
            count: 7,
            thickness: 0.018,
            intensity: 0.85,
            color: { r: 0.55, g: 0.85, b: 1 },
            uStart: 0.08,
            uEnd: 0.72,
            radialSigma: 0.22,
        },
        shocks: {
            enabled: true,
            count: 5,
            intensity: 1.1,
            color: { r: 0.85, g: 0.95, b: 1 },
            uStart: 0.06,
            spacing: 0.11,
            halfLength: 0.035,
            radialSigma: 0.09,
        },
        noise: {
            enabled: true,
            intensity: 0.22,
            freqU: 18,
            freqV: 9,
        },
        exposure: 1,
        gamma: 0.9,
    };
}
/** Hot chemical / afterburner orange wash. */
export function presetOrangeJet(widthPx = 512, heightPx = 128) {
    const p = defaultParams(widthPx, heightPx);
    p.core.color = { r: 1, g: 0.98, b: 0.9 };
    p.core.intensity = 2.6;
    p.midGlow.color = { r: 1, g: 0.55, b: 0.12 };
    p.midGlow.intensity = 1.5;
    p.outerGlow.color = { r: 0.95, g: 0.2, b: 0.05 };
    p.outerGlow.intensity = 0.9;
    p.wash.color = { r: 0.7, g: 0.15, b: 0.02 };
    p.rings.color = { r: 1, g: 0.75, b: 0.35 };
    p.shocks.color = { r: 1, g: 0.95, b: 0.75 };
    return p;
}
/** Thin needle ion / sci-fi blue laser plume. */
export function presetIonNeedle(widthPx = 512, heightPx = 128) {
    const p = defaultParams(widthPx, heightPx);
    p.trailWidth = 0.45;
    p.trailLength = 1.25;
    p.core.radialSigma = 0.035;
    p.core.intensity = 3.2;
    p.midGlow.radialSigma = 0.09;
    p.midGlow.color = { r: 0.4, g: 0.9, b: 1 };
    p.outerGlow.radialSigma = 0.22;
    p.outerGlow.color = { r: 0.05, g: 0.45, b: 0.95 };
    p.rings.enabled = true;
    p.rings.count = 11;
    p.rings.thickness = 0.01;
    p.shocks.enabled = false;
    p.noise.intensity = 0.12;
    return p;
}
/** Soft wide plasma exhaust without hard rings. */
export function presetSoftPlasma(widthPx = 512, heightPx = 128) {
    const p = defaultParams(widthPx, heightPx);
    p.trailWidth = 1.35;
    p.core.radialSigma = 0.14;
    p.midGlow.radialSigma = 0.32;
    p.outerGlow.radialSigma = 0.58;
    p.rings.enabled = false;
    p.shocks.enabled = false;
    p.noise.intensity = 0.35;
    p.noise.freqU = 11;
    p.midGlow.color = { r: 0.55, g: 0.35, b: 1 };
    p.outerGlow.color = { r: 0.35, g: 0.1, b: 0.75 };
    p.wash.color = { r: 0.25, g: 0.05, b: 0.45 };
    return p;
}
export const PRESET_NAMES = [
    "blue-jet",
    "orange-jet",
    "ion-needle",
    "soft-plasma",
];
export function paramsForPreset(name, widthPx = 512, heightPx = 128) {
    switch (name) {
        case "orange-jet":
            return presetOrangeJet(widthPx, heightPx);
        case "ion-needle":
            return presetIonNeedle(widthPx, heightPx);
        case "soft-plasma":
            return presetSoftPlasma(widthPx, heightPx);
        case "blue-jet":
        default:
            return defaultParams(widthPx, heightPx);
    }
}
//# sourceMappingURL=presets.js.map