/**
 * Thruster texture creator — URL query serialize/parse for all generation params.
 * Pure; UI writes history.replaceState; boot reads location.search once.
 */
import { defaultParams } from "./presets.js";
import { cloneParams } from "./generator.js";
function rgbToHex(c) {
    const b = (n) => Math.round(Math.max(0, Math.min(1, n)) * 255)
        .toString(16)
        .padStart(2, "0");
    return `${b(c.r)}${b(c.g)}${b(c.b)}`;
}
function hexToRgb(hex) {
    const h = hex.replace("#", "").trim();
    const full = h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h;
    const n = parseInt(full.slice(0, 6), 16);
    if (!Number.isFinite(n))
        return { r: 1, g: 1, b: 1 };
    return {
        r: ((n >> 16) & 0xff) / 255,
        g: ((n >> 8) & 0xff) / 255,
        b: (n & 0xff) / 255,
    };
}
function f(n, digits = 4) {
    if (!Number.isFinite(n))
        return "0";
    const s = n.toFixed(digits);
    return s.replace(/\.?0+$/, "") || "0";
}
function glowToEntries(prefix, g) {
    return [
        [`${prefix}En`, g.enabled ? "1" : "0"],
        [`${prefix}C`, rgbToHex(g.color)],
        [`${prefix}I`, f(g.intensity)],
        [`${prefix}S`, f(g.radialSigma)],
        [`${prefix}D`, f(g.lengthDecay)],
        [`${prefix}P`, f(g.lengthPower)],
        [`${prefix}E`, f(g.lengthExtent)],
        [`${prefix}O`, f(g.lengthOffset)],
    ];
}
function applyGlow(g, prefix, get) {
    const en = get(`${prefix}En`);
    if (en != null)
        g.enabled = en === "1" || en === "true";
    const c = get(`${prefix}C`);
    if (c)
        g.color = hexToRgb(c);
    const numKeys = [
        [`${prefix}I`, "intensity"],
        [`${prefix}S`, "radialSigma"],
        [`${prefix}D`, "lengthDecay"],
        [`${prefix}P`, "lengthPower"],
        [`${prefix}E`, "lengthExtent"],
        [`${prefix}O`, "lengthOffset"],
    ];
    for (const [k, field] of numKeys) {
        const v = get(k);
        if (v == null || v === "")
            continue;
        const n = Number(v);
        if (Number.isFinite(n))
            g[field] = n;
    }
}
/** Serialize full params to a query string (no leading ?). */
export function paramsToQuery(p) {
    const e = [
        ["w", String(Math.floor(p.widthPx))],
        ["h", String(Math.floor(p.heightPx))],
        ["tw", f(p.trailWidth)],
        ["tl", f(p.trailLength)],
        ["ex", f(p.exposure)],
        ["gm", f(p.gamma, 3)],
        ...glowToEntries("c", p.core),
        ...glowToEntries("m", p.midGlow),
        ...glowToEntries("o", p.outerGlow),
        ...glowToEntries("u", p.wash),
        ["rEn", p.rings.enabled ? "1" : "0"],
        ["rN", String(p.rings.count)],
        ["rT", f(p.rings.thickness)],
        ["rI", f(p.rings.intensity)],
        ["rC", rgbToHex(p.rings.color)],
        ["r0", f(p.rings.uStart)],
        ["r1", f(p.rings.uEnd)],
        ["rS", f(p.rings.radialSigma)],
        ["sEn", p.shocks.enabled ? "1" : "0"],
        ["sN", String(p.shocks.count)],
        ["sI", f(p.shocks.intensity)],
        ["sC", rgbToHex(p.shocks.color)],
        ["s0", f(p.shocks.uStart)],
        ["sSp", f(p.shocks.spacing)],
        ["sH", f(p.shocks.halfLength)],
        ["sS", f(p.shocks.radialSigma)],
        ["nEn", p.noise.enabled ? "1" : "0"],
        ["nI", f(p.noise.intensity)],
        ["nU", f(p.noise.freqU, 2)],
        ["nV", f(p.noise.freqV, 2)],
    ];
    return e.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}
/**
 * Parse query/search into params. Accepts raw query, `?…`, or full URL search.
 * Unknown/missing keys keep values from `base` (default: defaultParams()).
 */
