/**
 * Trail ribbon width modes — pure math mirrored by fleet-trails VS.
 *
 * - Screen (strategic NEAR/MID): constant pixel width; does not shrink with distance.
 * - World (model LOD / depthAware): constant world-unit width; scales with ship size
 *   on screen as the camera moves (not fixed px).
 *
 * Draw expand uses segment-constant normals (planar strips) so thruster atlas
 * centerlines do not zigzag from mitered non-planar quads.
 */
/** Screen-pixel width mode (strategic ribbons). */
export const TRAIL_WIDTH_MODE_SCREEN = 0;
/** World-unit width mode (3D model-LOD thrusters). */
export const TRAIL_WIDTH_MODE_WORLD = 1;
/**
 * Default world widths (origin-relative game units after modelScale).
 * Model-LOD / **3D thruster** ribbons only (strategic 2D uses thin screen-px path).
 */
export const TRAIL_WORLD_WIDTH_HEAD = 0.09;
export const TRAIL_WORLD_WIDTH_TAIL = 0.024;
/**
 * Clip-space half-width scale applied to a unit NDC side offset.
 *
 * Screen: `(linewidthPx / resolutionY) * clipW`  (constant on-screen px)
 * World:  `(linewidthWorld * 0.5) * |projection[1][1]|`  (constant world metres;
 *         do **not** multiply by clipW again — result is already a clip offset).
 *
 * @returns `{ scale, multiplyByClipW }` — VS does `offset_ndc * scale` then
 *          optionally `* clip.w` when multiplyByClipW is true.
 */
export function trailClipWidthScale(widthMode, linewidth, resolutionY, projection_1_1, clipW) {
    if (widthMode >= 0.5) {
        // World-space: ndc half ≈ (W/2)*|P11|/|z|; clip half ≈ (W/2)*|P11|
        const half = Math.max(0, linewidth) * 0.5 * Math.abs(projection_1_1);
        return { scale: half, multiplyByClipW: false };
    }
    const resY = Math.max(resolutionY, 1);
    const scale = (Math.max(0, linewidth) / resY) * (Number.isFinite(clipW) ? 1 : 1);
    // Screen path multiplies by clipW after scale (keep scale without clipW here)
    return {
        scale: Math.max(0, linewidth) / resY,
        multiplyByClipW: true,
    };
}
/**
 * Resolve head/tail width values + mode for encodeTrails.
 * Model depthAware → world units; strategic → screen px.
 */
export function resolveTrailDrawWidths(opts) {
    const s = opts.widthScale ?? 1;
    if (opts.depthAware) {
        return {
            widthMode: TRAIL_WIDTH_MODE_WORLD,
            widthHead: (opts.worldHead ?? TRAIL_WORLD_WIDTH_HEAD) * s,
            widthTail: (opts.worldTail ?? TRAIL_WORLD_WIDTH_TAIL) * s,
        };
    }
    return {
        widthMode: TRAIL_WIDTH_MODE_SCREEN,
        widthHead: opts.screenHeadPx * s,
        widthTail: opts.screenTailPx * s,
    };
}
//# sourceMappingURL=trail-width.js.map