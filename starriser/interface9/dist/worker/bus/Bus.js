/**
 * Bus facade — public API for postMessage RPC, priority queues, and broker pub/sub.
 *
 * Internals live in:
 *   bus-types.ts   — message shapes, priorities, guards
 *   bus-pubsub.ts  — broker enable / publish / subscribe
 *   bus-workers.ts — launch / terminate managed workers
 *
 * Message format (for V8 optimization):
 *   b: boolean      // Bus message marker
 *   t: string       // Event type
 *   d: unknown      // Data payload
 *   p: 0|1|2        // Priority: 0=real-time, 1=normal, 2=background
 *   e: 0|1|2        // Event kind: 0=event, 1=request, 2=response
 *   i: integer      // Request/response id (if needed)
 */
import { isBusMessage, isRecord, serializeBusMessage, } from "./bus-types.js";
import * as pubsub from "./bus-pubsub.js";
import * as workers from "./bus-workers.js";
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
        this._brokerWorker = null;
        this._brokerBus = null;
        this._brokerReady = false;
        this._workerPorts = new Map();
        this._subscriptions = new Map();
        this._brokerPort = null;
        this._bindReceive = this._onReceive.bind(this);
        this._setupMessageListener();
        this._startProcessor();
    }
    isPubSubReady() {
        return this._brokerReady;
    }
    hasBrokerPort() {
        return this._brokerPort !== null;
    }
    getDebugLevel() {
        return typeof this._options.debug === "number" ? this._options.debug : 0;
    }
    async enablePubSub() {
        return pubsub.enablePubSub(this);
    }
    async registerWorkerWithBroker(workerId, worker) {
        return pubsub.registerWorkerWithBroker(this, workerId, worker);
    }
    setupBrokerPort(brokerPort) {
        pubsub.setupBrokerPort(this, brokerPort);
    }
    _handleBrokerMessage(message) {
        pubsub.handleBrokerMessage(this, message);
    }
    _handlePubMessage(topic, data, senderId) {
        pubsub.handlePubMessage(this, topic, data, senderId);
    }
    publish(topic, data, priority = 1) {
        pubsub.publish(this, topic, data, priority);
    }
    subscribe(topic, handler) {
        pubsub.subscribe(this, topic, handler);
    }
    unsubscribe(topic, handler) {
        pubsub.unsubscribe(this, topic, handler);
    }
    async getBrokerStatus() {
        return pubsub.getBrokerStatus(this);
    }
    getWorkerPort(workerId) {
        return pubsub.getWorkerPort(this, workerId);
    }
    sendToWorker(workerId, type, data, priority = 1) {
        pubsub.sendToWorker(this, workerId, type, data, priority);
    }
    static serializeMessage(t, d, p, e, i) {
        return serializeBusMessage(t, d, p, e, i);
    }
    async launchWorker(workerModulePath, options = {}) {
        return workers.launchWorker(this, (endpoint, busOptions) => new Bus(endpoint, busOptions), workerModulePath, options);
    }
    getWorker(workerId) {
        return workers.getWorker(this, workerId);
    }
    terminateWorker(workerId) {
        workers.terminateWorker(this, workerId);
    }
    on(t, handler, _options) {
        if (!this._listeners[t])
            this._listeners[t] = [];
        this._listeners[t].push(handler);
    }
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
    _send_base(t, d, p, e = 0) {
        const msg = serializeBusMessage(t, d, p, e);
        this._sendLocal(t, msg);
        this._sendToTarget(msg);
    }
    send(t, d) {
        this._send_base(t, d, 1, 0);
    }
    send_realtime(t, d) {
        this._send_base(t, d, 0, 0);
    }
    send_background(t, d) {
        this._send_base(t, d, 2, 0);
    }
    _request_base(t, d, p, timeoutMs = 5000) {
        const requestId = this._counter++;
        const msg = serializeBusMessage(t, d, p, 1, requestId);
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
    request_realtime(t, d, timeoutMs = 5000) {
        return this._request_base(t, d, 0, timeoutMs);
    }
    request(t, d, timeoutMs = 5000) {
        return this._request_base(t, d, 1, timeoutMs);
    }
    request_background(t, d, timeoutMs = 5000) {
        return this._request_base(t, d, 2, timeoutMs);
    }
    respond(requestId, t, d, p = 0) {
        const msg = serializeBusMessage(t, d, p, 2, requestId);
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
        if (this._brokerBus) {
            this._brokerBus.send("cleanup", {});
        }
        for (const port of this._workerPorts.values()) {
            try {
                port.close();
            }
            catch (error) {
                // Port might already be closed
            }
        }
        this._workerPorts.clear();
        if (this._brokerPort) {
            try {
                this._brokerPort.close();
            }
            catch (error) {
                // Port might already be closed
            }
            this._brokerPort = null;
        }
        for (const [workerId] of this._managedWorkers) {
            this.terminateWorker(workerId);
        }
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
    _onReceive(e) {
        const m = e.data;
        if (!isBusMessage(m))
            return;
        this._processMessage(m);
    }
    _processMessage(m) {
        if (m.t === "setup_broker_port" && isRecord(m.d)) {
            const brokerPort = m.d.brokerPort;
            if (brokerPort instanceof MessagePort) {
                this.setupBrokerPort(brokerPort);
            }
            this._sendLocal(m.t, m);
            return;
        }
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
        let maxDuration = 2;
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