/**
 * System-orbit camera pose (pure, no GPU / DOM).
 *
 * Lifted yaw/pitch/radius eye math for Band B SCENE. The map camera
 * controller owns the mode — do not import `js/gpu/solar-system/`.
 * Look-at is the compact body; floating origin stays pathEnd / ship / eye.
 */
import { MAP_NEAR } from "./camera-zoom.js";
import { SCENE_EXIT_PX, SYSTEM_LOCAL_SPAN, distanceForSpanPx, } from "./solar-system-lod.js";
export const SYSTEM_ORBIT_DEFAULT_YAW = 0.55;
export const SYSTEM_ORBIT_DEFAULT_PITCH = 0.32;
/** Default orbit radius = this × {@link SYSTEM_LOCAL_SPAN} (0.18 at span 0.1). */
export const SYSTEM_ORBIT_RADIUS_SPAN_MUL = 1.8;
export const SYSTEM_ORBIT_DRAG_YAW_SENS = 0.005;
export const SYSTEM_ORBIT_DRAG_PITCH_SENS = 0.004;
export const SYSTEM_ORBIT_PITCH_MIN = -1.42;
export const SYSTEM_ORBIT_PITCH_MAX = 1.42;
/** Planet/sun min radius = max(this × bodyR, boom, near×NEAR_MUL). */
export const SYSTEM_ORBIT_BODY_MIN_R_MUL = 1.6;
export const SYSTEM_ORBIT_NEAR_MUL = 3;
/** Exit map height = dAt(SCENE_EXIT_PX) × this (beyond 50px re-enter). */
export const SYSTEM_ORBIT_EXIT_HEIGHT_MUL = 1.3;
export function defaultSystemOrbitRadius() {
    return SYSTEM_ORBIT_RADIUS_SPAN_MUL * SYSTEM_LOCAL_SPAN;
}
export function createSystemOrbitPose(partial) {
    return {
        yaw: partial?.yaw ?? SYSTEM_ORBIT_DEFAULT_YAW,
        pitch: partial?.pitch ?? SYSTEM_ORBIT_DEFAULT_PITCH,
        radius: partial?.radius ?? defaultSystemOrbitRadius(),
        focusX: partial?.focusX ?? 0,
        focusY: partial?.focusY ?? 0,
        focusZ: partial?.focusZ ?? 0,
        focusIndex: partial?.focusIndex ?? 0,
    };
}
export function systemOrbitEye(pose) {
    const cp = Math.cos(pose.pitch);
    const sp = Math.sin(pose.pitch);
    const cy = Math.cos(pose.yaw);
    const sy = Math.sin(pose.yaw);
    return {
        eyeX: pose.focusX + pose.radius * cp * sy,
        eyeY: pose.focusY + pose.radius * sp,
        eyeZ: pose.focusZ + pose.radius * cp * cy,
        targetX: pose.focusX,
        targetY: pose.focusY,
        targetZ: pose.focusZ,
    };
}
export function systemOrbitApplyDrag(pose, dxPx, dyPx, yawSens = SYSTEM_ORBIT_DRAG_YAW_SENS, pitchSens = SYSTEM_ORBIT_DRAG_PITCH_SENS) {
    let yaw = pose.yaw - dxPx * yawSens;
    let pitch = pose.pitch + dyPx * pitchSens;
    if (pitch < SYSTEM_ORBIT_PITCH_MIN)
        pitch = SYSTEM_ORBIT_PITCH_MIN;
    if (pitch > SYSTEM_ORBIT_PITCH_MAX)
        pitch = SYSTEM_ORBIT_PITCH_MAX;
    yaw = ((yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return { ...pose, yaw, pitch };
}
/**
 * Apply a log-radius wheel step (positive ds = zoom out).
 * Does **not** clamp with map MIN_ZOOM — orbit radius is independent.
 */
export function systemOrbitApplyWheel(pose, ds, minR, maxR) {
    const lo = Math.max(1e-9, minR);
    const hi = Math.max(lo, maxR);
    let radius = pose.radius * Math.exp(ds);
    let pastMax = false;
    if (ds > 0 && radius >= hi) {
        radius = hi;
        pastMax = true;
    }
    if (radius > hi)
        radius = hi;
    if (radius < lo)
        radius = lo;
    return { pose: { ...pose, radius }, pastMax };
}
export function systemOrbitSetFocus(pose, fx, fy, fz, focusIndex, radius) {
    return {
        ...pose,
        focusX: fx,
        focusY: fy,
        focusZ: fz,
        focusIndex: focusIndex | 0,
        radius: radius ?? pose.radius,
    };
}
/** Camera distance so limb diameter ≈ fillFrac × short edge. Floor on near×3. */
export function systemOrbitBoomDistance(radiusWorld, bufferW, bufferH, fovyDeg, fillFrac = 0.9, near = MAP_NEAR) {
    const short = Math.max(1, Math.min(bufferW, bufferH));
    const H = Math.max(1, bufferH);
    const th = Math.tan(((fovyDeg * Math.PI) / 180) * 0.5);
    const frac = fillFrac > 1e-6 ? fillFrac : 0.9;
    const d = (radiusWorld * H) / (frac * short * th);
    return Math.max(near * SYSTEM_ORBIT_NEAR_MUL, d);
}
export function systemOrbitMinRadius(bodyR, boom, near = MAP_NEAR) {
    return Math.max(SYSTEM_ORBIT_BODY_MIN_R_MUL * Math.max(0, bodyR), Math.max(0, boom), SYSTEM_ORBIT_NEAR_MUL * Math.max(0, near));
}
/** Distance where {@link SYSTEM_LOCAL_SPAN} projects to {@link SCENE_EXIT_PX}. */
export function systemOrbitMaxRadius(viewportH, fovyDeg) {
    return distanceForSpanPx(SCENE_EXIT_PX, viewportH, fovyDeg);
}
/**
 * Galaxy-pan rest height after orbit exit. 1.3× dAt(EXIT) so we do not
 * re-trigger the 50px Schmitt enter.
 */
export function systemOrbitExitHeight(viewportH, fovyDeg) {
    return (distanceForSpanPx(SCENE_EXIT_PX, viewportH, fovyDeg) *
        SYSTEM_ORBIT_EXIT_HEIGHT_MUL);
}
//# sourceMappingURL=system-orbit-pose.js.map