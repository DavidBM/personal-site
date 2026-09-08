import { seedBuffers } from './seed.js';
import { topologyBuffers } from './routes.js';
/** Owns one worker lifetime. Inputs may transfer; no request queue or local rule
 * execution. A timeout closes the worker so late offline results cannot leak. */
export function createDomainClient(worker, bootstrap, options) {
    const timeoutMs = options.timeoutMs ?? 10000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        worker.terminate();
        throw new Error('Invalid domain request timeout');
    }
    let closed = false, initialized = false, nextId = 0;
    let pending = null;
    let resolveReady, rejectReady;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    void ready.catch(() => { });
    const startupTimer = setTimeout(() => fail(new Error('Domain worker initialization timed out')), timeoutMs);
    function dispose(reason = new Error('Domain worker disposed')) {
        if (closed)
            return;
        closed = true;
        clearTimeout(startupTimer);
        rejectReady(reason);
        if (pending) {
            clearTimeout(pending.timer);
            pending.reject(reason);
            pending = null;
        }
        worker.removeEventListener('message', receive);
        worker.removeEventListener('error', error);
        worker.removeEventListener('messageerror', error);
        try {
            worker.postMessage({ type: 'dispose' });
        }
        catch { /* Endpoint may already be closed. */ }
        worker.terminate();
    }
    function fail(reason) { dispose(reason); options.onError(reason); }
    function error() { fail(new Error('Domain worker transport failed')); }
    function receive(event) {
        if (closed)
            return;
        const message = event.data;
        if (message.type === 'ready') {
            initialized = true;
            clearTimeout(startupTimer);
            resolveReady(message.status);
            return;
        }
        if (message.type === 'accepted') {
            accept(message.change);
            return;
        }
        if (message.type === 'disposed') {
            dispose();
            return;
        }
        if (message.type === 'failure' && message.id === undefined) {
            fail(new Error(message.message));
            return;
        }
        complete(message);
    }
    function accept(change) {
        try {
            options.onAccepted(change);
        }
        catch (cause) {
            fail(cause instanceof Error ? cause : new Error(String(cause)));
        }
    }
    function complete(message) {
        if (!pending || message.id !== pending.id)
            return;
        const current = pending;
        pending = null;
        clearTimeout(current.timer);
        if (message.type === 'failure')
            current.reject(new Error(message.message));
        else
            current.resolve(message.result);
    }
    worker.addEventListener('message', receive);
    worker.addEventListener('error', error);
    worker.addEventListener('messageerror', error);
    try {
        worker.postMessage(bootstrap);
    }
    catch (cause) {
        fail(cause instanceof Error ? cause : new Error(String(cause)));
    }
    return {
        ready,
        request(request) {
            if (closed || !initialized)
                return Promise.reject(new Error('Domain worker is not ready'));
            if (pending)
                return Promise.reject(new Error('Domain worker already has one request in flight'));
            const transfer = request.type === 'seed' ? seedBuffers(request.seed) : request.type === 'seedTopology' ? topologyBuffers(request.topology) : [];
            const id = ++nextId;
            return new Promise((resolve, reject) => {
                pending = { id, resolve, reject, timer: setTimeout(() => fail(new Error('Domain request timed out; worker closed')), timeoutMs) };
                try {
                    worker.postMessage({ type: 'request', id, request }, transfer);
                }
                catch (cause) {
                    fail(cause instanceof Error ? cause : new Error(String(cause)));
                }
            });
        },
        dispose,
    };
}
//# sourceMappingURL=client.js.map