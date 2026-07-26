/**
 * Pure mesh-yaw facing checks for model LOD.
 *
 * WGSL applies meshFix = quat(0, sin(meshYawHalf), 0, cos(meshYawHalf))
 * (half-angle Y-yaw) before the ShipSim body quaternion. Body forward = +Z.
 * Tip after meshFix must have positive · body +Z so the nose leads travel.
 */
import { quatRotateVec3 } from "./quat.js";
/**
 * Rotate a local mesh position by the production meshYawHalf (half-angle).
 * Matches fleet-model-ships.wgsl meshFix.
 */
export function rotateByMeshYawHalf(x, y, z, meshYawHalf) {
    const s = Math.sin(meshYawHalf);
    const c = Math.cos(meshYawHalf);
    return quatRotateVec3(0, s, 0, c, x, y, z);
}
/**
 * Pick the mesh tip vertex in local space.
 * - maxZ: procedural low-poly nose (+Z)
 * - minX: production Meshy GLB pointed tip (−X)
 */
export function meshTipLocal(interleaved, floatsPerVertex = 8, heuristic = "maxZ") {
    const stride = Math.max(3, floatsPerVertex | 0);
    const n = Math.floor(interleaved.length / stride);
    if (n <= 0) {
        return { x: 0, y: 0, z: 0, index: -1 };
    }
    let best = 0;
    let bestScore = heuristic === "minX" ? interleaved[0] : interleaved[2];
    for (let i = 1; i < n; i++) {
        const o = i * stride;
        const score = heuristic === "minX" ? interleaved[o] : interleaved[o + 2];
        if (heuristic === "minX" ? score < bestScore : score > bestScore) {
            bestScore = score;
            best = i;
        }
    }
    const o = best * stride;
    return {
        x: interleaved[o],
        y: interleaved[o + 1],
        z: interleaved[o + 2],
        index: best,
    };
}
/**
 * After meshYawHalf fix, tip · body forward (+Z). Must be **> 0** for nose-first.
 */
export function meshTipBodyForwardDot(interleaved, meshYawHalf, floatsPerVertex = 8, heuristic = "maxZ") {
    const tip = meshTipLocal(interleaved, floatsPerVertex, heuristic);
    if (tip.index < 0)
        return 0;
    const r = rotateByMeshYawHalf(tip.x, tip.y, tip.z, meshYawHalf);
    return r.z;
}
/** Production defaults: low-poly +Z tip; GLB −X tip → +90° half-angle. */
export const LOWPOLY_MESH_YAW_HALF = 0;
/** +90° Y-yaw half-angle: maps GLB −X nose → +Z. */
export const GLB_MESH_YAW_HALF = Math.PI / 4;
//# sourceMappingURL=mesh-yaw-facing.js.map