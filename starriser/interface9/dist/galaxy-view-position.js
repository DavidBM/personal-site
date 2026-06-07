import * as THREE from "./vendor/three.js";
/**
 * Renderer-facing view records own their Vector3 instances. Keeping this copy
 * boundary explicit prevents flat data or caller-owned vectors from being
 * mutated through view-record movement.
 */
export function toGalaxyViewPosition(position) {
    return new THREE.Vector3(position.x, position.y, position.z);
}
export function snapshotGalaxyViewPosition(position) {
    return {
        x: position.x,
        y: position.y,
        z: position.z,
    };
}
//# sourceMappingURL=galaxy-view-position.js.map