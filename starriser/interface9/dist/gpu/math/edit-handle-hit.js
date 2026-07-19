/**
 * M4 — pure ground-plane hit tests for cluster edit handles.
 * No GPU / DOM; call after ground pick with layout from cluster radius.
 */
/**
 * Derive axis/plane/ring sizes from a cluster radius.
 * R = radius || 400; L = R*1.5; W = max(R*0.06, L*0.04); P = R*0.35; ring = R.
 */
export function layoutFromRadius(radius) {
    const R = radius || 400;
    const L = R * 1.5;
    const W = Math.max(R * 0.06, L * 0.04);
    const P = R * 0.35;
    return {
        axisLength: L,
        axisHalfWidth: W,
        planeHalfExtent: P,
        ringRadius: R,
    };
}
const PRIORITY = ["axisX", "axisZ", "planeXZ"];
function regionHit(kind, dx, dz, layout) {
    const L = layout.axisLength;
    const W = layout.axisHalfWidth;
    const P = layout.planeHalfExtent;
    if (kind === "axisX")
        return dx >= 0 && dx <= L && Math.abs(dz) <= W;
    if (kind === "axisZ")
        return dz >= 0 && dz <= L && Math.abs(dx) <= W;
    return Math.abs(dx) <= P && Math.abs(dz) <= P;
}
/**
 * Hit-test ground (x,z) against edit-handle regions.
 * Priority: axisX, then axisZ, then planeXZ.
 * All handles share one center (first handle x,z; or per-kind if present).
 */
export function hitEditHandleAtGround(groundX, groundZ, handles, layout) {
    if (handles.length === 0)
        return null;
    const first = handles[0];
    const cx = first.x;
    const cz = first.z;
    const dx = groundX - cx;
    const dz = groundZ - cz;
    for (let i = 0; i < PRIORITY.length; i++) {
        const kind = PRIORITY[i];
        if (!regionHit(kind, dx, dz, layout))
            continue;
        let match = null;
        for (let h = 0; h < handles.length; h++) {
            if (handles[h].kind === kind) {
                match = handles[h];
                break;
            }
        }
        const src = match ?? first;
        return {
            handleId: src.id,
            handleKind: kind,
            clusterId: src.clusterId,
        };
    }
    return null;
}
//# sourceMappingURL=edit-handle-hit.js.map