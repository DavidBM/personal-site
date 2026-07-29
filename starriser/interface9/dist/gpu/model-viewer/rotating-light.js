/**
 * Dual-axis continuous key light for the model viewer.
 * Polar (from +Y) and azimuthal (around Y) angles both advance over time.
 */
/**
 * Angular rates (rad/s). Both non-zero so the light is never fixed on one axis.
 */
export const VIEWER_LIGHT_POLAR_RATE = 0.55;
export const VIEWER_LIGHT_AZIMUTH_RATE = 0.91;
/**
 * Unit light direction at time `tSec`.
 * polar = ωp·t, azimuth = ωa·t — both components vary continuously.
 *
 * dir = (
 *   sin(polar) * cos(azimuth),
 *   cos(polar),
 *   sin(polar) * sin(azimuth)
 * )
 */
export function rotatingLightDir(tSec, polarRate = VIEWER_LIGHT_POLAR_RATE, azimuthRate = VIEWER_LIGHT_AZIMUTH_RATE) {
    // Keep polar away from exact 0/π poles for a stable orbit of the light.
    const polar = 0.55 + 0.85 * Math.sin(tSec * polarRate);
    const azimuth = tSec * azimuthRate;
    const sp = Math.sin(polar);
    const cp = Math.cos(polar);
    const sa = Math.sin(azimuth);
    const ca = Math.cos(azimuth);
    const x = sp * ca;
    const y = cp;
    const z = sp * sa;
    const len = Math.hypot(x, y, z) || 1;
    return { x: x / len, y: y / len, z: z / len };
}
/**
 * Prove dual-axis motion: polar and azimuth components of the direction
 * both change between t0 and t1 (not a constant light).
 */
export function lightDirChangesTwoAxes(t0, t1, eps = 1e-4) {
    const d0 = rotatingLightDir(t0);
    const d1 = rotatingLightDir(t1);
    // Reconstruct angles from unit dir
    const polar0 = Math.acos(Math.max(-1, Math.min(1, d0.y)));
    const polar1 = Math.acos(Math.max(-1, Math.min(1, d1.y)));
    const az0 = Math.atan2(d0.z, d0.x);
    const az1 = Math.atan2(d1.z, d1.x);
    return {
        polarChanged: Math.abs(polar1 - polar0) > eps,
        azimuthChanged: Math.abs(az1 - az0) > eps,
        d0,
        d1,
    };
}
//# sourceMappingURL=rotating-light.js.map