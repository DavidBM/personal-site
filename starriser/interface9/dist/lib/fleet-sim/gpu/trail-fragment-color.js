/**
 * Pure thruster trail fragment color (mirrors fleet-trails FS).
 * Engine trails are overexposed light emitters: hard exposure boost +
 * premultiplied RGB for **additive** self-overlap (src=one, dst=one).
 * Stacked cores merge bright; dark halo never darkens a brighter layer.
 */
export const TRAIL_EXPOSURE_DEFAULT = 3.4;
/**
 * Production trail pipeline color blend (WebGPU GPUBlendComponent).
 * Additive self-overlap: src + dst so thruster cores merge like light.
 */
export const TRAIL_BLEND_COLOR = {
    srcFactor: "one",
    dstFactor: "one",
    operation: "add",
};
/** Alpha channel also additive (coverage accumulates; clamped by target). */
export const TRAIL_BLEND_ALPHA = {
    srcFactor: "one",
    dstFactor: "one",
    operation: "add",
};
function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}
/**
 * Soft edge mask across a solid ribbon (1 at center, 0 at edges).
 * `across01` is 0..1 from one side to the other (0.5 = centerline).
 */
export function solidTrailEdgeMask(across01) {
    const t = Number.isFinite(across01) ? across01 : 0.5;
    // Distance from centerline in [0, 0.5]; soft falloff near edges only.
    const d = Math.abs(t - 0.5);
    if (d <= 0.32)
        return 1;
    if (d >= 0.5)
        return 0;
    // smoothstep-ish from 0.32 → 0.5
    const u = (d - 0.32) / 0.18;
    const s = u * u * (3 - 2 * u);
    return 1 - s;
}
/**
 * Trail fragment color (mirrors fleet-trails FS).
 *
 * - **solidLine** (2D strategic): ship triangle RGB × age α × soft edge; no atlas/exposure.
 * - **thruster** (3D model): bright atlas × tint × exposure, premultiplied.
 * Output is for additive blend: dst' = src + dst (one/one).
 */
export function trailFragmentColor(input) {
    if (input.solidLine) {
        const edge = input.across01 !== undefined
            ? solidTrailEdgeMask(input.across01)
            : 1;
        const a = clamp01(input.vertA) * edge;
        const r = Math.max(0, input.vertR);
        const g = Math.max(0, input.vertG);
        const b = Math.max(0, input.vertB);
        return { r: r * a, g: g * a, b: b * a, a };
    }
    const inten = input.intensity > 0 && Number.isFinite(input.intensity)
        ? input.intensity
        : 1;
    const exp = input.exposure > 0 && Number.isFinite(input.exposure)
        ? input.exposure
        : TRAIL_EXPOSURE_DEFAULT;
    const tintR = Math.max(input.vertR, 0.25);
    const tintG = Math.max(input.vertG, 0.25);
    const tintB = Math.max(input.vertB, 0.25);
    // Transparency = atlas only (matches FS thruster path).
    const a = clamp01(input.texA);
    // Hard boost — channels can exceed 1 (overexposed core)
    const r = input.texR * tintR * inten * exp;
    const g = input.texG * tintG * inten * exp;
    const b = input.texB * tintB * inten * exp;
    // Premultiply so soft edge fades contribution under one/one additive.
    return { r: r * a, g: g * a, b: b * a, a };
}
/** Legacy dim multiply (pre-overexpose + age-faded alpha) for regression comparison. */
export function trailFragmentColorDim(input) {
    const inten = input.intensity > 0 && Number.isFinite(input.intensity) ? input.intensity : 1;
    const a = clamp01(input.vertA * inten * input.texA);
    const r = input.texR * Math.max(input.vertR, 0.25) * inten;
    const g = input.texG * Math.max(input.vertG, 0.25) * inten;
    const b = input.texB * Math.max(input.vertB, 0.25) * inten;
    return { r, g, b, a };
}
/**
 * Production composite: additive stack of two premultiplied trail fragments.
 * Bright energy never decreases when a second layer is added.
 */
export function compositeTrailAdditive(dst, src) {
    return {
        r: dst.r + src.r,
        g: dst.g + src.g,
        b: dst.b + src.b,
        a: clamp01(dst.a + src.a),
    };
}
/**
 * Legacy premultiplied alpha-over (src over dst):
 *   out = src + dst * (1 − src.a)
 * Dark high-α halo can darken a bright core underneath — NOT production.
 */
export function compositeTrailAlphaOver(dst, src) {
    const ia = 1 - clamp01(src.a);
    return {
        r: src.r + dst.r * ia,
        g: src.g + dst.g * ia,
        b: src.b + dst.b * ia,
        a: clamp01(src.a + dst.a * ia),
    };
}
//# sourceMappingURL=trail-fragment-color.js.map