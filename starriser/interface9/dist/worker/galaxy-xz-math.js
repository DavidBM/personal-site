/**
 * ZX-plane (XZ) geometry utilities
 */
/**
 * Returns ZX-plane Euclidean distance between a and b, ignoring y.
 */
export function distZX(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
}
/**
 * Returns a random radius in [0, outer] according to a "bell curve" (normal-like) bias:
 *   - bias = 0: uniform radius (flat/neutral)
 *   - bias > 0: strong central concentration, higher = tighter "bell" in center
 *   - bias < 0: more clusters on the edges, lower = stronger edge bias
 * @param {number} outer
 * @param {number} bias
 * @returns {number}
 */
export function bellCurveRandomRadius(outer, bias = 0) {
    const t = Math.random();
    if (bias === 0) {
        // uniform
        return t * outer;
    }
    if (bias > 0) {
        // Central bell: sharper toward center
        // Use normal dist, but since [0,1], mirror for "one-sided bell" (abs centered at 0)
        let u = 0, v = 0;
        // Box-Muller transform
        do {
            u = Math.random();
            v = Math.random();
        } while (u === 0);
        const std = 0.25 / bias; // shrink std for higher bias ("narrower")
        let r = Math.abs(std * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v));
        r = Math.min(r, 1); // Clamp to 1
        return r * outer;
    }
    else {
        // Negative: "inverse bell", more at sides/edges
        // Map the central bell result to edge by inverting
        let u = 0, v = 0;
        do {
            u = Math.random();
            v = Math.random();
        } while (u === 0);
        const std = 0.25 / Math.abs(bias);
        let r = Math.abs(std * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v));
        r = 1 - Math.min(r, 1); // invert center-to-edges
        return r * outer;
    }
}
/**
 * Returns true if point p is within minDist of any point in arr (ZX, XZ-plane)
 */
export function tooCloseZX(p, arr, minDist) {
    for (const q of arr)
        if (distZX(p, q) < minDist)
            return true;
    return false;
}
/**
 * Returns angle in radians from from → to in XZ plane
 */
export function angleXZ(from, to) {
    // Returns angle in radians from from → to in XZ plane
    return Math.atan2(to.z - from.z, to.x - from.x);
}
/**
 * Returns {x,z} vector a - b (XZ-plane only, ZX)
 */
export function subZX(a, b) {
    return { x: a.x - b.x, z: a.z - b.z };
}
/**
 * Place a point at angle and radius in XZ, Y unchanged from center
 */
export function pointAtAngle(center, radius, angleRad) {
    // Place a point at angle and radius in XZ, Y unchanged from center
    return {
        x: center.x + Math.cos(angleRad) * radius,
        y: center.y,
        z: center.z + Math.sin(angleRad) * radius,
    };
}
/**
 * Returns normalized {x,z} direction vector (XZ-plane, ZX)
 */
export function normZX(v) {
    const mag = Math.sqrt(v.x * v.x + v.z * v.z);
    return mag > 0 ? { x: v.x / mag, z: v.z / mag } : { x: 0, z: 0 };
}
/**
 * Given two segments [a1,a2], [b1,b2], returns true if they cross (XZ only)
 */
export function lineSegmentsCrossXZ(a1, a2, b1, b2) {
    // Based on cross-product directions
    function d(p, q, r) {
        return (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
    }
    return d(a1, a2, b1) * d(a1, a2, b2) < 0 && d(b1, b2, a1) * d(b1, b2, a2) < 0;
}
/**
 * Returns minimum ZX-plane (XZ) distance from point p to line segment ab
 */
export function pointLineDistZX(p, a, b) {
    const px = p.x, pz = p.z, ax = a.x, az = a.z, bx = b.x, bz = b.z;
    const dx = bx - ax, dz = bz - az;
    if (dx === 0 && dz === 0)
        return distZX(p, a);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
    const cx = ax + t * dx, cz = az + t * dz;
    return Math.sqrt((px - cx) ** 2 + (pz - cz) ** 2);
}
/**
 * Returns true if segment ab passes through (within radius) any cluster except those with ids in exceptIds.
 */
export function lineIntersectsClusterZX(a, b, clusters, exceptIds = []) {
    for (const c of clusters) {
        if (exceptIds.includes(c.id))
            continue;
        // Epsilon expansion
        if (pointLineDistZX(c.position, a, b) <
            c.radius * 1.1 // 5% margin
        ) {
            return true;
        }
    }
    return false;
}
//# sourceMappingURL=galaxy-xz-math.js.map