/** Dedicated worker shell. All operations are delegated to the production runtime. */
import { createRenderRuntime } from "./runtime.js";
import { isProjectionQuery } from './remote/protocol.js';
const scope = self;
let runtime = null;
let initializing = false;
let disposed = false;
let awaitingStateAck = false;
let orderedWork = Promise.resolve();
function send(message) {
    scope.postMessage(message);
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
async function initialize(message) {
    if (runtime || initializing || disposed)
        throw new Error("Render worker already initialized or disposed");
    initializing = true;
    try {
        const created = await createRenderRuntime({
            ...message,
            onState: (snapshot) => {
                if (awaitingStateAck || disposed)
                    return;
                awaitingStateAck = true;
                send({ type: "state", snapshot });
            },
            onError: (error) => { if (!disposed)
                send({ type: "error", message: error }); },
        });
        if (disposed) {
            created.dispose();
            return;
        }
        runtime = created;
        send({ type: "ready", snapshot: runtime.snapshot() });
    }
    finally {
        initializing = false;
        if (disposed)
            scope.close();
    }
}
function dispose() {
    disposed = true;
    runtime?.dispose();
    runtime = null;
    send({ type: "disposed" });
    if (!initializing)
        scope.close();
}
function attachProjection(message) {
    try {
        if (!runtime || disposed)
            throw new Error("Render worker is not ready");
        send({ type: 'result', id: message.id, result: runtime.attachProjection(message) });
    }
    catch (error) {
        message.port.close();
        send({ type: 'queryError', id: message.id, message: errorMessage(error) });
    }
}
async function dispatch(message) {
    if (message.type === "dispose") {
        dispose();
        return;
    }
    if (message.type === "ackState") {
        awaitingStateAck = false;
        return;
    }
    if (message.type === 'attachProjection') {
        attachProjection(message);
        return;
    }
    if (!runtime || disposed)
        throw new Error("Render worker is not ready");
    if (message.type === "commands") {
        runtime.apply(message.sequence, message.commands);
        return;
    }
    try {
        const result = await runtime.query(message.query);
        send({ type: "result", id: message.id, result });
    }
    catch (error) {
        send({ type: "queryError", id: message.id, message: errorMessage(error) });
    }
}
scope.onmessage = (event) => {
    const message = event.data;
    if (message.type === "dispose") {
        dispose();
        return;
    }
    if (message.type === "ackState") {
        awaitingStateAck = false;
        return;
    }
    // The direct-port consumer must be able to satisfy a cross-port waiter while
    // later UI commands and attachment replacement remain independently live.
    if (message.type === 'query' && isProjectionQuery(message.query)) {
        void orderedWork.then(() => dispatch(message)).catch((error) => send({ type: 'error', message: errorMessage(error) }));
        return;
    }
    // Await diagnostic GPU queries before later mutations; message order is observable.
    orderedWork = orderedWork.then(() => message.type === "initialize" ? initialize(message) : dispatch(message))
        .catch((error) => send({ type: "error", message: errorMessage(error) }));
};
//# sourceMappingURL=worker-entry.js.map