/**
 * Human figure for judging ship size in the model viewer: a low-poly 1.8 m
 * mannequin, in metres, feet at y = 0, facing +Z (the ship forward axis).
 *
 * Default lengths are the game's design lengths (CLASS_LENGTH_M, which also
 * sets the in-game draw scales); the length is editable per view.
 */
import { GLTF_FLOATS_PER_VERTEX } from "../../lib/fleet-sim/visual/gltf-static-mesh.js";
import { createLowPolyShipMesh } from "../../lib/fleet-sim/visual/lowpoly-ship-mesh.js";
// @ts-expect-error JS class metadata is shared with the motion kernel.
import { CLASS_LENGTH_M } from "../../lib/ship-runtime/classes.mjs";
export const PERSON_HEIGHT_M = 1.8;
const CLASS_KEYS = ["interceptor", "fighter", "bomber", "frigate", "battleship", "colossus"];
/** Design length in metres for a game class key; unknown classes get the fighter's. */
export function defaultShipLengthM(classKey) {
    const index = CLASS_KEYS.indexOf(classKey ?? "");
    return CLASS_LENGTH_M[index < 0 ? 1 : index];
}
/** Centre and size in metres: legs, hips, torso, shoulders, arms, neck, head. */
const BOXES = [
    [-0.1, 0.43, 0, 0.15, 0.86, 0.17], [0.1, 0.43, 0, 0.15, 0.86, 0.17],
    [0, 0.95, 0, 0.36, 0.2, 0.2],
    [0, 1.2, 0, 0.4, 0.42, 0.22],
    [0, 1.43, 0, 0.46, 0.06, 0.2],
    [-0.27, 1.13, 0, 0.09, 0.6, 0.11], [0.27, 1.13, 0, 0.09, 0.6, 0.11],
    [0, 1.5, 0, 0.1, 0.08, 0.1],
    [0, 1.66, 0.01, 0.2, 0.25, 0.23],
];
const FACES = [
    [[1, 0, 0], [1, 3, 7, 5]], [[-1, 0, 0], [0, 4, 6, 2]], [[0, 1, 0], [2, 6, 7, 3]],
    [[0, -1, 0], [0, 1, 5, 4]], [[0, 0, 1], [4, 5, 7, 6]], [[0, 0, -1], [0, 2, 3, 1]],
];
/** Flat-shaded boxes, outward counter-clockwise faces; `offset` places the feet (metres). */
export function createPersonMesh(offset = [0, 0, 0]) {
    const verts = [], indices = [];
    for (const [cx, cy, cz, sx, sy, sz] of BOXES) {
        const corner = (i) => [cx + (i & 1 ? sx : -sx) / 2 + offset[0], cy + (i & 2 ? sy : -sy) / 2 + offset[1], cz + (i & 4 ? sz : -sz) / 2 + offset[2]];
        for (const [normal, quad] of FACES) {
            const base = verts.length / GLTF_FLOATS_PER_VERTEX;
            for (const i of quad)
                verts.push(...corner(i), ...normal, 0, 0);
            indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
    }
    return { ...createLowPolyShipMesh(), interleaved: new Float32Array(verts), indices: new Uint32Array(indices),
        vertexCount: verts.length / GLTF_FLOATS_PER_VERTEX, indexCount: indices.length, materialName: "scale-person", images: [],
        baseColorImage: -1, normalImage: -1, diffuseSpecularImage: -1 };
}
//# sourceMappingURL=scale-figure.js.map