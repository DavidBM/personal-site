/**
 * Pure glow-sprite rasterizer: the bright light placed where an engine trail
 * meets the hull, hiding the join. A glow style is a free stack of layers,
 * each a shape (solid disc, soft halo, bloom tail, rays, streak, ring) with
 * its own colour, intensity, size and angular noise; layers add in linear
 * light, then exposure, an edge window (so the square never shows) and gamma.
 * Square sprite, light at the centre, x and y run −1…1 across it. Alpha is the
 * brightest channel, as in the thruster texture, so the PNG works additively
 * or alpha-blended. No DOM / WebGPU — Node tests and the model viewer share it.
 */
export const GLOW_LAYER_TYPES = ["disc", "halo", "bloom", "rays", "streak", "ring"];
export const GLOW_LAYER_LABELS = {
    disc: "Solid disc", halo: "Soft halo", bloom: "Bloom tail", rays: "Rays", streak: "Streak", ring: "Ring",
};
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function hash01(i, seed) {
    let n = Math.imul(i | 0, 374761393) + Math.imul(seed | 0, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
/** Periodic value noise around the circle: `lobes` cells, 1 ± amount. */
function angularNoise(theta, layer) {
    if (layer.noise <= 0)
        return 1;
    const lobes = Math.max(1, Math.round(layer.noiseLobes));
    const t = (theta / (2 * Math.PI) + 0.5) * lobes, cell = Math.floor(t), f = t - cell, smooth = f * f * (3 - 2 * f);
    const n = hash01(cell % lobes, layer.noiseSeed) * (1 - smooth) + hash01((cell + 1) % lobes, layer.noiseSeed) * smooth;
    return Math.max(0, 1 + layer.noise * (2 * n - 1));
}
/** Nearest ray only (rays are far apart); each thins toward its tip and ends at its length. */
function rays(r, theta, l) {
    const n = Math.max(1, Math.round(l.count)), sector = (2 * Math.PI) / n;
    const rel = theta - (l.rotation * Math.PI) / 180, k = Math.round(rel / sector), delta = rel - k * sector;
    const along = r * Math.cos(delta);
    if (along <= 0)
        return 0;
    const length = Math.max(1e-4, l.size * (1 - l.jitter * hash01(((k % n) + n) % n, l.seed)));
    const thickness = Math.max(1e-4, l.thickness * (1 - 0.7 * Math.min(1, along / length)));
    return Math.exp(-(((r * Math.sin(delta)) / thickness) ** 2)) * Math.max(0, 1 - along / length) ** 2;
}
function streak(x, y, l) {
    const a = (l.rotation * Math.PI) / 180, along = Math.abs(x * Math.cos(a) + y * Math.sin(a)), perp = -x * Math.sin(a) + y * Math.cos(a);
    const length = Math.max(1e-4, l.size), thickness = Math.max(1e-4, l.thickness * (1 - 0.7 * Math.min(1, along / length)));
    return Math.exp(-((perp / thickness) ** 2)) * Math.max(0, 1 - along / length) ** 2;
}
/** The layer's shape (0…1) at x, y with r = |(x, y)|, before colour, intensity and noise. */
export function sampleLayer(x, y, r, l) {
    const size = Math.max(1e-4, l.size), t = r / size;
    switch (l.type) {
        case "disc": return 1 - smoothstep(1 - Math.max(0.01, l.softness), 1, t);
        case "halo": return Math.exp(-4.5 * t * t) * (1 - smoothstep(0.7, 1, t));
        case "bloom": return (1 - smoothstep(0.4, 1, t)) / (1 + (t / Math.max(1e-3, l.falloff)) ** 2);
        case "rays": return rays(r, Math.atan2(y, x), l);
        case "streak": return streak(x, y, l);
        case "ring": return Math.exp(-(((r - size) / Math.max(1e-4, l.thickness)) ** 2));
        default: return 0;
    }
}
/** Linear RGB (after exposure and the edge window) at x, y in −1…1. */
export function sampleGlowLinear(x, y, style) {
    const r = Math.hypot(x, y), theta = Math.atan2(y, x), acc = { r: 0, g: 0, b: 0 };
    for (const l of style.layers) {
        if (!l.enabled || l.intensity <= 0)
            continue;
        const w = l.intensity * sampleLayer(x, y, r, l) * angularNoise(theta, l);
        acc.r += l.color.r * w;
        acc.g += l.color.g * w;
        acc.b += l.color.b * w;
    }
    const k = style.exposure * (1 - smoothstep(0.9, 1, r));
    return { r: acc.r * k, g: acc.g * k, b: acc.b * k };
}
function toByte(linear, gamma) {
    return Math.round(clamp01(Math.pow(clamp01(linear), 1 / gamma)) * 255);
}
export function generateGlowTexture(style) {
    const size = Math.max(8, Math.floor(style.sizePx)), gamma = style.gamma > 0 ? style.gamma : 1;
    const rgba = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const c = sampleGlowLinear(((x + 0.5) / size) * 2 - 1, ((y + 0.5) / size) * 2 - 1, style);
            const i = (y * size + x) * 4;
            rgba[i] = toByte(c.r, gamma);
            rgba[i + 1] = toByte(c.g, gamma);
            rgba[i + 2] = toByte(c.b, gamma);
            rgba[i + 3] = Math.round(clamp01(Math.max(c.r, c.g, c.b)) * 255);
        }
    }
    return { width: size, height: size, rgba };
}
const rgb = (r, g, b) => ({ r, g, b });
/** Typical starting values for a new layer of `type`. */
export function makeGlowLayer(type, overrides = {}) {
    const base = {
        type, enabled: true, color: rgb(0.6, 0.8, 1), intensity: 1, size: 0.5, softness: 0.5, falloff: 0.12, thickness: 0.015,
        count: 6, rotation: 0, jitter: 0.35, seed: 7, noise: 0, noiseLobes: 24, noiseSeed: 3,
    };
    const byType = {
        disc: { color: rgb(0.95, 0.98, 1), intensity: 2, size: 0.12, softness: 0.6 },
        halo: { color: rgb(0.3, 0.65, 1), intensity: 1.2, size: 0.45 },
        bloom: { color: rgb(0.1, 0.35, 1), intensity: 0.45, size: 1 },
        rays: { color: rgb(0.7, 0.85, 1), intensity: 1.2, size: 0.8, thickness: 0.012 },
        streak: { color: rgb(0.4, 0.7, 1), intensity: 0.7, size: 0.95, thickness: 0.012 },
        ring: { color: rgb(0.3, 0.6, 1), intensity: 0.3, size: 0.36, thickness: 0.02 },
    };
    return { ...base, ...byType[type], ...overrides };
}
export const GLOW_PRESET_NAMES = ["blue-ion", "white-hot", "star-flare", "orange-burner", "solid-orb", "rays-only", "noisy-corona"];
const PRESET_LAYERS = {
    "blue-ion": () => [makeGlowLayer("disc"), makeGlowLayer("halo", { noise: 0.25 }), makeGlowLayer("bloom", { noise: 0.25 }), makeGlowLayer("streak")],
    "white-hot": () => [makeGlowLayer("disc", { color: rgb(1, 1, 1), intensity: 3, size: 0.14, softness: 0.3 }),
        makeGlowLayer("halo", { color: rgb(0.75, 0.88, 1), intensity: 1.1, size: 0.5 }), makeGlowLayer("bloom", { color: rgb(0.45, 0.65, 1), intensity: 0.35 }),
        makeGlowLayer("streak", { color: rgb(0.8, 0.9, 1), intensity: 0.4 })],
    "star-flare": () => [makeGlowLayer("disc", { color: rgb(1, 1, 1), intensity: 3, size: 0.08, softness: 0.7 }),
        makeGlowLayer("halo", { color: rgb(0.6, 0.8, 1), intensity: 0.8, size: 0.35 }), makeGlowLayer("rays"), makeGlowLayer("streak", { intensity: 0.6, size: 1 })],
    "orange-burner": () => [makeGlowLayer("disc", { color: rgb(1, 0.95, 0.85), intensity: 2.6 }),
        makeGlowLayer("halo", { color: rgb(1, 0.55, 0.15), intensity: 1.3, size: 0.5, noise: 0.35 }),
        makeGlowLayer("bloom", { color: rgb(0.9, 0.25, 0.05), noise: 0.35 }), makeGlowLayer("streak", { color: rgb(1, 0.6, 0.25), intensity: 0.4 })],
    "solid-orb": () => [makeGlowLayer("disc", { color: rgb(0.85, 0.95, 1), intensity: 1.6, size: 0.45, softness: 0.35 }),
        makeGlowLayer("halo", { color: rgb(0.4, 0.7, 1), intensity: 0.6, size: 0.75 })],
    "rays-only": () => [makeGlowLayer("rays", { color: rgb(0.8, 0.9, 1), intensity: 1.5, size: 0.95, count: 8, thickness: 0.01, jitter: 0.5 })],
    "noisy-corona": () => [makeGlowLayer("disc", { size: 0.1 }), makeGlowLayer("halo", { size: 0.6, noise: 0.8, noiseLobes: 40 }),
        makeGlowLayer("bloom", { noise: 0.5, noiseLobes: 17 })],
};
export function glowStyleForPreset(name, id = "glow-1", label = "Engine glow", sizePx = 256) {
    return { id, name: label, sizePx, exposure: 1, gamma: 1, facing: 1, layers: PRESET_LAYERS[name]() };
}
//# sourceMappingURL=glow-generator.js.map