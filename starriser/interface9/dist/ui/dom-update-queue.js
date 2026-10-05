export function createUpdateQueue(options = {}) {
    const limit = options.maxJobsPerFrame ?? 64;
    if (!Number.isInteger(limit) || limit < 1)
        throw new RangeError('maxJobsPerFrame must be a positive integer');
    const request = options.requestFrame ?? (callback => requestAnimationFrame(callback));
    const cancel = options.cancelFrame ?? (id => cancelAnimationFrame(id));
    const onError = options.onError ?? (error => console.error('[UI commit]', error));
    const metrics = { requests: 0, commits: 0, formats: 0, writes: 0, frames: 0, pending: 0, maxPending: 0, deferred: 0, errors: 0 };
    const staged = new Array(limit).fill(null);
    const jobs = new Set(); // Registration/lifetime only; never scanned by a frame.
    let head = null, tail = null;
    let frame = null, flushing = false, disposed = false;
    function schedule() {
        if (frame === null && head && !flushing && !disposed)
            frame = request(flush);
    }
    function enqueue(work) {
        if (work.queued || !work.active || work.disposed || disposed)
            return;
        work.previous = tail;
        work.next = null;
        work.queued = true;
        if (tail)
            tail.next = work;
        else
            head = work;
        tail = work;
        metrics.pending++;
        metrics.maxPending = Math.max(metrics.maxPending, metrics.pending);
        schedule();
    }
    function unlink(work) {
        if (!work.queued)
            return;
        if (work.previous)
            work.previous.next = work.next;
        else
            head = work.next;
        if (work.next)
            work.next.previous = work.previous;
        else
            tail = work.previous;
        work.previous = work.next = null;
        work.queued = false;
        metrics.pending--;
        if (!head && frame !== null) {
            cancel(frame);
            frame = null;
        }
    }
    function failed(error) {
        metrics.errors++;
        // An observer must not strand the rest of the queue either.
        try {
            onError(error);
        }
        catch (reportError) {
            console.error('[UI error handler]', reportError);
        }
    }
    function stageBatch() {
        // Detach first, then stage: callbacks cannot pull newly queued jobs into this batch.
        let count = 0;
        while (head && count < limit) {
            const work = head;
            unlink(work);
            staged[count++] = work;
        }
        for (let i = 0; i < count; i++) {
            const work = staged[i];
            if (!work || !work.active || work.disposed) {
                staged[i] = null;
                continue;
            }
            work.dirty = false;
            try {
                work.stage();
            }
            catch (error) {
                staged[i] = null;
                failed(error);
            }
        }
        return count;
    }
    function flush() {
        frame = null;
        flushing = true;
        metrics.frames++;
        try {
            const count = stageBatch();
            for (let i = 0; i < count; i++) {
                const work = staged[i];
                staged[i] = null;
                if (!work || !work.active || work.disposed)
                    continue;
                try {
                    work.commit();
                    metrics.commits++;
                }
                catch (error) {
                    failed(error);
                }
            }
            metrics.deferred += metrics.pending;
        }
        finally {
            flushing = false;
            schedule();
        }
    }
    function retire(work) {
        unlink(work);
        work.disposed = true;
        work.stage = work.commit = null;
        jobs.delete(work);
    }
    return {
        /** Borrowed counters; reading them does not allocate a report. */
        metrics,
        /** Stage only copies pending state; commit performs bounded work from that copy. */
        job(stage, commit) {
            if (disposed)
                throw new Error('UI update queue is disposed');
            const work = { previous: null, next: null, queued: false, active: true, dirty: false, disposed: false, stage, commit };
            jobs.add(work);
            return {
                invalidate() { metrics.requests++; if (work.disposed)
                    return; work.dirty = true; enqueue(work); },
                setActive(active) {
                    if (work.disposed || work.active === active)
                        return;
                    work.active = active;
                    if (!active) {
                        work.dirty = true;
                        unlink(work);
                    }
                    else if (work.dirty)
                        enqueue(work);
                },
                dispose() { retire(work); },
            };
        },
        dispose() {
            disposed = true;
            if (frame !== null)
                cancel(frame);
            frame = null;
            for (const work of jobs)
                retire(work);
            staged.fill(null);
        },
    };
}
//# sourceMappingURL=dom-update-queue.js.map