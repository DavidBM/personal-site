/**
 * Pure solar-system body definitions and orbital kinematics for the showcase.
 *
 * Bodies are oversized vs reality so they remain interactive at game scale.
 * Planets come from the climate-by-orbit catalog (`planet-catalog.ts`).
 * No GPU types — unit-testable from Node after build.
 */
import { CATALOG_PLANET_COUNT, PLANET_CATALOG, catalogEntryToBody, seedForCatalogId, } from "./planet-catalog.js";
/** Showcase: exactly this many non-sun bodies (catalog length). */
export const SHOWCASE_PLANET_COUNT = CATALOG_PLANET_COUNT;
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
function cloneSunDef() {
    return {
        ...SUN_DEF,
        albedo: [SUN_DEF.albedo[0], SUN_DEF.albedo[1], SUN_DEF.albedo[2]],
        glow: [SUN_DEF.glow[0], SUN_DEF.glow[1], SUN_DEF.glow[2]],
    };
}
/** Outer-ice clone used only if planetCount exceeds the catalog. */
function padIceClone(i, last) {
    const extra = i - PLANET_CATALOG.length + 1;
    return {
        ...last,
        id: `p${i + 1}`,
        name: `Ice-${i + 1}`,
        seed: seedForCatalogId(`p${i + 1}`),
        orbitT: 1,
        zone: "outer-ice",
        orbitRadius: last.orbitRadius + extra * 2.4,
        orbitPeriodSec: last.orbitPeriodSec + extra * 6,
        orbitPhase0: (i * 2.399) % (Math.PI * 2),
        albedo: [last.albedo[0], last.albedo[1], last.albedo[2]],
        glow: [last.glow[0], last.glow[1], last.glow[2]],
    };
}
/**
 * Build showcase list: 1 sun + `planetCount` catalog planets (closest first).
 * Stable ids cinder / azure / amber / glacier stay in the catalog.
 */
export function buildShowcaseBodies(planetCount = SHOWCASE_PLANET_COUNT) {
    const n = Math.max(0, Math.floor(planetCount));
    const out = [cloneSunDef()];
    const take = Math.min(n, PLANET_CATALOG.length);
    for (let i = 0; i < take; i++) {
        out.push(catalogEntryToBody(PLANET_CATALOG[i]));
    }
    const last = PLANET_CATALOG[PLANET_CATALOG.length - 1];
    for (let i = take; i < n; i++) {
        if (!last)
            break;
        out.push(catalogEntryToBody(padIceClone(i, last)));
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