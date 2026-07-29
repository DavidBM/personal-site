/**
 * Pure equation thruster / engine-trail texture rasterizer.
 * No DOM / WebGPU — Node tests and the HTML UI share this path.
 *
 * Coordinate system (trail atlas convention for later ribbon UVs):
 *   u = 0 at nozzle (left), u = 1 at tip (right)
 *   v = 0..1 across width; centerline v = 0.5
 *
 * Layers are additive in linear light, then exposure + gamma, then
 * alpha is derived from max channel so transparent-bg PNGs composite well.
 */
import { defaultParams } from "./presets.js";
export { defaultParams, presetOrangeJet, presetIonNeedle, presetSoftPlasma, paramsForPreset, PRESET_NAMES, } from "./presets.js";
function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}
function saturate3(r, g, b) {
    return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
}
/** Deterministic value noise in [0,1) — fine filaments without assets. */
function hash2(x, y) {
    // Integer lattice hash → float (no trig; stable across engines).
    let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
    n = (n ^ (n >>> 13)) | 0;
    n = Math.imul(n, 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function valueNoise(u, v, freqU, freqV) {
    const x = u * freqU;
    const y = v * freqV;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    // Smoothstep
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const n00 = hash2(x0, y0);
    const n10 = hash2(x0 + 1, y0);
    const n01 = hash2(x0, y0 + 1);
    const n11 = hash2(x0 + 1, y0 + 1);
    const nx0 = n00 * (1 - sx) + n10 * sx;
    const nx1 = n01 * (1 - sx) + n11 * sx;
    return nx0 * (1 - sy) + nx1 * sy;
}
function radialGauss(rNorm, sigma) {
    const s = Math.max(1e-6, sigma);
    const t = rNorm / s;
    return Math.exp(-0.5 * t * t);
}
/**
 * Length envelope for a glow layer.
 * uAlong is in [0,1] after trailLength remap; outside extent → 0.
 */
function lengthEnvelope(uAlong, layer) {
    if (!layer.enabled || layer.intensity <= 0)
        return 0;
    const extent = Math.max(1e-4, layer.lengthExtent);
    const local = (uAlong - layer.lengthOffset) / extent;
    if (local < 0 || local > 1)
        return 0;
    const decay = Math.exp(-layer.lengthDecay * local);
    const power = Math.pow(1 - local, Math.max(0, layer.lengthPower));
    // Soft nozzle shoulder so the root is not a hard cut.
    const shoulder = 1 - Math.exp(-12 * Math.max(0, local + 0.02));
    return decay * power * shoulder;
}
function sampleGlow(uAlong, rNorm, layer, out) {
    const env = lengthEnvelope(uAlong, layer);
    if (env <= 0)
        return;
    const rad = radialGauss(rNorm, layer.radialSigma);
    const w = layer.intensity * env * rad;
    if (w <= 0)
        return;
    out.r += layer.color.r * w;
    out.g += layer.color.g * w;
    out.b += layer.color.b * w;
}
/**
 * Static distance rings: peaks at equal spacing in [uStart, uEnd],
 * Gaussian thickness along u, radial falloff, additive color.
 */
function sampleRings(u, rNorm, params, out) {
    const rings = params.rings;
    if (!rings.enabled || rings.count < 1 || rings.intensity <= 0)
        return;
    const u0 = rings.uStart;
    const u1 = Math.max(u0 + 1e-4, rings.uEnd);
    if (u < u0 - rings.thickness || u > u1 + rings.thickness)
        return;
    const span = u1 - u0;
    const rad = radialGauss(rNorm, rings.radialSigma);
    if (rad < 1e-4)
        return;
    const thick = Math.max(1e-5, rings.thickness);
    // n rings centered at u0 + (i+0.5)/n * span
    let peak = 0;
    for (let i = 0; i < rings.count; i++) {
        const cu = u0 + ((i + 0.5) / rings.count) * span;
        const d = (u - cu) / thick;
        peak += Math.exp(-0.5 * d * d);
    }
    const w = rings.intensity * peak * rad;
    out.r += rings.color.r * w;
    out.g += rings.color.g * w;
    out.b += rings.color.b * w;
}
/**
 * Shock / Mach diamonds: diamond-shaped bright cells along the centerline
 * (classic over-expanded jet look). Shape = product of length and radial Gaussians
 * with a cos² cross-section for a hard diamond silhouette.
 */
function sampleShocks(u, rNorm, params, out) {
    const s = params.shocks;
    if (!s.enabled || s.count < 1 || s.intensity <= 0)
        return;
    const half = Math.max(1e-5, s.halfLength);
    let peak = 0;
    for (let i = 0; i < s.count; i++) {
        const cu = s.uStart + i * s.spacing;
        const du = (u - cu) / half;
        if (Math.abs(du) > 2.5)
            continue;
        // Diamond: |du| + |r| style soft metric
        const diamond = Math.max(0, 1 - (Math.abs(du) + rNorm / Math.max(1e-4, s.radialSigma * 2.2)));
        const core = radialGauss(rNorm, s.radialSigma) * Math.exp(-0.5 * du * du);
        peak += diamond * diamond * core;
    }
    if (peak <= 0)
        return;
    const w = s.intensity * peak;
    out.r += s.color.r * w;
    out.g += s.color.g * w;
    out.b += s.color.b * w;
}
function sampleNoiseMod(u, v, params) {
    const n = params.noise;
    if (!n.enabled || n.intensity <= 0)
        return 1;
    // Anisotropic: stretch filaments along the jet axis.
    const a = valueNoise(u, v, n.freqU, n.freqV);
    const b = valueNoise(u * 1.7 + 3.1, v * 0.55 + 1.3, n.freqU * 0.5, n.freqV * 2);
    const filament = a * 0.65 + b * 0.35;
    // Keep base bright; noise modulates rather than punching black holes.
    return 1 + n.intensity * (filament * 2 - 1);
}
/**
 * Sample linear RGB (unclamped before caller exposure) at UV in [0,1]².
 * Pure; no side effects.
 */
export function sampleThrusterLinear(u, v, params) {
    // Map canvas UV through width/length scales so sliders change physical falloff.
    const tw = Math.max(1e-4, params.trailWidth);
    const tl = Math.max(1e-4, params.trailLength);
    // Centerline distance in “half-height units” of the designed plume.
    const rNorm = (Math.abs(v - 0.5) * 2) / tw;
    // Stretch/compress along: higher trailLength → same u looks closer to nozzle.
    const uAlong = u / tl;
    const acc = { r: 0, g: 0, b: 0 };
    sampleGlow(uAlong, rNorm, params.wash, acc);
    sampleGlow(uAlong, rNorm, params.outerGlow, acc);
    sampleGlow(uAlong, rNorm, params.midGlow, acc);
    sampleGlow(uAlong, rNorm, params.core, acc);
    sampleRings(uAlong, rNorm, params, acc);
    sampleShocks(uAlong, rNorm, params, acc);
    const mod = sampleNoiseMod(u, v, params);
    acc.r *= mod;
    acc.g *= mod;
    acc.b *= mod;
    // Mild edge feather so the atlas has soft transparent borders (ribbon-friendly).
    const edgeV = 1 - Math.pow(Math.max(0, rNorm - 0.85) / 0.35, 2);
    const edgeU = u < 0.01 ? u / 0.01 : u > 0.98 ? (1 - u) / 0.02 : 1;
    const edge = Math.max(0, Math.min(1, edgeV)) * Math.max(0, Math.min(1, edgeU));
    acc.r *= edge;
    acc.g *= edge;
    acc.b *= edge;
    const exp = params.exposure;
    return { r: acc.r * exp, g: acc.g * exp, b: acc.b * exp };
}
function toByte(linear, gamma) {
    const c = clamp01(linear);
    const g = gamma > 0 ? Math.pow(c, 1 / gamma) : c;
    return Math.round(clamp01(g) * 255);
}
/**
 * Rasterize full texture into an RGBA8 buffer (transparent where dark).
 */
export function generateThrusterTexture(params = defaultParams()) {
    const width = Math.max(1, Math.floor(params.widthPx));
    const height = Math.max(1, Math.floor(params.heightPx));
    const rgba = new Uint8ClampedArray(width * height * 4);
    const gamma = params.gamma > 0 ? params.gamma : 1;
    const invW = 1 / Math.max(1, width - 1);
    const invH = 1 / Math.max(1, height - 1);
    for (let y = 0; y < height; y++) {
        const v = y * invH;
        for (let x = 0; x < width; x++) {
            const u = x * invW;
            const lin = sampleThrusterLinear(u, v, params);
            const rgb = saturate3(lin.r, lin.g, lin.b);
            // Alpha from luminance peak so transparent-bg PNGs keep glow shape.
            const a = clamp01(Math.max(rgb.r, rgb.g, rgb.b));
            const i = (y * width + x) * 4;
            rgba[i] = toByte(rgb.r, gamma);
            rgba[i + 1] = toByte(rgb.g, gamma);
            rgba[i + 2] = toByte(rgb.b, gamma);
            rgba[i + 3] = Math.round(a * 255);
        }
    }
    return { width, height, rgba };
}
/** Sum of all channel bytes — cheap fingerprint for param-sensitivity tests. */
export function bufferChannelSum(buf) {
    let s = 0;
    const a = buf.rgba;
    for (let i = 0; i < a.length; i++)
        s += a[i];
    return s;
}
/** Count of pixels that differ in any channel (for param sensitivity). */
export function countDifferingPixels(a, b) {
    if (a.width !== b.width || a.height !== b.height) {
        return Math.max(a.width * a.height, b.width * b.height);
    }
    let n = 0;
    const aa = a.rgba;
    const bb = b.rgba;
    for (let i = 0; i < aa.length; i += 4) {
        if (aa[i] !== bb[i] ||
            aa[i + 1] !== bb[i + 1] ||
            aa[i + 2] !== bb[i + 2] ||
            aa[i + 3] !== bb[i + 3]) {
            n++;
        }
    }
    return n;
}
/** Deep-clone params so UI / tests can mutate without aliasing. */
export function cloneParams(p) {
    return JSON.parse(JSON.stringify(p));
}
//# sourceMappingURL=generator.js.map