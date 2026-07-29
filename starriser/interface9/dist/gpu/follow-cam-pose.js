/**
 * Same-frame follow-cam pose + solid-hull boom policy (pure).
 *
 * Live follow must not depend on multi-frame GPU MAP_READ for the camera.
 * The host steps one ShipSim agent (matching GPU integrate inputs) and uses
 * that pose for chase eye/look-at and floating origin — then uploads it so
 * model draw sees the same pose.
 *
 * Enter/exit follow eases over {@link FOLLOW_TRANSITION_MS} (smoothstep).
 */
import { chaseCameraFromShip, clampZoomHeight, FOLLOW_BACK_DIST, FOLLOW_HEIGHT, lookAtFromEyeTilt, smoothstep01, tiltFactorForHeight, } from "./camera-zoom.js";
import { integrateShipAgent, } from "../lib/fleet-sim/visual/ship-flight-ref.js";
import { MODEL_LOD_DEFAULT_SCALE } from "../lib/fleet-sim/visual/fleet-lod.js";
/** Enter/exit follow ease duration (ms). */
export const FOLLOW_TRANSITION_MS = 500;
/** Pointer → orbit yaw sens (rad per CSS px). Matches map CTRL free-look. */
export const FOLLOW_DRAG_YAW_SENS = 0.005;
/** Pointer → orbit pitch sens (rad per CSS px). */
export const FOLLOW_DRAG_PITCH_SENS = 0.004;
/** Pitch clamp while follow-dragging (rad). */
export const FOLLOW_DRAG_MAX_PITCH = 0.85;
/**
 * Apply primary-button follow drag to chase look offsets (pure).
 * Same math as {@link WebGpuCameraController.onMouseMove} follow branch.
 */
export function applyFollowDragLook(lookYaw, lookPitch, mdx, mdy, opts) {
    const yawSens = opts?.yawSens ?? FOLLOW_DRAG_YAW_SENS;
    const pitchSens = opts?.pitchSens ?? FOLLOW_DRAG_PITCH_SENS;
    const maxPitch = opts?.maxPitch ?? FOLLOW_DRAG_MAX_PITCH;
    let yaw = lookYaw - mdx * yawSens;
    let pitch = lookPitch - mdy * pitchSens;
    pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));
    return { lookYaw: yaw, lookPitch: pitch };
}
/**
 * @deprecated Trails use one production width always (no follow-only thick path).
 * Kept at 1 for import stability; do not reintroduce a dual size.
 */
export const FOLLOW_TRAIL_WIDTH_SCALE = 1;
/**
 * Ease factor t∈[0,1] for follow enter/exit (smoothstep). Pure.
 */
export function followTransitionT(elapsedMs, durationMs = FOLLOW_TRANSITION_MS) {
    if (!(durationMs > 0))
        return 1;
    if (elapsedMs <= 0)
        return 0;
    if (elapsedMs >= durationMs)
        return 1;
    return smoothstep01(elapsedMs / durationMs);
}
/**
 * Lerp eye + look-at between two camera endpoints (t∈[0,1]). Pure.
 */
export function lerpFollowCamEndpoints(from, to, t) {
    const u = Math.max(0, Math.min(1, t));
    return {
        eyeX: from.eyeX + (to.eyeX - from.eyeX) * u,
        eyeY: from.eyeY + (to.eyeY - from.eyeY) * u,
        eyeZ: from.eyeZ + (to.eyeZ - from.eyeZ) * u,
        targetX: from.targetX + (to.targetX - from.targetX) * u,
        targetY: from.targetY + (to.targetY - from.targetY) * u,
        targetZ: from.targetZ + (to.targetZ - from.targetZ) * u,
    };
}
/**
 * Valid map rest pose after stop-follow: clamp height, re-derive tilt look-at.
 * Prevents twisted chase boom / sub-MIN_ZOOM eye from becoming the map camera.
 */
export function mapRestPoseFromFollowExit(eyeX, eyeY, eyeZ, targetX, targetZ, preferredHeight) {
    // Prefer saved map height when available; else lift chase eye to a sane map height.
    const hRaw = preferredHeight != null && preferredHeight > 0
        ? preferredHeight
        : Math.max(eyeY, 800);
    const h = clampZoomHeight(hRaw);
    const tilt = tiltFactorForHeight(h);
    // Rest eye over the follow look-at XZ; tilt re-derives map look-at (−Z).
    const restEyeX = Number.isFinite(targetX) ? targetX : eyeX;
    const restEyeZ = Number.isFinite(targetZ) ? targetZ : eyeZ;
    const look = lookAtFromEyeTilt(restEyeX, h, restEyeZ, tilt);
    return {
        eyeX: restEyeX,
        eyeY: h,
        eyeZ: restEyeZ,
        tilt,
        targetX: look.x,
        targetZ: look.z,
    };
}
/**
 * Conservative mesh half-extent after {@link MODEL_LOD_DEFAULT_SCALE}.
 * Low-poly ≈ length 2×0.25; production GLB half-diag ≈ 0.3. Use a margin so
 * the roof-cam boom stays outside the hull (avoids interior/back-face view).
 */
export const FOLLOW_MESH_HALF_EXTENT = 0.55 * (MODEL_LOD_DEFAULT_SCALE / 0.25);
/**
 * True when chase eye (back, height) clears a sphere of radius `meshHalf`
 * around the ship origin (simple hull proxy).
 */
export function isChaseBoomOutsideMesh(back = FOLLOW_BACK_DIST, height = FOLLOW_HEIGHT, meshHalf = FOLLOW_MESH_HALF_EXTENT) {
    const eyeDist = Math.hypot(back, height);
    return eyeDist > meshHalf + 1e-6;
}
/**
 * Chase camera from a ship pose — pure; same helper the controller uses.
 * Exposed for lockstep tests (pose → eye is a pure function).
 */
export function chaseFromFollowPose(posX, posY, posZ, heading, opts) {
    return chaseCameraFromShip(posX, posY, posZ, heading, opts);
}
/**
 * Advance one ship agent by dtMs with the same center/pathEnd contract as GPU
 * cs_ships (C = pathEnd, V_C = 0). Mutates and returns `ship`.
 */
export function stepFollowShipAgent(ship, path, dtMs, nowRel) {
    const pathEndY = path.pathEndY ?? 0;
    return integrateShipAgent(ship, {
        centerX: path.pathEndX,
        centerZ: path.pathEndZ,
        centerY: pathEndY,
        pathStartX: path.pathStartX,
        pathStartZ: path.pathStartZ,
        pathEndX: path.pathEndX,
        pathEndZ: path.pathEndZ,
        pathEndY,
        formationHeading: path.formationHeading,
        dtMs,
        nowRel,
        t0: path.t0,
        durationMs: path.durationMs,
        domainWarpActive: path.domainWarpActive,
        space3d: path.space3d === true,
    });
}
/**
 * Compact pose extracted for camera / origin (after a shadow step).
 */
export function followPoseFromAgent(ship, shipIndex) {
    return {
        shipIndex: shipIndex | 0,
        posX: ship.posX,
        posY: ship.posY ?? 0,
        posZ: ship.posZ,
        heading: ship.heading,
        speed: ship.speed,
    };
}
//# sourceMappingURL=follow-cam-pose.js.map