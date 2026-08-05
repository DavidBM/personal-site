/**
 * Hybrid photoreal mix: procedural structure + AI/DCC equirect detail.
 *
 * Offline authoring only — Imagine/Comfy/Blender assets are frozen files;
 * no runtime diffusion. Liquid mask stays procedural so liquid level still
 * controls oceans. Land favors photo detail; ocean keeps bathymetry paint.
 */
import { applyImportedAlbedo, validateEquirectAlbedo, } from "./equirect-import.js";
import { rasterizePoleCap } from "./pole-cap.js";
function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}
function lerp(a, b, t) {
    return a + (b - a) * t;
}
/**
 * Soft-fix U-wrap seam by feather-blending left/right edge columns.
 * Mutates rgba in place. Helps AI equirects that fail seam validators.
 */
export function softFixEquirectSeam(rgba, width, height, blendCols = 24) {
    const k = Math.max(1, Math.min(Math.floor(width / 4), Math.floor(blendCols)));
    for (let y = 0; y < height; y++) {
        for (let c = 0; c < k; c++) {
            const t = 1 - c / k; // 1 at edge
            const w = t * 0.5;
            const iL = (y * width + c) * 4;
            const iR = (y * width + (width - 1 - c)) * 4;
            for (let ch = 0; ch < 3; ch++) {
                const a = rgba[iL + ch];
                const b = rgba[iR + ch];
                const mid = (a + b) * 0.5;
                rgba[iL + ch] = Math.round(a * (1 - w) + mid * w);
                rgba[iR + ch] = Math.round(b * (1 - w) + mid * w);
            }
        }
    }
}
/**
 * Resize nearest-neighbor RGBA into dest size (pure, no deps).
 */
export function resizeRgbaNearest(src, destW, destH) {
    const out = new Uint8ClampedArray(destW * destH * 4);
    for (let y = 0; y < destH; y++) {
        const sy = Math.min(src.height - 1, Math.floor((y + 0.5) * src.height / destH));
        for (let x = 0; x < destW; x++) {
            const sx = Math.min(src.width - 1, Math.floor((x + 0.5) * src.width / destW));
            const si = (sy * src.width + sx) * 4;
            const di = (y * destW + x) * 4;
            out[di] = src.rgba[si];
            out[di + 1] = src.rgba[si + 1];
            out[di + 2] = src.rgba[si + 2];
            out[di + 3] = 255;
        }
    }
    return { width: destW, height: destH, rgba: out };
}
/**
 * Prepare AI equirect for hybrid: optional seam fix until validators accept.
 * Returns buffer + validation (ok if pass after fix attempts).
 */
export function prepareAiEquirect(src, targetW, targetH, importOpts = {}) {
    let buf = resizeRgbaNearest(src, targetW, targetH);
    // Always soft-fix seams on AI sources
    softFixEquirectSeam(buf.rgba, buf.width, buf.height, Math.max(16, Math.floor(targetW / 64)));
    let v = validateEquirectAlbedo(buf, importOpts);
    if (!v.ok && !v.aspectOk) {
        return { buffer: buf, validation: v };
    }
    // Stronger seam fix if still failing
    if (!v.ok) {
        softFixEquirectSeam(buf.rgba, buf.width, buf.height, Math.max(32, Math.floor(targetW / 32)));
        v = validateEquirectAlbedo(buf, {
            ...importOpts,
            seamThreshold: importOpts.seamThreshold ?? 56,
        });
    }
    return { buffer: buf, validation: v };
}
/**
 * Mix procedural albedo with AI detail using liquid mask.
 * Mutates set.albedo; refreshes pole caps from new albedo.
 */
