/**
 * Pure solar-system body definitions and orbital kinematics for the showcase.
 *
 * Bodies are oversized vs reality so they remain interactive at game scale.
 * No GPU types — unit-testable from Node after build.
 */
/** Showcase stress: exactly this many non-sun bodies. */
export const SHOWCASE_PLANET_COUNT = 30;
const SUN_DEF = {
    id: "sol",
    name: "Sol",
    kind: "sun",
    radius: 2.8,
    // Corona shell (keep modest — pixel cost ∝ margin²; soft fade ends inside).
    // Paired with SUN_LOOK outerFadeEnd so the fade finishes before the quad edge.
    drawMargin: 2.25,
    orbitRadius: 0,
    orbitPeriodSec: 1,
    orbitPhase0: 0,
    spinRadPerSec: 0.08,
    obliquity: 0.12,
    albedo: [1.0, 1.0, 1.0],
    // Warm yellow/gold corona tint (rays take solarTemp palette)
    glow: [1.0, 0.72, 0.28],
    glowStrength: 1.0,
};
/** Kind templates cycled for the 30-planet stress set. */
const PLANET_TEMPLATES = Object.freeze([
    {
        kind: "rocky",
        namePrefix: "Cinder",
        radius: 0.42,
        drawMargin: 1.35,
        albedo: [0.55, 0.42, 0.32],
        glow: [0.9, 0.55, 0.25],
        glowStrength: 0.55,
        spinRadPerSec: 0.85,
        obliquity: 0.05,
    },
    {
        kind: "ocean",
        namePrefix: "Azure",
        radius: 0.85,
        drawMargin: 1.48,
        albedo: [0.18, 0.42, 0.72],
        glow: [0.4, 0.7, 1.0],
        glowStrength: 1.35,
        spinRadPerSec: 0.55,
        obliquity: 0.41,
    },
    {
        kind: "gas",
        namePrefix: "Amber",
        radius: 1.15,
        drawMargin: 1.4,
        albedo: [0.82, 0.62, 0.38],
        glow: [1.0, 0.75, 0.4],
        glowStrength: 0.85,
        spinRadPerSec: 1.2,
        obliquity: 0.08,
    },
    {
        kind: "ice",
        namePrefix: "Glacier",
        radius: 0.58,
        drawMargin: 1.4,
        albedo: [0.72, 0.88, 0.95],
        glow: [0.55, 0.85, 1.0],
        glowStrength: 1.0,
        spinRadPerSec: 0.35,
        obliquity: 0.55,
    },
]);
/**
 * Named showcase planets (stable ids for paste/URL: cinder, azure, amber, glacier).
 * Azure keeps the classic multi-map Earth slot and user-tuned atm preset.
 */
const NAMED_PLANETS = Object.freeze([
    {
        id: "cinder",
        name: "Cinder",
        kind: "rocky",
        radius: 0.42,
        drawMargin: 1.35,
        orbitRadius: 7.5,
        orbitPeriodSec: 14,
        orbitPhase0: 0.4,
        spinRadPerSec: 0.85,
        obliquity: 0.05,
        albedo: [0.55, 0.42, 0.32],
        glow: [0.9, 0.55, 0.25],
        glowStrength: 0.55,
    },
    {
        id: "azure",
        name: "Azure",
        kind: "ocean",
        radius: 0.85,
        drawMargin: 1.48,
        orbitRadius: 13.5,
        orbitPeriodSec: 28,
        orbitPhase0: 1.8,
        spinRadPerSec: 0.55,
        obliquity: 0.41,
        albedo: [0.18, 0.42, 0.72],
        glow: [0.4, 0.7, 1.0],
        glowStrength: 1.35,
    },
    {
        id: "amber",
        name: "Amber",
        kind: "gas",
        radius: 1.35,
        drawMargin: 1.4,
        orbitRadius: 22.5,
        orbitPeriodSec: 52,
        orbitPhase0: 3.5,
        spinRadPerSec: 1.2,
        obliquity: 0.08,
        albedo: [0.82, 0.62, 0.38],
        glow: [1.0, 0.75, 0.4],
        glowStrength: 0.85,
    },
    {
        id: "glacier",
        name: "Glacier",
        kind: "ice",
        radius: 0.58,
        drawMargin: 1.4,
        orbitRadius: 32,
        orbitPeriodSec: 78,
        orbitPhase0: 5.1,
        spinRadPerSec: 0.35,
        obliquity: 0.55,
        albedo: [0.72, 0.88, 0.95],
        glow: [0.55, 0.85, 1.0],
        glowStrength: 1.0,
    },
]);
/**
 * Build showcase list: 1 sun + `planetCount` planets.
 * First four keep stable ids (cinder/azure/amber/glacier) so paste configs still apply.
 * Remaining slots fill outward for perf stress.
 */
