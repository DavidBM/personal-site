import { featureRequest } from '../features/http-worker/client.js';
/** Relay sparse accepted scene data; the worker owns discovery and decoding. */
export function createOnlineBattleScene(generation, renderer, onError) {
    const channel = new MessageChannel(), owner = new AbortController();
    let scopeKey = '', world = '', epoch = 0n, request = 0n, system = '', version = 0, scope, ready = false, retries = 0, started = false;
    let received, wantsScene = false, activation = 0, pending = false;
    let retryTimer;
    const send = (value) => channel.port1.postMessage(value);
    function set(next, available) {
        const key = next ? `${next.worldId}:${next.visibilityEpoch}:${next.system}` : '';
        if (key !== scopeKey) {
            version++;
            scopeKey = key;
        }
        clearTimeout(retryTimer);
        retryTimer = undefined;
        retries = 0;
        if (available)
            start();
        scope = next;
        ready = available;
        send({ type: 'scope', version, scope, ready });
    }
    channel.port1.onmessage = ({ data }) => {
        if (owner.signal.aborted || data.version !== version)
            return;
        const v = data.value;
        if (v.type === 'error') {
            onError(v.message);
            return;
        }
        if (v.type === 'battle' && v.value.systemId !== system)
            return;
        const stamp = version;
        void renderer.query({ type: 'remoteBattle', generation, value: v.type === 'battle' ? v.value : undefined, battleId: v.type === 'remove' ? v.id : undefined }).catch(e => recover(stamp, e));
    };
    channel.port1.start();
    function start() {
        if (started)
            return;
        started = true;
        void featureRequest('battleScene', [channel.port2], owner.signal, [channel.port2]).catch(e => { if (!owner.signal.aborted)
            onError(e.message); });
    }
    function recover(stamp, error) {
        if (owner.signal.aborted || stamp !== version || !ready)
            return;
        onError(`Battle scene: ${error.message}`);
        if (retries >= 3 || retryTimer)
            return;
        retryTimer = setTimeout(() => { retryTimer = undefined; send({ type: 'refresh', replay: true }); }, 250 * 4 ** retries++);
    }
    function clear() { system = ''; received = undefined; wantsScene = false; activation++; pending = false; set(undefined, false); }
    function event(value) {
        if ('generation' in value && value.generation !== generation)
            return;
        if (value.type === 'welcome') {
            world = value.worldId;
            epoch = request = 0n;
            clear();
        }
        if (value.type === 'viewBarrier' && value.epoch > epoch) {
            epoch = value.epoch;
            clear();
        }
        if (value.type === 'state') {
            connectionState(value.state);
            return;
        }
        if (value.type === 'received') {
            projected(value);
            return;
        }
        if (value.type !== 'viewChanged' || value.status.slot !== 'detail')
            return;
        detail(value.status);
    }
    function connectionState(state) { if (state === 'closed')
        clear(); }
    function projected(value) {
        if (value.snapshotComplete) {
            received = value.watermark;
            activate();
        }
    }
    function detail(s) {
        if (s.requestedGeneration < request)
            return;
        request = s.requestedGeneration;
        const token = s.displayed, selected = s.requested;
        if (s.state === 'ready' && !s.stale && token && selected?.kind === 'detail') {
            if (token.connection !== generation || token.request !== request || token.epoch < epoch)
                return;
            epoch = token.epoch;
            system = selected.systemId;
            wantsScene = true;
            activation++;
            pending = false;
            set({ worldId: world, visibilityEpoch: String(epoch), system }, false);
            activate();
            return;
        }
        suspend(s);
    }
    function activate() {
        if (ready || pending || !wantsScene || !scope || !received)
            return;
        if (received.scope.systemId !== system || received.scope.worldId !== world)
            return;
        pending = true;
        const ticket = activation;
        void renderer.query({ type: 'projectionBarrier', required: received, timeoutMs: 10000 }).then(() => {
            if (owner.signal.aborted || ticket !== activation)
                return;
            pending = false;
            set(scope, true);
        }).catch(e => baselineError(ticket, e));
    }
    function baselineError(ticket, error) {
        if (ticket !== activation || owner.signal.aborted)
            return;
        pending = false;
        onError(`Battle baseline: ${error.message}`);
        if (retries >= 3 || retryTimer)
            return;
        retryTimer = setTimeout(() => { retryTimer = undefined; activate(); }, 250 * 4 ** retries++);
    }
    function suspend(s) {
        activation++;
        pending = false;
        received = undefined;
        wantsScene = false;
        if ((s.state === 'loading' || s.recovering) && s.requested?.kind === 'detail' && s.requested.systemId === system)
            set(scope, false);
        else
            clear();
    }
    return { event, dispose() { clearTimeout(retryTimer); send({ type: 'close' }); owner.abort(); channel.port1.close(); channel.port2.close(); } };
}
//# sourceMappingURL=online-battle-scene.js.map