import { contextCopy } from '../worker/bus/service-validation.js';
import { childContext } from './bus/context.js';
import { GAME_STAGES } from './game-stages.js';
const STAGES = new Set(GAME_STAGES.map(stage => stage.id));
const MAX_SPANS = 256;
const ID = /^(?!0{32}$)[0-9a-f]{32}$/;
const CODES = new Set(['accepted', 'committed', 'queued', 'rejected', 'unauthorized', 'invalid_target', 'stale_revision',
    'wrong_owner', 'identity_conflict', 'admission_expired', 'busy', 'not_found', 'expired', 'recovery_required',
    'storage_error', 'unavailable', 'peer_error', 'canceled', 'unknown', 'submission_failed', 'projection_apply', 'projection_pack']);
function validTiming(span) {
    return [span.startedMs, span.durationMs, span.startedMs + span.durationMs].every(value => Number.isFinite(value) && value >= 0);
}
export const emptyTraces = () => ({ kind: 'diagnostics', clocks: [], spans: [], dropped: 0 });
export function projectionTrace(value) {
    try {
        const context = contextCopy(value?.context);
        if (!context || !(context.traceFlags & 1) || !ID.test(value.commandId))
            return;
        return { context, commandId: value.commandId };
    }
    catch {
        return;
    }
}
export function workerClock(owner) {
    return { id: `${owner}:${crypto.randomUUID()}`, originUnixMs: performance.timeOrigin, uncertaintyMs: 1 };
}
export function createWorkerTraces(clock, now = () => performance.now()) {
    const clocks = new Map([[clock.id, { ...clock }]]);
    let ring = [], cursor = 0, dropped = 0;
    function record(span) {
        try {
            const trace = projectionTrace({ context: span.context, commandId: span.commandId });
            if (!trace || !STAGES.has(span.stage) || !clocks.has(span.clockId))
                throw new Error('Invalid trace identity');
            if (!validTiming(span))
                throw new Error('Invalid local duration');
            if (!['ok', 'error', 'unknown'].includes(span.status) || (span.code !== undefined && !CODES.has(span.code)))
                throw new Error('Invalid trace status');
            const copy = { stage: span.stage, context: trace.context, commandId: trace.commandId,
                clockId: span.clockId, startedMs: span.startedMs, durationMs: span.durationMs, status: span.status, code: span.code };
            if (ring.length === MAX_SPANS)
                dropped++;
            ring[cursor++ % MAX_SPANS] = copy;
        }
        catch {
            dropped++;
        }
    }
    function begin(stage, parent) {
        try {
            const trace = projectionTrace(parent);
            if (!trace)
                return;
            const context = childContext(trace.context), startedMs = now();
            let ended = false;
            return { context, commandId: trace.commandId,
                finish(status, code) {
                    if (ended)
                        return;
                    ended = true;
                    try {
                        record({ stage, context, commandId: trace.commandId, clockId: clock.id, startedMs,
                            durationMs: now() - startedMs, status, code });
                    }
                    catch {
                        dropped++;
                    }
                } };
        }
        catch {
            dropped++;
            return;
        }
    }
    return {
        begin, record,
        nativeClock(id) {
            if (!/^native:[a-zA-Z0-9_-]{1,64}$/.test(id) || (!clocks.has(id) && clocks.size >= 32)) {
                dropped++;
                return false;
            }
            clocks.set(id, { id });
            return true;
        },
        drop(count = 1) { if (Number.isSafeInteger(count) && count > 0)
            dropped += count; },
        take() {
            const spans = cursor < MAX_SPANS ? ring : ring.slice(cursor % MAX_SPANS).concat(ring.slice(0, cursor % MAX_SPANS));
            const value = { kind: 'diagnostics', clocks: Array.from(clocks.values(), value => ({ ...value })), spans, dropped };
            ring = [];
            cursor = 0;
            dropped = 0;
            return value;
        },
    };
}
//# sourceMappingURL=worker-traces.js.map