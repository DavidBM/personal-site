/**
 * Large-world floating origin for precision-sensitive fleet draws.
 *
 * Galaxy |xz| can be 1e5–1e7+ while ship meshes / trail samples are O(0.01–5).
 * Absolute f32 `world + mesh` loses mesh-scale bits far from the origin.
 * Frame origin (camera-linked by default) lets shaders form
 *   relative = (world − origin) + smallOffset
 * then multiply by a view built with eye/target also relative to the same origin.
 *
 * Not tied to cluster/system centers — mid-jump fleets stay precise when the
 * camera is near them.
 */
import { mat4LookAt } from "./mat4.js";
/**
 * Choose the frame floating origin for fleet model / triangle / trail draws.
 *
 * - Prefer the followed ship when actively chasing (stable hull-local frame).
 * - Else the camera eye (camera-linked; covers inter-cluster travel).
 *
 * Never requires a cluster or solar-system anchor.
 */
export function chooseFrameOrigin(eyeX, eyeY, eyeZ, follow) {
    if (follow != null &&
        Number.isFinite(follow.posX) &&
        Number.isFinite(follow.posZ)) {
        const y = follow.posY;
        return {
            x: follow.posX,
            y: Number.isFinite(y) ? y : 0,
            z: follow.posZ,
        };
    }
    return { x: eyeX, y: eyeY, z: eyeZ };
}
/** world − origin in f64 (JS number). */
export function relativeToOrigin(worldX, worldY, worldZ, originX, originY, originZ) {
    return {
        x: worldX - originX,
        y: worldY - originY,
        z: worldZ - originZ,
    };
}
/**
 * Look-at with eye/target expressed relative to `origin` (f64 subtract, then f32 mat).
 * When origin ≈ eye, translation terms stay small → stable close-up framing.
 */
export function mat4LookAtRelative(out, eyeX, eyeY, eyeZ, centerX, centerY, centerZ, originX, originY, originZ, upX = 0, upY = 1, upZ = 0) {
    return mat4LookAt(out, eyeX - originX, eyeY - originY, eyeZ - originZ, centerX - originX, centerY - originY, centerZ - originZ, upX, upY, upZ);
}
/** Cast through Float32Array (same as GPU f32 storage / VS math). */
export function f32(n) {
    return Math.fround(n);
}
/**
 * Absolute f32 world position of a mesh vertex (the precision-hostile path):
 *   f32(f32(ship) + f32(mesh))
 */
export function meshWorldAbsoluteF32(shipX, shipY, shipZ, meshX, meshY, meshZ) {
    return {
        x: f32(f32(shipX) + f32(meshX)),
        y: f32(f32(shipY) + f32(meshY)),
        z: f32(f32(shipZ) + f32(meshZ)),
    };
}
/**
 * Origin-relative mesh vertex (mirrors model / ship VS):
 *   f32(f32(ship) − f32(origin)) + f32(mesh)
 * Keeps mesh-scale detail when |ship| is huge but ship ≈ origin.
 */
export function meshWorldRelativeF32(shipX, shipY, shipZ, meshX, meshY, meshZ, originX, originY, originZ) {
    return {
        x: f32(f32(f32(shipX) - f32(originX)) + f32(meshX)),
        y: f32(f32(f32(shipY) - f32(originY)) + f32(meshY)),
        z: f32(f32(f32(shipZ) - f32(originZ)) + f32(meshZ)),
    };
}
/**
 * Trail endpoint relative to origin (mirrors trail VS before modelView):
 *   f32(f32(end) − f32(origin))
 */
export function trailEndpointRelativeF32(endX, endY, endZ, originX, originY, originZ) {
    return {
        x: f32(f32(endX) - f32(originX)),
        y: f32(f32(endY) - f32(originY)),
        z: f32(f32(endZ) - f32(originZ)),
    };
}
/**
 * Expand-time thruster endpoint (production model-trail path):
 *   f32(f32(sample) − f32(origin)) + f32(potWorld)
 *
 * Apply the **small** pot offset after the origin subtract so mesh-scale thruster
 * offsets survive at large |world| (same family as {@link meshWorldRelativeF32}).
 * Hostile path {@link trailExpandEndpointAbsoluteF32} loses pot bits first.
 */
export function trailExpandEndpointRelativeF32(sampleX, sampleY, sampleZ, potX, potY, potZ, originX, originY, originZ) {
    return {
        x: f32(f32(f32(sampleX) - f32(originX)) + f32(potX)),
        y: f32(f32(f32(sampleY) - f32(originY)) + f32(potY)),
        z: f32(f32(f32(sampleZ) - f32(originZ)) + f32(potZ)),
    };
}
/**
 * Hostile expand: f32(f32(sample) + f32(pot)) then later − origin in the VS.
 * At large |sample|, pot quantizes away → thrusters collapse into the hull.
 */
export function trailExpandEndpointAbsoluteF32(sampleX, sampleY, sampleZ, potX, potY, potZ) {
    return {
        x: f32(f32(sampleX) + f32(potX)),
        y: f32(f32(sampleY) + f32(potY)),
        z: f32(f32(sampleZ) + f32(potZ)),
    };
}
/**
 * Ensure a ship index is present on the model/trail ownership list (follow force-include).
 * Returns the same array if already present or idx invalid.
 */
export function ensureShipIndexInList(indices, shipIndex) {
    const i = shipIndex | 0;
    if (i < 0 || !Number.isFinite(shipIndex))
        return indices.slice();
    for (let k = 0; k < indices.length; k++) {
        if ((indices[k] | 0) === i)
            return indices.slice();
    }
    const out = indices.slice();
    out.push(i);
    return out;
}
/**
 * Absolute f32 trail endpoint (hostile path) used only for golden comparisons.
 */
export function trailEndpointAbsoluteF32(endX, endY, endZ) {
    return { x: f32(endX), y: f32(endY), z: f32(endZ) };
}
/**
 * True relative mesh offset recovered from absolute world verts (f64 truth).
 * Used by tests as the golden delta between two mesh verts on the same ship.
 */
export function meshDeltaTruth(meshAx, meshAy, meshAz, meshBx, meshBy, meshBz) {
    return {
        x: meshAx - meshBx,
        y: meshAy - meshBy,
        z: meshAz - meshBz,
    };
}
//# sourceMappingURL=world-origin.js.map