export function buildShowcaseBodies(planetCount = SHOWCASE_PLANET_COUNT) {
    const n = Math.max(0, Math.floor(planetCount));
    const out = [
        {
            ...SUN_DEF,
            albedo: [...SUN_DEF.albedo],
            glow: [...SUN_DEF.glow],
        },
    ];
    const namedN = Math.min(n, NAMED_PLANETS.length);
    for (let i = 0; i < namedN; i++) {
        const d = NAMED_PLANETS[i];
        out.push({
            ...d,
            albedo: [...d.albedo],
            glow: [...d.glow],
        });
    }
    // Extra stress planets beyond the four named ones
    for (let i = namedN; i < n; i++) {
        const t = PLANET_TEMPLATES[i % PLANET_TEMPLATES.length];
        const orbitRadius = 36 + (i - namedN) * 1.7 + (i % 3) * 0.12;
        const orbitPeriodSec = 80 + (i - namedN) * 3.4 + (i % 5) * 0.7;
        const orbitPhase0 = (i * 2.399) % (Math.PI * 2);
        const rScale = 0.88 + (i % 7) * 0.04;
        out.push({
            id: `p${i + 1}`,
            name: `${t.namePrefix}-${i + 1}`,
            kind: t.kind,
            radius: t.radius * rScale,
            drawMargin: t.drawMargin,
            orbitRadius,
            orbitPeriodSec,
            orbitPhase0,
            spinRadPerSec: t.spinRadPerSec * (0.85 + (i % 5) * 0.05),
            obliquity: t.obliquity + (i % 4) * 0.03,
            albedo: [...t.albedo],
            glow: [...t.glow],
            glowStrength: t.glowStrength,
        });
    }
    return out;
}
/** Showcase system: 1 sun + 30 planets (perf stress). */
export const SHOWCASE_BODIES = Object.freeze(buildShowcaseBodies(SHOWCASE_PLANET_COUNT));
/**
 * Kepler-style circular orbit in the XZ plane (y = 0 game plane).
 * Phase advances with time / period.
 */
export function orbitWorldPosition(orbitRadius, orbitPeriodSec, orbitPhase0, timeSec, out = { x: 0, y: 0, z: 0 }) {
    if (orbitRadius <= 0 || !Number.isFinite(orbitRadius)) {
        out.x = 0;
        out.y = 0;
        out.z = 0;
        return out;
    }
    const period = Math.max(1e-6, orbitPeriodSec);
    const phase = orbitPhase0 + (timeSec / period) * Math.PI * 2;
    out.x = Math.cos(phase) * orbitRadius;
    out.y = 0;
    out.z = Math.sin(phase) * orbitRadius;
    return out;
}
/** Axial spin angle at time (radians). */
export function spinAngle(spinRadPerSec, timeSec) {
    return spinRadPerSec * timeSec;
}
/** Clamp selection index into [0, count). */
export function clampSelection(index, count) {
    if (count <= 0)
        return 0;
    if (!Number.isFinite(index))
        return 0;
    const i = Math.floor(index);
    if (i < 0)
        return 0;
    if (i >= count)
        return count - 1;
    return i;
}
export const ZOOM_MIN_FACTOR = 1.6;
export const ZOOM_MAX_FACTOR = 48;
/**
 * Zoom radius bounds relative to body visual radius
 * (camera distance from focus center).
 */
export function zoomBoundsForBody(bodyRadius) {
    const r = Math.max(0.05, bodyRadius);
    return {
        min: r * ZOOM_MIN_FACTOR,
        max: r * ZOOM_MAX_FACTOR,
    };
}
export function clampZoom(radius, min, max) {
    if (!Number.isFinite(radius))
        return min;
    if (radius < min)
        return min;
    if (radius > max)
        return max;
    return radius;
}
/**
 * Ray–sphere intersection (t ≥ 0 nearest). Returns t or null.
 * Ray: origin + t * dir (dir need not be unit; t is along dir).
 */
export function raySphereIntersect(ox, oy, oz, dx, dy, dz, cx, cy, cz, radius) {
    const lx = ox - cx;
    const ly = oy - cy;
    const lz = oz - cz;
    const a = dx * dx + dy * dy + dz * dz;
    if (a < 1e-20)
        return null;
    const b = 2 * (lx * dx + ly * dy + lz * dz);
    const c = lx * lx + ly * ly + lz * lz - radius * radius;
    const disc = b * b - 4 * a * c;
    if (disc < 0)
        return null;
    const s = Math.sqrt(disc);
    const t0 = (-b - s) / (2 * a);
    const t1 = (-b + s) / (2 * a);
    if (t0 >= 0)
        return t0;
    if (t1 >= 0)
        return t1;
    return null;
}
/** Evaluate all body world poses at time. */
export function evaluateBodyPoses(bodies, timeSec, out = []) {
    out.length = bodies.length;
    for (let i = 0; i < bodies.length; i++) {
        const def = bodies[i];
        const pos = orbitWorldPosition(def.orbitRadius, def.orbitPeriodSec, def.orbitPhase0, timeSec);
        const prev = out[i];
        if (prev) {
            prev.def = def;
            prev.x = pos.x;
            prev.y = pos.y;
            prev.z = pos.z;
            prev.spin = spinAngle(def.spinRadPerSec, timeSec);
        }
        else {
            out[i] = {
                def,
                x: pos.x,
                y: pos.y,
                z: pos.z,
                spin: spinAngle(def.spinRadPerSec, timeSec),
            };
        }
    }
    return out;
}
/**
 * Pick nearest body hit by a world ray (eye → direction).
 * Uses visual radius (not draw margin) so picks feel tight on the disc.
 */
export function pickBodyIndex(ox, oy, oz, dx, dy, dz, poses) {
    let bestT = Infinity;
    let bestI = null;
    for (let i = 0; i < poses.length; i++) {
        const p = poses[i];
        const t = raySphereIntersect(ox, oy, oz, dx, dy, dz, p.x, p.y, p.z, p.def.radius);
        if (t != null && t < bestT) {
            bestT = t;
            bestI = i;
        }
    }
    return bestI;
}
/** Kind → integer for shader packing (must match WGSL). */
export function bodyKindId(kind) {
    switch (kind) {
        case "sun":
            return 0;
        case "rocky":
            return 1;
        case "ocean":
            return 2;
        case "gas":
            return 3;
        case "ice":
            return 4;
        default:
            return 1;
    }
}
//# sourceMappingURL=solar-bodies.js.map