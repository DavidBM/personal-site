import { featureRequest, watchGameplay } from '../features/http-worker/client.js';
/** Sparse list lifecycle, independent of camera/detail selection. Hidden panels
 * keep one dirty bit; permission and connection changes immediately retire rows. */
export function createOwnedPlanetRoster(show, options = {}) {
    let home, scope;
    let credential = '', epoch = 0n, generation = 0, visible = false, dirty = true, closed = false, cursor, page;
    let owner;
    const read = options.read ?? ((scope, cursor, signal) => featureRequest('ownedPlanets', [scope, cursor], signal));
    const publish = (loading = false, message = '') => show({ page, loading, first: !cursor, message });
    function invalidate() { owner?.abort(); owner = undefined; page = undefined; cursor = undefined; dirty = true; publish(false, scope ? '' : 'Connect to see your planets.'); if (visible && scope)
        void refresh(); }
    async function refresh(next) {
        if (closed || !scope || !visible)
            return;
        owner?.abort();
        const request = owner = new AbortController(), snapshot = scope;
        cursor = next;
        dirty = false;
        publish(true);
        try {
            const result = await read(snapshot, next, request.signal);
            if (request.signal.aborted || closed)
                return;
            page = result;
            publish(false, result.rows.length ? '' : 'You do not own any planets yet.');
        }
        catch (error) {
            if (request.signal.aborted || closed)
                return;
            page = undefined;
            dirty = true;
            publish(false, error instanceof Error ? error.message : 'Unable to load planets.');
        }
        finally {
            if (owner === request)
                owner = undefined;
        }
    }
    function setScope(value) { epoch = value; scope = home?.contentEndpoint && value > 0n ? { worldId: home.worldId, visibilityEpoch: String(value), credential, endpoint: new URL('./planet-catalog', home.contentEndpoint).href } : undefined; invalidate(); }
    const unwatch = (options.watch ?? watchGameplay)(32, () => { if (!closed) {
        dirty = true;
        if (visible && scope)
            void refresh();
    } });
    function event(value) {
        if (closed)
            return;
        if (value.type === 'welcome') {
            generation = value.generation;
            home = value;
            setScope(0n);
            return;
        }
        if ('generation' in value && value.generation !== generation)
            return;
        if (value.type === 'state' && value.state === 'closed') {
            home = undefined;
            setScope(0n);
        }
        if (value.type === 'viewBarrier')
            setScope(value.epoch);
        if (value.type === 'viewChanged' && value.status.state === 'ready' && !value.status.stale && value.status.displayed?.connection === generation && value.status.displayed.epoch > epoch)
            setScope(value.status.displayed.epoch);
    }
    publish(false, 'Connect to see your planets.');
    return { event, reconnect(value) { credential = value; home = undefined; setScope(0n); },
        visible(value) { if (visible === value)
            return; visible = value; if (!value && owner) {
            owner.abort();
            owner = undefined;
            dirty = true;
        } if (value && dirty)
            void refresh(); },
        first() { void refresh(); }, next() { if (page?.next)
            void refresh(page.next); },
        clear() { home = undefined; setScope(0n); }, dispose() { closed = true; unwatch(); owner?.abort(); page = undefined; } };
}
//# sourceMappingURL=owned-planets.js.map