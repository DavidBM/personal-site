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
 * Unit-ish fighter: length ~2 along +Z, wingspan ~1.6, height ~0.4.
 * ~40 triangles — cheap instancing.
 */
export function createLowPolyShipMesh() {
    const verts = [];
    const indices = [];
    // Nose / fuselage (pointed)
    const nose = [0, 0.05, 1.1];
    const deck = [0, 0.18, 0.15];
    const belly = [0, -0.12, 0.1];
    const midL = [-0.18, 0.02, 0.2];
    const midR = [0.18, 0.02, 0.2];
    const tailL = [-0.12, 0.05, -0.85];
    const tailR = [0.12, 0.05, -0.85];
    const tailB = [0, -0.08, -0.9];
    const tailTop = [0, 0.22, -0.7];
    // Wings
    const wingL = [-0.85, 0.0, -0.15];
    const wingR = [0.85, 0.0, -0.15];
    const wingLT = [-0.55, 0.04, -0.55];
    const wingRT = [0.55, 0.04, -0.55];
    const uvN = [
        [0.5, 1],
        [0, 0.5],
        [1, 0.5],
    ];
    const uvW = [
        [0, 0],
        [1, 0],
        [0.5, 1],
    ];
    // Fuselage
    tri(verts, indices, nose, midL, deck, uvN);
    tri(verts, indices, nose, deck, midR, uvN);
    tri(verts, indices, nose, belly, midL, uvN);
    tri(verts, indices, nose, midR, belly, uvN);
    tri(verts, indices, deck, midL, tailTop, uvN);
    tri(verts, indices, deck, tailTop, midR, uvN);
    tri(verts, indices, midL, belly, tailB, uvN);
    tri(verts, indices, midR, tailB, belly, uvN);
    tri(verts, indices, midL, tailL, tailTop, uvN);
    tri(verts, indices, midR, tailTop, tailR, uvN);
    tri(verts, indices, tailL, tailB, tailTop, uvN);
    tri(verts, indices, tailR, tailTop, tailB, uvN);
    tri(verts, indices, midL, tailB, tailL, uvN);
    tri(verts, indices, midR, tailR, tailB, uvN);
    // Wings (top + bottom)
    tri(verts, indices, midL, wingL, wingLT, uvW);
    tri(verts, indices, midL, wingLT, tailL, uvW);
    tri(verts, indices, midR, wingRT, wingR, uvW);
    tri(verts, indices, midR, tailR, wingRT, uvW);
    tri(verts, indices, midL, wingLT, wingL, [
        [0, 1],
        [1, 1],
        [0.5, 0],
    ]);
    tri(verts, indices, midR, wingR, wingRT, [
        [0, 1],
        [0.5, 0],
        [1, 1],
    ]);
    // Engine pods (rear)
    const eL0 = [-0.2, -0.02, -0.75];
    const eL1 = [-0.32, -0.02, -1.05];
    const eR0 = [0.2, -0.02, -0.75];
    const eR1 = [0.32, -0.02, -1.05];
    tri(verts, indices, eL0, eL1, tailB, uvW);
    tri(verts, indices, eR0, tailB, eR1, uvW);
    tri(verts, indices, eL0, tailL, eL1, uvW);
    tri(verts, indices, eR0, eR1, tailR, uvW);
    // Vertical fin
    const fin = [0, 0.45, -0.55];
    tri(verts, indices, tailTop, fin, tailL, uvW);
    tri(verts, indices, tailTop, tailR, fin, uvW);
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