import { smoothstep01 } from './camera-zoom.js';
/** One selected target's acquisition path. Pull back only when the gap between
 * targets needs more room than the current view. No scene/entity state lives here. */
export function targetFlightPose(from, to, progress, fovyDeg, aspect) {
    const s = smoothstep01(Math.max(0, Math.min(1, progress)));
    if (s === 0)
        return { ...from };
    if (s === 1)
        return { ...to };
    const a = boom(from), b = boom(to);
    const separation = Math.hypot(to.targetX - from.targetX, to.targetY - from.targetY, to.targetZ - from.targetZ);
    const halfFov = Math.atan(Math.tan(fovyDeg * Math.PI / 360) * Math.min(1, Math.max(.1, aspect)));
    const overview = separation * .65 / Math.max(.05, Math.sin(halfFov));
    const baseline = Math.exp(Math.log(a.radius) * (1 - s) + Math.log(b.radius) * s);
    const lift = Math.max(0, overview - Math.sqrt(a.radius * b.radius));
    const radius = baseline + 4 * s * (1 - s) * lift;
    const yawDelta = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
    const yaw = a.yaw + yawDelta * s, pitch = a.pitch + (b.pitch - a.pitch) * s;
    const targetX = from.targetX + (to.targetX - from.targetX) * s;
    const targetY = from.targetY + (to.targetY - from.targetY) * s;
    const targetZ = from.targetZ + (to.targetZ - from.targetZ) * s;
    return { targetX, targetY, targetZ,
        eyeX: targetX + radius * Math.cos(pitch) * Math.sin(yaw),
        eyeY: targetY + radius * Math.sin(pitch),
        eyeZ: targetZ + radius * Math.cos(pitch) * Math.cos(yaw) };
}
export function targetFlightDuration(from, to, minimumMs) {
    const gap = Math.hypot(to.targetX - from.targetX, to.targetY - from.targetY, to.targetZ - from.targetZ);
    return Math.min(1400, minimumMs + 180 * Math.log1p(gap / boom(to).radius));
}
function boom(pose) {
    const x = pose.eyeX - pose.targetX, y = pose.eyeY - pose.targetY, z = pose.eyeZ - pose.targetZ;
    return { radius: Math.max(1e-9, Math.hypot(x, y, z)), yaw: Math.atan2(x, z), pitch: Math.atan2(y, Math.hypot(x, z)) };
}
//# sourceMappingURL=camera-target-flight.js.map