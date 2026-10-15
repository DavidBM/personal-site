import { notifyObserver } from '../../lib/notify-observer.js';
/** One authenticated worker port. A missing/closed connection never selects HTTP
 * or the sandbox. A lost reply leaves the command outcome unconfirmed. */
import { GameplayOperation as Op } from '../../contracts/gameplay.js';
export const GAMEPLAY_TOPICS = { journeys: 1, battles: 2, encounters: 4, development: 8, industry: 16, planets: 32, all: 63 };
let port, ready = false, next = 0;
const pending = new Map(), listeners = new Set();
export function onGameplayChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
export function attachLiveGameplay(value, publish) {
    close();
    port = value;
    value.onmessage = ({ data }) => {
        if (port !== value)
            return;
        if (data.kind === 'ready') {
            ready = true;
            for (const row of pending.values()) {
                row.send?.();
                row.send = undefined;
            }
            return;
        }
        if (data.kind === 'closed' || data.kind === 'barrier') {
            rejectPending();
            ready = data.kind !== 'closed';
            if (!ready) {
                port = undefined;
                value.close();
            }
            return;
        }
        if (data.kind === 'changed') {
            for (const fn of listeners)
                notifyObserver('gameplay worker', () => fn(data.topics, data.fleetIds ?? []));
            publish(data.topics, data.fleetIds ?? []);
            return;
        }
        if (data.kind !== 'reply')
            return;
        const row = pending.get(data.id);
        if (!row)
            return;
        pending.delete(data.id);
        row.done();
        if (data.error) {
            row.reject(new Error(data.error));
            return;
        }
        row.resolve({ status: data.status, visibilityEpoch: data.epoch, payload: data.payload });
    };
    value.start();
}
function rejectPending() {
    for (const row of pending.values()) {
        row.done();
        row.reject(new Error('Gameplay connection changed; outcome unconfirmed. Retry the same order.'));
    }
    pending.clear();
}
function close() { ready = false; port?.close(); rejectPending(); }
const send = async (operation, body, signal) => {
    signal.throwIfAborted();
    if (!port)
        throw new Error('Live gameplay connection is not attached');
    if (pending.size >= 8)
        throw new Error('Gameplay request capacity reached');
    const payload = new TextEncoder().encode(body);
    if (!payload.length || payload.length > 4096)
        throw new Error('Gameplay request exceeds 4 KiB');
    const id = ++next, owner = port;
    return new Promise((resolve, reject) => {
        const abort = () => { const row = pending.get(id); if (!row)
            return; pending.delete(id); row.done(); owner.postMessage({ kind: 'cancel', id }); reject(new Error('Gameplay request aborted; outcome unconfirmed')); };
        const timer = setTimeout(abort, 15000);
        pending.set(id, { resolve, reject, done() { clearTimeout(timer); signal.removeEventListener('abort', abort); } });
        signal.addEventListener('abort', abort, { once: true });
        const dispatch = () => { try {
            owner.postMessage({ kind: 'request', id, operation, payload }, payload.length >= 1024 ? [payload.buffer] : []);
        }
        catch {
            abort();
        } };
        if (ready)
            dispatch();
        else
            pending.get(id).send = dispatch;
    });
};
/** Repair transient read rejection a bounded number of times; controllers own
 * mutation identity and recovery. Idle connections never issue feature reads. */
export const callGameplay = async (operation, body, signal) => {
    const owner = port, retry = readOnly(operation, body);
    for (let attempt = 0;; attempt++) {
        const response = await send(operation, body, signal);
        if (!retry || response.status !== 503 || attempt >= 2 || port !== owner)
            return response;
        await delay(250 * 4 ** attempt, signal);
        if (port !== owner)
            throw new Error('Gameplay connection changed during read recovery');
    }
};
function readOnly(operation, body) {
    if ([Op.FLEET_STATUS, Op.SURVEY, Op.INCOMING, Op.ROUTE_PREVIEW, Op.JOURNEY_PATH, Op.TESTER_OWNERS].includes(operation))
        return true;
    try {
        const value = JSON.parse(body);
        const action = operation === Op.DEVELOPMENT ? value.operation?.action : value.action;
        return action === 'read' || action === 'list' || action === 'lookup';
    }
    catch {
        return false;
    }
}
function delay(ms, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new Error('Gameplay read recovery aborted')); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
        signal.addEventListener('abort', abort, { once: true });
    });
}
//# sourceMappingURL=live.js.map