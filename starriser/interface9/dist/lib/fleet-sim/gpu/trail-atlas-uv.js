/**
 * Pure thruster-atlas UV math.
 *
 * Vertex-interpolated UVs zigzag on tapered thruster quads (atlas is
 * asymmetric along U). Production FS rebuilds UV by projecting the fragment
 * onto the segment axis — see {@link trailPathCorrectAtlasUv}.
 */
export function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}
/** Atlas U from trail sample alpha (1 = fresh/head/nozzle). */
export function trailAtlasUFromAlpha(alpha) {
    return 1 - clamp01(alpha);
}
/** Atlas V from body template side (−1 left, +1 right). */
export function trailAtlasVFromSide(side) {
    return (side + 1) * 0.5;
}
/**
 * UV at a ribbon vertex. `along` is 0 at start (older/tail) and 1 at end (newer/head).
 * U is linearly blended from endpoint ages so joints that share alphas meet.
 */
export function trailAtlasUv(alphaStart, alphaEnd, along, side) {
    const u0 = trailAtlasUFromAlpha(alphaStart);
    const u1 = trailAtlasUFromAlpha(alphaEnd);
    const t = clamp01(along);
    return {
        u: u0 + (u1 - u0) * t,
        v: trailAtlasVFromSide(side),
    };
}
/**
 * Path-correct atlas UV (mirrors fleet-trails FS).
 * Projects a view-space point onto the segment; independent of triangle diagonal.
 */
export function trailPathCorrectAtlasUv(opts) {
    const tx = opts.segEnd.x - opts.segStart.x;
    const ty = opts.segEnd.y - opts.segStart.y;
    const tz = opts.segEnd.z - opts.segStart.z;
    const len2 = Math.max(tx * tx + ty * ty + tz * tz, 1e-12);
    const apx = opts.viewPos.x - opts.segStart.x;
    const apy = opts.viewPos.y - opts.segStart.y;
    const apz = opts.viewPos.z - opts.segStart.z;
    const t = clamp01((apx * tx + apy * ty + apz * tz) / len2);
    const u = opts.u0 + (opts.u1 - opts.u0) * t;
    // side axis = normalize(cross(trail, (0,0,-1))) = normalize((−ty, tx, 0)) when trail ⟂ Z
    let sx = -ty;
    let sy = tx;
    let sz = 0;
    let sl = Math.hypot(sx, sy, sz);
    if (sl < 1e-5) {
        // trail ‖ view forward — use cross(trail, up)
        sx = ty * 0 - tz * 1;
        sy = tz * 0 - tx * 0;
        sz = tx * 1 - ty * 0;
        sl = Math.hypot(sx, sy, sz);
    }
    if (sl < 1e-5) {
        sx = 1;
        sy = 0;
        sz = 0;
        sl = 1;
    }
    sx /= sl;
    sy /= sl;
    sz /= sl;
    const cx = opts.segStart.x + tx * t;
    const cy = opts.segStart.y + ty * t;
    const cz = opts.segStart.z + tz * t;
    const s = (opts.viewPos.x - cx) * sx +
        (opts.viewPos.y - cy) * sy +
        (opts.viewPos.z - cz) * sz;
    const halfW = opts.halfW0 + (opts.halfW1 - opts.halfW0) * t;
    const v = clamp01(0.5 + 0.5 * (s / Math.max(halfW, 1e-6)));
    return { u, v, t };
}
/**
 * Centerline samples (s=0) along a bent polyline must keep V≈0.5 and monotonic U
 * — proves path-correct UV does not zigzag the thruster core.
 */
export function trailPathCorrectCenterlineCheck(opts) {
    const pts = opts.points;
    const a = opts.alphas;
    let maxVCenterErr = 0;
    let uMonotonic = true;
    let prevU = -Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i];
        const p1 = pts[i + 1];
        const u0 = trailAtlasUFromAlpha(a[i]);
        const u1 = trailAtlasUFromAlpha(a[i + 1]);
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
            const mid = {
                x: p0.x + (p1.x - p0.x) * t,
                y: p0.y + (p1.y - p0.y) * t,
                z: p0.z + (p1.z - p0.z) * t,
            };
            const uv = trailPathCorrectAtlasUv({
                viewPos: mid,
                segStart: p0,
                segEnd: p1,
                u0,
                u1,
                halfW0: opts.halfW,
                halfW1: opts.halfW,
            });
            maxVCenterErr = Math.max(maxVCenterErr, Math.abs(uv.v - 0.5));
            if (uv.u + 1e-6 < prevU)
                uMonotonic = false;
            prevU = uv.u;
        }
    }
    return { maxVCenterErr, uMonotonic };
}
/**
 * Multi-segment polyline UV continuity check (vertex-style UVs).
 * For each joint, same-side UVs of the two incident segs must meet, and U
 * along the path must be monotonic with increasing alpha (toward the head).
 */
export function trailAtlasUvPolylineContinuity(opts) {
    const a = opts.alphas;
    if (a.length < 2) {
        return { maxJointUvGap: 0, uMonotonicTowardHead: true, vStablePerSide: true };
    }
    let maxJointUvGap = 0;
    let uMonotonicTowardHead = true;
    let vStablePerSide = true;
    // Walk segments i: sample i → i+1 (older → newer when alphas increase toward head)
    for (let i = 0; i < a.length - 1; i++) {
        const a0 = a[i];
        const a1 = a[i + 1];
        // At end of seg i (along=1) vs start of seg i+1 (along=0) — joint
        if (i + 1 < a.length - 1 || i < a.length - 2) {
            /* joint between seg i and seg i+1 shares sample i+1 */
        }
        for (const side of [-1, 1]) {
            const endOfSeg = trailAtlasUv(a0, a1, 1, side);
            if (i + 1 < a.length - 1) {
                const a2 = a[i + 2];
                const startOfNext = trailAtlasUv(a1, a2, 0, side);
                const gap = Math.hypot(endOfSeg.u - startOfNext.u, endOfSeg.v - startOfNext.v);
                maxJointUvGap = Math.max(maxJointUvGap, gap);
                if (Math.abs(endOfSeg.v - startOfNext.v) > 1e-9)
                    vStablePerSide = false;
            }
        }
        // U should move toward nozzle (decrease) as alpha rises toward head
        const uTip = trailAtlasUFromAlpha(a0);
        const uHead = trailAtlasUFromAlpha(a1);
        // When alpha increases along path, U must not increase (no reverse)
        if (a1 + 1e-9 >= a0 && uHead > uTip + 1e-6) {
            uMonotonicTowardHead = false;
        }
    }
    return { maxJointUvGap, uMonotonicTowardHead, vStablePerSide };
}
//# sourceMappingURL=trail-atlas-uv.js.map