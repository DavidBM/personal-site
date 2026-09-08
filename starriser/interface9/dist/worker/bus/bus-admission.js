import { isRecord, serializeBusMessage } from './bus-types.js';
const CONTROL = '__bus_admission';
function clock() { return performance.timeOrigin + performance.now(); }
function expired(message) { return message.x !== undefined && clock() >= message.x; }
function post(target, message) { target.postMessage(message); }
function packet(target, value) { post(target, serializeBusMessage(CONTROL, value, 0, 0)); }
function failure(error) { return error instanceof Error ? error : new Error(String(error)); }
/** Reservation messages bypass payload scheduling. The producer retains payload
 * until credit is granted; receiver waiters contain only size/count metadata. */
export function createBusAdmission(reserve, measure, report) {
    const links = new Map();
    let disposed = false;
    function link(target) {
        let value = links.get(target);
        if (!value) {
            value = { next: 0, incoming: new Map(), outgoing: new Map() };
            links.set(target, value);
        }
        return value;
    }
    function releaseIncoming(state, id) {
        const item = state.incoming.get(id);
        if (!item)
            return;
        state.incoming.delete(id);
        clearTimeout(item.timer);
        item.abort.abort();
        item.reservation?.release();
    }
    function settle(state, id, error) {
        const item = state.outgoing.get(id);
        if (!item)
            return;
        state.outgoing.delete(id);
        item.cleanup();
        if (error)
            item.fail(error);
        else if (item.admitted)
            item.admitted();
        else
            item.grant();
    }
    function cancel(target, state, id, error) {
        if (!state.outgoing.has(id))
            return;
        settle(state, id, error);
        try {
            packet(target, { op: 'cancel', id });
        }
        catch (error) {
            report(failure(error));
        }
    }
    function measurement(message) { return { message, size: measure(message) }; }
    function prepare(target, message, signal, known) {
        if (disposed)
            return Promise.reject(new Error('Bus destroyed'));
        if (signal?.aborted)
            return Promise.reject(failure(signal.reason));
        if (expired(message))
            return Promise.resolve(undefined);
        const state = link(target), id = ++state.next;
        return new Promise((resolve, reject) => {
            if (known && known.message !== message)
                throw new Error('Bus measurement does not match its message');
            const size = known?.size ?? measure(message);
            const abort = () => {
                if (!state.outgoing.get(id)?.sent)
                    cancel(target, state, id, failure(signal?.reason ?? new Error('Bus admission canceled')));
            };
            const timer = message.x === undefined ? undefined : setTimeout(() => {
                if (!state.outgoing.get(id)?.sent)
                    cancel(target, state, id);
            }, Math.max(0, message.x - clock()));
            state.outgoing.set(id, { message, size, grant: resolve, fail: reject, sent: false,
                cleanup() { clearTimeout(timer); signal?.removeEventListener('abort', abort); } });
            signal?.addEventListener('abort', abort, { once: true });
            try {
                packet(target, { op: 'reserve', id, ...size, expiresAt: message.x });
            }
            catch (error) {
                settle(state, id, failure(error));
            }
        });
    }
    function lease(target, state, id) {
        const deadline = state.outgoing.get(id)?.message.x;
        return {
            send(verified) {
                const item = state.outgoing.get(id);
                if (!item && deadline !== undefined && clock() >= deadline)
                    return Promise.resolve();
                if (!item)
                    return Promise.reject(new Error('Bus reservation is unavailable'));
                if (item.sent)
                    return Promise.reject(new Error('Bus reservation already sent'));
                item.sent = true;
                return new Promise((resolve, reject) => {
                    item.admitted = resolve;
                    item.fail = reject;
                    try {
                        if (verified && verified.message !== item.message)
                            throw new Error('Bus measurement does not match its message');
                        const current = verified?.size ?? measure(item.message);
                        if ((current.bytes ?? 0) > (item.size.bytes ?? 0))
                            throw new Error('Bus payload grew while waiting for admission');
                        post(target, { ...item.message, k: item.size.bytes, q: id });
                        // Once posted, cancellation cannot prove that the receiver has not
                        // started. Retain transport/semantic credit until its admission ACK.
                        item.cleanup();
                    }
                    catch (error) {
                        cancel(target, state, id, failure(error));
                    }
                });
            },
            cancel(reason = 'Bus reservation canceled') {
                if (state.outgoing.has(id) && !state.outgoing.get(id).sent)
                    cancel(target, state, id, new Error(reason));
                else {
                    try {
                        packet(target, { op: 'cancel', id });
                    }
                    catch (error) {
                        report(failure(error));
                    }
                }
            },
        };
    }
    async function requested(target, state, value) {
        if (state.incoming.has(value.id))
            throw new Error('Duplicate Bus reservation');
        const item = { abort: new AbortController(), type: value.type };
        state.incoming.set(value.id, item);
        if (value.expiresAt !== undefined)
            item.timer = setTimeout(() => {
                releaseIncoming(state, value.id);
                packet(target, { op: 'expired', id: value.id });
            }, Math.max(0, value.expiresAt - clock()));
        try {
            const credit = await reserve({ bytes: value.bytes, control: value.control === true, type: value.type }, item.abort.signal);
            if (state.incoming.get(value.id) !== item) {
                credit.release();
                return;
            }
            item.reservation = credit;
            packet(target, { op: 'grant', id: value.id });
        }
        catch (error) {
            if (!state.incoming.has(value.id))
                return;
            releaseIncoming(state, value.id);
            packet(target, { op: 'failure', id: value.id, error: failure(error).message });
        }
    }
    function control(target, state, value) {
        switch (value.op) {
            case 'reserve': return requested(target, state, value);
            case 'grant':
                state.outgoing.get(value.id)?.grant(lease(target, state, value.id));
                return;
            case 'admitted':
                settle(state, value.id);
                return;
            case 'expired':
                settle(state, value.id);
                return;
            case 'failure':
                settle(state, value.id, new Error(value.error ?? 'Bus admission failed'));
                return;
            case 'cancel':
                releaseIncoming(state, value.id);
                return;
        }
    }
    async function receive(target, message, deliver) {
        if (disposed)
            return;
        const state = link(target);
        if (message.t === CONTROL) {
            await control(target, state, validatePacket(message.d));
            return;
        }
        if (message.q === undefined) {
            await deliver(message);
            return;
        }
        const item = state.incoming.get(message.q);
        if (!item?.reservation) {
            packet(target, { op: 'failure', id: message.q, error: 'Bus reservation unavailable' });
            return;
        }
        const credit = item.reservation;
        const keepRequest = message.t === 'publish' && message.e === 1;
        if (!keepRequest) {
            state.incoming.delete(message.q);
            clearTimeout(item.timer);
        }
        if (rejectPayload(target, state, message, credit, item.type))
            return;
        item.reservation = undefined;
        try {
            await deliver(message, credit);
            packet(target, { op: 'admitted', id: message.q });
        }
        catch (error) {
            credit.release();
            releaseIncoming(state, message.q);
            packet(target, { op: 'failure', id: message.q, error: failure(error).message });
        }
    }
    function rejectPayload(target, state, message, credit, type) {
        const elapsed = expired(message);
        if (!elapsed && type === message.t)
            return false;
        credit.release();
        releaseIncoming(state, message.q);
        packet(target, { op: elapsed ? 'expired' : 'failure', id: message.q, error: 'Bus reservation type mismatch' });
        return true;
    }
    function disconnect(target) {
        const state = links.get(target);
        if (!state)
            return;
        for (const id of state.outgoing.keys())
            cancel(target, state, id, new Error('Bus endpoint disconnected'));
        for (const id of state.incoming.keys()) {
            try {
                packet(target, { op: 'failure', id, error: 'Bus endpoint disconnected' });
            }
            catch { /* The endpoint is already unavailable. */ }
            releaseIncoming(state, id);
        }
        links.delete(target);
    }
    return { prepare, measurement, disconnect,
        requestSignal(target, id) {
            return links.get(target)?.incoming.get(id)?.abort.signal ?? AbortSignal.abort(new Error('Publication canceled'));
        },
        finishRequest(target, id) { const state = links.get(target); if (state)
            releaseIncoming(state, id); },
        async send(target, message, signal) {
            const reservation = await prepare(target, message, signal);
            if (reservation)
                await reservation.send();
        },
        receive(target, message, deliver) {
            void receive(target, message, deliver).catch(error => report(failure(error)));
        },
        dispose() { disposed = true; for (const target of links.keys())
            disconnect(target); }, };
}
function validatePacket(value) {
    if (!isRecord(value) || !Number.isSafeInteger(value.id) || Number(value.id) < 1)
        throw new Error('Invalid Bus admission ID');
    if (!['reserve', 'grant', 'admitted', 'cancel', 'failure', 'expired'].includes(String(value.op)))
        throw new Error('Invalid Bus admission operation');
    if (value.expiresAt !== undefined && (typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt)))
        throw new Error('Invalid Bus expiry');
    return value;
}
//# sourceMappingURL=bus-admission.js.map