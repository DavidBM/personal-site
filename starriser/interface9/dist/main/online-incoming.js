import { watchGameplay } from '../features/http-worker/client.js';
import { requestIncoming } from '../lib/journey-content/incoming.js';
/** Accepted detail owns the destination interest. Camera and selection do not. */
export function createOnlineIncoming(show, read = requestIncoming) {
    let scope, welcome;
    let system, request, closed = false, dirty = false, epoch = 0n, generation = 0n;
    let timer, attempt = 0;
    const unwatch = watchGameplay(1, () => { attempt = 0; void refresh(); });
    function reset() { request?.abort(); request = undefined; clearTimeout(timer); timer = undefined; dirty = false; show(undefined, []); }
    async function refresh() {
        if (closed || !scope || !system)
            return;
        if (request) {
            dirty = true;
            return;
        }
        clearTimeout(timer);
        timer = undefined;
        dirty = false;
        const owner = new AbortController(), accepted = scope, destination = system;
        request = owner;
        try {
            const rows = await readPages(accepted, destination, owner.signal);
            if (current(owner, accepted, destination)) {
                show(destination, rows);
                attempt = 0;
            }
        }
        catch (error) {
            if (current(owner, accepted, destination))
                failed(error);
        }
        finally {
            if (request === owner) {
                request = undefined;
                if (dirty)
                    void refresh();
            }
        }
    }
    function current(owner, accepted, destination) { return !owner.signal.aborted && scope === accepted && system === destination; }
    function failed(error) {
        if ([401, 403, 412].includes(error.status ?? 0)) {
            reset();
            scope = undefined;
            return;
        }
        console.error('Incoming fleet read failed', error);
        if (attempt < 3)
            timer = setTimeout(() => { timer = undefined; void refresh(); }, 250 * 4 ** attempt++);
    }
    function detail(s) {
        if (s.slot !== 'detail' || s.requestedGeneration < generation)
            return;
        if (s.state !== 'ready' || s.stale) {
            generation = s.requestedGeneration;
            reset();
            scope = undefined;
            return;
        }
        const accepted = valid(s);
        if (!accepted)
            return;
        const { token: t, systemId: id } = accepted;
        generation = s.requestedGeneration;
        if (system !== id || epoch !== t.epoch)
            reset();
        system = id;
        epoch = t.epoch;
        scope = { worldId: welcome.worldId, visibilityEpoch: String(epoch) };
        attempt = 0;
        void refresh();
    }
    function valid(s) {
        const t = s.displayed;
        if (!welcome || !t || t.connection !== welcome.generation || t.request !== s.requestedGeneration || t.epoch < epoch || t.epoch < 1n || s.requested?.kind !== 'detail')
            return;
        return { token: t, systemId: s.requested.systemId };
    }
    async function readPages(accepted, destination, signal) {
        const rows = [];
        let after;
        do {
            const page = await read(accepted, destination, after, signal);
            rows.push(...page.journeys);
            after = page.next ?? undefined;
        } while (after && rows.length < 32);
        return rows;
    }
    function reconnect() { reset(); welcome = undefined; scope = undefined; system = undefined; epoch = generation = 0n; }
    return { reconnect, refresh, event(e) {
            if (closed || !sameConnection(e, welcome))
                return;
            switch (e.type) {
                case 'welcome':
                    reconnect();
                    welcome = e;
                    return;
                case 'viewChanged':
                    detail(e.status);
                    return;
                case 'viewBarrier':
                    if (e.epoch > epoch) {
                        reset();
                        scope = undefined;
                        epoch = e.epoch;
                    }
                    return;
                case 'state':
                    if (e.state === 'closed')
                        reconnect();
                    return;
            }
        }, dispose() { closed = true; unwatch(); reconnect(); } };
}
function sameConnection(e, welcome) { return !welcome || !('generation' in e) || e.generation === welcome.generation; }
//# sourceMappingURL=online-incoming.js.map