/**
 * Pure spherical orbit camera for the model viewer.
 * Yaw around +Y, pitch clamped; eye = target + spherical offset.
 */
/** Default: look at origin from +Z / slightly up. */
export function createOrbitState(partial) {
    return {
        yaw: partial?.yaw ?? 0.6,
        pitch: partial?.pitch ?? 0.35,
        radius: partial?.radius ?? 3.5,
        targetX: partial?.targetX ?? 0,
        targetY: partial?.targetY ?? 0,
        targetZ: partial?.targetZ ?? 0,
    };
}
const PITCH_MIN = -1.45;
const PITCH_MAX = 1.45;
const RADIUS_MIN = 0.35;
const RADIUS_MAX = 80;
/**
 * Apply drag deltas (pixels → radians via sensitivity).
 * dx > 0 → yaw increases (orbit right).
 * dy > 0 → pitch increases (orbit up / look more from above when inverted?).
 * Standard: drag right → orbit right (model appears to rotate left).
 */
export function orbitApplyDrag(state, dxPx, dyPx, sensitivity = 0.005) {
    let yaw = state.yaw - dxPx * sensitivity;
    let pitch = state.pitch + dyPx * sensitivity;
    if (pitch < PITCH_MIN)
        pitch = PITCH_MIN;
    if (pitch > PITCH_MAX)
        pitch = PITCH_MAX;
    // Keep yaw in a finite range for numerics
    yaw = ((yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return { ...state, yaw, pitch };
}
export function orbitApplyZoom(state, deltaY, factor = 1.0015) {
    // Wheel up (negative) → closer
    const mul = Math.pow(factor, deltaY);
    let radius = state.radius * mul;
    if (radius < RADIUS_MIN)
        radius = RADIUS_MIN;
    if (radius > RADIUS_MAX)
        radius = RADIUS_MAX;
    return { ...state, radius };
}
/** Eye position from spherical orbit (Y-up). */
export function orbitEye(state) {
    const cp = Math.cos(state.pitch);
    const sp = Math.sin(state.pitch);
    const cy = Math.cos(state.yaw);
    const sy = Math.sin(state.yaw);
    const x = state.targetX + state.radius * cp * sy;
    const y = state.targetY + state.radius * sp;
    const z = state.targetZ + state.radius * cp * cy;
    return {
        eyeX: x,
        eyeY: y,
        eyeZ: z,
        targetX: state.targetX,
        targetY: state.targetY,
        targetZ: state.targetZ,
    };
}
//# sourceMappingURL=orbit-camera.js.map