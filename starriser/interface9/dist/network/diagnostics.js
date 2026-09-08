import { contextCopy } from '../worker/bus/service-validation.js';
import { projectionTrace } from '../debug/worker-traces.js';
import { opaqueIdAt } from '../contracts/opaque-id.js';
const hex = (bytes) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const bytes = (value) => Uint8Array.from(value.match(/../g), part => Number.parseInt(part, 16));
export function wireTrace(context) {
    try {
        const value = contextCopy(context);
        if (!value || !(value.traceFlags & 1))
            return;
        return { $typeName: 'galaxy.v1.TraceContext', traceId: bytes(value.traceId), spanId: bytes(value.spanId),
            parentSpanId: value.parentSpanId ? bytes(value.parentSpanId) : new Uint8Array(), traceFlags: value.traceFlags };
    }
    catch {
        return;
    }
}
function localContext(value) {
    if (!value || value.traceId.length !== 16 || value.spanId.length !== 8 || ![0, 8].includes(value.parentSpanId.length))
        return;
    return contextCopy({ traceId: hex(value.traceId), spanId: hex(value.spanId),
        parentSpanId: value.parentSpanId.length ? hex(value.parentSpanId) : undefined, traceFlags: value.traceFlags });
}
export function localProjectionTrace(value) {
    try {
        if (value?.commandId.byteLength !== 16)
            return;
        const context = localContext(value?.context);
        return context && projectionTrace({ context, commandId: opaqueIdAt(value.commandId) });
    }
    catch {
        return;
    }
}
/** Optional metadata cannot reject an otherwise valid receipt. Never inspect or
 * copy its command payload; only bounded, allowlisted diagnostic fields survive. */
export function collectNativeTraces(traces, batch) {
    if (!batch)
        return;
    if (batch.spans.length > 16) {
        traces.drop();
        return;
    }
    traces.drop(batch.dropped);
    for (const value of batch.spans)
        collectSpan(traces, value);
}
function collectSpan(traces, value) {
    try {
        if (value.commandId.byteLength !== 16) {
            traces.drop();
            return;
        }
        const context = localContext(value.context);
        if (!context || value.startedUs > BigInt(Number.MAX_SAFE_INTEGER) || value.durationUs > BigInt(Number.MAX_SAFE_INTEGER)
            || !traces.nativeClock(value.clockId)) {
            traces.drop();
            return;
        }
        const status = value.status === 1 ? 'ok' : value.status === 2 ? 'error' : 'unknown';
        traces.record({ stage: value.stage, context, clockId: value.clockId, startedMs: Number(value.startedUs) / 1000,
            durationMs: Number(value.durationUs) / 1000, status, code: value.code || undefined, commandId: opaqueIdAt(value.commandId) });
    }
    catch {
        traces.drop();
    }
}
//# sourceMappingURL=diagnostics.js.map