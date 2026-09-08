import { ServiceError } from '../worker/bus/service-types.js';
import { StrategicServices } from '../network/strategic-services.js';
/** Optional registration: readiness or request failure never disposes ShipOrders. */
export function createStrategicClient(bus, scope, generation, changed) {
    try {
        return bindClient(bus, scope, generation, changed);
    }
    catch {
        const unavailable = async () => { throw new ServiceError('DISPOSED', 'System overview is unavailable'); };
        return { replace: (_value) => unavailable(), query: () => unavailable(), dispose: async () => { } };
    }
}
function bindClient(bus, scope, generation, changed) {
    const lifetime = new AbortController();
    const binding = bus.bind({ service: 'strategic', instance: 'main', scope, source: 'js/main/strategic-client.ts' }, {
        consumes: { replace: StrategicServices.replace, query: StrategicServices.query }, provides: { refresh: StrategicServices.refresh },
    });
    binding.provides.refresh.handle(value => {
        if (!lifetime.signal.aborted && value.connectionGeneration === generation)
            changed(value);
    });
    // Main registers before launching the network worker. Readiness is requested
    // only after that worker exists, on the first actual overview operation.
    let readiness;
    function ready() {
        return readiness ?? (readiness = binding.ready().catch(error => { readiness = undefined; throw error; }));
    }
    return {
        async replace(value) {
            await ready();
            await binding.consumes.replace.request(value, { signal: lifetime.signal, timeoutMs: 3000 });
        },
        async query() { await ready(); return binding.consumes.query.request(undefined, { signal: lifetime.signal, timeoutMs: 3000 }); },
        dispose() { lifetime.abort(); return binding.dispose(); },
    };
}
//# sourceMappingURL=strategic-client.js.map