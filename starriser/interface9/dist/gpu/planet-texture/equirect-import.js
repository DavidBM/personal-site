/**
 * Equirectangular texture import validators + apply helpers (AI/DCC-ready).
 *
 * Does NOT call external AI services — only ingest/checks so offline
 * equirect outputs (Blender panosphere, SD tileX seamless, etc.) can replace
 * procedural albedo (and optional height) after validation.
 *
 * Full plate solvers / GCM deferred; import is research item 9a only.
 */
import { seamEdgeMaxDelta } from "./sphere-map.js";
/**
 * Validate an equirect RGBA buffer for planet belly use.
 * Checks 2:1 aspect and U-wrap seam continuity.
 */
export function validateEquirectAlbedo(buf, opts = {}) {
    const seamThreshold = opts.seamThreshold ?? 48;
    const aspectTol = opts.aspectTol ?? 0.12;
    const messages = [];
    const { width, height, rgba } = buf;
    if (width < 8 || height < 4) {
        messages.push(`resolution too small: ${width}×${height}`);
    }
    if (rgba.length < width * height * 4) {
        messages.push("rgba buffer shorter than width*height*4");
    }
    const aspectRatio = height > 0 ? width / height : 0;
    const aspectOk = aspectRatio >= 2 - aspectTol && aspectRatio <= 2 + aspectTol;
    if (!aspectOk) {
        messages.push(`aspect ${aspectRatio.toFixed(3)} not ~2:1 (equirect belly expects width≈2×height)`);
    }
    let seamScore = 255;
    if (rgba.length >= width * height * 4 && width >= 2) {
        seamScore = seamEdgeMaxDelta(rgba, width, height);
    }
    const seamOk = seamScore <= seamThreshold;
    if (!seamOk) {
        messages.push(`U-wrap seam score ${seamScore} exceeds threshold ${seamThreshold} ` +
            `(left/right edge mismatch — fix tileX seamless / mirror+fill before import)`);
    }
    // Pole note (soft — always documented)
    messages.push("pole note: equirect poles are pinchy; prefer companion N/S pole α-caps " +
        "or cubemap pole fix when using AI/DCC sources");
    const hardFail = !aspectOk ||
        width < 8 ||
        height < 4 ||
        rgba.length < width * height * 4 ||
        (!seamOk && !opts.allowSeamWarn);
    return {
        ok: !hardFail,
        width,
        height,
        aspectOk,
        aspectRatio,
        seamScore,
        seamThreshold,
        messages,
    };
}
/**
 * Apply imported equirect albedo onto a baked set (in place).
 * Resamples with nearest if dimensions differ. Returns validation result.
 */
export function applyImportedAlbedo(set, imported, opts = {}) {
    const v = validateEquirectAlbedo(imported, opts);
    if (!v.ok)
        return v;
    const { width: dw, height: dh } = set.albedo;
    const out = set.albedo.rgba;
    const sw = imported.width;
    const sh = imported.height;
    const src = imported.rgba;
    for (let y = 0; y < dh; y++) {
        const sy = Math.min(sh - 1, Math.floor((y + 0.5) * sh / dh));
        for (let x = 0; x < dw; x++) {
            const sx = Math.min(sw - 1, Math.floor((x + 0.5) * sw / dw));
            const si = (sy * sw + sx) * 4;
            const di = (y * dw + x) * 4;
            out[di] = src[si];
            out[di + 1] = src[si + 1];
            out[di + 2] = src[si + 2];
            out[di + 3] = 255;
        }
    }
    return v;
}
/**
 * Optional: replace grayscale height from imported mono/R channel (same rules).
 */
export function applyImportedHeight(set, imported, opts = {}) {
    const v = validateEquirectAlbedo(imported, {
        ...opts,
        // Height seams matter less for display; still flag aspect
        allowSeamWarn: opts.allowSeamWarn ?? true,
    });
    if (!v.aspectOk || imported.rgba.length < imported.width * imported.height * 4) {
        return { ...v, ok: false };
    }
    const { width: dw, height: dh } = set.height;
    const out = set.height.rgba;
    const sw = imported.width;
    const sh = imported.height;
    const src = imported.rgba;
    for (let y = 0; y < dh; y++) {
        const sy = Math.min(sh - 1, Math.floor((y + 0.5) * sh / dh));
        for (let x = 0; x < dw; x++) {
            const sx = Math.min(sw - 1, Math.floor((x + 0.5) * sw / dw));
            const g = src[(sy * sw + sx) * 4];
            const di = (y * dw + x) * 4;
            out[di] = g;
            out[di + 1] = g;
            out[di + 2] = g;
            out[di + 3] = 255;
        }
    }
    return { ...v, ok: true };
}
/** Build a synthetic seamless equirect checker for tests (U-wrap continuous). */
export function syntheticSeamlessEquirect(width, height) {
    const rgba = new Uint8ClampedArray(width * height * 4);
    // Vertical gradient + low-freq sin so L/R edges match (same at u=0 and u=1)
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const u = x / width;
            const v = y / height;
            // Period-1 horizontal wave → seamless
            const w = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 3);
            const g = Math.round((0.3 + 0.4 * v + 0.3 * w) * 255);
            const o = (y * width + x) * 4;
            rgba[o] = g;
            rgba[o + 1] = Math.round(g * 0.9);
            rgba[o + 2] = Math.round(80 + w * 100);
            rgba[o + 3] = 255;
        }
    }
    return { width, height, rgba };
}
/** Build a deliberately bad-seam equirect (left red, right blue). */
export function syntheticBrokenSeamEquirect(width, height) {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const o = (y * width + x) * 4;
            if (x < width / 2) {
                rgba[o] = 220;
                rgba[o + 1] = 40;
                rgba[o + 2] = 40;
            }
            else {
                rgba[o] = 40;
                rgba[o + 1] = 40;
                rgba[o + 2] = 220;
            }
            rgba[o + 3] = 255;
        }
    }
    return { width, height, rgba };
}
//# sourceMappingURL=equirect-import.js.map