/** One ordered worker channel; queries flush earlier commands before being sent. */
export function createRenderConnection(options) {
    const { endpoint } = options;
    const timeoutMs = options.timeoutMs ?? 15000;
    const pending = new Map();
    let commands = [];
    let sequence = 0;
    let queryId = 0;
    let scheduled = false;
    let closed = false;
    let stopping = false;
    let lastSequence = -1;
    let resolveReady;
    let rejectReady;
    let resolveDispose = null;
    let disposeTimeout = null;
    const ready = new Promise((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });
    // Transfer/bootstrap can throw before the owner reaches `await ready`.
    void ready.catch(() => { });
    const startupTimeout = setTimeout(() => fail(new Error("Render worker initialization timed out")), timeoutMs);
    function release(error) {
        if (closed)
            return;
        closed = true;
        commands = [];
        clearTimeout(startupTimeout);
        if (disposeTimeout != null)
            clearTimeout(disposeTimeout);
        for (const query of pending.values()) {
            query.cleanup();
            query.reject(error);
        }
        pending.clear();
        endpoint.removeEventListener("message", onMessage);
        endpoint.removeEventListener("error", onWorkerError);
        endpoint.removeEventListener("messageerror", onMessageError);
        endpoint.terminate();
        rejectReady(error);
        resolveDispose?.();
    }
    function fail(error) {
        if (closed)
            return;
        release(error);
        options.onError(error);
    }
    function acceptState(snapshot) {
        if (snapshot.sequence < lastSequence)
            return;
        lastSequence = snapshot.sequence;
        options.onState(snapshot);
    }
    function settleQuery(response) {
        const query = pending.get(response.id);
        if (!query)
            return;
        pending.delete(response.id);
        query.cleanup();
        if (response.type === "queryError")
            query.reject(new Error(response.message));
        else {
            if (query.kind === "snapshot")
                acceptState(response.result);
            query.resolve(response.result);
        }
    }
    function onMessage(event) {
        if (closed)
            return;
        const response = event.data;
        switch (response.type) {
            case "ready":
                clearTimeout(startupTimeout);
                acceptState(response.snapshot);
                resolveReady(response.snapshot);
                break;
            case "state":
                try {
                    acceptState(response.snapshot);
                }
                finally {
                    post({ type: "ackState" });
                }
                break;
            case "result":
            case "queryError":
                settleQuery(response);
                break;
            case "error":
                fail(new Error(response.message));
                break;
            case "disposed":
                release(new Error("Render worker disposed"));
                break;
        }
    }
    function onWorkerError(event) {
        fail(new Error(event.message || "Render worker crashed"));
    }
    function onMessageError() { fail(new Error("Render worker message could not be decoded")); }
    endpoint.addEventListener("message", onMessage);
    endpoint.addEventListener("error", onWorkerError);
    endpoint.addEventListener("messageerror", onMessageError);
    function post(message, transfer = []) {
        if (closed)
            return;
        try {
            endpoint.postMessage(message, transfer);
        }
        catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
        }
    }
    function flush() {
        scheduled = false;
        if (closed || commands.length === 0)
            return;
        const batch = commands;
        commands = [];
        post({ type: "commands", sequence: ++sequence, commands: batch });
    }
    function request(kind, message, transfer = [], deadline = timeoutMs, signal) {
        if (signal?.aborted)
            return Promise.reject(new Error('Render query cancelled'));
        if (closed || stopping)
            return Promise.reject(new Error('Render worker is unavailable'));
        flush();
        if (closed)
            return Promise.reject(new Error('Render worker is unavailable'));
        const id = ++queryId;
        return new Promise((resolve, reject) => {
            const fail = (error) => { pending.delete(id); cleanup(); reject(error); };
            const abort = () => fail(new Error('Render query cancelled'));
            const timeout = deadline === null ? undefined : setTimeout(() => fail(new Error(`Render query ${kind} timed out`)), deadline);
            const cleanup = () => { clearTimeout(timeout); signal?.removeEventListener('abort', abort); };
            pending.set(id, { kind, resolve, reject, cleanup });
            signal?.addEventListener('abort', abort, { once: true });
            post(message(id), transfer);
        });
    }
    return {
        ready,
        send(command) {
            if (closed || stopping)
                return;
            commands.push(command);
            if (scheduled)
                return;
            scheduled = true;
            queueMicrotask(flush);
        },
        query(query, options = {}) {
            return request(query.type, id => ({ type: 'query', id, query }), [], options.timeoutMs === undefined ? timeoutMs : options.timeoutMs, options.signal);
        },
        attachProjection(attachment) {
            return request('attachProjection', id => ({ type: 'attachProjection', id, ...attachment }), [attachment.port])
                .catch(error => { attachment.port.close(); throw error; });
        },
        dispose() {
            if (closed)
                return Promise.resolve();
            if (stopping)
                return new Promise((resolve) => {
                    const previous = resolveDispose;
                    resolveDispose = () => { previous?.(); resolve(); };
                });
            stopping = true;
            flush();
            if (closed)
                return Promise.resolve();
            return new Promise((resolve) => {
                resolveDispose = resolve;
                disposeTimeout = setTimeout(() => release(new Error("Render worker dispose timed out")), 1000);
                post({ type: "dispose" });
            });
        },
    };
}
//# sourceMappingURL=render-connection.js.map