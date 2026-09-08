import { contextCopy } from '../../worker/bus/service-validation.js';
const MAX_SPANS = 1024;
/** Only declared stage IDs label counters. Detailed records retain an explicit allowlist. */
export function createRecorder(stages, dependencies, clocks) {
    if (stages.length > 64 || dependencies.length > 256 || clocks.length > 32)
        throw new Error('Inspector declaration capacity');
    const definitions = new Map(stages.map(stage => [bounded(stage.id), { id: stage.id, service: bounded(stage.service), source: bounded(stage.source) }]));
    const clockMap = new Map(clocks.map(clock => [bounded(clock.id), copyClock(clock)]));
    const links = dependencies.map(link => {
        if (!definitions.has(link.from) || !definitions.has(link.to))
            throw new Error('Undeclared diagnostic dependency');
        return { from: link.from, to: link.to, contract: optional(link.contract) };
    });
    const counters = new Map();
    const ring = [];
    let mode = 'disabled', cursor = 0, rejected = 0;
    function record(value) {
        try {
            if (!definitions.has(value.stage) || !clockMap.has(value.clockId))
                throw new Error('Undeclared diagnostic stage or clock');
            if (!Number.isFinite(value.durationMs) || value.durationMs < 0)
                throw new Error('Invalid local duration');
            const count = counters.get(value.stage) ?? { stage: value.stage, completed: 0, failures: 0, durationMs: 0 };
            count.completed++;
            count.durationMs += value.durationMs;
            if (value.status === 'error')
                count.failures++;
            counters.set(value.stage, count);
            if (mode === 'disabled' || !(value.context.traceFlags & 1))
                return;
            const span = copySpan(value);
            ring[cursor++ % MAX_SPANS] = span;
        }
        catch {
            rejected++;
        }
    }
    return {
        record,
        registerClock(value) {
            try {
                if (!clockMap.has(value.id) && clockMap.size >= 32)
                    throw new Error('Inspector clock capacity');
                const copy = copyClock({ id: bounded(value.id), originUnixMs: value.originUnixMs, uncertaintyMs: value.uncertaintyMs });
                const previous = clockMap.get(value.id);
                if (previous && (previous.originUnixMs !== copy.originUnixMs || previous.uncertaintyMs !== copy.uncertaintyMs))
                    throw new Error('Clock identity cannot change its anchor');
                clockMap.set(value.id, copy);
                return true;
            }
            catch {
                rejected++;
                return false;
            }
        },
        configure(value) { mode = value; ring.length = 0; cursor = 0; },
        snapshot: () => ({ stages: Array.from(definitions.values(), value => ({ ...value })), dependencies: links.map(value => ({ ...value })),
            clocks: Array.from(clockMap.values(), value => ({ ...value })), counters: Array.from(counters.values(), value => ({ ...value })),
            spans: ordered(ring, cursor).map(value => ({ ...value, context: { ...value.context } })),
            overwritten: Math.max(0, cursor - MAX_SPANS), rejected }),
    };
}
function ordered(ring, cursor) {
    return cursor < MAX_SPANS ? ring : ring.slice(cursor % MAX_SPANS).concat(ring.slice(0, cursor % MAX_SPANS));
}
function bounded(value) {
    if (typeof value !== 'string' || !value || value.length > 256)
        throw new Error('Invalid diagnostic label');
    return value;
}
function optional(value) { return value === undefined ? undefined : bounded(value); }
function copyClock(value) {
    for (const number of [value.originUnixMs, value.uncertaintyMs]) {
        if (number !== undefined && (!Number.isFinite(number) || number < 0))
            throw new Error('Invalid clock anchor');
    }
    return { id: value.id, originUnixMs: value.originUnixMs, uncertaintyMs: value.uncertaintyMs };
}
function copySpan(value) {
    if (!Number.isFinite(value.startedMs) || value.startedMs < 0)
        throw new Error('Invalid local timestamp');
    if (!Number.isFinite(value.startedMs + value.durationMs))
        throw new Error('Invalid local span endpoint');
    if (!['ok', 'error', 'unknown'].includes(value.status))
        throw new Error('Invalid span status');
    return { stage: value.stage, context: contextCopy(value.context), clockId: value.clockId,
        startedMs: value.startedMs, durationMs: value.durationMs, status: value.status,
        code: optional(value.code), commandId: optional(value.commandId), contract: optional(value.contract) };
}
//# sourceMappingURL=recorder.js.map