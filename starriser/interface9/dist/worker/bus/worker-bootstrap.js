import { Bus } from "./Bus.js";
// Create bus instance for this worker
const bus = new Bus(self, {
    debug: 1,
    workerLabel: "BootstrapWorker",
});
let currentWorkerId = null;
let workerInstance = null;
let workerModule = null;
// Handle worker initialization
bus.on("wrk_init", async ({ modulePath, workerId }) => {
    try {
        currentWorkerId = workerId;
        bus._options.workerId = workerId;
        bus._options.workerLabel = `Worker-${workerId}`;
        const module = (await import(modulePath));
        workerModule = module;
        if (typeof workerModule.busConstructor !== "function") {
            throw new Error(`Module ${modulePath} must export a busConstructor function`);
        }
        workerInstance = workerModule.busConstructor(bus);
        bus.send_realtime("wrk_ready", { workerId, modulePath });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Worker initialization error:", error);
        bus.send_realtime("wrk_error", {
            error: message,
            workerId,
            modulePath,
        });
    }
});
// Handle instance requests
bus.on("get_instance", (data, meta) => {
    if (meta && meta.eventType === 1 && typeof meta.id === "number") {
        bus.respond(meta.id, "get_instance", {
            hasInstance: !!workerInstance,
            moduleExports: workerModule ? Object.keys(workerModule) : [],
            type: workerInstance ? typeof workerInstance : null,
        });
    }
});
// Handle broker port setup
bus.on("setup_broker_port", () => {
    const debugLevel = bus._options.debug ?? 0;
    if (debugLevel >= 1) {
        console.log(`🔗 Worker ${currentWorkerId} received broker port`);
    }
});
// Handle worker termination
bus.on("terminate_worker", () => {
    if (workerInstance && typeof workerInstance.destroy === "function") {
        workerInstance.destroy();
    }
    bus.destroy();
    self.close();
});
// Error handling
self.addEventListener("error", (errorEvent) => {
    bus.send_realtime("wrk_error", {
        error: errorEvent.message,
        filename: errorEvent.filename,
        lineno: errorEvent.lineno,
        colno: errorEvent.colno,
    });
});
self.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
    bus.send_realtime("wrk_error", {
        error: reason,
        type: "unhandledrejection",
    });
});
//# sourceMappingURL=worker-bootstrap.js.map