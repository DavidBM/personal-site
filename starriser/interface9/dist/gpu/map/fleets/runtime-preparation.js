let nextPreparationId = 1;
/** Observes one host lifetime. GPU promises may finish after cancellation. */
export function createRuntimePreparation(now = () => performance.now()) {
    const id = nextPreparationId++;
    const timings = [];
    let status = null;
    let started = 0, stageStarted = 0, finished = null;
    function update(event) {
        if (finished != null)
            return;
        const time = now();
        if (event.durationMs != null)
            timings.push({ label: event.label, durationMs: event.durationMs });
        if (!status)
            started = time;
        if (!status || status.phase !== event.phase || status.label !== event.label)
            stageStarted = time;
        status = { ...event };
        if (event.phase === 'ready' || event.phase === 'failed' || event.phase === 'cancelled')
            finished = time;
    }
    return {
        update,
        engine(event) {
            if (event.phase === 'ready')
                update({ phase: 'preparing', label: 'Scene rendering resources' });
            else
                update(event);
        },
        cancel() {
            if (status)
                update({ phase: 'cancelled', label: 'Ship preparation cancelled' });
        },
        snapshot() {
            if (!status)
                return null;
            const time = finished ?? now();
            return { ...status, id, elapsedMs: Math.max(0, time - started), stageElapsedMs: Math.max(0, time - stageStarted), timings: timings.slice() };
        },
    };
}
//# sourceMappingURL=runtime-preparation.js.map