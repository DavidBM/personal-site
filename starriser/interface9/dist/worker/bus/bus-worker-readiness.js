import { isBusMessage, isRecord } from "./bus-types.js";
let registrationCounter = 0;
export const createWorkerRegistrationId = (workerId) => `${workerId}:${++registrationCounter}`;
/** Await a lifecycle acknowledgement, retaining errors until it arrives. */
export function awaitWorkerAcknowledgement(options) {
    const { bus, worker, workerId, event, signal } = options;
    return new Promise((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => finish(new Error(`Worker ${workerId} ${event} timeout`)), options.timeoutMs ?? 10000);
        function finish(error) {
            if (settled)
                return;
            settled = true;
            clearTimeout(timeout);
            bus.off(event, onReady);
            worker.removeEventListener("message", onMessage);
            worker.removeEventListener("error", onError);
            worker.removeEventListener("messageerror", onMessageError);
            signal?.removeEventListener("abort", onAbort);
            if (error)
                reject(error);
            else
                resolve();
        }
        function onReady(data) {
            if (!isRecord(data) || data.workerId !== workerId)
                return;
            if (options.registrationId && data.registrationId !== options.registrationId)
                return;
            finish();
        }
        function onMessage(message) {
            const value = message.data;
            if (!isBusMessage(value) || value.t !== "wrk_error")
                return;
            const reason = isRecord(value.d) ? value.d.error : "Unknown error";
            finish(new Error(`Worker ${workerId} failed: ${String(reason)}`));
        }
        function onError(error) {
            finish(new Error(`Worker ${workerId} failed: ${error.message}`));
        }
        function onMessageError() { finish(new Error(`Worker ${workerId} message could not be decoded`)); }
        function onAbort() { finish(new Error(`Worker ${workerId} startup cancelled`)); }
        bus.on(event, onReady);
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);
        worker.addEventListener("messageerror", onMessageError);
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) {
            onAbort();
            return;
        }
        try {
            options.start();
        }
        catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)));
        }
    });
}
//# sourceMappingURL=bus-worker-readiness.js.map