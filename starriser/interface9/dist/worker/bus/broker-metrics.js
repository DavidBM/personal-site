import { isRecord } from './bus-types.js';
import { BROKER_METRICS, BROKER_METRICS_INTERVAL_MS, BROKER_METRICS_LEASE_MS } from './broker-metrics-types.js';
const counts = () => ({ dispatched: 0, publications: 0, fanoutTargets: 0 });
/** One leased observer. Disabled has no timer, payload capture or counter updates. */
export function createBrokerMetrics(bus, topology) {
    let session = '', sequence = 0, outstanding = 0, lastAck = 0, previousAt = 0;
    let totals = counts(), previous = counts(), peak = 0, coalesced = 0;
    let failureBase = 0, expiredBase = 0, disposed = false;
    let timer;
    const dispatched = () => { totals.dispatched++; };
    function stop() {
        clearInterval(timer);
        timer = undefined;
        session = '';
        outstanding = 0;
        bus._metricsDispatched = undefined;
    }
    function enable(id) {
        stop();
        session = id;
        totals = counts();
        previous = counts();
        sequence = peak = coalesced = 0;
        previousAt = lastAck = performance.now();
        const diagnostics = bus.getDiagnostics();
        failureBase = diagnostics.failures;
        expiredBase = diagnostics.expiredMessages;
        bus._metricsDispatched = dispatched;
        timer = setInterval(report, BROKER_METRICS_INTERVAL_MS);
    }
    function receive(event) {
        const value = event.data;
        if (!validControl(value) || disposed)
            return;
        if (value.op === 'enable') {
            enable(value.session);
            return;
        }
        if (value.session !== session)
            return;
        if (value.op === 'disable') {
            stop();
            return;
        }
        if (value.op === 'ack' && outstanding > 0 && value.sequence === outstanding) {
            outstanding = 0;
            lastAck = performance.now();
        }
    }
    function snapshot(now) {
        const info = bus.getDiagnostics(), elapsedMs = Math.max(1, now - previousAt);
        peak = Math.max(peak, info.queuedMessages);
        const rate = (key) => (totals[key] - previous[key]) * 1000 / elapsedMs;
        const result = { sequence: ++sequence, sampledAtMs: now, elapsedMs, ...totals,
            dispatchedPerSecond: rate('dispatched'), publicationsPerSecond: rate('publications'), fanoutPerSecond: rate('fanoutTargets'),
            queued: info.queuedMessages, active: info.activeMessages,
            reserved: Math.max(0, info.pendingMessages + info.controlMessages - info.queuedMessages - info.activeMessages),
            ordinaryOccupancy: info.pendingMessages, controlOccupancy: info.controlMessages,
            waitingAdmissions: info.waitingAdmissions, chargedBytes: info.knownBytes + info.controlKnownBytes,
            queuePeakSampled: peak, failures: info.failures - failureBase, expired: info.expiredMessages - expiredBase,
            coalescedSamples: coalesced, ...topology() };
        previous = { ...totals };
        previousAt = now;
        return result;
    }
    function report() {
        const now = performance.now();
        if (now - lastAck >= BROKER_METRICS_LEASE_MS) {
            stop();
            return;
        }
        if (outstanding) {
            coalesced++;
            return;
        }
        const value = { kind: BROKER_METRICS, session, op: 'sample', snapshot: snapshot(now) };
        outstanding = value.snapshot.sequence;
        try {
            bus._target.postMessage(value);
        }
        catch {
            stop();
        }
    }
    function dispose() {
        if (disposed)
            return;
        disposed = true;
        stop();
        bus._target.removeEventListener('message', receive);
        bus.signal.removeEventListener('abort', dispose);
    }
    bus._target.addEventListener('message', receive);
    bus.signal.addEventListener('abort', dispose, { once: true });
    return { dispose,
        publication() { if (session)
            totals.publications++; },
        fanout(targets) { if (session)
            totals.fanoutTargets += targets?.size ?? 0; },
    };
}
function validControl(value) {
    return isRecord(value) && value.kind === BROKER_METRICS && typeof value.session === 'string'
        && value.session.length > 0 && value.session.length <= 64
        && (value.op === 'enable' || value.op === 'disable' || value.op === 'ack');
}
//# sourceMappingURL=broker-metrics.js.map