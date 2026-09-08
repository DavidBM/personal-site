/** Standalone worker shell; all game decisions are compiled shared Rust rules. */
import { loadSharedRules } from '../shared-rules.js';
import { changeBuffers, createDomainHost } from './host.js';
import { routePreviewBuffers } from './routes.js';
const scope = self;
let host = null;
let busy = false;
let closed = false;
let initialized = false;
const errorText = (error) => error instanceof Error ? error.message : String(error);
function send(message, transfer = []) {
    if (!closed)
        scope.postMessage(message, transfer);
}
async function initialize(message) {
    if (initialized)
        throw new Error('Domain worker already initialized');
    initialized = true;
    if (message.mode !== 'offline' && message.mode !== 'online-preview')
        throw new Error('Invalid domain authority mode');
    const rules = await loadSharedRules({ moduleUrl: new URL(message.moduleUrl), wasmUrl: new URL(message.wasmUrl) });
    if (closed)
        return;
    host = createDomainHost(rules, message.mode, change => send({ type: 'accepted', change }, changeBuffers(change)));
    send({ type: 'ready', status: host.status() });
}
function resultBuffers(result) {
    if ('kind' in result && result.kind === 'preview' && result.proposal)
        return changeBuffers(result.proposal);
    if ('kind' in result && result.kind === 'route-preview')
        return routePreviewBuffers(result);
    return [];
}
function dispose() {
    if (closed)
        return;
    host?.dispose();
    host = null;
    send({ type: 'disposed' });
    closed = true;
    scope.close();
}
async function receive(message) {
    if (closed)
        return;
    if (busy) {
        send({ type: 'failure', id: 'id' in message ? message.id : undefined, message: 'Domain worker already has one request in flight' });
        return;
    }
    busy = true;
    try {
        if (message.type === 'initialize') {
            await initialize(message);
            return;
        }
        if (!host)
            throw new Error('Domain worker is not ready');
        const result = host.request(message.request);
        send({ type: 'result', id: message.id, result }, resultBuffers(result));
    }
    catch (error) {
        send({ type: 'failure', id: 'id' in message ? message.id : undefined, message: errorText(error) });
    }
    finally {
        busy = false;
    }
}
scope.onmessage = ({ data }) => {
    if (data.type === 'dispose')
        dispose();
    else
        void receive(data);
};
scope.onmessageerror = () => dispose();
//# sourceMappingURL=worker-entry.js.map