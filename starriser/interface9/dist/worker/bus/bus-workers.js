/**
 * Dynamic worker launch / terminate / lookup.
 * Operates on a host object with the Bus underscore fields (public by convention).
 */
import { isRecord } from "./bus-types.js";
import { registerWorkerWithBroker } from "./bus-pubsub.js";
/**
 * Launch a worker with automatic Bus setup and optional broker registration.
 */
export async function launchWorker(host, createChildBus, workerModulePath, options = {}) {
    const workerId = options.workerId || `worker_${host._workerIdCounter++}`;
    const debug = typeof host._options.debug === "number" ? host._options.debug : 0;
    if (debug >= 1) {
        console.log(`🚀 Launching worker ${workerId}`);
    }
    const workerUrl = new URL("./worker-bootstrap.js", import.meta.url);
    const worker = new Worker(workerUrl, {
        type: "module",
    });
    const workerBus = createChildBus(worker, {
        debug: host._options.debug,
        workerLabel: `${host._options.workerLabel}/${workerId}`,
        workerId: workerId,
        ...(options.busOptions ?? {}),
    });
    const workerReady = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`Worker ${workerId} initialization timeout`));
        }, 10000);
        workerBus.on("wrk_ready", () => {
            clearTimeout(timeout);
            resolve();
        });
        workerBus.on("wrk_error", (error) => {
            clearTimeout(timeout);
            const message = isRecord(error) && typeof error.error === "string"
                ? error.error
                : "Unknown error";
            reject(new Error(`Worker ${workerId} failed: ${message}`));
        });
    });
    workerBus.send("wrk_init", { modulePath: workerModulePath, workerId });
    await workerReady;
    const workerInfo = {
        workerId,
        worker,
        bus: workerBus,
        modulePath: workerModulePath,
    };
    host._managedWorkers.set(workerId, workerInfo);
    if (host._brokerReady && workerId !== "broker") {
        try {
            await registerWorkerWithBroker(host, workerId, worker);
        }
        catch (error) {
            console.error(`Failed to register worker ${workerId} with broker:`, error);
        }
    }
    if (debug >= 1) {
        console.log(`✅ Worker ${workerId} ready`);
    }
    return workerInfo;
}
export function getWorker(host, workerId) {
    return host._managedWorkers.get(workerId);
}
export function terminateWorker(host, workerId) {
    const workerInfo = host._managedWorkers.get(workerId);
    if (workerInfo) {
        workerInfo.bus.destroy();
        workerInfo.worker.terminate();
        host._managedWorkers.delete(workerId);
    }
}
//# sourceMappingURL=bus-workers.js.map