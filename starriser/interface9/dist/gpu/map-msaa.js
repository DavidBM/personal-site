/**
 * Map color-pass MSAA settings.
 *
 * All pipelines that draw into {@link WebGpuMapView}'s main pass must use
 * {@link MAP_MSAA_SAMPLES}. Line2 uses geometric coverage at 4x and analytic edge coverage at 1x.
 * Blending applies faint-line opacity once; alpha-to-coverage stays disabled.
 */
/** Multisample count for the galaxy map color pass (MSAA resolve to swapchain). */
export let MAP_MSAA_SAMPLES = 4;
/** Bootstrap-only, before any pipeline/attachment exists in this render worker. */
export function configureMapMsaa(enabled) {
    MAP_MSAA_SAMPLES = enabled ? 4 : 1;
    MAP_BODY_SAMPLES = MAP_MSAA_SAMPLES;
    MAP_SELECTIVE_MSAA = false;
    MAP_HALF_GLOW = false;
    MAP_HULL_MSAA = false;
    MAP_HIGH_HULL_SAMPLES = MAP_MSAA_SAMPLES;
}
/** Selective split: self-softened body color remains single-sampled. */
export let MAP_SELECTIVE_MSAA = false;
export let MAP_BODY_SAMPLES = 4;
export function configureSelectiveMsaa(enabled) {
    MAP_SELECTIVE_MSAA = enabled && MAP_MSAA_SAMPLES === 4;
    MAP_BODY_SAMPLES = MAP_SELECTIVE_MSAA ? 1 : MAP_MSAA_SAMPLES;
}
export let MAP_HALF_GLOW = false;
/** Product AA is an isolated transparent pass for the maximum-detail hull bin. */
export let MAP_HULL_MSAA = false;
export let MAP_HIGH_HULL_SAMPLES = 4;
export function configureHalfGlow(enabled) { MAP_HALF_GLOW = enabled && (MAP_SELECTIVE_MSAA || MAP_MSAA_SAMPLES === 1); }
/** Product modes: high-hull-only 4× or off. Older scene-wide modes are lab references. */
export function configureMapQuality(selective = true, halfGlow = true) {
    configureMapMsaa(false);
    MAP_HULL_MSAA = selective;
    MAP_HIGH_HULL_SAMPLES = selective ? 4 : 1;
    configureHalfGlow(halfGlow);
}
//# sourceMappingURL=map-msaa.js.map