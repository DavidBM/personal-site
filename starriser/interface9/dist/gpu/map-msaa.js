/**
 * Map color-pass MSAA settings.
 *
 * All pipelines that draw into {@link WebGpuMapView}'s main pass must use
 * {@link MAP_MSAA_SAMPLES}. Line2 long-edge AA relies on this plus
 * `alphaToCoverage` on the Line2 pipelines (not on opaque/translucent fills).
 */
/** Multisample count for the galaxy map color pass (MSAA resolve to swapchain). */
export const MAP_MSAA_SAMPLES = 4;
//# sourceMappingURL=map-msaa.js.map