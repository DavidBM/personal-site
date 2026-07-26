/**
 * Per-ship model lighting from hop/orbit destination (pathEnd).
 *
 * Textured model LOD treats the fleet pathEnd (where ships are going / orbiting)
 * as a **point light**. Direction from surface → light:
 *   L = normalize(center − ship)
 * Near-center (ship ≈ lamp) falls back to a fixed unit direction so NdotL stays finite.
 *
 * Pure — GPU FS mirrors this; tests assert ring opposites without a device.
 */
/** Default fallback when |center − ship| is tiny (matches old global key-ish dir). */
export const MODEL_LIGHT_FALLBACK_DIR = {
    x: 0.55,
    y: 0.9,
    z: 0.4,
};
/** Distance below which we use {@link MODEL_LIGHT_FALLBACK_DIR} (world units). */
export const MODEL_LIGHT_CENTER_EPS = 1e-3;
/**
 * Unit light direction **from ship toward orbit/hop center** (point light at center).
 * Pure; used by host docs + unit tests. WGSL fragment uses the same formula.
 */
export function lightDirFromOrbitCenter(shipX, shipY, shipZ, centerX, centerY, centerZ, eps = MODEL_LIGHT_CENTER_EPS, fallback = MODEL_LIGHT_FALLBACK_DIR) {
    const dx = centerX - shipX;
    const dy = centerY - shipY;
    const dz = centerZ - shipZ;
    const len2 = dx * dx + dy * dy + dz * dz;
    const e = Math.max(0, eps);
    if (!(len2 > e * e) || !Number.isFinite(len2)) {
        return normalizeOrFallback(fallback.x, fallback.y, fallback.z, fallback);
    }
    const inv = 1 / Math.sqrt(len2);
    const x = dx * inv;
    const y = dy * inv;
    const z = dz * inv;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return normalizeOrFallback(fallback.x, fallback.y, fallback.z, fallback);
    }
    return { x, y, z };
}
/**
 * Lambert NdotL for a world normal and light dir (both should be unit-ish).
 * Clamped to [0,1]. Pure helper for tests (opposite ring sides).
 */
export function modelNdotL(normalX, normalY, normalZ, lightX, lightY, lightZ) {
    const d = normalX * lightX + normalY * lightY + normalZ * lightZ;
    if (!Number.isFinite(d))
        return 0;
    return d > 0 ? (d > 1 ? 1 : d) : 0;
}
function normalizeOrFallback(x, y, z, fallback) {
    const len2 = x * x + y * y + z * z;
    if (len2 > 1e-12 && Number.isFinite(len2)) {
        const inv = 1 / Math.sqrt(len2);
        return { x: x * inv, y: y * inv, z: z * inv };
    }
    const fx = fallback.x;
    const fy = fallback.y;
    const fz = fallback.z;
    const fl2 = fx * fx + fy * fy + fz * fz;
    if (fl2 > 1e-12) {
        const inv = 1 / Math.sqrt(fl2);
        return { x: fx * inv, y: fy * inv, z: fz * inv };
    }
    return { x: 0, y: 1, z: 0 };
}
//# sourceMappingURL=model-point-light.js.map