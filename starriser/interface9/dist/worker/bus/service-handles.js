import { requireReady } from './service-client.js';
import { ServiceError } from './service-types.js';
import { checkStream } from './service-validation.js';
export function createServiceHandles(state, declarations, request, publish, send, report) {
    const consumes = {}, provides = {};
    for (const [name, contract] of Object.entries(declarations.consumes ?? {})) {
        consumes[name] = consumer(state, contract, request, send);
    }
    for (const [name, contract] of Object.entries(declarations.provides ?? {})) {
        provides[name] = provider(state, contract, publish, send, report);
    }
    return { consumes, provides };
}
function consumer(state, contract, request, send) {
    if (contract.kind === 'stream')
        return streamHandle(state, contract, send);
    if (contract.kind === 'event')
        return { subscribe: (handler) => install(state, contract.id, handler, false) };
    return { request: (value, options) => request(state, contract, value, options) };
}
function provider(state, contract, publish, send, report) {
    if (contract.kind === 'stream')
        return streamHandle(state, contract, send);
    if (contract.kind !== 'event')
        return { handle: (handler) => install(state, contract.id, handler, true) };
    return { publish(value, options = {}) {
            requireReady(state);
            void publish(state, contract, value, { ...options, maxQueueAgeMs: undefined }).catch(error => report(contract.id, error));
        },
        publishWithBackpressure: (value, options = {}) => publish(state, contract, value, { ...options, maxQueueAgeMs: undefined }),
        publishAndIgnoreAfterTimeout: (value, maxQueueAgeMs, options = {}) => publish(state, contract, value, { ...options, maxQueueAgeMs }),
    };
}
function install(state, id, handler, single) {
    if (state.disposed)
        throw new ServiceError('DISPOSED', 'Service binding disposed');
    let handlers = state.handlers.get(id);
    if (!handlers) {
        handlers = new Set();
        state.handlers.set(id, handlers);
    }
    if (handlers.size >= (single ? 1 : 64))
        throw new ServiceError('OWNERSHIP', 'Service handler capacity exceeded');
    handlers.add(handler);
    return () => { handlers.delete(handler); if (!handlers.size)
        state.handlers.delete(id); };
}
function streamHandle(state, contract, send) {
    return { connect(metadata) {
            requireReady(state);
            const value = checkStream(metadata);
            send({ type: 'stream', binding: state.id, contract: contract.id, value });
            let connected = true;
            return () => {
                if (!connected || state.disposed)
                    return;
                connected = false;
                send({ type: 'stream', binding: state.id, contract: contract.id, value: { id: value.id, disconnect: true } });
            };
        } };
}
//# sourceMappingURL=service-handles.js.map