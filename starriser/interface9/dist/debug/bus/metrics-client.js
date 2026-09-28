import { BROKER_METRICS, BROKER_METRICS_LEASE_MS } from '../../worker/bus/broker-metrics-types.js';
/** Raw diagnostics never enter the admitted gameplay queues or count themselves. */
export function createBrokerMetricsClient(bus, changed, status) {
    let target = null, session = '', disposed = false;
    let deadline;
    function post(op, sequence) {
        target?.postMessage({ kind: BROKER_METRICS, session, op, sequence });
    }
    function disconnect() {
        clearTimeout(deadline);
        try {
            post('disable');
        }
        catch { /* A disappeared broker owns no live reporter. */ }
        target?.removeEventListener('message', receive);
        target = null;
        session = '';
    }
    function watch() {
        clearTimeout(deadline);
        deadline = setTimeout(() => { disconnect(); status('unavailable'); }, BROKER_METRICS_LEASE_MS);
    }
    function receive(event) {
        const value = event.data;
        if (value?.kind !== BROKER_METRICS || value.op !== 'sample' || value.session !== session)
            return;
        // The report is produced by our own broker, over its existing dedicated endpoint.
        try {
            changed(value.snapshot);
            status('live');
            post('ack', value.snapshot.sequence);
            watch();
        }
        catch {
            disconnect();
            status('unavailable');
        }
    }
    function setEnabled(enabled) {
        disconnect();
        if (disposed)
            return;
        if (!enabled) {
            status('disabled');
            return;
        }
        if (!bus.isPubSubReady() || !bus._brokerBus) {
            status('unavailable');
            return;
        }
        target = bus._brokerBus._target;
        session = crypto.randomUUID();
        target.addEventListener('message', receive);
        try {
            post('enable');
            status('waiting');
            watch();
        }
        catch {
            disconnect();
            status('unavailable');
        }
    }
    function dispose() {
        if (disposed)
            return;
        disposed = true;
        disconnect();
        bus.signal.removeEventListener('abort', dispose);
    }
    bus.signal.addEventListener('abort', dispose, { once: true });
    return { setEnabled, dispose };
}
//# sourceMappingURL=metrics-client.js.map