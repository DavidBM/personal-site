import { bindText, setText } from './dom-bindings.js';
import { createBrokerMetricsClient } from '../debug/bus/metrics-client.js';
const ROWS = [
    ['dispatched', 'Messages / s', 'Broker envelopes dispatched, excluding admission protocol and this telemetry.'],
    ['publications', 'Publishes / s', 'Publication attempts from main and workers.'],
    ['fanout', 'Fanout targets / s', 'Pub/sub recipient targets selected for routing; not handler completions.'],
    ['queued', 'Queued · peak', 'Ready and ordered waiting messages; peak is sampled at 200 ms.'],
    ['active', 'Active · reserved', 'Handlers running or awaiting async work; reserved credit not yet queued.'],
    ['waiting', 'Credit waiters', 'Admission requests waiting for queue capacity.'],
    ['bytes', 'Charged memory', 'Conservative payload accounting, including active work and reservations. Not native IPC or process memory.'],
    ['occupancy', 'Ordinary · control', 'Occupied admission slots, including reserved, queued and active work.'],
    ['totals', 'Messages · publishes', 'Totals since this observation was enabled.'],
    ['failures', 'Errors · expired', 'Bus failures and dispatcher age expirations since enabled; not all producer-side cancellations.'],
    ['topology', 'Workers · topics', 'Connected endpoints including main; active pub/sub topics.'],
    ['subscriptions', 'Subscriptions', 'Total endpoint/topic subscription pairs.'],
    ['services', 'Service work · bindings', 'Accepted service deliveries awaiting owner completion, and registered live bindings. Work can outlive the broker handler.'],
    ['streams', 'Direct streams', 'Registered direct-port streams. Their traffic and queues bypass this broker monitor.'],
    ['coalesced', 'Coalesced samples', '200 ms reporting ticks skipped while the previous report awaited acknowledgement.'],
];
/** Mount in an existing UI-owned panel; the owner disposes it on mode/app teardown. */
export function mountBusMetricsPanel(bus, parent) {
    const element = document.createElement('section');
    element.dataset.busMetrics = '';
    Object.assign(element.style, { fontSize: '9px', lineHeight: '1.25', marginTop: '6px', paddingTop: '5px',
        borderTop: '1px solid rgba(100,140,180,.2)' });
    const label = document.createElement('label'), checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.setAttribute('aria-label', 'Bus metrics');
    label.append(checkbox, ' Bus metrics');
    element.append(label);
    const state = document.createElement('span');
    state.dataset.metricsStatus = '';
    state.style.opacity = '.65';
    state.style.marginLeft = '6px';
    element.append(state);
    const body = document.createElement('div');
    body.hidden = true;
    element.append(body);
    const values = new Map();
    for (const [key, name, title] of ROWS) {
        const row = document.createElement('div');
        row.dataset.metric = key;
        Object.assign(row.style, { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 12ch', gap: '8px', height: '14px', overflow: 'hidden', contain: 'layout paint' });
        row.title = title;
        const heading = document.createElement('span'), value = document.createElement('span');
        heading.style.cssText = 'overflow:hidden;white-space:nowrap;text-overflow:ellipsis';
        value.style.cssText = 'text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums';
        heading.textContent = name;
        value.textContent = '—';
        values.set(key, bindText(value, { height: '14px' }));
        row.append(heading, value);
        body.append(row);
    }
    const note = document.createElement('div');
    note.textContent = 'Broker only · 200 ms · native port queue unavailable';
    note.style.opacity = '.55';
    note.style.marginTop = '4px';
    body.append(note);
    const stateText = bindText(state, { width: '16ch' });
    const client = createBrokerMetricsClient(bus, snapshot => {
        for (const [key, value] of Object.entries(formatBrokerMetrics(snapshot)))
            setText(values.get(key), value);
    }, status => {
        setText(stateText, status === 'live' ? 'live · 5 Hz' : status);
        body.hidden = status === 'disabled';
        if (status === 'unavailable')
            checkbox.checked = false;
    });
    function setEnabled(enabled) { checkbox.checked = enabled; client.setEnabled(enabled); }
    checkbox.addEventListener('change', () => setEnabled(checkbox.checked));
    parent.append(element);
    setText(stateText, 'disabled');
    return { element, setEnabled, dispose() { client.dispose(); element.remove(); } };
}
export function formatBrokerMetrics(value) {
    const n = (number) => Math.round(number).toLocaleString();
    return { dispatched: n(value.dispatchedPerSecond), publications: n(value.publicationsPerSecond), fanout: n(value.fanoutPerSecond),
        queued: `${n(value.queued)} · ${n(value.queuePeakSampled)}`, active: `${n(value.active)} · ${n(value.reserved)}`,
        waiting: n(value.waitingAdmissions), bytes: `${(value.chargedBytes / 1024).toFixed(1)} KiB`,
        occupancy: `${n(value.ordinaryOccupancy)} · ${n(value.controlOccupancy)}`, totals: `${n(value.dispatched)} · ${n(value.publications)}`,
        failures: `${n(value.failures)} · ${n(value.expired)}`, topology: `${n(value.workers)} · ${n(value.topics)}`,
        subscriptions: n(value.subscriptions), services: `${n(value.servicePending)} · ${n(value.serviceBindings)}`,
        streams: n(value.directStreams), coalesced: n(value.coalescedSamples) };
}
//# sourceMappingURL=bus-metrics-panel.js.map