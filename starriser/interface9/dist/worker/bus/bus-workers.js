/**
 * Dynamic worker launch / terminate / lookup.
 * Operates on a host object with the Bus underscore fields (public by convention).
 */
import { registerWorkerWithBroker } from "./bus-pubsub.js";
import { awaitWorkerAcknowledgement, createWorkerRegistrationId } from "./bus-worker-readiness.js";
function logWorker(host, message) {
    if ((host._options.debug ?? 0) >= 1)
        console.log(message);
}
function assertStartupCurrent(host, info, signal) {
    if (signal.aborted || host._managedWorkers.get(info.workerId) !== info) {
        throw new Error(`Worker ${info.workerId} startup cancelled`);
    }
}
/**
 * Launch a worker with automatic Bus setup and optional broker registration.
 */
export async function launchWorker(host, createChildBus, workerModulePath, options = {}) {
    const workerId = options.workerId || `worker_${host._workerIdCounter++}`;
    if (host._managedWorkers.has(workerId))
        throw new Error(`Worker ${workerId} already exists`);
    logWorker(host, `🚀 Launching worker ${workerId}`);
    const workerUrl = new URL("./worker-bootstrap.js", import.meta.url);
    const worker = new Worker(workerUrl, {
        type: "module",
    });
    let workerBus;
    try {
        workerBus = createChildBus(worker, {
            debug: host._options.debug,
            workerLabel: `${host._options.workerLabel}/${workerId}`,
            workerId,
            ...(options.busOptions ?? {}),
        });
    }
    catch (error) {
        worker.terminate();
        throw error;
    }
    const startup = new AbortController();
    const registrationId = createWorkerRegistrationId(workerId);
    const workerInfo = {
        workerId, worker, bus: workerBus, modulePath: workerModulePath,
        cancelStartup: () => startup.abort(),
        registrationId,
    };
    host._managedWorkers.set(workerId, workerInfo);
    try {
        await awaitWorkerAcknowledgement({
            bus: workerBus, worker, workerId, event: "wrk_ready", signal: startup.signal,
            timeoutMs: host._options.workerStartupTimeoutMs,
            start: () => workerBus.send("wrk_init", { modulePath: workerModulePath, workerId }),
        });
        if (host._brokerReady && workerId !== "broker") {
            await registerWorkerWithBroker(host, workerId, worker, startup.signal, registrationId);
        }
        assertStartupCurrent(host, workerInfo, startup.signal);
        delete workerInfo.cancelStartup;
        logWorker(host, `✅ Worker ${workerId} ready`);
        return workerInfo;
    }
    catch (error) {
        if (host._managedWorkers.get(workerId) === workerInfo)
            terminateWorker(host, workerId);
        throw error;
    }
}
export function getWorker(host, workerId) {
    return host._managedWorkers.get(workerId);
}
export function terminateWorker(host, workerId) {
    const workerInfo = host._managedWorkers.get(workerId);
    if (workerInfo) {
        workerInfo.cancelStartup?.();
        workerInfo.bus.destroy();
        workerInfo.worker.terminate();
        host._managedWorkers.delete(workerId);
        host._workerPorts.get(workerId)?.close();
        host._workerPorts.delete(workerId);
        if (workerId !== "broker")
            host._brokerBus?.send("unregister_worker", { workerId, registrationId: workerInfo.registrationId });
    }
}
//# sourceMappingURL=bus-workers.js.map