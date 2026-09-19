/**
 * Cheap low-poly fighter mesh for model LOD (10k @ 60 FPS target).
 * Shape: pointed nose + wing delta + twin engines — body forward = **+Z**
 * (matches ShipSim). Interleaved pos3 + nrm3 + uv2 like gltf-static-mesh.
 */
import { GLTF_FLOATS_PER_VERTEX, } from "./gltf-static-mesh.js";
function pushVert(out, p, n, u, v) {
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    out.push(p[0], p[1], p[2], n[0] / nl, n[1] / nl, n[2] / nl, u, v);
}
function faceNormal(a, b, c) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}
function tri(verts, indices, a, b, c, uv) {
    const n = faceNormal(a, b, c);
    const base = verts.length / GLTF_FLOATS_PER_VERTEX;
    pushVert(verts, a, n, uv[0][0], uv[0][1]);
    pushVert(verts, b, n, uv[1][0], uv[1][1]);
    pushVert(verts, c, n, uv[2][0], uv[2][1]);
    indices.push(base, base + 1, base + 2);
}
/**
 * Paper-dart fighter: length ~2 along +Z. 8 triangles — silhouette only.
 */
export function createLowPolyShipMesh() {
    const verts = [];
    const indices = [];
    const nose = [0, 0.02, 1.0];
    const wingL = [-0.7, 0, -0.2];
    const wingR = [0.7, 0, -0.2];
    const tail = [0, 0, -1.0];
    const keel = [0, -0.12, -0.15];
    const fin = [0, 0.28, -0.55];
    const uv = [[0.5, 1], [0, 0], [1, 0]];
    tri(verts, indices, nose, wingL, fin, uv);
    tri(verts, indices, nose, fin, wingR, uv);
    tri(verts, indices, nose, keel, wingL, uv);
    tri(verts, indices, nose, wingR, keel, uv);
    tri(verts, indices, tail, fin, wingL, uv);
    tri(verts, indices, tail, wingR, fin, uv);
    tri(verts, indices, tail, wingL, keel, uv);
    tri(verts, indices, tail, keel, wingR, uv);
    const interleaved = new Float32Array(verts);
    const idx = new Uint32Array(indices);
    const vertexCount = interleaved.length / GLTF_FLOATS_PER_VERTEX;
    // 1×1 procedural “textures” as empty — GPU layer uses solid cool defaults.
    return {
        interleaved,
        indices: idx,
        vertexCount,
        indexCount: idx.length,
        floatsPerVertex: GLTF_FLOATS_PER_VERTEX,
        bakedScale: 1,
        images: [],
        baseColorImage: -1,
        diffuseSpecularImage: -1,
        normalImage: -1,
        materialName: "lowpoly-fighter",
    };
}
//# sourceMappingURL=lowpoly-ship-mesh.js.map