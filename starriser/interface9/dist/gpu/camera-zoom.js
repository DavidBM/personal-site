/**
 * Map-camera zoom / tilt policy (pure, no GPU / DOM).
 *
 * - Zoom space: log height s = ln(h) so equal effort ≈ equal screen-scale change.
 * - Wheel extends targets; controller damps with frame-time–independent exp ease.
 * - Far: pure top-down (tilt 0). Near: up to 42° pitch along fixed −Z.
 * - Zoom-in: cursor pivot; zoom-out: screen-center pivot.
 */
/**
 * Closest map height. Deep enough for close model inspection / roof-cam chase
 * (~ship-scale framing at model LOD with DEFAULT_SCALE 0.25).
 */
export const MIN_ZOOM = 4;
export const MAX_ZOOM = 1000000;
/** CTRL free-look returns to rest over this many ms. */
export const CTRL_LOOK_RETURN_MS = 200;
/** Enter/exit ship-follow ease duration (ms). */
export const FOLLOW_TRANSITION_MS = 500;
/**
 * Follow chase: slightly behind and below the nose line so the engine bay
 * reads in frame (not pure roof-cam). Still << old third-person boom (~10).
 * Ships are ~0.8…5 world units (BASE×type scale).
 */
/** Chase distance behind ship (world units). */
export const FOLLOW_BACK_DIST = 1.55;
/** Chase height above ship (slightly above engines, not pure roof). */
export const FOLLOW_HEIGHT = 0.34;
/** Look-at point ahead of ship along forward. */
export const FOLLOW_LOOK_AHEAD = 6;
/**
 * Look-at Y relative to ship (not eye). Negative = aim below hull so the
 * boom reads slightly downward (engines / deck in frame).
 */
export const FOLLOW_LOOK_Y = -0.12;
/**
 * Roof-cam chase: eye just above/behind the ship, look-at well ahead along travel.
 * heading 0 = +Z; forward = (sin h, 0, cos h).
 * lookYaw/lookPitch = CTRL free-look offsets (rad); 0 = pure chase.
 */
export function chaseCameraFromShip(posX, posY, posZ, heading, opts) {
    const back = opts?.back ?? FOLLOW_BACK_DIST;
    const height = opts?.height ?? FOLLOW_HEIGHT;
    const lookAhead = opts?.lookAhead ?? FOLLOW_LOOK_AHEAD;
    const lookY = opts?.lookY ?? FOLLOW_LOOK_Y;
    const lookYaw = opts?.lookYaw ?? 0;
    const lookPitch = opts?.lookPitch ?? 0;
    const yaw = heading + lookYaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    // Pitch: lift/drop look target relative to eye (clamped).
    const pitch = Math.max(-0.85, Math.min(0.85, lookPitch));
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    // Eye sits back along −forward and up; pitch tilts the chase boom.
    const eyeX = posX - fx * back * cosP;
    const eyeY = posY + height + back * sinP;
    const eyeZ = posZ - fz * back * cosP;
    const targetX = posX + fx * lookAhead;
    const targetY = posY + lookY;
    const targetZ = posZ + fz * lookAhead;
    return { eyeX, eyeY, eyeZ, targetX, targetY, targetZ };
}
/**
 * Orbit eye around a fixed look-at pivot (sphere). Used for map CTRL free-look.
 * dYaw rotates about world +Y; dPitch elevates (clamped so eye stays above ground).
 * Keeps look-at fixed — no “slide” from re-deriving look along −Z.
 */
export function orbitEyeAroundLookAt(eyeX, eyeY, eyeZ, targetX, targetY, targetZ, dYaw, dPitch, opts) {
    const minEyeY = opts?.minEyeY ?? MIN_ZOOM;
    const minRadius = opts?.minRadius ?? 2;
    const maxPitch = opts?.maxPitch ?? 1.35;
    let dx = eyeX - targetX;
    let dy = eyeY - targetY;
    let dz = eyeZ - targetZ;
    let r = Math.hypot(dx, dy, dz);
    if (!(r > minRadius)) {
        // Nearly top-down / on pivot: invent a back boom so orbit has leverage.
        r = Math.max(minRadius, Math.max(eyeY - targetY, minEyeY));
        dx = 0;
        dy = r * 0.85;
        dz = r * 0.5;
    }
    let yaw = Math.atan2(dx, dz);
    let pitch = Math.asin(Math.max(-1, Math.min(1, dy / r)));
    yaw += dYaw;
    pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch + dPitch));
    // Keep a little elevation so the map does not flip under the plane.
    const minPitch = Math.asin(Math.max(-1, Math.min(1, (minEyeY - targetY) / r)));
    if (pitch < minPitch)
        pitch = minPitch;
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    const nx = targetX + r * Math.sin(yaw) * cosP;
    const ny = targetY + r * sinP;
    const nz = targetZ + r * Math.cos(yaw) * cosP;
    return {
        eyeX: nx,
        eyeY: Math.max(minEyeY, ny),
        eyeZ: nz,
    };
}
/**
 * Ease CTRL look offset → 0 over returnMs. Returns remaining fraction of offset
 * (1 = full offset, 0 = rest). Linear for predictable 200ms product feel.
 */
export function ctrlLookReturnFactor(elapsedMsSinceRelease, returnMs = CTRL_LOOK_RETURN_MS) {
    if (returnMs <= 0)
        return 0;
    if (elapsedMsSinceRelease <= 0)
        return 1;
    if (elapsedMsSinceRelease >= returnMs)
        return 0;
    return 1 - elapsedMsSinceRelease / returnMs;
}
/**
 * Lerp eye pose from → to with t in [0,1] (t=1 → fully at `to`).
 * Pure helper for map CTRL free-look restore.
 */
export function lerpEyePose(from, to, t) {
    const u = Math.max(0, Math.min(1, t));
    return {
        eyeX: from.eyeX + (to.eyeX - from.eyeX) * u,
        eyeY: from.eyeY + (to.eyeY - from.eyeY) * u,
        eyeZ: from.eyeZ + (to.eyeZ - from.eyeZ) * u,
        tilt: from.tilt + (to.tilt - from.tilt) * u,
    };
}
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