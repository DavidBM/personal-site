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
}
/** Selective split: self-softened body color remains single-sampled. */
export let MAP_SELECTIVE_MSAA = false;
export let MAP_BODY_SAMPLES = 4;
export function configureSelectiveMsaa(enabled) {
    MAP_SELECTIVE_MSAA = enabled && MAP_MSAA_SAMPLES === 4;
    MAP_BODY_SAMPLES = MAP_SELECTIVE_MSAA ? 1 : MAP_MSAA_SAMPLES;
}
export let MAP_HALF_GLOW = false;
export function configureHalfGlow(enabled) { MAP_HALF_GLOW = enabled && MAP_SELECTIVE_MSAA; }
/** Product modes: selective 4× or off. Full-scene 4× remains a lab reference only. */
export function configureMapQuality(selective = true, halfGlow = true) {
    configureMapMsaa(selective);
    configureSelectiveMsaa(selective);
    configureHalfGlow(halfGlow);
}
//# sourceMappingURL=map-msaa.js.map