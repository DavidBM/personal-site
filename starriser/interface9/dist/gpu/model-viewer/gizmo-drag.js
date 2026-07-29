/**
 * Pure XYZ gizmo drag + axis pick for the model viewer red-ball marker.
 * Screen-projected axis: pointer delta along projected axis → world translation.
 */
const AXIS_UNIT = {
    x: { x: 1, y: 0, z: 0 },
    y: { x: 0, y: 1, z: 0 },
    z: { x: 0, y: 0, z: 1 },
};
export function axisUnit(axis) {
    return AXIS_UNIT[axis];
}
/** World → clip (column-major mat4 × vec4). */
export function projectWorldToClip(viewProj, x, y, z) {
    return {
        x: viewProj[0] * x +
            viewProj[4] * y +
            viewProj[8] * z +
            viewProj[12],
        y: viewProj[1] * x +
            viewProj[5] * y +
            viewProj[9] * z +
            viewProj[13],
        z: viewProj[2] * x +
            viewProj[6] * y +
            viewProj[10] * z +
            viewProj[14],
        w: viewProj[3] * x +
            viewProj[7] * y +
            viewProj[11] * z +
            viewProj[15],
    };
}
/** Clip → CSS screen pixels (origin top-left). */
export function clipToScreen(clip, viewportW, viewportH) {
    const iw = clip.w !== 0 ? 1 / clip.w : 0;
    const ndcX = clip.x * iw;
    const ndcY = clip.y * iw;
    return {
        x: (ndcX * 0.5 + 0.5) * viewportW,
        y: (-ndcY * 0.5 + 0.5) * viewportH,
    };
}
export function worldToScreen(viewProj, x, y, z, viewportW, viewportH) {
    return clipToScreen(projectWorldToClip(viewProj, x, y, z), viewportW, viewportH);
}
/**
 * Translate ball along `axis` by the component of pointer delta (CSS px)
 * along the projected axis. Uses unit axis length in world for scale.
 */
export function gizmoDragWorldDelta(axis, pointerDxPx, pointerDyPx, ball, viewProj, viewportW, viewportH) {
    const u = AXIS_UNIT[axis];
    // Project ball and ball+unit axis → screen
    const p0 = worldToScreen(viewProj, ball.x, ball.y, ball.z, viewportW, viewportH);
    const p1 = worldToScreen(viewProj, ball.x + u.x, ball.y + u.y, ball.z + u.z, viewportW, viewportH);
    const sx = p1.x - p0.x;
    const sy = p1.y - p0.y;
    const len2 = sx * sx + sy * sy;
    if (len2 < 1e-8) {
        return { x: 0, y: 0, z: 0 };
    }
    // t = world units along axis for this pointer delta
    const t = (pointerDxPx * sx + pointerDyPx * sy) / len2;
    return { x: u.x * t, y: u.y * t, z: u.z * t };
}
/**
 * Pick nearest axis handle in screen space (distance to segment ball→ball+len*axis).
 * Returns null if all distances > hitPx.
 */
export function pickGizmoAxis(screenX, screenY, ball, viewProj, viewportW, viewportH, axisLength = 0.55, hitPx = 14) {
    const p0 = worldToScreen(viewProj, ball.x, ball.y, ball.z, viewportW, viewportH);
    let best = null;
    let bestD = hitPx;
    for (const axis of ["x", "y", "z"]) {
        const u = AXIS_UNIT[axis];
        const p1 = worldToScreen(viewProj, ball.x + u.x * axisLength, ball.y + u.y * axisLength, ball.z + u.z * axisLength, viewportW, viewportH);
        const d = distPointToSegment2d(screenX, screenY, p0.x, p0.y, p1.x, p1.y);
        if (d < bestD) {
            bestD = d;
            best = axis;
        }
    }
    return best;
}
function distPointToSegment2d(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const ab2 = abx * abx + aby * aby;
    let t = ab2 > 1e-12 ? (apx * abx + apy * aby) / ab2 : 0;
    if (t < 0)
        t = 0;
    if (t > 1)
        t = 1;
    const cx = ax + abx * t;
    const cy = ay + aby * t;
    return Math.hypot(px - cx, py - cy);
}
export function addVec3(a, b) {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
//# sourceMappingURL=gizmo-drag.js.map