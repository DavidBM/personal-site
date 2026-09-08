function randomHex(bytes) {
    return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
/** Diagnostic identity is independent of a durable command's retry identity. */
export function newTrace(mode) {
    if (mode === 'disabled')
        return;
    const traceId = randomHex(16);
    const sampled = mode === 'full' || Number.parseInt(traceId.slice(-4), 16) % 16 === 0;
    return { traceId, spanId: randomHex(8), traceFlags: sampled ? 1 : 0 };
}
export function childContext(parent) {
    return { traceId: parent.traceId, spanId: randomHex(8), parentSpanId: parent.spanId, traceFlags: parent.traceFlags };
}
//# sourceMappingURL=context.js.map