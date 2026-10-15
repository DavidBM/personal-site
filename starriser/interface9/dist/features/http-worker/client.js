import { notifyObserver } from '../../lib/notify-observer.js';
export class FeatureError extends Error {
    constructor(message, status) { super(message); this.status = status; }
}
let worker, next = 0, closed = false;
let moduleUrl = new URL('./worker-entry.js', import.meta.url).href;
const pending = new Map();
export function configureFeatureWorker(url) { disposeFeatureWorker(); closed = false; moduleUrl = url; }
export function disposeFeatureWorker() {
    closed = true;
    worker?.terminate();
    worker = undefined;
    for (const row of pending.values()) {
        row.done();
        row.reject(new Error('Feature connection closed'));
    }
    pending.clear();
}
function endpoint() {
    if (closed)
        throw new Error('Feature worker is closed');
    if (worker)
        return worker;
    worker = new Worker(moduleUrl, { type: 'module', name: 'game-features' });
    worker.addEventListener('message', event => {
        if (event.data.gameplayChanged) {
            for (const fn of gameplayListeners)
                notifyObserver('gameplay UI', () => fn(event.data.gameplayChanged, event.data.fleetIds ?? []));
            return;
        }
        const { id, value, error } = event.data;
        const row = pending.get(id);
        if (!row)
            return;
        pending.delete(id);
        row.done();
        if (error)
            row.reject(new FeatureError(error.message, error.status));
        else
            row.resolve(value);
    });
    worker.addEventListener('error', disposeFeatureWorker);
    worker.addEventListener('messageerror', disposeFeatureWorker);
    return worker;
}
export function featureRequest(operation, args, signal, transfer = []) {
    signal.throwIfAborted();
    if (pending.size >= 8)
        return Promise.reject(new Error('Feature request capacity reached'));
    const host = endpoint(), id = ++next;
    return new Promise((resolve, reject) => {
        const abort = () => { const row = pending.get(id); if (!row)
            return; pending.delete(id); row.done(); host.postMessage({ id, abort: true }); reject(signal.reason ?? new Error('Feature request aborted')); };
        const timer = setTimeout(() => { const row = pending.get(id); if (!row)
            return; pending.delete(id); row.done(); host.postMessage({ id, abort: true }); reject(new Error('Feature outcome unconfirmed; retry the same order')); }, 15000);
        pending.set(id, { resolve: value => resolve(value), reject, done() { clearTimeout(timer); signal.removeEventListener('abort', abort); } });
        signal.addEventListener('abort', abort, { once: true });
        try {
            host.postMessage({ id, operation, args }, transfer);
        }
        catch (error) {
            pending.get(id)?.done();
            pending.delete(id);
            reject(error);
        }
    });
}
/** Teardown must not compete with data requests for a credit or reopen a closed worker. */
export function featureControl(operation, args = []) {
    if (!worker || closed)
        return;
    worker.postMessage({ control: operation, args });
}
const gameplayListeners = new Set();
export function watchGameplay(topics, callback) { const fn = (changed, ids) => { if (changed & topics)
    callback(ids); }; gameplayListeners.add(fn); return () => gameplayListeners.delete(fn); }
export function attachGameplayTransport() { const channel = new MessageChannel(); endpoint().postMessage({ control: 'gameplayPort', port: channel.port1 }, [channel.port1]); return channel.port2; }
//# sourceMappingURL=client.js.map