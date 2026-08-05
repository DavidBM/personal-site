/**
 * Solo-mode multi-instance swarm: N random discs of the same method,
 * each with independent spin. Pure generation for smoke; GPU packs in main.
 */
export const SWARM_COUNT = 500;
/** Default world half-extent for random placement (cube). */
export const SWARM_SPREAD = 28;
/** Mulberry32 — deterministic when seed provided. */
export function createRng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/**
 * Spawn `count` randomly distributed instances with unique spin directions.
 * Smoke drives this shipped function (not a reimplementation).
 */
export function createSwarmInstances(count = SWARM_COUNT, spread = SWARM_SPREAD, seed = 0x5e4a71d) {
    return createSwarmInstancesSeeded(count, spread, seed);
}
export function createSwarmInstancesSeeded(count, spread, seed) {
    const rnd = createRng(seed);
    const out = [];
    for (let i = 0; i < count; i++) {
        // Uniform in cube, then avoid clustering at exact origin
        let x = (rnd() * 2 - 1) * spread;
        let y = (rnd() * 2 - 1) * spread * 0.55;
        let z = (rnd() * 2 - 1) * spread;
        // Mild radial bias outward so density reads as a cloud
        const r0 = Math.hypot(x, y, z) || 1;
        const push = 0.35 + 0.65 * rnd();
        x = (x / r0) * r0 * push;
        y = (y / r0) * r0 * push;
        z = (z / r0) * r0 * push;
        // Different spin direction & speed per instance
        const yawRate = (rnd() * 2 - 1) * 1.35;
        const pitchRate = (rnd() * 2 - 1) * 0.95;
        out.push({
            x,
            y,
            z,
            yaw: rnd() * Math.PI * 2,
            pitch: (rnd() * 2 - 1) * 0.9,
            yawRate,
            pitchRate,
            radius: 0.35 + rnd() * 0.55,
        });
    }
    return out;
}
/** Advance spin angles by dt seconds (shipped integration). */
export function stepSwarmInstances(instances, dt) {
    const t = Math.min(0.05, Math.max(0, dt));
    for (let i = 0; i < instances.length; i++) {
        const s = instances[i];
        s.yaw += s.yawRate * t;
        s.pitch += s.pitchRate * t;
        // Soft pitch clamp so body doesn't tumble into poles forever
        if (s.pitch > 1.4) {
            s.pitch = 1.4;
            s.pitchRate = -Math.abs(s.pitchRate);
        }
        else if (s.pitch < -1.4) {
            s.pitch = -1.4;
            s.pitchRate = Math.abs(s.pitchRate);
        }
    }
}
/** Mean |angular rate| — smoke checks non-zero diverse spins. */
export function swarmMeanAbsSpin(instances) {
    if (instances.length === 0)
        return 0;
    let s = 0;
    for (const i of instances) {
        s += Math.abs(i.yawRate) + Math.abs(i.pitchRate);
    }
    return s / instances.length;
}
/** Spatial span (max axis extent) of positions. */
export function swarmPositionSpan(instances) {
    if (instances.length === 0)
        return 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const i of instances) {
        if (i.x < minX)
            minX = i.x;
        if (i.x > maxX)
            maxX = i.x;
        if (i.y < minY)
            minY = i.y;
        if (i.y > maxY)
            maxY = i.y;
        if (i.z < minZ)
            minZ = i.z;
        if (i.z > maxZ)
            maxZ = i.z;
    }
    return Math.max(maxX - minX, maxY - minY, maxZ - minZ);
}
//# sourceMappingURL=swarm.js.map