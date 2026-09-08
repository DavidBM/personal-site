import { copyWatermark, sameScope } from "./projection-state.js";
function progress(current, required) {
    if (!current || current.streamGeneration < required.streamGeneration)
        return "wait";
    if (current.streamGeneration > required.streamGeneration || !sameScope(current.scope, required.scope)
        || current.subscriptionId !== required.subscriptionId)
        return "stale";
    return current.sequence >= required.sequence && current.systemRevision >= required.systemRevision ? "ready" : "wait";
}
/** Observation waiters do not enter the queue that applies their awaited data. */
export function createProjectionBarriers() {
    const waiting = new Set();
    let current = null;
    let closed = false;
    function settle(item) {
        const state = progress(current, item.required);
        if (state === "ready")
            item.finish();
        if (state === "stale")
            item.finish(new Error("Projection barrier was superseded"));
    }
    return {
        advance(value) {
            current = value;
            for (const item of waiting)
                settle(item);
        },
        wait(required, options = {}) {
            if (closed)
                return Promise.reject(new Error("Projection consumer is disposed"));
            if (waiting.size >= 128)
                return Promise.reject(new Error("Projection barrier capacity exceeded"));
            const timeoutMs = options.timeoutMs ?? 1500;
            if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
                return Promise.reject(new Error("Invalid projection barrier timeout"));
            return new Promise((resolve, reject) => {
                const finish = (error) => {
                    waiting.delete(item);
                    clearTimeout(timer);
                    options.signal?.removeEventListener("abort", abort);
                    if (error)
                        reject(error);
                    else
                        resolve();
                };
                const abort = () => finish(new Error("Projection barrier was cancelled"));
                const timer = setTimeout(() => finish(new Error("Projection barrier timed out")), timeoutMs);
                const item = { required: copyWatermark(required), finish };
                waiting.add(item);
                options.signal?.addEventListener("abort", abort, { once: true });
                if (options.signal?.aborted)
                    abort();
                else
                    settle(item);
            });
        },
        replace(value) {
            current = null;
            for (const item of waiting) {
                if (item.required.streamGeneration < value.streamGeneration
                    || (item.required.streamGeneration === value.streamGeneration && !sameScope(item.required.scope, value.scope))) {
                    item.finish(new Error('Projection stream was replaced'));
                }
            }
        },
        invalidate(reason) {
            current = null;
            for (const item of waiting)
                item.finish(new Error(reason));
        },
        dispose() {
            closed = true;
            for (const item of waiting)
                item.finish(new Error("Projection consumer is disposed"));
            current = null;
        },
    };
}
//# sourceMappingURL=projection-barriers.js.map