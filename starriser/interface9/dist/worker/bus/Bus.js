/**
 * Micro-optimized Bus implementation with minimal serialization overhead.
 *
 * Message format (for V8 optimization):
 *   b: boolean      // Bus message marker
 *   t: string       // Event type
 *   d: unknown      // Data payload
 *   p: 0|1|2        // Priority: 0=real-time, 1=normal, 2=background
 *   e: 0|1|2        // Event kind: 0=event, 1=request, 2=response
 *   i: integer      // Request/response id (if needed)
 */
const isRecord = (value) => typeof value === "object" && value !== null;
const isBusMessage = (value) => {
    if (!isRecord(value))
        return false;
    return (value.b === true &&
        typeof value.t === "string" &&
        typeof value.p === "number" &&
        typeof value.e === "number");
};
export class Bus {
    /**
     * @param {BusEndpoint} endpoint - postMessage target or self
     * @param {BusOptions} [options] - Configuration options (debug: number, workerLabel: string)
     */
    constructor(endpoint, options = {}) {
        if (!endpoint)
            throw new Error("Bus requires a postMessage endpoint");
        this._target = endpoint;
        this._options = {
            debug: options.debug ?? 0,
            workerLabel: options.workerLabel ?? "",
            workerId: options.workerId ?? null,
            ...options,
        };
        this._counter = 1;
        this._listeners = {};
        this._pendingRequests = new Map();
        this._normalQueue = [];
        this._backgroundQueue = [];
        this._processing = false;
        this._normalQueueMessagesProcessed = null;
        this._managedWorkers = new Map();
        this._workerIdCounter = 1;
        // Pub/Sub broker system
        this._brokerWorker = null;
        this._brokerBus = null;
        this._brokerReady = false;
        // MessageChannel ports for direct worker communication
        this._workerPorts = new Map();
        this._subscriptions = new Map();
        // MessageChannel port for broker communication (when in worker)
        this._brokerPort = null;
        this._bindReceive = this._onReceive.bind(this);
        this._setupMessageListener();
        this._startProcessor();
    }
    /**
     * Enable pub/sub system by launching broker worker (main thread only)
     */
    async enablePubSub() {
        if (this._brokerReady)
            return;
        // Only main thread can launch the broker worker
        if (typeof window === "undefined") {
            throw new Error("Pub/sub can only be enabled on main thread");
        }
        if (this._options.debug && this._options.debug >= 1) {
            console.log("🚀 Enabling pub/sub system");
        }
        try {
            // Launch broker worker
            const brokerInfo = await this.launchWorker("./broker-worker.js", {
                workerId: "broker",
                busOptions: { debug: this._options.debug, brokerMode: true },
            });
            this._brokerWorker = brokerInfo.worker;
            this._brokerBus = brokerInfo.bus;
            // Wait for broker to be ready
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error("Broker initialization timeout"));
                }, 5000);
                this._brokerBus?.on("worker_ready", (data) => {
                    const role = isRecord(data) ? data.role : undefined;
                    if (role === "broker") {
                        clearTimeout(timeout);
                        this._brokerReady = true;
                        resolve();
                    }
                });
            });
            // Set up main thread to receive pub/sub messages from broker
            this._brokerBus?.on("pub_message", (data) => {
                if (!isRecord(data))
                    return;
                const topic = typeof data.topic === "string" ? data.topic : "";
                const payload = data.data;
                const senderId = typeof data.senderId === "string" ? data.senderId : undefined;
                if (topic) {
                    this._handlePubMessage(topic, payload, senderId);
                }
            });
            if (this._options.debug && this._options.debug >= 1) {
                console.log("✅ Pub/sub system ready");
            }
        }
        catch (error) {
            console.error("❌ Failed to enable pub/sub:", error);
            throw error;
        }
    }
    /**
     * Register a worker with the broker for pub/sub communication
     */
    async registerWorkerWithBroker(workerId, worker) {
        if (!this._brokerReady) {
            throw new Error("Pub/sub not enabled. Call enablePubSub() first.");
        }
        // Create MessageChannel for direct broker-worker communication
        const channel = new MessageChannel();
        const mainPort = channel.port1;
        const workerPort = channel.port2;
        // Store the main port for potential direct communication
        this._workerPorts.set(workerId, mainPort);
        if (!this._brokerBus) {
            throw new Error("Broker bus missing");
        }
        // Send worker port to broker using direct postMessage for port transfer
        const brokerTarget = this._brokerBus._target;
        brokerTarget.postMessage({
            b: true,
            t: "register_worker",
            d: { workerId, port: mainPort },
            p: 1,
            e: 0,
        }, [mainPort]);
        // Send broker port to worker
        worker.postMessage({
            b: true,
            t: "setup_broker_port",
            d: { brokerPort: workerPort },
            p: 0,
            e: 0,
        }, [workerPort]);
        if (this._options.debug && this._options.debug >= 1) {
            console.log(`🔗 Registered worker ${workerId} with broker`);
        }
    }
    /**
     * Setup broker port for worker-side communication
     */
    setupBrokerPort(brokerPort) {
        if (this._brokerPort) {
            console.warn("Broker port already set up");
            return;
        }
        if (!brokerPort || typeof brokerPort !== "object") {
            console.error("Invalid broker port provided:", brokerPort);
            throw new Error("Invalid MessagePort provided for broker setup");
        }
        try {
            this._brokerPort = brokerPort;
            this._brokerPort.onmessage = (event) => {
                try {
                    this._handleBrokerMessage(event.data);
                }
                catch (error) {
                    console.error("Error handling broker message:", error);
                }
            };
            this._brokerPort.onmessageerror = (event) => {
                console.error("Broker port message error:", event);
            };
            this._brokerPort.start();
            if (this._options.debug && this._options.debug >= 1) {
                console.log("🔗 Broker port set up for worker");
            }
        }
        catch (error) {
            console.error("Failed to setup broker port:", error);
            this._brokerPort = null;
            throw error;
        }
    }
    /**
     * Handle messages from broker (worker-side)
     */
    _handleBrokerMessage(message) {
        if (!isBusMessage(message))
            return;
        const type = message.t;
        const data = message.d;
        if (type === "pub_message" && isRecord(data)) {
            const topic = typeof data.topic === "string" ? data.topic : "";
            const payload = data.data;
            const senderId = typeof data.senderId === "string" ? data.senderId : undefined;
            if (topic) {
                this._handlePubMessage(topic, payload, senderId);
            }
        }
    }
    /**
     * Handle published messages for local subscribers
     */
    _handlePubMessage(topic, data, senderId) {
        const handlers = this._subscriptions.get(topic);
        if (handlers) {
            for (const handler of handlers) {
                try {
                    handler(data, { topic, senderId });
                }
                catch (err) {
                    console.error(`Pub/sub handler error for topic ${topic}:`, err);
                }
            }
        }
        if (this._options.debug && this._options.debug >= 2) {
            console.log(`📨 Received pub message on topic "${topic}" from ${senderId}`, data);
        }
    }
    /**
     * Publish a message to a topic
     */
    publish(topic, data, priority = 1) {
        // Main thread: use broker bus
        if (this._brokerBus && this._brokerReady) {
            if (priority === 0) {
                this._brokerBus.send_realtime("publish", { topic, data });
            }
            else if (priority === 2) {
                this._brokerBus.send_background("publish", { topic, data });
            }
            else {
                this._brokerBus.send("publish", { topic, data });
            }
            if (this._options.debug && this._options.debug >= 2) {
                console.log(`📤 Main published to "${topic}":`, data);
            }
            return;
        }
        // Worker thread: use broker port
        if (!this._brokerPort) {
            throw new Error("Pub/sub not enabled. Worker must receive broker port first.");
        }
        const message = {
            b: true,
            t: "publish",
            d: { topic, data },
            p: priority,
            e: 0,
        };
        this._brokerPort.postMessage(message);
        if (this._options.debug && this._options.debug >= 2) {
            console.log(`📤 Worker published to "${topic}":`, data);
        }
    }
    /**
     * Subscribe to a topic
     */
    subscribe(topic, handler) {
        // Add to local subscriptions
        if (!this._subscriptions.has(topic)) {
            this._subscriptions.set(topic, new Set());
        }
        this._subscriptions.get(topic)?.add(handler);
        // Main thread: use broker bus
        if (this._brokerBus && this._brokerReady) {
            this._brokerBus.send("subscribe", { topic });
            if (this._options.debug && this._options.debug >= 1) {
                console.log(`📢 Main subscribed to "${topic}"`);
            }
            return;
        }
        // Worker thread: use broker port
        if (!this._brokerPort) {
            throw new Error("Pub/sub not enabled. Worker must receive broker port first.");
        }
        const message = {
            b: true,
            t: "subscribe",
            d: { topic },
            p: 1,
            e: 0,
        };
        this._brokerPort.postMessage(message);
        if (this._options.debug && this._options.debug >= 1) {
            console.log(`📢 Worker subscribed to "${topic}"`);
        }
    }
    /**
     * Unsubscribe from a topic
     */
    unsubscribe(topic, handler) {
        const handlers = this._subscriptions.get(topic);
        if (handlers) {
            handlers.delete(handler);
            if (handlers.size === 0) {
                this._subscriptions.delete(topic);
                // Main thread: use broker bus
                if (this._brokerBus && this._brokerReady) {
                    this._brokerBus.send("unsubscribe", { topic });
                    if (this._options.debug && this._options.debug >= 1) {
                        console.log(`🔇 Main unsubscribed from "${topic}"`);
                    }
                    return;
                }
                // Worker thread: use broker port
                if (!this._brokerPort) {
                    console.warn("Pub/sub not enabled, cannot unsubscribe");
                    return;
                }
                const message = {
                    b: true,
                    t: "unsubscribe",
                    d: { topic },
                    p: 1,
                    e: 0,
                };
                this._brokerPort.postMessage(message);
                if (this._options.debug && this._options.debug >= 1) {
                    console.log(`🔇 Worker unsubscribed from "${topic}"`);
                }
            }
        }
    }
    /**
     * Get broker status for debugging and monitoring
     */
    async getBrokerStatus() {
        if (!this._brokerReady || !this._brokerBus) {
            return {
                enabled: false,
                ready: false,
                error: "Pub/sub system not enabled or broker not ready",
            };
        }
        try {
            const status = await this._brokerBus.request("get_status", {}, 2000);
            return {
                enabled: true,
                ready: true,
                broker: status,
                localWorkers: Array.from(this._workerPorts.keys()),
                localSubscriptions: Array.from(this._subscriptions.keys()),
            };
        }
        catch (error) {
            return {
                enabled: true,
                ready: false,
                error: error instanceof Error ? error.message : "Unknown error",
                localWorkers: Array.from(this._workerPorts.keys()),
                localSubscriptions: Array.from(this._subscriptions.keys()),
            };
        }
    }
    /**
     * Get a MessagePort for direct communication with a specific worker
     */
    getWorkerPort(workerId) {
        return this._workerPorts.get(workerId) || null;
    }
    /**
     * Send message directly to a worker via its MessagePort
     */
    sendToWorker(workerId, type, data, priority = 1) {
        const port = this._workerPorts.get(workerId);
        if (!port) {
            throw new Error(`No port found for worker ${workerId}`);
        }
        const message = {
            b: true,
            t: type,
            d: data,
            p: priority,
            e: 0,
        };
        port.postMessage(message);
        if (this._options.debug && this._options.debug >= 2) {
            console.log(`📤 Direct message to ${workerId}:`, type, data);
        }
    }
    /**
     * Micro-optimized message serializer. Always call this to construct messages!
     */
    static serializeMessage(t, d, p, e, i) {
        if (i !== undefined) {
            return { b: true, t, d, p, e, i };
        }
        return { b: true, t, d, p, e };
    }
    /**
     * Launch a worker dynamically with automatic Bus setup
     */
    async launchWorker(workerModulePath, options = {}) {
        const workerId = options.workerId || `worker_${this._workerIdCounter++}`;
        if (this._options.debug && this._options.debug >= 1) {
            console.log(`🚀 Launching worker ${workerId}`);
        }
        const workerUrl = new URL("./worker-bootstrap.js", import.meta.url);
        const worker = new Worker(workerUrl, {
            type: "module",
        });
        const workerBus = new Bus(worker, {
            debug: this._options.debug,
            workerLabel: `${this._options.workerLabel}/${workerId}`,
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
        this._managedWorkers.set(workerId, workerInfo);
        // Register with broker system if enabled
        if (this._brokerReady && workerId !== "broker") {
            try {
                await this.registerWorkerWithBroker(workerId, worker);
            }
            catch (error) {
                console.error(`Failed to register worker ${workerId} with broker:`, error);
            }
        }
        if (this._options.debug && this._options.debug >= 1) {
            console.log(`✅ Worker ${workerId} ready`);
        }
        return workerInfo;
    }
    getWorker(workerId) {
        return this._managedWorkers.get(workerId);
    }
    terminateWorker(workerId) {
        const workerInfo = this._managedWorkers.get(workerId);
        if (workerInfo) {
            workerInfo.bus.destroy();
            workerInfo.worker.terminate();
            this._managedWorkers.delete(workerId);
        }
    }
    /**
     * Register a listener for a given event type.
     */
    on(t, handler, _options) {
        if (!this._listeners[t])
            this._listeners[t] = [];
        this._listeners[t].push(handler);
    }
    /**
     * Remove event listener(s).
     */
    off(t, handler) {
        if (!this._listeners[t])
            return;
        if (!handler) {
            delete this._listeners[t];
        }
        else {
            this._listeners[t] = this._listeners[t].filter((h) => h !== handler);
            if (this._listeners[t].length === 0)
                delete this._listeners[t];
        }
    }
    /**
     * Internal send for a specific priority/eventType, not for direct user code.
     */
    _send_base(t, d, p, e = 0) {
        const msg = Bus.serializeMessage(t, d, p, e);
        this._sendLocal(t, msg);
        this._sendToTarget(msg);
    }
    /**
     * Send a normal priority event.
     */
    send(t, d) {
        this._send_base(t, d, 1, 0);
    }
    /**
     * Send a real-time (highest-priority) event.
     */
    send_realtime(t, d) {
        this._send_base(t, d, 0, 0);
    }
    /**
     * Send a background (lowest-priority) event.
     */
    send_background(t, d) {
        this._send_base(t, d, 2, 0);
    }
    /**
     * Internal request for a specific priority, not for direct user code.
     */
    _request_base(t, d, p, timeoutMs = 5000) {
        const requestId = this._counter++;
        const msg = Bus.serializeMessage(t, d, p, 1, requestId);
        return new Promise((resolve, reject) => {
            const resolveUnknown = (value) => resolve(value);
            const rejectUnknown = (reason) => reject(reason);
            this._pendingRequests.set(requestId, {
                resolve: resolveUnknown,
                reject: rejectUnknown,
            });
            setTimeout(() => {
                if (this._pendingRequests.has(requestId)) {
                    this._pendingRequests.delete(requestId);
                    reject(new Error("Request timeout"));
                }
            }, timeoutMs);
            this._sendLocal(t, msg);
            this._sendToTarget(msg);
        });
    }
    /**
     * Make a real-time (priority 0) request, expecting a response.
     */
    request_realtime(t, d, timeoutMs = 5000) {
        return this._request_base(t, d, 0, timeoutMs);
    }
    /**
     * Make a normal (priority 1) request, expecting a response.
     */
    request(t, d, timeoutMs = 5000) {
        return this._request_base(t, d, 1, timeoutMs);
    }
    /**
     * Make a background (priority 2) request, expecting a response.
     */
    request_background(t, d, timeoutMs = 5000) {
        return this._request_base(t, d, 2, timeoutMs);
    }
    /**
     * Respond to a request.
     */
    respond(requestId, t, d, p = 0) {
        const msg = Bus.serializeMessage(t, d, p, 2, requestId);
        this._sendLocal(t, msg);
        this._sendToTarget(msg);
    }
    _sendLocal(t, m) {
        const localHandlers = this._listeners[t];
        if (!localHandlers)
            return;
        for (const handler of localHandlers) {
            try {
                handler(m.d, { id: m.i, eventType: m.e, priority: m.p });
            }
            catch (err) {
                // Local handler error
            }
        }
    }
    _sendToTarget(m) {
        if (this._target && typeof this._target.postMessage === "function") {
            const target = this._target;
            target.postMessage(m);
        }
    }
    destroy() {
        // Notify broker about cleanup
        if (this._brokerBus) {
            this._brokerBus.send("cleanup", {});
        }
        // Close all worker ports
        for (const port of this._workerPorts.values()) {
            try {
                port.close();
            }
            catch (error) {
                // Port might already be closed
            }
        }
        this._workerPorts.clear();
        // Close broker port if we have one
        if (this._brokerPort) {
            try {
                this._brokerPort.close();
            }
            catch (error) {
                // Port might already be closed
            }
            this._brokerPort = null;
        }
        // Terminate all managed workers
        for (const [workerId] of this._managedWorkers) {
            this.terminateWorker(workerId);
        }
        // Clean up broker worker
        if (this._brokerWorker) {
            this._brokerWorker.terminate();
            this._brokerWorker = null;
            this._brokerBus = null;
            this._brokerReady = false;
        }
        this._removeMessageListener();
        this._listeners = {};
        this._pendingRequests.clear();
        this._subscriptions.clear();
    }
    _setupMessageListener() {
        if (typeof window !== "undefined" && this._target === window) {
            window.addEventListener("message", this._bindReceive, false);
        }
        else if (typeof self !== "undefined" && this._target === self) {
            self.addEventListener("message", this._bindReceive, false);
        }
        else {
            this._target.addEventListener("message", this._bindReceive, false);
        }
    }
    _removeMessageListener() {
        if (typeof window !== "undefined" && this._target === window) {
            window.removeEventListener("message", this._bindReceive, false);
        }
        else if (typeof self !== "undefined" && this._target === self) {
            self.removeEventListener("message", this._bindReceive, false);
        }
        else {
            this._target.removeEventListener("message", this._bindReceive, false);
        }
    }
    /**
     * Micro-optimized message receive logic:
     * - Only processes objects with { b: true }
     */
    _onReceive(e) {
        const m = e.data;
        if (!isBusMessage(m))
            return;
        this._processMessage(m);
    }
    /**
     * Always check event type numerically.
     */
    _processMessage(m) {
        // Handle special setup messages immediately
        if (m.t === "setup_broker_port" && isRecord(m.d)) {
            const brokerPort = m.d.brokerPort;
            if (brokerPort instanceof MessagePort) {
                this.setupBrokerPort(brokerPort);
            }
            this._sendLocal(m.t, m);
            return;
        }
        // Handle a response: resolve the pending promise
        if (m.e === 2 && m.i !== undefined && this._pendingRequests.has(m.i)) {
            const pending = this._pendingRequests.get(m.i);
            this._pendingRequests.delete(m.i);
            pending?.resolve(m.d);
            return;
        }
        const prio = typeof m.p === "number" ? m.p : 1;
        if (prio === 0) {
            this._executeMessage(m);
        }
        else if (prio === 1) {
            this._normalQueue.push(m);
        }
        else {
            this._backgroundQueue.push(m);
        }
    }
    _startProcessor() {
        const process = () => {
            this._processQueues();
            requestAnimationFrame(process);
        };
        requestAnimationFrame(process);
    }
    _processQueues() {
        if (this._processing)
            return;
        this._processing = true;
        const startTime = performance.now();
        let maxDuration = 2; // Start with 2ms budget for processing
        let messagesProcessed = 0;
        if (this._normalQueueMessagesProcessed) {
            if (this._normalQueue.length > this._normalQueueMessagesProcessed * 3) {
                maxDuration = Math.min((maxDuration * this._normalQueue.length) /
                    this._normalQueueMessagesProcessed, 64);
                console.log("Processing normal queue too slow", "duration assigned", maxDuration, "current queue length", this._normalQueue.length, "queue speed", this._normalQueueMessagesProcessed);
            }
        }
        let time_exhausted = true;
        while (performance.now() - startTime < maxDuration) {
            messagesProcessed++;
            if (this._normalQueue.length > 0) {
                const m = this._normalQueue.shift();
                if (m)
                    this._executeMessage(m);
            }
            else if (this._backgroundQueue.length > 0) {
                const m = this._backgroundQueue.shift();
                if (m)
                    this._executeMessage(m);
            }
            else {
                time_exhausted = false;
                break;
            }
        }
        if (time_exhausted) {
            console.log("Normal queue exhausted");
            this._normalQueueMessagesProcessed = messagesProcessed;
        }
        else {
            this._normalQueueMessagesProcessed = null;
        }
        this._processing = false;
    }
    _executeMessage(m) {
        const handlers = this._listeners[m.t];
        if (!handlers)
            return;
        for (const handler of handlers) {
            try {
                handler(m.d, { id: m.i, eventType: m.e, priority: m.p });
            }
            catch (err) {
                // Handler error
            }
        }
    }
}
//# sourceMappingURL=Bus.js.map