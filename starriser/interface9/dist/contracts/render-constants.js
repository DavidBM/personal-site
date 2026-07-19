/** Strict gameplay/render plane (AGENTS: y = 0). */
export const RENDER_PLANE_Y = 0;
/**
 * Soft-deleted buffer slots are moved far off-camera instead of compacting
 * every frame. Shared by connection lines, solar points, and fleets.
 */
export const HIDDEN_COORDINATE = 1e9;
/** Project any position onto the render plane without allocating a Vector3. */
export function projectToRenderPlane(position) {
    return {
        x: position.x,
        y: RENDER_PLANE_Y,
        z: position.z,
    };
}
/** Write projected coords into an existing target (hot-path friendly). */
export function writeProjectedToRenderPlane(position, target) {
    target.x = position.x;
    target.y = RENDER_PLANE_Y;
    target.z = position.z;
    return target;
}
//# sourceMappingURL=render-constants.js.map