import { createPlanetPresenceFeed } from './planet-presence.js';
import { onGameplayChange } from './live.js';
import { requestSurvey } from './survey.js';
import { requestJourney } from '../../lib/journey-content/client.js';
import { requestJourneyPath } from '../../lib/journey-content/path.js';
import { anyMapLayer, mapLayers } from '../../contracts/map-layers.js';
/** Worker owns HTTP, decoding, revision cache and bounded progressive scheduling. */
export function attachMapLayers(port) {
    let generation = 0;
    const presence = createPlanetPresenceFeed(value => port.postMessage({ generation, value: { type: 'presence', value } }));
    const owner = createMapLayerFeed(value => port.postMessage({ generation, value }));
    port.onmessage = event => { const v = event.data; if (v.type === 'scope') {
        generation = v.generation;
        presence.scope(v.scope);
    } if (v.type === 'system') {
        presence.system(v.system);
        return;
    } if (v.type === 'options')
        presence.enabled(v.value.system.planetOwners || v.value.system.ownPlanets); owner.input(v); if (v.type === 'close') {
        presence.dispose();
        port.close();
    } };
    port.start();
}
export function createMapLayerFeed(publish, api = { survey: requestSurvey, journey: requestJourney, path: requestJourneyPath }) {
    let scope, owner = new AbortController(), closed = false, busy = false;
    let options = mapLayers(null);
    let timer, planetDue = 0, planetCursor, planetPages = 0, planetRevision = 0;
    const roster = new Map(), staging = new Map(), pending = new Set();
    const unwatch = onGameplayChange((topics, ids) => { if (topics & 32) {
        planetRevision++;
        planetDue = 0;
        planetCursor = undefined;
        planetPages = 0;
    } if (topics & 1 && anyMapLayer(options, 'ownRoutes'))
        for (const id of ids.length ? ids : roster.keys())
            if (roster.has(id))
                pending.add(id); schedule(); });
    let preferPage = false;
    const paths = new Map();
    function reset() { owner.abort(); owner = new AbortController(); clearTimeout(timer); timer = undefined; planetDue = 0; planetCursor = undefined; planetPages = 0; paths.clear(); pending.clear(); publish({ type: 'reset' }); }
    function schedule(delay = 100) { if (closed || timer || !scope)
        return; timer = setTimeout(() => { timer = undefined; void step(); }, delay); }
    function input(value) {
        if (closed)
            return;
        if (value.type === 'close') {
            closed = true;
            unwatch();
            reset();
            return;
        }
        if (value.type === 'scope') {
            reset();
            scope = value.scope;
            roster.clear();
            staging.clear();
            schedule();
            return;
        }
        if (value.type === 'options') {
            const old = options;
            options = value.value;
            if (anyMapLayer(old, 'ownRoutes') !== anyMapLayer(options, 'ownRoutes')) {
                owner.abort();
                owner = new AbortController();
                paths.clear();
                pending.clear();
                publish({ type: 'routesReset' });
                if (anyMapLayer(options, 'ownRoutes'))
                    for (const id of roster.keys())
                        pending.add(id);
            }
            if (anyMapLayer(old, 'ownPlanets') !== anyMapLayer(options, 'ownPlanets') || anyMapLayer(old, 'systemColors') !== anyMapLayer(options, 'systemColors'))
                planetDue = 0;
            schedule();
            return;
        }
        if (value.type === 'system')
            return;
        if (value.begin)
            staging.clear();
        for (const [id, version] of value.rows)
            if (staging.size < 16384)
                staging.set(id, version);
        if (!value.end)
            return;
        for (const id of roster.keys())
            if (!staging.has(id)) {
                pending.delete(id);
                paths.delete(id);
                publish({ type: 'route', id });
            }
        for (const [id, version] of staging)
            if (anyMapLayer(options, 'ownRoutes') && roster.get(id) !== version)
                pending.add(id);
        roster.clear();
        for (const [id, version] of staging)
            roster.set(id, version);
        staging.clear();
        schedule();
    }
    async function planets(signal) {
        if (!(anyMapLayer(options, 'ownPlanets') || anyMapLayer(options, 'systemColors')) || Date.now() < planetDue)
            return false;
        const revision = planetRevision;
        const reply = await api.survey(scope, { action: 'ownedPlanets', cursor: planetCursor }, signal);
        signal.throwIfAborted();
        if (revision !== planetRevision)
            return true;
        publish({ type: 'planets', rows: reply.planets ?? [], reset: planetPages === 0 });
        planetPages++;
        planetCursor = reply.next ?? undefined;
        if (!planetCursor) {
            planetPages = 0;
            planetDue = Infinity;
        }
        if (planetPages > 1024)
            throw new Error('Owned planet catalog exceeds map budget');
        return true;
    }
    async function route(id, signal) {
        const journeyScope = scope;
        const reply = await api.journey(journeyScope, { action: 'lookup', fleetId: id }, signal);
        signal.throwIfAborted();
        if ('kind' in reply || ['completed', 'cancelled', 'failed'].includes(reply.phase.phase)) {
            paths.delete(id);
            publish({ type: 'route', id });
            return;
        }
        let cached = paths.get(id);
        if (cached?.journey !== reply.journeyId) {
            cached = { journey: reply.journeyId, next: 0, source: reply.sourceSystem, completed: reply.completedLegs, checked: Date.now() };
            paths.set(id, cached);
            publish({ type: 'route', id });
        }
        cached.completed = reply.completedLegs;
        cached.checked = Date.now();
        publish({ type: 'route', id, completed: cached.completed });
    }
    async function page(id, cached, signal) {
        const reply = await api.path(scope, { journeyId: cached.journey, sourceSystem: cached.source, offset: cached.next }, signal);
        signal.throwIfAborted();
        if (reply.fleetId !== id)
            throw new Error('Map route fleet mismatch');
        cached.next = reply.nextOffset;
        publish({ type: 'route', id, page: reply, completed: cached.completed });
    }
    async function step() {
        if (busy) {
            schedule();
            return;
        }
        busy = true;
        const lifetime = owner.signal, signal = AbortSignal.any([lifetime, AbortSignal.timeout(10000)]);
        let delay = 250;
        try {
            // Alternate bounded reads; never subscribe to another system or fetch ship detail.
            if (await planets(signal))
                return;
            if (!anyMapLayer(options, 'ownRoutes')) {
                delay = 1000;
                return;
            }
            if (preferPage) {
                preferPage = false;
                for (const [id, p] of paths)
                    if (p.next !== null) {
                        await page(id, p, signal);
                        return;
                    }
            }
            const id = pending.keys().next().value;
            if (id) {
                preferPage = true;
                pending.delete(id);
                try {
                    await route(id, signal);
                }
                catch (e) {
                    if (!lifetime.aborted)
                        pending.add(id);
                    throw e;
                }
                return;
            }
            for (const [id, p] of paths)
                if (p.next !== null) {
                    await page(id, p, signal);
                    return;
                }
            delay = 1000;
        }
        catch (error) {
            delay = 2000;
            if (!lifetime.aborted && [401, 403, 412].includes(error.status ?? 0)) {
                reset();
                scope = undefined;
            }
        }
        finally {
            busy = false;
            if (scope && ((anyMapLayer(options, 'ownPlanets') || anyMapLayer(options, 'systemColors')) && planetDue !== Infinity || anyMapLayer(options, 'ownRoutes') && (pending.size > 0 || [...paths.values()].some(p => p.next !== null))))
                schedule(delay);
        }
    }
    return { input };
}
//# sourceMappingURL=map-layers.js.map