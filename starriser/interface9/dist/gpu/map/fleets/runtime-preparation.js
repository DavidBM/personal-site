let nextPreparationId = 1;
/** Observes one host lifetime. GPU promises may finish after cancellation. */
export function createRuntimePreparation(now = () => performance.now()) {
    const id = nextPreparationId++;
    const timings = [];
    let status = null;
    let observedAt = 0;
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
        observedAt = time;
        if (event.phase === 'ready' || event.phase === 'failed' || event.phase === 'cancelled')
            finished = time;
    }
    return {
        update(event) {
            // Concurrent scene setup cannot replace the list of unfinished engine jobs.
            if (event.phase === 'compiling' && status?.active?.length)
                return;
            update(event);
        },
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
            const active = status.active?.map(job => ({ ...job, elapsedMs: job.elapsedMs + Math.max(0, time - observedAt) }));
            return { ...status, ...(active ? { active } : {}), id, elapsedMs: Math.max(0, time - started), stageElapsedMs: Math.max(0, time - stageStarted), timings: timings.slice() };
        },
    };
}
//# sourceMappingURL=runtime-preparation.js.map