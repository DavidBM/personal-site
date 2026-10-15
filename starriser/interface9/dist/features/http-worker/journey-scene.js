import { onGameplayChange } from './live.js';
import { requestJourney } from '../../lib/journey-content/client.js';
import { requestJourneyPath } from '../../lib/journey-content/path.js';
export function attachJourneyScene(port) {
    let version = 0;
    const feed = createJourneySceneFeed(value => port.postMessage({ version, value }));
    port.onmessage = ({ data }) => { if (data.type === 'scope')
        version = data.version; feed.input(data); if (data.type === 'close')
        port.close(); };
    port.start();
}
/** Scene interest and accepted own journeys own reads, never selection or route
 * visibility. One request at a time; idle means zero reads. */
export function createJourneySceneFeed(publish, api = { journey: requestJourney, path: requestJourneyPath }) {
    let scope, system, closed = false, busy = false;
    let owner = new AbortController(), timer;
    let flight;
    const roster = new Map(), staging = new Map();
    const pending = new Set(), active = new Map(), attempts = new Map();
    const seeds = new Map();
    const pages = new Map();
    const unwatch = onGameplayChange((topics, ids) => { if (!(topics & 1))
        return; for (const id of ids.length ? ids : roster.keys())
        if (relevant(id)) {
            attempts.delete(id);
            pending.add(id);
        } schedule(); });
    function relevant(id) { const row = roster.get(id); return active.has(id) || !!row && (row[2] === system); }
    function schedule(delay = 0) { if (!scope || closed || busy || timer || !pending.size)
        return; timer = setTimeout(() => { timer = undefined; void step(); }, delay); }
    function cancelFlight() { flight?.controller.abort(); flight = undefined; busy = false; }
    function reset() { cancelFlight(); owner.abort(); owner = new AbortController(); clearTimeout(timer); timer = undefined; roster.clear(); staging.clear(); active.clear(); pages.clear(); seeds.clear(); pending.clear(); attempts.clear(); publish({ type: 'reset' }); }
    function remove(id) { if (flight?.id === id)
        cancelFlight(); active.delete(id); seeds.delete(id); pages.delete(id); pending.delete(id); attempts.delete(id); publish({ type: 'remove', id }); schedule(); }
    function rosterPage(v) {
        if (v.begin)
            staging.clear();
        for (const row of v.rows)
            if (staging.size < 16384)
                staging.set(row[0], row);
        if (v.end)
            commitRoster();
    }
    function commitRoster() {
        for (const id of roster.keys())
            if (!staging.has(id))
                remove(id);
        for (const [id, row] of staging) {
            const old = roster.get(id);
            roster.set(id, row);
            if (relevant(id) && old?.[1] !== row[1]) {
                attempts.delete(id);
                pending.add(id);
            }
        }
        for (const id of roster.keys())
            if (!staging.has(id))
                roster.delete(id);
        staging.clear();
        schedule();
    }
    async function present(v, signal) {
        if (['completed', 'cancelled', 'failed'].includes(v.phase.phase)) {
            publish({ type: 'journey', value: v, nodes: [] });
            active.delete(v.fleetId);
            pages.delete(v.fleetId);
            return;
        }
        if (!active.has(v.fleetId) && active.size >= 512)
            throw new Error('Journey scene exceeds 512 active fleets');
        const previous = active.get(v.fleetId);
        if (previous?.journeyId === v.journeyId && previous.revision > v.revision)
            return;
        active.set(v.fleetId, v);
        const nodes = await currentNodes(v, signal);
        signal.throwIfAborted();
        publish({ type: 'journey', value: v, nodes });
    }
    async function currentNodes(v, signal) {
        const offset = Math.floor(v.completedLegs / 16) * 16, key = `${v.journeyId}:${offset}`;
        let cached = pages.get(v.fleetId);
        if (cached?.key !== key) {
            cached = { key, nodes: await loadNodes(v, offset, signal) };
            signal.throwIfAborted();
            pages.set(v.fleetId, cached);
        }
        return cached.nodes.filter(n => n[0] === v.currentSystem || n[0] === v.destinationSystem);
    }
    async function loadNodes(v, offset, signal) {
        const page = await api.path(scope, { journeyId: v.journeyId, sourceSystem: v.sourceSystem, offset }, signal);
        signal.throwIfAborted();
        if (page.fleetId !== v.fleetId)
            throw new Error('Journey scene fleet mismatch');
        if (v.completedLegs % 16 !== 15 || page.nextOffset === null)
            return page.nodes;
        const next = await api.path(scope, { journeyId: v.journeyId, sourceSystem: v.sourceSystem, offset: page.nextOffset }, signal);
        signal.throwIfAborted();
        if (next.fleetId !== v.fleetId)
            throw new Error('Journey scene fleet mismatch');
        return [...page.nodes, ...next.nodes];
    }
    async function step() {
        if (busy || !scope || !pending.size)
            return;
        busy = true;
        const id = pending.values().next().value, current = { id, controller: new AbortController() };
        flight = current;
        const signal = AbortSignal.any([owner.signal, current.controller.signal]);
        pending.delete(id);
        let delay = 0;
        try {
            const seed = seeds.get(id);
            seeds.delete(id);
            const v = seed ?? await api.journey(scope, { action: 'lookup', fleetId: id }, signal);
            signal.throwIfAborted();
            if ('kind' in v)
                remove(id);
            else
                await present(v, signal);
            attempts.delete(id);
        }
        catch (error) {
            if (!signal.aborted)
                delay = failed(id, error);
        }
        finally {
            if (flight === current) {
                flight = undefined;
                busy = false;
                schedule(delay);
            }
        }
    }
    function failed(id, error) {
        publish({ type: 'error', message: error instanceof Error ? error.message : 'Journey scene unavailable' });
        if ([401, 403, 412].includes(error?.status ?? 0)) {
            remove(id);
            return 0;
        }
        const n = attempts.get(id) ?? 0;
        if (n >= 3)
            return 0;
        attempts.set(id, n + 1);
        pending.add(id);
        return 250 * 4 ** n;
    }
    function seed(value) {
        if (!scope)
            return;
        const previous = seeds.get(value.fleetId) ?? active.get(value.fleetId);
        if (previous?.journeyId === value.journeyId && previous.revision >= value.revision)
            return;
        if (seeds.size >= 512)
            throw new Error('Journey scene seed capacity reached');
        seeds.set(value.fleetId, value);
        pending.add(value.fleetId);
        schedule();
    }
    function setSystem(value) {
        if (system === value)
            return;
        system = value;
        for (const id of roster.keys())
            if (relevant(id))
                pending.add(id);
        schedule();
    }
    function input(v) {
        if (closed)
            return;
        switch (v.type) {
            case 'scope':
                reset();
                scope = v.scope;
                return;
            case 'close':
                closed = true;
                unwatch();
                reset();
                scope = undefined;
                return;
            case 'roster':
                rosterPage(v);
                return;
            case 'system':
                setSystem(v.system);
                return;
            case 'seed':
                seed(v.value);
                return;
        }
    }
    return { input, inspect: () => ({ active: active.size, pending: pending.size }) };
}
//# sourceMappingURL=journey-scene.js.map