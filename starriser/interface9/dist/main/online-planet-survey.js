import { loadPlanetCatalog } from '../lib/planet-content/catalog.js';
import { PlanetHttpError } from '../lib/planet-content/http.js';
import { SURVEY_PLANET_SYSTEM_LIMIT } from '../contracts/survey-signals.js';
export function surveyPlanetCatalog(context, node) {
    return { clusterId: node.clusterId, systemId: node.solarSystemId, onlineSystemId: context.systemId,
        bodies: context.bodies.map(body => ({ id: body.bodyId, name: body.name, kind: body.planetClass, mapReady: !!body.surface, catalogId: body.visualCatalogId })) };
}
/** Independent discovery-authorized metadata; fleet locations seed it without selecting any detail view. */
export function createOnlinePlanetSurvey(options) {
    let welcome, epoch = 0n, closed = false;
    let owner = new AbortController(), running = 0;
    const cache = new Map();
    const pending = new Map();
    const queue = new Map();
    const discovered = new Map();
    const credential = Array.from(options.credential, n => n.toString(16).padStart(2, '0')).join('');
    function reset() {
        owner.abort();
        owner = new AbortController();
        epoch = 0n;
        queue.clear();
        discovered.clear();
        cache.clear();
        pending.clear();
        options.publish(undefined);
    }
    async function read(systemId, signal) {
        const home = welcome, visibilityEpoch = String(epoch);
        try {
            const { catalog, version } = await (options.load ?? loadPlanetCatalog)({ endpoint: new URL('./planet-catalog', home.contentEndpoint).href,
                credential, worldId: home.worldId, systemId, visibilityEpoch, signal });
            signal.throwIfAborted();
            return { catalogVersion: version, endpoint: new URL('./planet-content', home.contentEndpoint).href, credential,
                worldId: catalog.worldId, systemId, visibilityEpoch, bodies: catalog.bodies };
        }
        catch (error) {
            signal.throwIfAborted();
            if (error instanceof PlanetHttpError && error.status === 404)
                return undefined;
            throw error;
        }
    }
    async function context(systemId) {
        if (closed || !welcome?.contentEndpoint || epoch < 1n)
            throw new Error('Planet discovery is not ready');
        if (cache.has(systemId))
            return cache.get(systemId);
        const existing = pending.get(systemId);
        if (existing)
            return existing;
        const signal = AbortSignal.any([owner.signal, AbortSignal.timeout(15000)]);
        const request = read(systemId, signal);
        pending.set(systemId, request);
        try {
            const value = await request;
            signal.throwIfAborted();
            if (cache.size >= SURVEY_PLANET_SYSTEM_LIMIT)
                cache.delete(cache.keys().next().value);
            cache.set(systemId, value);
            return value;
        }
        finally {
            if (pending.get(systemId) === request)
                pending.delete(systemId);
        }
    }
    async function prefetch(systemId, node) {
        const signal = owner.signal;
        try {
            const value = await context(systemId);
            if (!signal.aborted && value)
                options.publish(surveyPlanetCatalog(value, node));
        }
        catch { /* Missing, denied or interrupted discovery never invents planet facts. */ }
        finally {
            running--;
            pump();
        }
    }
    function pump() {
        if (closed || epoch < 1n)
            return;
        while (running < 2 && (queue.size || discovered.size)) {
            const source = queue.size ? queue : discovered;
            const [id, node] = source.entries().next().value;
            source.delete(id);
            running++;
            void prefetch(id, node);
        }
    }
    function roster(fleets) {
        queue.clear();
        for (const fleet of fleets) {
            if (!cache.has(fleet.onlineSystemId) && !pending.has(fleet.onlineSystemId))
                queue.set(fleet.onlineSystemId, fleet.node);
            if (queue.size >= SURVEY_PLANET_SYSTEM_LIMIT)
                break;
        }
        pump();
    }
    function event(value) {
        if (closed || ('generation' in value && value.generation !== options.generation))
            return;
        if (value.type === 'welcome') {
            reset();
            welcome = value;
            return;
        }
        if (value.type === 'viewBarrier') {
            reset();
            epoch = value.epoch;
            return;
        }
        if (value.type === 'state' && value.state === 'closed') {
            reset();
            welcome = undefined;
            return;
        }
        if (value.type !== 'viewChanged')
            return;
        ready(value.status);
    }
    function ready(status) {
        const token = status.displayed;
        if (status.state !== 'ready' || status.stale || token?.connection !== options.generation || token.epoch <= epoch)
            return;
        reset();
        epoch = token.epoch;
    }
    function discover(system, node, version) {
        if (version && cache.get(system)?.catalogVersion === version)
            return;
        cache.delete(system);
        if (version === null) {
            discovered.delete(system);
            options.publish({ clusterId: node.clusterId, systemId: node.solarSystemId, onlineSystemId: system, bodies: [] });
            return;
        }
        if (discovered.size >= SURVEY_PLANET_SYSTEM_LIMIT)
            discovered.delete(discovered.keys().next().value);
        discovered.set(system, node);
        pump();
    }
    return { event, roster, context, discover, dispose() { closed = true; reset(); welcome = undefined; } };
}
//# sourceMappingURL=online-planet-survey.js.map