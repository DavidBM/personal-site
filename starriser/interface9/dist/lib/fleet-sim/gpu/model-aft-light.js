/**
 * Aft thruster hard light for model-LOD ships — pure helpers.
 * Light sits behind the ship (body −Z when +Z is forward) and gently
 * pulses with thruster/trail activity (time-based; couples to trail glow).
 */
/** Pulse amplitude (± around 1). Keep subtle so hulls don't strobe. */
export const THRUSTER_PULSE_AMPLITUDE = 0.14;
/** Angular frequency (rad/s) — light "breathes" with engine trails. */
export const THRUSTER_PULSE_OMEGA = 7.2;
/** Base hard-light strength (multiplies N·Laft^k). */
export const THRUSTER_AFT_LIGHT_STRENGTH = 1.35;
/** Hot thruster tint for the aft key. */
export const THRUSTER_AFT_LIGHT_COLOR = {
    r: 0.55,
    g: 0.75,
    b: 1.0,
};
/**
 * Light direction **from surface toward the light** = body aft (−Z after quat).
 * Body +Z is forward; thrusters face −Z, so the lamp is on −Z.
 */
export function aftLightDirFromQuat(qx, qy, qz, qw) {
    // quatRotate (0,0,-1)
    const x = qx;
    const y = qy;
    const z = qz;
    const w = qw;
    const vx = 0;
    const vy = 0;
    const vz = -1;
    // t = 2 * cross(q.xyz, v)
    const tx = 2 * (y * vz - z * vy);
    const ty = 2 * (z * vx - x * vz);
    const tz = 2 * (x * vy - y * vx);
    // v + w*t + cross(q.xyz, t)
    const cx = y * tz - z * ty;
    const cy = z * tx - x * tz;
    const cz = x * ty - y * tx;
    let ox = vx + w * tx + cx;
    let oy = vy + w * ty + cy;
    let oz = vz + w * tz + cz;
    const len = Math.hypot(ox, oy, oz);
    if (len < 1e-8)
        return { x: 0, y: 0, z: -1 };
    ox /= len;
    oy /= len;
    oz /= len;
    return { x: ox, y: oy, z: oz };
}
/**
 * Gentle thruster pulse in ~[1−A, 1+A].
 * @param timeSec frame time (seconds)
 * @param trailActivity 0…1 extra emphasis when trails are hot (default 1)
 */
export function thrusterPulse(timeSec, trailActivity = 1) {
    const act = Number.isFinite(trailActivity) ? Math.max(0, Math.min(1.5, trailActivity)) : 1;
    const t = Number.isFinite(timeSec) ? timeSec : 0;
    const wave = Math.sin(t * THRUSTER_PULSE_OMEGA);
    return 1 + THRUSTER_PULSE_AMPLITUDE * wave * act;
}
/**
 * Hard aft contribution (unclamped channel boost).
 * @param nDotLaft max(dot(N, Laft), 0)
 */
export function aftHardLightFactor(nDotLaft, pulse) {
    const d = Math.max(0, nDotLaft);
    // Hard-ish falloff — still continuous (no step binary)
    const hard = Math.pow(d, 1.35);
    return hard * THRUSTER_AFT_LIGHT_STRENGTH * Math.max(0.5, pulse);
}
//# sourceMappingURL=model-aft-light.js.map