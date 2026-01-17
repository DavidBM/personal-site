/**
 * Color blending and gradient utilities.
 *
 * All functions assume colors are specified as HTML-style numbers (0xRRGGBB),
 * or as [r,g,b] arrays, where r,g,b ∈ 0..1 (floats).
 *
 * Exposes:
 *   - blendColorRGB: Interpolates linearly between two colors.
 *   - rgbToHex: Converts [r,g,b] ∈ 0..1 to hex number (0xRRGGBB)
 *   - hexToRgb: Converts hex number (0xRRGGBB) to [r,g,b] ∈ 0..1
 *   - makeColorGradient: Returns an array of n blended colors from colorA to colorB.
 *   - blendColorHSV: Like blendColorRGB, but with HSV interpolation (visually smoother).
 */
export function blendColorRGB(colorA, colorB, factor) {
    const a = Array.isArray(colorA) ? colorA : hexToRgb(colorA);
    const b = Array.isArray(colorB) ? colorB : hexToRgb(colorB);
    return [
        a[0] + (b[0] - a[0]) * factor,
        a[1] + (b[1] - a[1]) * factor,
        a[2] + (b[2] - a[2]) * factor,
    ];
}
/**
 * Returns a [r,g,b] array for a color hex number (0xRRGGBB).
 * @param {number} hex
 * @returns {RgbTuple}
 */
export function hexToRgb(hex) {
    return [
        ((hex >> 16) & 0xff) / 255,
        ((hex >> 8) & 0xff) / 255,
        (hex & 0xff) / 255,
    ];
}
/**
 * Returns a color hex number (0xRRGGBB) for [r,g,b] floats.
 * @param {RgbTuple} rgb
 * @returns {number}
 */
export function rgbToHex(rgb) {
    const r = Math.round(rgb[0] * 255);
    const g = Math.round(rgb[1] * 255);
    const b = Math.round(rgb[2] * 255);
    return (r << 16) | (g << 8) | b;
}
/**
 * Returns an array of n blended colors from colorA to colorB.
 * @param {ColorInput} colorA
 * @param {ColorInput} colorB
 * @param {number} n
 * @param {boolean} [hsv=false] - Use HSV interpolation if true.
 * @returns {RgbTuple[]} of [r,g,b]
 */
export function makeColorGradient(colorA, colorB, n, hsv = false) {
    const out = [];
    for (let i = 0; i < n; ++i) {
        const f = n === 1 ? 0.5 : i / (n - 1);
        out.push(hsv ? blendColorHSV(colorA, colorB, f) : blendColorRGB(colorA, colorB, f));
    }
    return out;
}
/**
 * Converts [r,g,b] to [h,s,v], all in 0..1.
 * @param {RgbTuple} rgb
 * @returns {RgbTuple}
 */
function rgbToHsv([r, g, b]) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s, v = max;
    const d = max - min;
    s = max === 0 ? 0 : d / max;
    if (max === min) {
        h = 0;
    }
    else {
        switch (max) {
            case r:
                h = (g - b) / d + (g < b ? 6 : 0);
                break;
            case g:
                h = (b - r) / d + 2;
                break;
            case b:
                h = (r - g) / d + 4;
                break;
        }
        h /= 6;
    }
    return [h, s, v];
}
/**
 * Converts [h,s,v] to [r,g,b], all in 0..1.
 * @param {RgbTuple} hsv
 * @returns {RgbTuple}
 */
function hsvToRgb([h, s, v]) {
    let r = 0, g = 0, b = 0;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
        case 0:
            ((r = v), (g = t), (b = p));
            break;
        case 1:
            ((r = q), (g = v), (b = p));
            break;
        case 2:
            ((r = p), (g = v), (b = t));
            break;
        case 3:
            ((r = p), (g = q), (b = v));
            break;
        case 4:
            ((r = t), (g = p), (b = v));
            break;
        case 5:
            ((r = v), (g = p), (b = q));
            break;
    }
    return [r, g, b];
}
/**
 * Linearly blends two colors in HSV space for perceptual gradient.
 * @param {ColorInput} colorA
 * @param {ColorInput} colorB
 * @param {number} factor - 0=start, 1=end
 * @returns {RgbTuple}
 */
export function blendColorHSV(colorA, colorB, factor) {
    const a = Array.isArray(colorA) ? colorA : hexToRgb(colorA);
    const b = Array.isArray(colorB) ? colorB : hexToRgb(colorB);
    const hsvA = rgbToHsv(a);
    const hsvB = rgbToHsv(b);
    // Special care for hue interpolation (go shortest path)
    let h1 = hsvA[0], h2 = hsvB[0];
    if (Math.abs(h1 - h2) > 0.5) {
        if (h1 > h2)
            h2 += 1;
        else
            h1 += 1;
    }
    const h = (h1 + (h2 - h1) * factor) % 1;
    const s = hsvA[1] + (hsvB[1] - hsvA[1]) * factor;
    const v = hsvA[2] + (hsvB[2] - hsvA[2]) * factor;
    return hsvToRgb([h, s, v]);
}
//# sourceMappingURL=color.js.map