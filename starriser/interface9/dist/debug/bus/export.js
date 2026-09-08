import { selectedSpans } from './graph.js';
const attribute = (key, value) => ({ key, value: { stringValue: value } });
const nanos = (ms) => BigInt(Math.trunc(ms)) * 1000000n + BigInt(Math.round((ms % 1) * 1000000));
/** OTLP JSON uses explicit epoch anchors. Unknown clocks remain in the portable snapshot. */
export function exportOtlp(snapshot, filter = {}) {
    const clocks = new Map(snapshot.clocks.map(clock => [clock.id, clock]));
    const stages = new Map(snapshot.stages.map(stage => [stage.id, stage]));
    const groups = new Map();
    let excludedWithoutClockAnchor = 0;
    for (const span of selectedSpans(snapshot, filter)) {
        const clock = clocks.get(span.clockId), stage = stages.get(span.stage);
        if (clock?.originUnixMs === undefined || !stage) {
            excludedWithoutClockAnchor++;
            continue;
        }
        const group = groups.get(stage.service) ?? [];
        group.push(convert(span, clock.originUnixMs, clock.uncertaintyMs));
        groups.set(stage.service, group);
    }
    return { excludedWithoutClockAnchor, data: { resourceSpans: Array.from(groups, ([service, spans]) => ({
                resource: { attributes: [attribute('service.name', service)] },
                scopeSpans: [{ scope: { name: 'galaxy.bus-inspector', version: '1' }, spans }],
            })) } };
}
function convert(span, origin, uncertainty) {
    const start = nanos(origin) + nanos(span.startedMs);
    const attributes = [attribute('galaxy.clock.id', span.clockId), attribute('galaxy.stage', span.stage),
        { key: 'galaxy.local.start_ms', value: { doubleValue: span.startedMs } },
        { key: 'galaxy.local.duration_ms', value: { doubleValue: span.durationMs } }];
    if (uncertainty !== undefined)
        attributes.push({ key: 'galaxy.clock.uncertainty_ms', value: { doubleValue: uncertainty } });
    if (span.contract)
        attributes.push(attribute('messaging.destination.name', span.contract));
    if (span.code)
        attributes.push(attribute('error.type', span.code));
    return { traceId: span.context.traceId, spanId: span.context.spanId, parentSpanId: span.context.parentSpanId,
        flags: span.context.traceFlags ?? 0, name: span.stage, kind: 1,
        startTimeUnixNano: start.toString(), endTimeUnixNano: (start + nanos(span.durationMs)).toString(),
        attributes, status: { code: span.status === 'error' ? 2 : span.status === 'ok' ? 1 : 0 } };
}
//# sourceMappingURL=export.js.map