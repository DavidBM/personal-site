/**
 * Galaxy solar-point LOD — pure policy (no GPU / DOM).
 *
 * Systems and cluster impostors share a true screen-size target (~5px diameter).
 * When a cluster's systems would overlap at that size, replace them with one
 * impostor (hysteresis avoids flicker on the threshold).
 *
 * All sizing uses camera-to-target distance `d` (not per-point depth) so the
 * map-view can recompute O(clusters) only on camera/viewport change.
 */
/** True screen diameter for solar systems and jump gates (px). */
export const SYSTEM_POINT_DIAMETER_PX = 5;
/** True screen diameter for cluster impostors (px). */
export const CLUSTER_IMPOSTOR_DIAMETER_PX = 5;
/**
 * Switch to impostor when projected cluster diameter falls below
 * `OVERLAP_FACTOR * SYSTEM_POINT_DIAMETER_PX` (systems would stack).
 */
export const OVERLAP_FACTOR = 3;
/**
 * Camera distance at which all clusters prefer impostors (strategic band).
 * Aligned with map tilt flat height (~160k) so far view is flat + cluster dots.
 */
export const CLUSTER_IMPOSTOR_CAMERA_DIST = 160000;
/** Relative hysteresis on the distance threshold (~12%). */
export const LOD_HYSTERESIS = 0.12;
export const DEFAULT_GALAXY_POINT_LOD_POLICY = {
    systemDiameterPx: SYSTEM_POINT_DIAMETER_PX,
    impostorDiameterPx: CLUSTER_IMPOSTOR_DIAMETER_PX,
    overlapFactor: OVERLAP_FACTOR,
    hysteresis: LOD_HYSTERESIS,
    impostorCameraDist: CLUSTER_IMPOSTOR_CAMERA_DIST,
};
function resolvePolicy(policy) {
    return policy ?? DEFAULT_GALAXY_POINT_LOD_POLICY;
}
/** Euclidean distance from eye to look-at target. */
export function cameraDistanceToTarget(eye, target) {
    const ty = target.y ?? 0;
    const dx = eye.x - target.x;
    const dy = eye.y - ty;
    const dz = eye.z - target.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
/**
 * Billboard half-extent in world units so full diameter ≈ `diameterPx` at
 * distance `d` with vertical FOV and viewport height `viewportH`.
 *
 * worldDiameter = (diameterPx / H) * 2 * tan(fovy/2) * d
 * half-extent (shader multiplies corner ±1) = half of that.
 */
export function billboardScaleForDiameterPx(diameterPx, d, fovyDeg, viewportH) {
    const H = Math.max(1, viewportH);
    const dist = Math.max(1e-6, d);
    const halfFov = ((fovyDeg * Math.PI) / 180) * 0.5;
    const tanHalf = Math.tan(halfFov);
    // (diameterPx / H) * tan(fovy/2) * d
    return (diameterPx / H) * tanHalf * dist;
}
/**
 * Camera distance at which projected cluster diameter equals
 * `overlapFactor * systemDiameterPx`. Beyond this, systems overlap → impostor.
 *
 * screenDiam = (2 * radius) / (2 * tan(fovy/2) * d) * H
 *            = radius * H / (tan(fovy/2) * d)
 * set screenDiam = overlap * systemPx → dSwitch.
 */
export function clusterImpostorDistanceThreshold(radius, fovyDeg, viewportH, policy) {
    const p = resolvePolicy(policy);
    const H = Math.max(1, viewportH);
    const r = Math.max(0, radius);
    const halfFov = ((fovyDeg * Math.PI) / 180) * 0.5;
    const tanHalf = Math.tan(halfFov);
    const screenTarget = p.overlapFactor * p.systemDiameterPx;
    // Avoid div-by-zero: tiny target → huge threshold (always impostor far out)
    if (screenTarget <= 0 || tanHalf <= 0)
        return Number.POSITIVE_INFINITY;
    // d = radius * H / (screenTarget * tanHalf)
    return (r * H) / (screenTarget * tanHalf);
}
/**
 * Sticky impostor decision: enter when d exceeds threshold*(1+h), leave only
 * once d falls below threshold*(1-h).
 *
 * Threshold is the **max** of (size-overlap distance, strategic camera dist):
 * strategic ~{@link CLUSTER_IMPOSTOR_CAMERA_DIST} is a **floor** so typical
 * clusters keep systems until that zoom (size alone used to collapse them ~20–50k).
 * Very large clusters can stay detailed slightly longer when size says so.
 */
export function clusterImpostorWithHysteresis(d, radius, wasImpostor, fovyDeg, viewportH, policy) {
    const p = resolvePolicy(policy);
    const dSize = clusterImpostorDistanceThreshold(radius, fovyDeg, viewportH, p);
    const dStrategic = Math.max(0, p.impostorCameraDist);
    // Floor at strategic band — product dial for "when do I see cluster dots?"
    const dSwitch = Math.max(dSize, dStrategic);
    const h = Math.max(0, p.hysteresis);
    if (wasImpostor) {
        // Stay impostor until clearly closer than the lower edge
        return d >= dSwitch * (1 - h);
    }
    // Enter impostor only past the upper edge
    return d >= dSwitch * (1 + h);
}
//# sourceMappingURL=galaxy-point-lod.js.map