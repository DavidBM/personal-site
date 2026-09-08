import { selectedSpans } from './graph.js';
import { renderGraph } from './view-graph.js';
export function renderInspection(snapshot, filter, previous) {
    renderSelections(snapshot);
    document.querySelector('#summary').textContent = `${snapshot.graph.connected.length} live bindings · ${snapshot.graph.pending} admitted deliveries pending · ${snapshot.spans.length}/1024 retained spans · ${snapshot.overwritten} overwritten · ${snapshot.rejected} invalid records`;
    renderGraph(document.querySelector('#graph'), snapshot, filter);
    renderCounters(snapshot, filter, previous);
    renderTimeline(snapshot, filter);
    table(document.querySelector('#streams'), ['Contract', 'Source → target', 'Generation', 'Credit limits'], snapshot.graph.streams.map(stream => [
        stream.contract, `${stream.source} → ${stream.target}`, String(stream.generation), `${stream.maxBytes} bytes / ${stream.maxBuffers} buffers`,
    ]));
    renderProgress(snapshot);
}
function renderProgress(snapshot) {
    const target = document.querySelector('#projection-progress');
    if (!target)
        return;
    const cursor = (value) => value ? `${value.systemId} · epoch ${value.ownerEpoch}/${value.recoveryGeneration} · stream ${value.streamGeneration} · sequence ${value.sequence} · revision ${value.systemRevision}` : 'unavailable';
    table(target, ['Owner / connection', 'Received', 'Applied to CPU/GPU buffers', 'Queued / retained', 'Sent; credit outstanding'], (snapshot.projectionProgress ?? []).map(value => [
        `${value.owner} / ${value.connectionGeneration}`, cursor(value.received), cursor(value.applied),
        `${value.queuedBytes} bytes / ${value.queuedBatches} batches`,
        value.owner === 'network' ? `${value.inFlightBytes} bytes / ${value.inFlightBatches} batches` : 'not a sender',
    ]));
}
function renderSelections(snapshot) {
    const commands = new Map(), traces = new Map();
    for (const span of snapshot.spans.slice().reverse()) {
        if (span.commandId && commands.size < 128)
            commands.set(span.commandId, `${span.stage} · ${span.status}`);
        if (traces.size < 128)
            traces.set(span.context.traceId, `${span.stage} · ${span.status}`);
    }
    for (const [id, values] of [['commands', commands], ['traces', traces]]) {
        const target = document.querySelector(`#${id}`);
        target.replaceChildren();
        for (const [value, label] of values) {
            const option = document.createElement('option');
            option.value = value;
            option.label = label;
            target.append(option);
        }
    }
}
function renderCounters(snapshot, filter, previous) {
    const old = new Map(previous?.graph.observed.map(value => [value.contract, value]));
    const seconds = previous ? (snapshot.capturedMonotonicMs - previous.capturedMonotonicMs) / 1000 : 0;
    const rows = snapshot.graph.observed.filter(value => !filter.contract || value.contract.includes(filter.contract)).map(value => {
        const baseline = old.get(value.contract);
        const delta = baseline ? value.messages - baseline.messages : -1;
        const rate = seconds > 0 && delta >= 0 ? `${(delta / seconds).toFixed(1)}/s` : 'unavailable';
        return [value.contract, String(value.messages), rate, String(value.knownBytes), String(value.unknownSizes), String(value.failures)];
    });
    table(document.querySelector('#counters'), ['Contract aggregate', 'Deliveries', 'Interval rate', 'Known bytes', 'Unknown sizes', 'Failures'], rows);
}
function renderTimeline(snapshot, filter) {
    const spans = selectedSpans(snapshot, filter), clocks = new Map();
    for (const span of spans) {
        const group = clocks.get(span.clockId) ?? [];
        group.push(span);
        clocks.set(span.clockId, group);
    }
    const target = document.querySelector('#timeline');
    target.replaceChildren();
    for (const [clock, group] of clocks) {
        group.sort((a, b) => a.startedMs - b.startedMs);
        const section = document.createElement('section'), heading = document.createElement('h3');
        heading.textContent = `${clock} · local monotonic time`;
        section.append(heading);
        const origin = group[0].startedMs, end = Math.max(...group.map(span => span.startedMs + span.durationMs));
        const scale = Math.max(1, end - origin);
        for (const span of group.slice(0, 256)) {
            const row = document.createElement('div');
            row.className = 'span-row';
            const label = document.createElement('span');
            label.textContent = `${span.stage} · ${span.status}${span.code ? ` (${span.code})` : ''} · ${span.durationMs.toFixed(3)} ms`;
            const track = document.createElement('div');
            track.className = 'track';
            const bar = document.createElement('i');
            bar.className = span.status;
            bar.style.left = `${(span.startedMs - origin) / scale * 100}%`;
            bar.style.width = `${Math.max(0.2, span.durationMs / scale * 100)}%`;
            track.append(bar);
            row.append(label, track);
            row.title = `trace ${span.context.traceId}\nspan ${span.context.spanId}\nparent ${span.context.parentSpanId ?? 'root'}\nlocal start ${span.startedMs} ms`;
            if (span.commandId)
                row.title += `\ncommand ${span.commandId}`;
            section.append(row);
        }
        target.append(section);
    }
    if (!spans.length)
        target.textContent = 'No retained spans match. Disabled or sampled tracing can leave gaps; no observation does not imply no work.';
    const traces = new Set(spans.map(span => span.context.traceId));
    const events = snapshot.graph.trace.filter(event => matchesEvent(event, filter, traces));
    table(document.querySelector('#broker-events'), ['Broker local time (ms)', 'Kind', 'Contract', 'Service', 'Trace'], events.slice(-256).map(event => [
        event.time.toFixed(3), event.kind, event.contract, event.service, event.context?.traceId ?? 'untraced',
    ]));
}
function matchesEvent(event, filter, traces) {
    const traceId = event.context ? event.context.traceId : '';
    if (filter.traceId && traceId !== filter.traceId)
        return false;
    if (filter.commandId && !traces.has(traceId))
        return false;
    if (filter.service && !event.service.includes(filter.service))
        return false;
    return !filter.contract || event.contract.includes(filter.contract);
}
function table(target, headings, rows) {
    const element = document.createElement('table'), header = document.createElement('tr');
    for (const value of headings) {
        const cell = document.createElement('th');
        cell.textContent = value;
        header.append(cell);
    }
    const head = document.createElement('thead');
    head.append(header);
    element.append(head);
    const body = document.createElement('tbody');
    for (const values of rows) {
        const row = document.createElement('tr');
        for (const value of values) {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.append(cell);
        }
        body.append(row);
    }
    element.append(body);
    target.replaceChildren(element);
}
//# sourceMappingURL=view.js.map