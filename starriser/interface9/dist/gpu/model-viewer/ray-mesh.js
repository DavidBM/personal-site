/**
 * Pure ray–triangle / ray–mesh hit for model-viewer thruster attach picking.
 * Möller–Trumbore; no GPU. Mesh positions are already in viewer world space.
 */
const EPS = 1e-8;
function sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function cross(a, b) {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}
function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
function addScaled(o, d, t) {
    return { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
}
/**
 * Ray vs triangle. Returns hit if t > 0 and barycentrics inside.
 * `cullBackface` discards when det < 0 (clockwise vs RH ray).
 */
export function rayTriangleHit(ray, v0, v1, v2, cullBackface = false) {
    const e1 = sub(v1, v0);
    const e2 = sub(v2, v0);
    const pvec = cross(ray.dir, e2);
    const det = dot(e1, pvec);
    if (cullBackface) {
        if (det < EPS)
            return null;
    }
    else if (Math.abs(det) < EPS) {
        return null;
    }
    const invDet = 1 / det;
    const tvec = sub(ray.origin, v0);
    const u = dot(tvec, pvec) * invDet;
    if (u < 0 || u > 1)
        return null;
    const qvec = cross(tvec, e1);
    const v = dot(ray.dir, qvec) * invDet;
    if (v < 0 || u + v > 1)
        return null;
    const t = dot(e2, qvec) * invDet;
    if (t <= EPS)
        return null;
    return {
        t,
        point: addScaled(ray.origin, ray.dir, t),
        triIndex: -1,
        u,
        v,
    };
}
/**
 * Closest forward hit against an indexed triangle mesh.
 * `positions` = flat xyz (3 floats / vertex), `indices` = uint triangles.
 */
export function rayMeshHit(ray, positions, indices, cullBackface = false) {
    const triCount = Math.floor(indices.length / 3);
    let best = null;
    for (let ti = 0; ti < triCount; ti++) {
        const i0 = indices[ti * 3];
        const i1 = indices[ti * 3 + 1];
        const i2 = indices[ti * 3 + 2];
        const v0 = {
            x: positions[i0 * 3],
            y: positions[i0 * 3 + 1],
            z: positions[i0 * 3 + 2],
        };
        const v1 = {
            x: positions[i1 * 3],
            y: positions[i1 * 3 + 1],
            z: positions[i1 * 3 + 2],
        };
        const v2 = {
            x: positions[i2 * 3],
            y: positions[i2 * 3 + 1],
            z: positions[i2 * 3 + 2],
        };
        const hit = rayTriangleHit(ray, v0, v1, v2, cullBackface);
        if (!hit)
            continue;
        if (!best || hit.t < best.t) {
            hit.triIndex = ti;
            best = hit;
        }
    }
    return best;
}
/**
 * Build world-space position buffer from glTF interleaved (pos3+nrm3+uv2)
 * with production mesh yaw half-angle + model scale (matches fleet model VS).
 */
export function buildViewerWorldPositions(interleaved, floatsPerVertex, meshYawHalf, modelScale) {
    const stride = Math.max(3, floatsPerVertex | 0);
    const n = Math.floor(interleaved.length / stride);
    const out = new Float32Array(n * 3);
    const s = Math.sin(meshYawHalf);
    const c = Math.cos(meshYawHalf);
    // quat(0, s, 0, c) Y-yaw half-angle — same as fleet-model-ships meshFix
    for (let i = 0; i < n; i++) {
        const bx = interleaved[i * stride];
        const by = interleaved[i * stride + 1];
        const bz = interleaved[i * stride + 2];
        // quatRotate: v + 2w (q×v) + 2 (q×(q×v)) with q=(0,s,0), w=c
        // For pure Y-yaw: x' = c²*x + 2*s*c*z - s²*x  … standard:
        // R_y(2*half): x' = cos θ x + sin θ z, z' = -sin θ x + cos θ z, θ=2*half
        const cosT = c * c - s * s; // cos(2half)
        const sinT = 2 * s * c; // sin(2half)
        const x = (cosT * bx + sinT * bz) * modelScale;
        const y = by * modelScale;
        const z = (-sinT * bx + cosT * bz) * modelScale;
        out[i * 3] = x;
        out[i * 3 + 1] = y;
        out[i * 3 + 2] = z;
    }
    return out;
}
//# sourceMappingURL=ray-mesh.js.map