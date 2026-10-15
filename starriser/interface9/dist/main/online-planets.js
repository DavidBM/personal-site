import { loadPlanetCatalog } from '../lib/planet-content/catalog.js';
/** One connection owns an independent, bounded catalog request and planet UI scope. */
export function createOnlinePlanets(observer, credential, options = {}) {
    let welcome, epoch = 0n, selected = '', closed = false;
    let detailRequest = 0n, acceptedSystem = '';
    let pending, last;
    function clear(preserveIntent = false) {
        pending?.abort();
        pending = undefined;
        if (preserveIntent && observer.suspend)
            observer.suspend();
        else
            observer.setContext(undefined);
    }
    async function load(systemId, owner) {
        const home = welcome, currentEpoch = epoch.toString();
        try {
            const { catalog } = await loadPlanetCatalog({ endpoint: new URL('./planet-catalog', home.contentEndpoint).href,
                credential, worldId: home.worldId, systemId, visibilityEpoch: currentEpoch,
                fetch: options.fetch, signal: owner.signal });
            owner.signal.throwIfAborted();
            if (closed || pending !== owner)
                return;
            observer.setContext({ endpoint: new URL('./planet-content', home.contentEndpoint).href, credential,
                worldId: catalog.worldId, systemId, visibilityEpoch: currentEpoch, bodies: catalog.bodies });
        }
        catch (error) {
            if (owner.signal.aborted || closed || pending !== owner)
                return;
            // An unavailable or denied catalog cannot keep a previously visible surface alive.
            pending = undefined;
            owner.abort();
            observer.setContext(undefined);
        }
    }
    function install(systemId) {
        selected = systemId;
        pending?.abort();
        pending = undefined;
        if (!welcome?.contentEndpoint || epoch < 1n || !systemId)
            return;
        const owner = new AbortController();
        pending = owner;
        void load(systemId, owner);
    }
    function clearDetail(preserveIntent = false) {
        selected = '';
        if (!preserveIntent)
            acceptedSystem = '';
        clear(preserveIntent);
    }
    function detail(status) {
        if (status.slot !== 'detail' || status.requestedGeneration < detailRequest)
            return;
        if (status.displayed && status.displayed.connection !== welcome?.generation)
            return;
        if (status.state !== 'ready' || status.stale) {
            detailRequest = status.requestedGeneration;
            clearDetail(refreshingDetail(status));
            return;
        }
        acceptDetail(status);
    }
    function refreshingDetail(status) {
        return (status.state === 'loading' || status.state === 'unavailable') && status.requested?.kind === 'detail'
            && status.requested.systemId === acceptedSystem && (!status.displayed || status.displayed.epoch === epoch);
    }
    function acceptDetail(status) {
        const current = currentDetail(status, welcome, epoch);
        if (!current)
            return;
        const { token, systemId } = current;
        detailRequest = status.requestedGeneration;
        if (last && !newer(token, last))
            return;
        activateDetail(token, systemId);
    }
    function activateDetail(token, systemId) {
        const changed = token.epoch !== epoch;
        if (changed || systemId !== acceptedSystem)
            clearDetail();
        epoch = token.epoch;
        last = { ...token };
        acceptedSystem = systemId;
        if (changed || systemId !== selected || !pending)
            install(systemId);
    }
    function event(value) {
        if (closed || (welcome && 'generation' in value && value.generation !== welcome.generation))
            return;
        switch (value.type) {
            case 'welcome':
                clearDetail();
                welcome = value;
                epoch = 0n;
                detailRequest = 0n;
                last = undefined;
                return;
            case 'viewBarrier':
                if (value.epoch > epoch) {
                    epoch = value.epoch;
                    clearDetail();
                }
                return;
            case 'viewChanged':
                detail(value.status);
                return;
            default: control(value);
        }
    }
    function control(value) {
        if (value.type === 'viewInterests' && value.interests.slots.detail === null)
            clearDetail();
        if (value.type === 'state' && value.state === 'closed')
            clearDetail();
    }
    function dispose() { if (closed)
        return; closed = true; clear(); welcome = undefined; }
    return { reconnect(value) { clearDetail(); credential = value; welcome = undefined; epoch = detailRequest = 0n; last = undefined; }, event, dispose };
}
function currentDetail(status, welcome, epoch) {
    const token = status.displayed;
    if (!welcome || !token || token.connection !== welcome.generation || token.request !== status.requestedGeneration)
        return;
    if (token.epoch < 1n || token.epoch < epoch)
        return;
    if (status.requested?.kind !== 'detail')
        return;
    return { token, systemId: status.requested.systemId };
}
function newer(next, previous) {
    for (const key of ['epoch', 'request', 'baseline', 'sequence']) {
        if (next[key] !== previous[key])
            return next[key] > previous[key];
    }
    return false;
}
//# sourceMappingURL=online-planets.js.map