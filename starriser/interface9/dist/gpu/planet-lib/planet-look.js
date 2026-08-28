/**
 * Pure planet look helpers — atmosphere sun/terminator factor.
 * Mirrored in planet-disc.wgsl.ts (keep formulas in sync).
 *
 * Surface detail uses 3D noise on the body-frame normal in WGSL
 * (no 2D lat/lon wrap seam). That path is fragment-only; this module
 * owns the sun-following atmosphere scalar for unit tests.
 */
/**
 * Atmosphere brightness vs. N·L (surface normal · sun direction).
 *
 * - Day (N·L > 0): bright glow
 * - Night (N·L < 0): near-off (tiny residual)
 * - Terminator (N·L ≈ 0): extra dawn/dusk boost (sunrise scattering)
 *
 * Returns a non-negative scale applied to rim/shell atmosphere color.
 */
export function atmosphereSunFactor(nDotL) {
    if (!Number.isFinite(nDotL))
        return 0;
    // Soft day gate — dark on night hemisphere
    const day = smoothstep(-0.18, 0.22, nDotL);
    // Gaussian peak around terminator for sunrise/sunset
    const term = Math.exp(-nDotL * nDotL * 14) * 1.15;
    // Tiny night residual so the disc edge is not totally black
    const nightGlow = (1 - day) * 0.04;
    return day * 0.72 + term + nightGlow;
}
function smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0 || 1e-12)));
    return t * t * (3 - 2 * t);
}
/**
 * WGSL snippet constants — must match {@link atmosphereSunFactor}.
 * Used by smoke to assert the shipped shader still encodes day/term/night.
 */
export const ATMOSPHERE_SUN_FACTOR_MARKERS = [
    "atmosphereSunFactor",
    "smoothstep(-0.18, 0.22, nDotL)",
    "exp(-nDotL * nDotL * 14.0)",
];
/** Markers that surface sampling is 3D / sphere-domain, not raw lat-lon fbm wrap. */
export const SURFACE_SEAM_SAFE_MARKERS = [
    "fbm3",
    "noise3",
    "nBody",
    // must not drive primary fbm from sphereToUv wrap alone
];
//# sourceMappingURL=planet-look.js.map