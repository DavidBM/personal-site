/** No implicit unbounded promise queue when a camera requests many segments. */
export function createContentScheduler(concurrency, maxQueued) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4
        || !Number.isInteger(maxQueued) || maxQueued < 1 || maxQueued > 64)
        throw new Error('Invalid content scheduler bounds');
    const queue = [];
    let active = 0;
    function pump() {
        while (active < concurrency && queue.length) {
            const job = queue.shift();
            job.signal.removeEventListener('abort', job.abort);
            if (job.signal.aborted) {
                job.reject(job.signal.reason);
                continue;
            }
            active++;
            Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => { active--; pump(); });
        }
    }
    return {
        run(signal, run) {
            signal.throwIfAborted();
            if (queue.length >= maxQueued)
                return Promise.reject(new Error('World content queue backpressure'));
            return new Promise((resolve, reject) => {
                const job = { signal, run, resolve: value => resolve(value), reject, abort() {
                        const index = queue.indexOf(job);
                        if (index >= 0) {
                            queue.splice(index, 1);
                            reject(signal.reason);
                        }
                    } };
                signal.addEventListener('abort', job.abort, { once: true });
                queue.push(job);
                pump();
            });
        },
        inspect() { return { active, queued: queue.length }; },
    };
}
/** Consumer pacing owns no fetch/hash credit; invalidation need not wait for a
 * renderer callback that may never resume. Its eventual rejection is observed. */
export function waitForConsumer(work, signal) {
    if (signal.aborted) {
        void work.catch(() => { });
        return Promise.reject(signal.reason);
    }
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}
//# sourceMappingURL=scheduler.js.map