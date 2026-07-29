/**
 * Orbit camera focused on a selected solar body (pure).
 * Yaw around +Y, pitch clamped; radius = distance from focus.
 */
const PITCH_MIN = -1.42;
const PITCH_MAX = 1.42;
export function createSolarOrbitState(partial) {
    return {
        yaw: partial?.yaw ?? 0.55,
        pitch: partial?.pitch ?? 0.32,
        radius: partial?.radius ?? 18,
        focusX: partial?.focusX ?? 0,
        focusY: partial?.focusY ?? 0,
        focusZ: partial?.focusZ ?? 0,
    };
}
export function solarOrbitApplyDrag(state, dxPx, dyPx, sensitivity = 0.005) {
    let yaw = state.yaw - dxPx * sensitivity;
    let pitch = state.pitch + dyPx * sensitivity;
    if (pitch < PITCH_MIN)
        pitch = PITCH_MIN;
    if (pitch > PITCH_MAX)
        pitch = PITCH_MAX;
    yaw = ((yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return { ...state, yaw, pitch };
}
export function solarOrbitApplyZoom(state, deltaY, minR, maxR, factor = 1.0018) {
    const mul = Math.pow(factor, deltaY);
    let radius = state.radius * mul;
    if (radius < minR)
        radius = minR;
    if (radius > maxR)
        radius = maxR;
    return { ...state, radius };
}
export function solarOrbitSetFocus(state, fx, fy, fz, radius) {
    return {
        ...state,
        focusX: fx,
        focusY: fy,
        focusZ: fz,
        radius: radius ?? state.radius,
    };
}
export function solarOrbitEye(state) {
    const cp = Math.cos(state.pitch);
    const sp = Math.sin(state.pitch);
    const cy = Math.cos(state.yaw);
    const sy = Math.sin(state.yaw);
    return {
        eyeX: state.focusX + state.radius * cp * sy,
        eyeY: state.focusY + state.radius * sp,
        eyeZ: state.focusZ + state.radius * cp * cy,
        targetX: state.focusX,
        targetY: state.focusY,
        targetZ: state.focusZ,
    };
}
//# sourceMappingURL=solar-camera.js.map