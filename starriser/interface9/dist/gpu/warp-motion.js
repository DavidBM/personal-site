function localTime(warp, nowMs) {
    return Math.fround((warp.displayMs ?? nowMs - warp.lag * 1000) / 1000 - warp.epoch);
}
/** Mirror the presentation shader's f32 operations, including its clock epoch. */
export function warpPosition(warp, nowMs) {
    const elapsed = Math.fround(Math.max(warp.start, Math.min(warp.end, localTime(warp, nowMs))) - (warp.anchor ?? warp.start));
    const axis = (origin, velocity) => Math.fround(Math.fround(origin + Math.fround(velocity * elapsed)) * warp.scale);
    return { x: axis(warp.x, warp.vx), y: axis(warp.y, warp.vy), z: axis(warp.z, warp.vz) };
}
/** Keep a delayed sample in the same f32 epoch as the next GPU presentation. */
export function rebaseWarpMotion(warp, epoch) {
    if (epoch === warp.epoch)
        return;
    const shift = epoch - warp.epoch;
    if (warp.anchor != null)
        warp.anchor = Math.fround(warp.anchor - shift);
    warp.start = Math.fround(warp.start - shift);
    warp.end = Math.fround(warp.end - shift);
    warp.epoch = epoch;
}
export function warpViewSample(pose, nowMs, hullRadius) {
    const warp = pose?.warp;
    if (!warp)
        return null;
    const time = localTime(warp, nowMs), duration = warp.end - warp.start;
    if (time < warp.start || time >= warp.end || duration <= 0)
        return null;
    const entry = Math.min(.18, duration * .2), exit = Math.min(.3, duration * .25);
    const smooth = (value) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
    const strength = smooth((time - warp.start) / entry) * smooth((warp.end - time) / exit);
    return { ...warpPosition(warp, nowMs), hullRadius, strength };
}
//# sourceMappingURL=warp-motion.js.map