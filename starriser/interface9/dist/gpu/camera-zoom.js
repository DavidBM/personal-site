/**
 * Map-camera zoom / tilt policy (pure, no GPU / DOM).
 *
 * - Zoom space: log height s = ln(h) so equal effort ≈ equal screen-scale change.
 * - Wheel extends targets; controller damps with frame-time–independent exp ease.
 * - Far: pure top-down (tilt 0). Near: up to 42° pitch along fixed −Z.
 * - Zoom-in: cursor pivot; zoom-out: screen-center pivot.
 */
export const MIN_ZOOM = 100;
export const MAX_ZOOM = 1000000;
/**
 * Height at/below which tilt is full (tactical).
 * Paired with {@link TILT_FLAT_HEIGHT} ≈ strategic LOD band (~160k).
 */
export const TILT_FULL_HEIGHT = 5000;
/**
 * Height at/above which tilt is zero (strategic top-down).
 * Aligned with cluster impostor height so graph view is flat + impostored.
 */
export const TILT_FLAT_HEIGHT = 160000;
export const MIN_TILT_RAD = 0;
/** Max pitch when fully zoomed in (42° — a bit stronger than the old 30°). */
export const MAX_TILT_RAD = (42 * Math.PI) / 180;
/** Time constants for exp approach (seconds). */
export const TAU_S = 0.09;
export const TAU_XZ = 0.09;
/** Slight lag so tip-in reads as intentional. */
export const TAU_TILT = 0.11;
/** Clamp dt so tab freezes / first frame don't explode. */
export const DT_MIN = 0.001;
export const DT_MAX = 0.05;
export const S_EPS = 2e-4;
export const T_EPS = 5e-4;
/** Softsign denominator for trackpad pixel deltas. */
export const WHEEL_SOFTSIGN = 40;
/** Overall sensitivity on normalized pixel stream. */
export const WHEEL_K = 0.55;
/** Per-event |Δs| cap (~2.1× height). */
export const DS_EVENT_MAX = 0.75;
/** Per-frame |ΣΔs| budget. */
export const DS_FRAME_MAX = 1.1;
/**
 * Discrete mouse-line step in log-height (≈ 3·ln(1.1) at mult=1).
 * Scaled by height speed multiplier at target height.
 */
export const MOUSE_LINE_DS = 0.28;
/** Cursor must stay within this (CSS px) to chain zoom-in against target pose. */
export const CHAIN_CURSOR_PX = 10;
/** Legacy alias: old per-frame lerp factor (tests / docs). Prefer expAlpha. */
export const ZOOM_DAMPING = 0.12;
/** Legacy wheel speed weight (used by wheelZoomFactor). */
export const ZOOM_SPEED = 3;
/** Legacy linear tilt span (prefer TILT_FULL/FLAT + smoothstep). */
export const TILT_HEIGHT_RANGE = 150000;
export function clampZoomHeight(height, minZoom = MIN_ZOOM, maxZoom = MAX_ZOOM) {
    return Math.max(minZoom, Math.min(maxZoom, height));
}
export function heightToLog(height) {
    return Math.log(Math.max(1e-6, height));
}
export function logToHeight(s) {
    return Math.exp(s);
}
export function clampLogHeight(s, minZoom = MIN_ZOOM, maxZoom = MAX_ZOOM) {
    return Math.max(heightToLog(minZoom), Math.min(heightToLog(maxZoom), s));
}
/** Height-dependent speed: faster far, careful near. */
export function heightSpeedMultiplier(height) {
    return Math.min(2.5, 1 + Math.max(0, height) / 5000);
}
/**
 * Multiplicative height step for one discrete wheel tick (legacy helper).
 * Prefer {@link wheelDeltaLogS} for the live path.
 */
export function wheelZoomFactor(isZoomOut, height, zoomSpeed = ZOOM_SPEED) {
    const zoomDelta = isZoomOut ? 1.1 : 1 / 1.1;
    return Math.pow(zoomDelta, zoomSpeed * heightSpeedMultiplier(height));
}
/**
 * Convert a wheel event's deltaY + deltaMode into a log-height step.
 * Positive Δs = zoom out (higher). Uses target height for speed mult.
 */
