/**
 * UV sphere mesh builders for the surface-methods demo.
 * Standard sphere uses moderate density; displace mesh is denser so height push shows holes.
 */
export const VERTEX_STRIDE_FLOATS = 11;
/**
 * Lat-long UV sphere. v=0 south, v=1 north (matches heightfield).
 * Tangents point +U (east).
 */
export function buildUVSphere(radius, segments, rings) {
    const seg = Math.max(3, segments | 0);
    const rg = Math.max(2, rings | 0);
    const stride = VERTEX_STRIDE_FLOATS;
    const vertexCount = (seg + 1) * (rg + 1);
    const vertices = new Float32Array(vertexCount * stride);
    let vi = 0;
    for (let y = 0; y <= rg; y++) {
        const v = y / rg;
        const theta = (1 - v) * Math.PI; // 0 north
        const st = Math.sin(theta);
        const ct = Math.cos(theta);
        for (let x = 0; x <= seg; x++) {
            const u = x / seg;
            const phi = u * Math.PI * 2;
            const cp = Math.cos(phi);
            const sp = Math.sin(phi);
            const nx = st * cp;
            const ny = ct;
            const nz = st * sp;
            // tangent = dP/du (east)
            let tx = -st * sp;
            let ty = 0;
            let tz = st * cp;
            const tlen = Math.hypot(tx, ty, tz) || 1;
            tx /= tlen;
            ty /= tlen;
            tz /= tlen;
            // poles: arbitrary tangent
            if (tlen < 1e-6) {
                tx = 1;
                ty = 0;
                tz = 0;
            }
            vertices[vi++] = nx * radius;
            vertices[vi++] = ny * radius;
            vertices[vi++] = nz * radius;
            vertices[vi++] = nx;
            vertices[vi++] = ny;
            vertices[vi++] = nz;
            vertices[vi++] = u;
            vertices[vi++] = v;
            vertices[vi++] = tx;
            vertices[vi++] = ty;
            vertices[vi++] = tz;
        }
    }
    const indices = new Uint32Array(seg * rg * 6);
    let ii = 0;
    const row = seg + 1;
    // CCW from outside (camera looks toward −Z / toward origin).
    for (let y = 0; y < rg; y++) {
        for (let x = 0; x < seg; x++) {
            const a = y * row + x;
            const b = a + row;
            indices[ii++] = a;
            indices[ii++] = a + 1;
            indices[ii++] = b;
            indices[ii++] = a + 1;
            indices[ii++] = b + 1;
            indices[ii++] = b;
        }
    }
    return {
        vertices,
        indices,
        vertexCount,
        indexCount: indices.length,
        strideFloats: stride,
    };
}
/** Standard preview sphere (smooth enough for fragment methods). */
export function buildStandardSphere(radius = 1) {
    return buildUVSphere(radius, 96, 48);
}
/** Dense sphere for geometric vertex displacement. */
export function buildDisplaceSphere(radius = 1) {
    return buildUVSphere(radius, 256, 128);
}
/**
 * Push unit-sphere vertices along normals by a height function.
 * height01(u,v) → 1 crust, 0 near-core; strength is max indent fraction.
 */
export function applyVertexDisplacement(mesh, height01, strength) {
    const s = mesh.strideFloats;
    const v = mesh.vertices.slice();
    for (let i = 0; i < mesh.vertexCount; i++) {
        const o = i * s;
        const u = v[o + 6];
        const vv = v[o + 7];
        const nx = v[o + 3];
        const ny = v[o + 4];
        const nz = v[o + 5];
        const h = height01(u, vv);
        const r = 1 - (1 - h) * strength;
        v[o] = nx * r;
        v[o + 1] = ny * r;
        v[o + 2] = nz * r;
        // Keep geometric normal as radial for lighting base
        v[o + 3] = nx;
        v[o + 4] = ny;
        v[o + 5] = nz;
    }
    return {
        vertices: v,
        indices: mesh.indices,
        vertexCount: mesh.vertexCount,
        indexCount: mesh.indexCount,
        strideFloats: mesh.strideFloats,
    };
}
/**
 * Displace by a direct radius function r(u,v) ∈ (0,1] (e.g. asteroid shell).
 * Positions = normalize * r; normals stay radial.
 */
export function applyRadialRadius(mesh, radiusUV) {
    const s = mesh.strideFloats;
    const v = mesh.vertices.slice();
    for (let i = 0; i < mesh.vertexCount; i++) {
        const o = i * s;
        const u = v[o + 6];
        const vv = v[o + 7];
        const nx = v[o + 3];
        const ny = v[o + 4];
        const nz = v[o + 5];
        const r = Math.max(0.05, radiusUV(u, vv));
        v[o] = nx * r;
        v[o + 1] = ny * r;
        v[o + 2] = nz * r;
    }
    return {
        vertices: v,
        indices: mesh.indices,
        vertexCount: mesh.vertexCount,
        indexCount: mesh.indexCount,
        strideFloats: mesh.strideFloats,
    };
}
/** Density for 500-instance asteroid mesh compare (balance look vs cost). */
export const ASTEROID_MESH_SEGMENTS = 48;
export const ASTEROID_MESH_RINGS = 24;
/**
 * Build a proper triangle mesh of the asteroid radial shell (pure; Node smokeable).
 * Uses the shipped asteroid shape radius, not a disc impostor.
 */
export function buildAsteroidMesh(radiusUV, segments = ASTEROID_MESH_SEGMENTS, rings = ASTEROID_MESH_RINGS) {
    const base = buildUVSphere(1, segments, rings);
    return applyRadialRadius(base, radiusUV);
}
//# sourceMappingURL=mesh.js.map