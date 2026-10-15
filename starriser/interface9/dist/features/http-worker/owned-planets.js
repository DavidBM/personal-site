import { requestSurvey } from './survey.js';
import { loadPlanetCatalog } from '../../lib/planet-content/catalog.js';
import { catalogMapRelpath } from '../../gpu/planet-lib/catalog-assets.js';
/** Authoritative ownership first; only hydrate those bodies. Two catalog reads at
 * a time, at most 16 rows, no detail subscription or scene/texture generation. */
export async function requestOwnedPlanets(scope, cursor, signal, deps = { survey: requestSurvey, catalog: loadPlanetCatalog }) {
    const page = await deps.survey(scope, { action: 'ownedPlanets', cursor }, signal);
    signal.throwIfAborted();
    const planets = page.planets ?? [], systems = [...new Set(planets.map(row => row[1]))];
    const catalogs = new Map();
    let next = 0;
    async function hydrate() {
        while (next < systems.length) {
            const systemId = systems[next++];
            signal.throwIfAborted();
            try {
                const result = await deps.catalog({ ...scope, systemId, signal });
                signal.throwIfAborted();
                catalogs.set(systemId, result.catalog);
            }
            catch (error) {
                signal.throwIfAborted();
                if (error?.status === 401 || error?.status === 403)
                    throw error;
            }
        }
    }
    await Promise.all([hydrate(), hydrate()]);
    signal.throwIfAborted();
    return { next: page.next ?? null, rows: planets.map(([bodyId, systemId]) => {
            const body = catalogs.get(systemId)?.bodies.find(row => row.bodyId === bodyId), catalogId = body?.visualCatalogId;
            return { bodyId, systemId, name: body?.name ?? `Planet ${bodyId.slice(-6)}`, kind: body?.planetClass ?? 'Details unavailable', catalogId,
                thumbnail: catalogId ? catalogMapRelpath(catalogId, 'preview_albedo') : undefined };
        }) };
}
//# sourceMappingURL=owned-planets.js.map