export function wheelDeltaLogS(deltaY, deltaMode, targetHeight, viewportH = 800) {
    // Normalize to approximate pixels (DOM_DELTA_PIXEL=0, LINE=1, PAGE=2).
    let raw = deltaY;
    if (deltaMode === 1)
        raw *= 16;
    else if (deltaMode === 2)
        raw *= Math.max(1, viewportH);
    const mult = heightSpeedMultiplier(targetHeight);
    // Discrete mouse-line notches: fixed step (sign only).
    if (deltaMode === 1 || Math.abs(raw) >= 80) {
        const sign = raw > 0 ? 1 : raw < 0 ? -1 : 0;
        return (sign * MOUSE_LINE_DS * mult);
    }
    // Continuous trackpad: softsign + sensitivity.
    const soft = raw / (WHEEL_SOFTSIGN + Math.abs(raw));
    let ds = WHEEL_K * soft * mult;
    if (ds > DS_EVENT_MAX)
        ds = DS_EVENT_MAX;
    if (ds < -DS_EVENT_MAX)
        ds = -DS_EVENT_MAX;
    return ds;
}
export function smoothstep01(u) {
    const x = Math.min(1, Math.max(0, u));
    return x * x * (3 - 2 * x);
}
/**
 * Tilt factor ∈ [0, 1]: 0 = top-down (far), 1 = max tilt (near).
 * Smoothstep in log-height between {@link TILT_FLAT_HEIGHT} and {@link TILT_FULL_HEIGHT}.
 */
export function tiltFactorForHeight(height, fullH = TILT_FULL_HEIGHT, flatH = TILT_FLAT_HEIGHT) {
    const h = Math.max(1e-6, height);
    const lnFull = Math.log(fullH);
    const lnFlat = Math.log(flatH);
    // u=1 at full (near), u=0 at flat (far)
    const u = (Math.log(h) - lnFlat) / (lnFull - lnFlat);
    return smoothstep01(u);
}
export function tiltAngleRad(tiltFactor, minTilt = MIN_TILT_RAD, maxTilt = MAX_TILT_RAD) {
    const t = Math.min(1, Math.max(0, tiltFactor));
    return minTilt + t * (maxTilt - minTilt);
}
/**
 * Look-at XZ from eye + tilt. Offset along fixed −Z.
 */
export function lookAtFromEyeTilt(eyeX, eyeY, eyeZ, tiltFactor) {
    const offset = Math.tan(tiltAngleRad(tiltFactor)) * Math.max(0, eyeY);
    return { x: eyeX, z: eyeZ - offset };
}
/** Frame-rate–independent blend factor for exp approach. */
export function expAlpha(dtSec, tau) {
    const dt = Math.min(DT_MAX, Math.max(DT_MIN, dtSec));
    const t = Math.max(1e-6, tau);
    return 1 - Math.exp(-dt / t);
}
/** Exponential ease toward target (dt-independent). */
export function dampTowardExp(current, target, dtSec, tau) {
    return current + (target - current) * expAlpha(dtSec, tau);
}
/** Legacy frame-coupled ease (prefer dampTowardExp). */
export function dampToward(current, target, damping) {
    return current + (target - current) * damping;
}
export function xzSettleEps(height) {
    return Math.max(0.05, 2e-4 * Math.max(0, height));
}
export function isPoseSettled(cur, tgt) {
    const ds = Math.abs(heightToLog(cur.eyeY) - heightToLog(tgt.eyeY));
    if (ds > S_EPS)
        return false;
    if (Math.abs(cur.tilt - tgt.tilt) > T_EPS)
        return false;
    const e = xzSettleEps(cur.eyeY);
    const dx = cur.eyeX - tgt.eyeX;
    const dz = cur.eyeZ - tgt.eyeZ;
    return dx * dx + dz * dz <= e * e;
}
/**
 * Screen pivot for a wheel step: center on zoom-out, cursor on zoom-in.
 */
export function pivotScreenForWheel(isZoomOut, clientX, clientY, viewportW, viewportH) {
    if (isZoomOut) {
        return { x: viewportW * 0.5, y: viewportH * 0.5 };
    }
    return { x: clientX, y: clientY };
}
/**
 * Initial eye after scaling height about a ground pivot (XZ offset scales with h).
 */
export function eyeAfterHeightScale(eyeX, eyeY, eyeZ, groundX, groundZ, newHeight) {
    const h0 = Math.max(1e-6, eyeY);
    const h1 = clampZoomHeight(newHeight);
    const ratio = h1 / h0;
    return {
        x: groundX + (eyeX - groundX) * ratio,
        y: h1,
        z: groundZ + (eyeZ - groundZ) * ratio,
    };
}
/**
 * Iteratively correct eye XZ so `ground` stays under the screen pivot after tilt.
 * `hitAt` must return ground XZ for a candidate eye + tilt (look-at derived inside).
 */
export function refineEyeForScreenGround(screenX, screenY, groundX, groundZ, eyeX, eyeY, eyeZ, tiltFactor, hitAt, iterations = 3) {
    let x = eyeX;
    let y = eyeY;
    let z = eyeZ;
    const thr = 1e-3 * Math.max(1, y);
    const thr2 = thr * thr;
    for (let i = 0; i < iterations; i++) {
        const hit = hitAt(screenX, screenY, x, y, z, tiltFactor);
        if (!hit)
            break;
        const dx = groundX - hit.x;
        const dz = groundZ - hit.z;
        x += dx;
        z += dz;
        if (dx * dx + dz * dz < thr2)
            break;
    }
    return { x, y, z };
}
//# sourceMappingURL=camera-zoom.js.map