export function paramsFromQuery(search, base) {
    const p = cloneParams(base ?? defaultParams());
    let q = search.trim();
    if (q.startsWith("?"))
        q = q.slice(1);
    // Allow accidental full URLs
    const qi = q.indexOf("?");
    if (qi >= 0)
        q = q.slice(qi + 1);
    if (!q)
        return p;
    const map = new Map();
    for (const part of q.split("&")) {
        if (!part)
            continue;
        const eq = part.indexOf("=");
        const k = decodeURIComponent(eq >= 0 ? part.slice(0, eq) : part);
        const v = decodeURIComponent(eq >= 0 ? part.slice(eq + 1) : "");
        map.set(k, v);
    }
    const get = (k) => map.get(k) ?? null;
    const w = get("w");
    if (w != null) {
        const n = Number(w);
        if (Number.isFinite(n))
            p.widthPx = Math.max(16, Math.floor(n));
    }
    const h = get("h");
    if (h != null) {
        const n = Number(h);
        if (Number.isFinite(n))
            p.heightPx = Math.max(8, Math.floor(n));
    }
    const tw = get("tw");
    if (tw != null && Number.isFinite(Number(tw)))
        p.trailWidth = Number(tw);
    const tl = get("tl");
    if (tl != null && Number.isFinite(Number(tl)))
        p.trailLength = Number(tl);
    const ex = get("ex");
    if (ex != null && Number.isFinite(Number(ex)))
        p.exposure = Number(ex);
    const gm = get("gm");
    if (gm != null && Number.isFinite(Number(gm)))
        p.gamma = Number(gm);
    applyGlow(p.core, "c", get);
    applyGlow(p.midGlow, "m", get);
    applyGlow(p.outerGlow, "o", get);
    applyGlow(p.wash, "u", get);
    const rings = p.rings;
    if (get("rEn") != null)
        rings.enabled = get("rEn") === "1" || get("rEn") === "true";
    if (get("rN") != null)
        rings.count = Math.max(0, Math.floor(Number(get("rN"))));
    if (get("rT") != null)
        rings.thickness = Number(get("rT"));
    if (get("rI") != null)
        rings.intensity = Number(get("rI"));
    if (get("rC"))
        rings.color = hexToRgb(get("rC"));
    if (get("r0") != null)
        rings.uStart = Number(get("r0"));
    if (get("r1") != null)
        rings.uEnd = Number(get("r1"));
    if (get("rS") != null)
        rings.radialSigma = Number(get("rS"));
    const shocks = p.shocks;
    if (get("sEn") != null)
        shocks.enabled = get("sEn") === "1" || get("sEn") === "true";
    if (get("sN") != null)
        shocks.count = Math.max(0, Math.floor(Number(get("sN"))));
    if (get("sI") != null)
        shocks.intensity = Number(get("sI"));
    if (get("sC"))
        shocks.color = hexToRgb(get("sC"));
    if (get("s0") != null)
        shocks.uStart = Number(get("s0"));
    if (get("sSp") != null)
        shocks.spacing = Number(get("sSp"));
    if (get("sH") != null)
        shocks.halfLength = Number(get("sH"));
    if (get("sS") != null)
        shocks.radialSigma = Number(get("sS"));
    const noise = p.noise;
    if (get("nEn") != null)
        noise.enabled = get("nEn") === "1" || get("nEn") === "true";
    if (get("nI") != null)
        noise.intensity = Number(get("nI"));
    if (get("nU") != null)
        noise.freqU = Number(get("nU"));
    if (get("nV") != null)
        noise.freqV = Number(get("nV"));
    return p;
}
/** True if two param trees match within float eps (for round-trip tests). */
export function paramsNearlyEqual(a, b, eps = 1e-3) {
    const near = (x, y) => Math.abs(x - y) <= eps;
    const rgbEq = (x, y) => near(x.r, y.r) && near(x.g, y.g) && near(x.b, y.b);
    const glowEq = (x, y) => x.enabled === y.enabled &&
        rgbEq(x.color, y.color) &&
        near(x.intensity, y.intensity) &&
        near(x.radialSigma, y.radialSigma) &&
        near(x.lengthDecay, y.lengthDecay) &&
        near(x.lengthPower, y.lengthPower) &&
        near(x.lengthExtent, y.lengthExtent) &&
        near(x.lengthOffset, y.lengthOffset);
    const ringsEq = (x, y) => x.enabled === y.enabled &&
        x.count === y.count &&
        near(x.thickness, y.thickness) &&
        near(x.intensity, y.intensity) &&
        rgbEq(x.color, y.color) &&
        near(x.uStart, y.uStart) &&
        near(x.uEnd, y.uEnd) &&
        near(x.radialSigma, y.radialSigma);
    const shocksEq = (x, y) => x.enabled === y.enabled &&
        x.count === y.count &&
        near(x.intensity, y.intensity) &&
        rgbEq(x.color, y.color) &&
        near(x.uStart, y.uStart) &&
        near(x.spacing, y.spacing) &&
        near(x.halfLength, y.halfLength) &&
        near(x.radialSigma, y.radialSigma);
    const noiseEq = (x, y) => x.enabled === y.enabled &&
        near(x.intensity, y.intensity) &&
        near(x.freqU, y.freqU) &&
        near(x.freqV, y.freqV);
    return (a.widthPx === b.widthPx &&
        a.heightPx === b.heightPx &&
        near(a.trailWidth, b.trailWidth) &&
        near(a.trailLength, b.trailLength) &&
        near(a.exposure, b.exposure) &&
        near(a.gamma, b.gamma) &&
        glowEq(a.core, b.core) &&
        glowEq(a.midGlow, b.midGlow) &&
        glowEq(a.outerGlow, b.outerGlow) &&
        glowEq(a.wash, b.wash) &&
        ringsEq(a.rings, b.rings) &&
        shocksEq(a.shocks, b.shocks) &&
        noiseEq(a.noise, b.noise));
}
//# sourceMappingURL=url-state.js.map