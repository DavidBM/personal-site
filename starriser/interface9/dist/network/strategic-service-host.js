import { StrategicServices } from './strategic-services.js';
import { createStrategicNotifier } from './strategic-notifier.js';
export function createStrategicService(bus, scope, session) {
    const binding = bus.bind({ service: 'strategic', instance: 'network', scope, source: 'js/network/strategic-service-host.ts' }, {
        provides: { replace: StrategicServices.replace, query: StrategicServices.query }, consumes: { refresh: StrategicServices.refresh },
    });
    binding.provides.replace.handle(value => session().replaceStrategic(value));
    binding.provides.query.handle(() => session().strategicSnapshot());
    let readiness;
    function ready() {
        return readiness ?? (readiness = binding.ready().catch(error => { readiness = undefined; throw error; }));
    }
    void ready().catch(() => { });
    const notifier = createStrategicNotifier(async (value, signal) => {
        await ready();
        await binding.consumes.refresh.request(value, { signal, timeoutMs: 3000 });
    });
    return { notify: notifier.notify, dispose() { notifier.dispose(); return binding.dispose(); } };
}
//# sourceMappingURL=strategic-service-host.js.map