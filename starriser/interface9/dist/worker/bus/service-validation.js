import { ServiceError } from './service-types.js';
export function identityCopy(value) {
    for (const field of ['service', 'instance', 'scope', 'source']) {
        if (typeof value[field] !== 'string' || !value[field] || value[field].length > 256)
            throw new Error(`Invalid service ${field}`);
    }
    return { service: value.service, instance: value.instance, scope: value.scope, source: value.source };
}
export function metadata(value) {
    if (value.ordered !== undefined && (!value.ordered || value.ordered.length > 128))
        throw new Error('Invalid ordered service lane');
    if (![0, 1, 2].includes(value.priority))
        throw new Error('Invalid service priority');
    return { id: value.id, kind: value.kind, priority: value.priority, ordered: value.ordered, capacity: value.capacity, summary: value.summary };
}
export function contextCopy(value) {
    if (!value)
        return;
    if (!/^(?!0{32}$)[0-9a-f]{32}$/.test(value.traceId) || !validSpan(value.spanId))
        throw new Error('Invalid trace context');
    if (value.parentSpanId !== undefined && !validSpan(value.parentSpanId))
        throw new Error('Invalid parent span');
    if (value.traceFlags !== undefined && (!Number.isInteger(value.traceFlags) || value.traceFlags < 0 || value.traceFlags > 255))
        throw new Error('Invalid trace flags');
    return { traceId: value.traceId, spanId: value.spanId, parentSpanId: value.parentSpanId, traceFlags: value.traceFlags };
}
function validSpan(value) { return /^(?!0{16}$)[0-9a-f]{16}$/.test(value); }
export function knownBytes(contract, value) {
    const bytes = contract.bytes?.(value);
    if (bytes !== undefined && (!Number.isSafeInteger(bytes) || bytes < 0))
        throw new Error('Invalid contract byte estimate');
    return bytes;
}
export function checkStream(value) {
    for (const key of ['id', 'source', 'target']) {
        if (!value[key] || value[key].length > 256)
            throw new Error('Invalid direct stream identity');
    }
    for (const key of ['generation', 'maxBytes', 'maxBuffers']) {
        if (!Number.isSafeInteger(value[key]) || value[key] < 1)
            throw new Error('Invalid direct stream limit');
    }
    return { id: value.id, generation: value.generation, source: value.source, target: value.target, maxBytes: value.maxBytes, maxBuffers: value.maxBuffers };
}
export function waitTimeout(value = 5000) {
    if (!Number.isFinite(value) || value < 1 || value > 120000)
        throw new ServiceError('TIMEOUT', 'Invalid service deadline');
    return value;
}
//# sourceMappingURL=service-validation.js.map