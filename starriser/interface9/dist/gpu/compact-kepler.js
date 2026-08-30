/**
 * Compact Kepler set for one Band B SCENE.
 *
 * Sun + ≤8 seed-selected catalog bodies. After pick, showcase orbits are
 * reassigned to even slots (inner 8 … outer 52) so discs do not collide;
 * pose compose applies {@link KEPLER_SCALE}. Sun visual radius is 0.005
 * (~5% of span 0.1). Do not plant SHOWCASE_BODIES at SolarSystem.position.
 */
import { catalogById, catalogEntryToBody, PLANET_CATALOG, seedForCatalogId, } from "./planet-lib/planet-catalog.js";
import { KEPLER_SCALE } from "./solar-system-lod.js";
/** Hard cap on non-sun bodies in one SCENE. */
export const MAX_COMPACT_PLANETS = 8;
/** Even compact showcase orbit floor (k=0.1/56 → world 0.014). */
export const COMPACT_SHOWCASE_ORBIT_INNER = 8;
/** Even compact showcase orbit ceiling (k=0.1/56 → world 0.093). */
export const COMPACT_SHOWCASE_ORBIT_OUTER = 52;
/**
 * Compact sun visual radius (world). 5% of SYSTEM_LOCAL_SPAN (0.1).
 * Pin the product number so Schmitt enter still matches a 5px sun.
 */
export const COMPACT_SUN_VISUAL_RADIUS = 0.005;
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function cloneSunCompact() {
    return {
        id: "sol",
        name: "Sol",
        kind: "sun",
        radius: COMPACT_SUN_VISUAL_RADIUS,
        drawMargin: 2.25,
        orbitRadius: 0,
        orbitPeriodSec: 1,
        orbitPhase0: 0,
        spinRadPerSec: 0.08,
        obliquity: 0.12,
        albedo: [1, 1, 1],
        glow: [1, 0.72, 0.28],
        glowStrength: 1,
    };
}
function scalePlanet(def) {
    return {
        ...def,
        radius: def.radius * KEPLER_SCALE,
        albedo: [def.albedo[0], def.albedo[1], def.albedo[2]],
        glow: [def.glow[0], def.glow[1], def.glow[2]],
        // orbitRadius stays showcase — keplerPhaseLocalF32 applies k.
    };
}
function pickPlanetEntries(catalogId) {
    const seed = seedForCatalogId(catalogId);
    const rng = mulberry32(seed);
    const named = catalogById(catalogId);
    const picked = [];
    const used = new Set();
    if (named) {
        picked.push(scalePlanet(catalogEntryToBody(named)));
        used.add(named.id);
    }
    const rest = PLANET_CATALOG.filter((p) => !used.has(p.id));
    for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = rest[i];
        rest[i] = rest[j];
        rest[j] = tmp;
    }
    for (let i = 0; i < rest.length && picked.length < MAX_COMPACT_PLANETS; i++) {
        picked.push(scalePlanet(catalogEntryToBody(rest[i])));
    }
    return spaceCompactShowcaseOrbits(picked);
}
/**
 * Sort by current showcase orbit, then reassign even slots so consecutive
 * compact world orbits clear (r_i + r_{i+1}). Period stays Keplerian
 * (T ∝ a^1.5); KEPLER_SCALE / SPAN are unchanged.
 */
function spaceCompactShowcaseOrbits(planets) {
    const n = planets.length;
    if (n <= 0)
        return planets;
    const sorted = planets.slice().sort((a, b) => a.orbitRadius - b.orbitRadius);
    const inner = COMPACT_SHOWCASE_ORBIT_INNER;
    const outer = COMPACT_SHOWCASE_ORBIT_OUTER;
    const span = outer - inner;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
        const p = sorted[i];
        const oldR = p.orbitRadius > 1e-9 ? p.orbitRadius : inner;
        const newR = inner + span * ((i + 1) / n);
        const period = oldR > 1e-9
            ? p.orbitPeriodSec * Math.pow(newR / oldR, 1.5)
            : 14 + 76 * ((i + 1) / n);
        out[i] = { ...p, orbitRadius: newR, orbitPeriodSec: period };
    }
    return out;
}
/**
 * Build sun + ≤8 planets for a hashed catalog identity.
 * `catalogId` is {@link catalogIdFromSystemId} output (azure only if hash landed).
 */
export function buildCompactKepler(catalogId) {
    const sun = cloneSunCompact();
    const planets = pickPlanetEntries(catalogId);
    const bodies = [sun, ...planets];
    return {
        catalogId,
        keplerScale: KEPLER_SCALE,
        sun,
        planets,
        bodies,
    };
}
//# sourceMappingURL=compact-kepler.js.map