export function hybridMixAlbedo(set, aiEquirect, opts = {}) {
    // Defaults biased so azure/temperate land reads photo detail (was 0.55 → washed)
    const landDetail = clamp01(opts.landDetail ?? 0.72);
    // Ocean albedo keeps procedural bathymetry; keep AI ocean mix low (not wave texture)
    const oceanDetail = clamp01(opts.oceanDetail ?? 0.1);
    const coastSoft = Math.max(0.02, opts.coastSoft ?? 0.14);
    const prep = prepareAiEquirect(aiEquirect, set.albedo.width, set.albedo.height);
    if (!prep.validation.aspectOk) {
        return prep.validation;
    }
    // Allow slightly softer seam after fix for hybrid (still fail extreme breaks)
    const v = validateEquirectAlbedo(prep.buffer, {
        seamThreshold: 64,
        allowSeamWarn: false,
    });
    if (!v.ok) {
        // Last resort: force-import after heavy seam average so hybrid still works
        softFixEquirectSeam(prep.buffer.rgba, prep.buffer.width, prep.buffer.height, Math.floor(prep.buffer.width / 16));
    }
    const finalV = validateEquirectAlbedo(prep.buffer, {
        seamThreshold: 80,
        allowSeamWarn: true,
    });
    if (!finalV.aspectOk)
        return finalV;
    const W = set.albedo.width;
    const H = set.albedo.height;
    const proc = set.albedo.rgba;
    const liq = set.liquidMask.rgba;
    const ai = prep.buffer.rgba;
    const out = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
        const o = i * 4;
        const liquid = liq[o] / 255;
        // Coast soft: 0 land … 1 deep ocean
        const oceanW = clamp01((liquid - (1 - coastSoft)) / coastSoft);
        const landW = 1 - oceanW;
        const pr = proc[o] / 255;
        const pg = proc[o + 1] / 255;
        const pb = proc[o + 2] / 255;
        const ar = ai[o] / 255;
        const ag = ai[o + 1] / 255;
        const ab = ai[o + 2] / 255;
        // Land: overlay + residual AI detail so azure/temperate read from orbit
        // (plain lerp washed both procedural grit and AI texture).
        const aridProc = pr > pg + 0.04 && pr > pb + 0.04 && (pr + pg + pb) / 3 > 0.25 ? 1 : 0;
        const vegProc = pg > pr + 0.03 && pg > pb + 0.02 && (pr + pg + pb) / 3 < 0.65 ? 1 : 0;
        const climateHold = Math.max(aridProc * 0.22, vegProc * 0.14, 0.06);
        const landT = landDetail * (1 - climateHold);
        // Overlay preserves base climate while imprinting AI mid-tone structure
        const overlay = (base, blend) => base < 0.5 ? 2 * base * blend : 1 - 2 * (1 - base) * (1 - blend);
        let lr = lerp(pr, clamp01(overlay(pr, ar)), landT * 0.72);
        let lg = lerp(pg, clamp01(overlay(pg, ag)), landT * 0.72);
        let lb = lerp(pb, clamp01(overlay(pb, ab)), landT * 0.72);
        // Direct residual detail (photo texture) on top of overlay
        const resid = 0.42 * landT;
        lr = clamp01(lr + (ar - pr) * resid);
        lg = clamp01(lg + (ag - pg) * resid);
        lb = clamp01(lb + (ab - pb) * resid);
        // Keep procedural micro-grit so hybrid never looks smoother than pure paint
        // (structure-first climate can be smoother class fills — grit restores fine var)
        const grit = 0.22;
        lr = clamp01(lr * (1 - grit) + pr * grit + (pr - (pr + pg + pb) / 3) * 0.22);
        lg = clamp01(lg * (1 - grit) + pg * grit + (pg - (pr + pg + pb) / 3) * 0.22);
        lb = clamp01(lb * (1 - grit) + pb * grit + (pb - (pr + pg + pb) / 3) * 0.22);
        // Warm push on arid provinces (Blue Marble deserts)
        if (aridProc > 0.5) {
            lr = clamp01(lr * 0.45 + Math.max(lr, 0.52) * 0.55);
            lg = clamp01(lg * 0.72 + 0.32 * lg);
            lb = clamp01(lb * 0.78);
        }
        // Soft-desaturate excess AI green (avoid RTS solid green land)
        if (lg > lr + 0.08 && lg > lb + 0.08) {
            const over = Math.min(0.16, lg - Math.max(lr, lb));
            lg = clamp01(lg - over * 0.5);
            lr = clamp01(lr + over * 0.12);
        }
        // Ocean: keep procedural bathymetry; light AI variation
        const or_ = lerp(pr, ar, oceanDetail);
        const og = lerp(pg, ag, oceanDetail);
        const ob = lerp(pb, ab, oceanDetail);
        const r = lerp(lr, or_, oceanW);
        const g = lerp(lg, og, oceanW);
        const b = lerp(lb, ob, oceanW);
        out[o] = Math.round(r * 255);
        out[o + 1] = Math.round(g * 255);
        out[o + 2] = Math.round(b * 255);
        out[o + 3] = 255;
    }
    set.albedo.rgba.set(out);
    // Refresh poles from hybrid albedo
    set.poleNorth = rasterizePoleCap(set.albedo.rgba, W, H, set.params.poleSize, true);
    set.poleSouth = rasterizePoleCap(set.albedo.rgba, W, H, set.params.poleSize, false);
    return {
        ...finalV,
        ok: true,
        messages: [
            ...finalV.messages,
            `hybrid landDetail=${landDetail} oceanDetail=${oceanDetail}`,
        ],
    };
}
/**
 * Replace albedo entirely with prepared AI (after validation/fix), keep masks.
 */
export function hybridReplaceAlbedo(set, aiEquirect) {
    const prep = prepareAiEquirect(aiEquirect, set.albedo.width, set.albedo.height, { seamThreshold: 64, allowSeamWarn: true });
    if (!prep.validation.aspectOk)
        return prep.validation;
    softFixEquirectSeam(prep.buffer.rgba, prep.buffer.width, prep.buffer.height, Math.floor(prep.buffer.width / 24));
    return applyImportedAlbedo(set, prep.buffer, {
        seamThreshold: 96,
        allowSeamWarn: true,
    });
}
// Re-export bank paths for callers that used the old single-file constants
export { AI_EQUIRECT_ASSETS } from "./ai-bank.js";
//# sourceMappingURL=hybrid-mix.js.map