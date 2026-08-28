/**
 * View-local catalog identity for a topology SolarSystem.id.
 *
 * Deterministic hash → catalog planet id. Azure may appear when the hash
 * lands on it (~1/30). Azure is **never** the fallback — that is cinder.
 * No new OP; GalaxyViewHooks stay topology-only.
 */
import { PLANET_CATALOG } from "./planet-lib/planet-catalog.js";
/** Fallback when the id is unusable or the catalog is empty. Never azure. */
export const CATALOG_ID_FALLBACK = "cinder";
function catalogIds() {
    return PLANET_CATALOG.map((p) => p.id);
}
/** Integer mix — stable across runs, not cryptographic. */
export function hashSystemId(id) {
    let x = id | 0;
    x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
    x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
    return (x ^ (x >>> 16)) >>> 0;
}
/**
 * Map topology system id → catalog planet id.
 * Invalid / non-finite ids return {@link CATALOG_ID_FALLBACK} (cinder).
 */
export function catalogIdFromSystemId(id) {
    if (!Number.isFinite(id))
        return CATALOG_ID_FALLBACK;
    const ids = catalogIds();
    if (ids.length === 0)
        return CATALOG_ID_FALLBACK;
    const idx = hashSystemId(id) % ids.length;
    return ids[idx] ?? CATALOG_ID_FALLBACK;
}
//# sourceMappingURL=solar-catalog-id.js.map