import { ServiceError } from './service-types.js';
import { contextCopy, identityCopy, knownBytes, metadata, waitTimeout } from './service-validation.js';
import { createServiceHandles } from './service-handles.js';
import { createBusCapacity } from './bus-capacity.js';
import { estimateBusPayloadBytes } from './bus-payload-size.js';
import { eventDeadline, eventQueueLifetime, serviceQueueClock } from './service-event-admission.js';
export function createServiceClient(bus) {
    const bindings = new Map(), waiting = new Map();
    let nextBinding = 0, nextRequest = 0, disposed = false, waitingBytes = 0;
    const maxWaitingBytes = bus._options.maxQueuedBytes ?? 16 * 1024 * 1024;
    const eventCapacity = createBusCapacity({ maxQueuedMessages: 1024, maxQueuedBytes: maxWaitingBytes });
    function send(packet, priority = 1, signal) {
        return bus._sendServicePacket(packet, priority, packet.stream ? `${packet.binding}:${packet.stream}` : undefined, signal);
    }
    function wait(packet, options = {}, state) {
        if (disposed || state?.disposed)
            return Promise.reject(new ServiceError('DISPOSED', 'Service binding is disposed'));
        if (options.signal?.aborted)
            return Promise.reject(new ServiceError('CANCELED', 'Waiting canceled; accepted work is not rolled back'));
        const capacityError = waitCapacityError(packet);
        if (capacityError)
            return Promise.reject(capacityError);
        const timeoutMs = packet.type === 'publish' ? undefined : waitTimeout(options.timeoutMs), request = ++nextRequest;
        return new Promise((resolve, reject) => {
            let transport = Promise.resolve();
            const settle = (value, failure) => {
                if (failure)
                    reject(new ServiceError(failure.code, failure.message));
                else
                    resolve(value);
            };
            const finish = (value, failure) => {
                if (!waiting.delete(request))
                    return;
                waitingBytes -= packet.bytes ?? 0;
                clearTimeout(timer);
                options.signal?.removeEventListener('abort', canceled);
                if (state)
                    state.pending--;
                // Canceled event producers retain their allowance until transport has
                // released its payload reference and any outstanding reservation.
                if (packet.type === 'publish')
                    void transport.then(() => settle(value, failure), () => settle(value, failure));
                else
                    settle(value, failure);
            };
            const canceled = () => finish(undefined, { code: 'CANCELED', message: 'Waiting canceled; accepted work is not rolled back' });
            const timer = timeoutMs === undefined ? undefined : setTimeout(() => finish(undefined, { code: 'TIMEOUT', message: 'Outcome unknown; resolve the original command identity' }), timeoutMs);
            waiting.set(request, { binding: packet.binding, settle: finish });
            waitingBytes += packet.bytes ?? 0;
            if (state)
                state.pending++;
            options.signal?.addEventListener('abort', canceled, { once: true });
            try {
                transport = send({ ...packet, request }, options.priority, packet.type === 'publish' ? options.signal : undefined);
                void transport.catch(error => finish(undefined, { code: 'TRANSPORT', message: String(error) }));
            }
            catch (error) {
                finish(undefined, { code: 'TRANSPORT', message: String(error) });
            }
        });
    }
    function waitCapacityError(packet) {
        if (packet.type === 'publish')
            return; // Event admission was reserved by publish().
        if (waiting.size >= 1024)
            return new ServiceError('OVERLOADED', 'Service wait capacity exceeded');
        if (waitingBytes + (packet.bytes ?? 0) > maxWaitingBytes)
            return new ServiceError('OVERLOADED', 'Service wait byte capacity exceeded');
    }
    function bind(identity, declarations) {
        if (disposed)
            throw new ServiceError('DISPOSED', 'Bus service lifetime ended');
        if (bindings.size >= 128)
            throw new ServiceError('OVERLOADED', 'Local service binding capacity exceeded');
        const provides = declarations.provides ?? {}, consumes = declarations.consumes ?? {};
        if (Object.keys(provides).length + Object.keys(consumes).length > 64)
            throw new Error('Too many binding contracts');
        const state = { id: `binding-${++nextBinding}`, identity: identityCopy(identity), ready: false, disposed: false,
            lifetime: new AbortController(), handlers: new Map(), registered: Promise.resolve(), pending: 0,
            received: 0, completed: 0, failures: 0, handlerMs: 0 };
        const declaration = { id: state.id, identity: state.identity,
            consumes: Object.values(consumes).map(metadata), provides: Object.values(provides).map(metadata) };
        bindings.set(state.id, state);
        state.registered = wait({ type: 'register', binding: state.id, declaration }, {}, state).then(() => { });
        void state.registered.catch(() => { });
        const handles = createServiceHandles(state, declarations, request, publish, send, (contract, error) => {
            state.failures++;
            bus._reportFailure({ code: 'HANDLER_ERROR', type: contract, message: error instanceof Error ? error.message : String(error) });
        });
        return { ...handles, registered: state.registered, ready: () => ready(state, provides), dispose: () => remove(state), inspect: () => inspect(state) };
    }
    async function ready(state, provides) {
        await state.registered;
        for (const contract of Object.values(provides)) {
            if ((contract.kind === 'command' || contract.kind === 'query') && state.handlers.get(contract.id)?.size !== 1) {
                throw new ServiceError('OWNERSHIP', `Install one handler for ${contract.id} before readiness`);
            }
        }
        await wait({ type: 'ready', binding: state.id }, {}, state);
        if (state.disposed || disposed)
            throw new ServiceError('DISPOSED', 'Service binding was disposed during readiness');
        state.ready = true;
    }
    function request(state, contract, value, options = {}) {
        requireReady(state);
        if (state.pending >= contract.capacity)
            return Promise.reject(new ServiceError('OVERLOADED', 'Binding request capacity exceeded'));
        const packet = { type: 'request', binding: state.id, contract: contract.id, value,
            context: contextCopy(options.context), stream: contract.ordered, bytes: knownBytes(contract, value) };
        return wait(packet, { ...options, priority: options.priority ?? contract.priority }, state);
    }
    async function publish(state, contract, value, options) {
        requireReady(state);
        const expiresAt = eventDeadline(options.maxQueueAgeMs);
        const packet = { type: 'publish', binding: state.id, contract: contract.id, value,
            context: contextCopy(options.context), stream: contract.ordered, bytes: knownBytes(contract, value), expiresAt };
        const signals = options.signal ? [state.lifetime.signal, options.signal] : [state.lifetime.signal];
        const scope = eventQueueLifetime(signals, expiresAt);
        let permit;
        try {
            permit = await eventCapacity.reserve({ bytes: estimateBusPayloadBytes(packet, maxWaitingBytes), control: false }, scope.signal);
            permit.claim();
            await wait(packet, { signal: scope.signal, priority: options.priority ?? contract.priority }, state);
        }
        catch (error) {
            const reason = scope.signal.aborted ? scope.signal.reason : error;
            throwEventFailure(reason, state, options.signal);
        }
        finally {
            permit?.release();
            scope.close();
        }
    }
    function inspect(state) {
        return { identity: { ...state.identity }, ready: state.ready, disposed: state.disposed, pending: state.pending,
            received: state.received, completed: state.completed, failures: state.failures, handlerMs: state.handlerMs };
    }
    function remove(state) {
        if (state.disposal)
            return state.disposal;
        state.disposed = true;
        state.ready = false;
        state.lifetime.abort();
        state.handlers.clear();
        for (const entry of waiting.values())
            if (entry.binding === state.id)
                entry.settle(undefined, { code: 'DISPOSED', message: 'Service binding disposed' });
        bindings.delete(state.id);
        state.disposal = disposed || bus.isDestroyed() ? Promise.resolve()
            : wait({ type: 'remove', binding: state.id }).then(() => { });
        void state.disposal.catch(() => { });
        return state.disposal;
    }
    function receive(packet) {
        if (packet.type === 'result') {
            receiveResult(packet);
            return;
        }
        const state = bindings.get(packet.binding);
        if (!state || state.disposed) {
            failure(packet, { code: 'DISPOSED', message: 'Service binding is unavailable' });
            return;
        }
        return invoke(state, packet);
    }
    function receiveResult(packet) {
        const entry = packet.request === undefined ? undefined : waiting.get(packet.request);
        if (entry && entry.binding === packet.binding) {
            entry.settle(packet.value, packet.failure);
            return;
        }
        if (packet.request === undefined && packet.failure) {
            const state = bindings.get(packet.binding);
            if (state)
                state.failures++;
            bus._reportFailure({ code: 'HANDLER_ERROR', type: packet.contract, message: packet.failure.message });
        }
    }
    async function invoke(state, packet) {
        state.received++;
        const started = performance.now();
        try {
            if (packet.type === 'event' && packet.expiresAt !== undefined && serviceQueueClock() >= packet.expiresAt) {
                send({ type: 'reply', binding: state.id, route: packet.route });
                return;
            }
            const value = await executeHandlers(state, packet);
            state.completed++;
            if (!state.disposed)
                send({ type: 'reply', binding: state.id, route: packet.route, value });
        }
        catch (error) {
            state.failures++;
            if (!state.disposed)
                failure(packet, { code: 'HANDLER_ERROR', message: (error instanceof Error ? error.message : String(error)).slice(0, 512) });
        }
        finally {
            state.handlerMs += performance.now() - started;
        }
    }
    function failure(packet, error) {
        if (!disposed)
            send({ type: 'reply', binding: packet.binding, route: packet.route, failure: error });
    }
    function dispose() {
        disposed = true;
        eventCapacity.dispose();
        for (const state of bindings.values())
            remove(state);
        for (const entry of waiting.values())
            entry.settle(undefined, { code: 'DISPOSED', message: 'Bus service lifetime ended' });
        bus.signal.removeEventListener('abort', dispose);
    }
    bus.signal.addEventListener('abort', dispose, { once: true });
    return { bind, receive, failure, dispose,
        graph: () => wait({ type: 'inspect', binding: '' }),
        trace: (value) => wait({ type: 'trace', binding: '', value }).then(() => { }),
    };
}
function throwEventFailure(reason, state, signal) {
    if (reason instanceof ServiceError && reason.code === 'EXPIRED')
        return;
    if (state.disposed)
        throw new ServiceError('DISPOSED', 'Service binding was disposed');
    if (signal?.aborted)
        throw new ServiceError('CANCELED', 'Waiting canceled; accepted work is not rolled back');
    throw reason;
}
async function executeHandlers(state, packet) {
    const handlers = state.handlers.get(packet.contract);
    const context = { causal: packet.context, signal: state.lifetime.signal };
    if (packet.type === 'invoke') {
        if (handlers?.size !== 1)
            throw new ServiceError('OWNERSHIP', 'Service owner handler is unavailable');
        return handlers.values().next().value(packet.value, context);
    }
    const outcomes = await Promise.allSettled(Array.from(handlers ?? [], handler => Promise.resolve().then(() => handler(packet.value, context)).then(() => undefined)));
    const failed = outcomes.find(value => value.status === 'rejected');
    if (failed?.status === 'rejected')
        throw failed.reason;
}
export function requireReady(state) {
    if (state.disposed)
        throw new ServiceError('DISPOSED', 'Service binding is disposed');
    if (!state.ready)
        throw new ServiceError('NOT_READY', 'Await service binding readiness');
}
//# sourceMappingURL=service-client.js.map