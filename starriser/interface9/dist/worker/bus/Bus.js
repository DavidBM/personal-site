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
import { createBusDispatcher } from "./bus-dispatcher.js";
import { isBusControl } from "./bus-control.js";
import { createServiceClient } from './service-client.js';
import { isServiceDelivery, sendService } from './service-transport.js';
import { createBusAdmission } from './bus-admission.js';
export class Bus {
    /**
     * @param {BusEndpoint} endpoint - postMessage target or self
     * @param {BusOptions} [options] - Configuration options (debug: number, workerLabel: string)
     */
    constructor(endpoint, options = {}) {
        this._destroyed = false;
        this._messageSinks = new Map();
        this._lifetime = new AbortController();
        this._orderedMessages = new Map();
        this._orderedTopics = new Map();
        this._reportedCodes = new Set();
        this._failureCount = 0;
        this._lastFailure = null;
        this._receiveError = () => this._reportFailure({ code: "MESSAGE_ERROR", message: "Bus message could not be cloned or decoded" });
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
        this._listeners = Object.create(null);
        this._pendingRequests = new Map();
        this._dispatcher = createBusDispatcher(this._options, delivery => this._executeDelivery(delivery), (delivery, reason) => this._deliveryFailure(delivery, "HANDLER_ERROR", reason));
        this._admission = createBusAdmission((size, signal) => (this._messageSinks.get(size.type ?? '') ?? this._dispatcher).reserve(size, signal), message => ({ bytes: this._dispatcher.estimate(message), control: isBusControl(message), type: message.t }), error => this._reportFailure({ code: 'SEND_ERROR', message: error.message }));
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
    }
    isPubSubReady() {
        return this._brokerReady;
    }
    bind(identity, declarations) {
        return (this._services ?? (this._services = createServiceClient(this))).bind(identity, declarations);
    }
    getServiceGraph() {
        return (this._services ?? (this._services = createServiceClient(this))).graph();
    }
    setServiceTrace(options) {
        return (this._services ?? (this._services = createServiceClient(this))).trace(options);
    }
    _sendServicePacket(packet, priority, ordered, signal) {
        if (this._destroyed)
            throw new Error('Bus destroyed');
        return this._observe(sendService(this, packet, priority, ordered, signal));
    }
    isDestroyed() { return this._destroyed; }
    /** The transport owner aborts active work and attached resources on teardown. */
    get signal() { return this._lifetime.signal; }
    hasBrokerPort() {
        return this._brokerPort !== null;
    }
    getDebugLevel() {
        return typeof this._options.debug === "number" ? this._options.debug : 0;
    }
    async enablePubSub() {
        if (this._destroyed)
            throw new Error("Bus destroyed");
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
    _handlePubMessage(topic, data, senderId, priority = 1) {
        pubsub.handlePubMessage(this, topic, data, senderId, priority);
    }
    publish(topic, data, priority = 1) {
        return this._observe(this.publishWithBackpressure(topic, data, priority));
    }
    publishWithBackpressure(topic, data, priority = 1, options = {}) {
        return pubsub.publishWithBackpressure(this, topic, data, priority, options);
    }
    publishAndIgnoreAfterTimeout(topic, data, maxQueueAgeMs, priority = 1) {
        return this._observe(pubsub.publishExpiring(this, topic, data, this._expiry(maxQueueAgeMs), priority));
    }
    subscribe(topic, handler, options) {
        if (this._destroyed)
            return;
        this._setOrdering(this._orderedTopics, topic, options);
        pubsub.subscribe(this, topic, handler);
    }
    unsubscribe(topic, handler) {
        pubsub.unsubscribe(this, topic, handler);
        if (!this._subscriptions.has(topic))
            this._orderedTopics.delete(topic);
    }
    async getBrokerStatus() {
        return pubsub.getBrokerStatus(this);
    }
    static serializeMessage(t, d, p, e, i) {
        return serializeBusMessage(t, d, p, e, i);
    }
    async launchWorker(workerModulePath, options = {}) {
        if (this._destroyed)
            throw new Error("Bus destroyed");
        return workers.launchWorker(this, (endpoint, busOptions) => new Bus(endpoint, busOptions), workerModulePath, options);
    }
    getWorker(workerId) {
        return workers.getWorker(this, workerId);
    }
    terminateWorker(workerId) {
        workers.terminateWorker(this, workerId);
    }
    on(t, handler, options) {
        if (this._destroyed)
            return;
        this._setOrdering(this._orderedMessages, t, options);
        if (!this._listeners[t])
            this._listeners[t] = [];
        this._listeners[t].push(handler);
    }
    off(t, handler) {
        if (!this._listeners[t])
            return;
        if (!handler) {
            delete this._listeners[t];
            this._orderedMessages.delete(t);
        }
        else {
            this._listeners[t] = this._listeners[t].filter((h) => h !== handler);
            if (this._listeners[t].length === 0) {
                delete this._listeners[t];
                this._orderedMessages.delete(t);
            }
        }
    }
    _send_base(t, d, p, _e = 0) {
        return this._observe(this.sendWithBackpressure(t, d, p));
    }
    send(t, d) {
        return this._send_base(t, d, 1, 0);
    }
    send_realtime(t, d) {
        return this._send_base(t, d, 0, 0);
    }
    send_background(t, d) {
        return this._send_base(t, d, 2, 0);
    }
    sendWithBackpressure(t, d, priority = 1, options = {}) {
        return this._sendAcknowledged(serializeBusMessage(t, d, priority, 0), options.signal);
    }
    sendAndIgnoreAfterTimeout(t, d, maxQueueAgeMs, priority = 1) {
        return this._observe(this._sendAcknowledged({ ...serializeBusMessage(t, d, priority, 0), x: this._expiry(maxQueueAgeMs) }));
    }
    _expiry(age) {
        if (!Number.isFinite(age) || age <= 0 || age > 0x7fffffff)
            throw new Error('Queue age must be positive and fit the platform timer range');
        return performance.timeOrigin + performance.now() + age;
    }
    async _sendAcknowledged(message, signal) {
        if (this._destroyed || signal?.aborted)
            throw new Error('Bus send canceled');
        await this._admission.send(this._target, message, signal);
        if (this._listeners[message.t])
            await this._enqueue({ message, local: true });
    }
    _observe(waiting) {
        void waiting.catch(error => this._reportFailure({ code: 'SEND_ERROR', message: String(error) }));
        return waiting;
    }
    _measureForAdmission(message) { return this._admission.measurement(message); }
    _reserveTo(target, message, signal, measurement) {
        return this._admission.prepare(target, message, signal, measurement);
    }
    _sendOn(target, message, signal) {
        return this._admission.send(target, message, signal);
    }
    _disconnectEndpoint(target) { this._admission.disconnect(target); }
    _admissionRequestSignal(target, id) { return this._admission.requestSignal(target, id); }
    _finishAdmissionRequest(target, id) { this._admission.finishRequest(target, id); }
    _setMessageSink(type, sink) { this._messageSinks.set(type, sink); }
    _reserveIngress(size, signal) { return this._dispatcher.reserve(size, signal); }
    _receiveFrom(target, message, deliver = (value, credit) => this._processMessage(value, credit)) {
        this._admission.receive(target, message, deliver);
    }
    _requestOn(target, t, d, priority, options = {}, expiresAt) {
        if (this._destroyed || options.signal?.aborted)
            return Promise.reject(new Error('Bus request canceled'));
        const id = this._counter++;
        return new Promise((resolve, reject) => {
            let reservation;
            const abort = () => {
                this._resolveRequest(id, undefined, { code: 'SEND_ERROR', message: 'Bus request canceled' });
            };
            this._pendingRequests.set(id, { resolve: () => resolve(), reject,
                cleanup: () => { options.signal?.removeEventListener('abort', abort); reservation?.cancel(); } });
            options.signal?.addEventListener('abort', abort, { once: true });
            // Routing can await several recipient queues. Keep one publisher's next
            // publication behind that admission; worker wrappers scope this lane to
            // their incarnation, while subscriber handler completion stays separate.
            void this._reserveTo(target, { ...serializeBusMessage(t, d, priority, 1, id),
                o: t === 'publish' ? 'publication' : undefined, x: expiresAt }, options.signal)
                .then(async (credit) => { reservation = credit; if (credit)
                await credit.send(); })
                .catch(error => this._resolveRequest(id, undefined, { code: 'SEND_ERROR', message: String(error) }));
        });
    }
    _request_base(t, d, p, timeoutMs = 5000) {
        if (this._destroyed)
            return Promise.reject(new Error("Bus destroyed"));
        const requestId = this._counter++;
        const msg = serializeBusMessage(t, d, p, 1, requestId);
        return new Promise((resolve, reject) => {
            const resolveUnknown = (value) => resolve(value);
            const rejectUnknown = (reason) => reject(reason);
            const timeout = setTimeout(() => {
                if (this._pendingRequests.has(requestId)) {
                    this._pendingRequests.delete(requestId);
                    reject(new Error("Request timeout"));
                }
            }, timeoutMs);
            this._pendingRequests.set(requestId, {
                resolve: resolveUnknown,
                reject: rejectUnknown,
                timeout,
            });
            try {
                this._sendToTarget(msg);
                this._sendLocal(t, msg);
            }
            catch (error) {
                clearTimeout(timeout);
                this._pendingRequests.delete(requestId);
                reject(error);
            }
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
        if (this._destroyed)
            return;
        const msg = serializeBusMessage(t, d, p, 2, requestId);
        this._sendToTarget(msg);
        this._sendLocal(t, msg);
    }
    _sendLocal(t, m) {
        if (!this._listeners[t])
            return;
        this._observe(this._enqueue({ message: m, local: true }));
    }
    _sendToTarget(m) {
        return this._observe(this._sendOn(this._target, m));
    }
    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this._lifetime.abort();
        this._admission.dispose();
        this._dispatcher.dispose();
        if (this._brokerBus) {
            try {
                this._brokerBus.send("cleanup", {});
            }
            catch { /* Continue local teardown if the remote endpoint failed. */ }
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
        this._listeners = Object.create(null);
        this._rejectPendingRequests();
        this._subscriptions.clear();
        this._orderedMessages.clear();
        this._orderedTopics.clear();
        this._messageSinks.clear();
    }
    _rejectPendingRequests() {
        for (const pending of this._pendingRequests.values()) {
            clearTimeout(pending.timeout);
            pending.cleanup?.();
            pending.reject(new Error("Bus destroyed"));
        }
        this._pendingRequests.clear();
    }
    _setupMessageListener() {
        this._target.addEventListener("messageerror", this._receiveError);
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
        this._target.removeEventListener("messageerror", this._receiveError);
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
        if (!isBusMessage(m)) {
            if (isRecord(m) && m.b === true)
                this._reportFailure({ code: "INVALID_MESSAGE", message: "Invalid Bus envelope" });
            return;
        }
        this._receiveFrom(this._target, m);
    }
    _processMessage(m, reservation) {
        const sink = this._messageSinks.get(m.t);
        return this._observe(sink ? sink.deliver(m, reservation) : this._enqueue({ message: m }, reservation));
    }
    _resolveRequest(id, data, failure) {
        const pending = this._pendingRequests.get(id);
        if (!pending)
            return false;
        this._pendingRequests.delete(id);
        clearTimeout(pending.timeout);
        pending.cleanup?.();
        if (failure)
            pending.reject(Object.assign(new Error(failure.message), { code: failure.code }));
        else
            pending.resolve(data);
        return true;
    }
    _initializeBrokerPort(message, port) {
        try {
            if (!(port instanceof MessagePort))
                throw new Error("Invalid broker port");
            this.setupBrokerPort(port);
            return this._runBrokerSetup(message).then(() => this._acknowledgeSubscriptions(port)).catch(error => this._brokerSetupFailed(error));
        }
        catch (error) {
            this._brokerSetupFailed(error);
        }
    }
    async _runBrokerSetup(message) {
        for (const handler of this._listeners[message.t] ?? []) {
            if (this._destroyed)
                return;
            await handler(message.d, { eventType: message.e, priority: message.p, signal: this._lifetime.signal });
        }
    }
    _acknowledgeSubscriptions(port) {
        if (!this._destroyed)
            port.postMessage(serializeBusMessage("subscriptions_ready", {}, 0, 0));
    }
    _brokerSetupFailed(error) {
        this._reportFailure({ code: "HANDLER_ERROR", type: "setup_broker_port", message: this._errorText(error) });
        try {
            this.send_realtime("wrk_error", { error: this._errorText(error) });
        }
        catch { /* Send failure is already reported. */ }
    }
    _processQueues() { this._dispatcher.drain(); }
    _enqueuePublication(topic, data, senderId, priority = 1, reservation, expiresAt) {
        const key = this._orderedTopics.get(topic);
        const sender = senderId ?? "";
        return this._observe(this._enqueue({ message: { ...serializeBusMessage(topic, data, priority, 0), x: expiresAt,
                k: reservation?.bytes }, publication: { topic, senderId },
            ordered: key === undefined ? undefined : `topic:${sender.length}:${sender}:${key}` }, reservation));
    }
    _setOrdering(orders, type, options) {
        if (!options?.orderedIngress)
            return;
        const existing = orders.get(type);
        if (existing && existing !== options.orderedIngress)
            throw new Error(`Conflicting Bus ordering for ${type}`);
        orders.set(type, options.orderedIngress);
    }
    _enqueue(delivery, reservation) {
        if (this._destroyed)
            return Promise.reject(new Error('Bus destroyed'));
        if (!delivery.publication) {
            delivery.control = isBusControl(delivery.message);
            const key = this._orderedMessages.get(delivery.message.t);
            if (key !== undefined && delivery.message.e !== 2)
                delivery.ordered = `message:${key}`;
            if (delivery.message.o !== undefined)
                delivery.ordered = `service:${delivery.message.o}`;
        }
        return this._dispatcher.enqueue(delivery, reservation).catch(error => {
            this._deliveryFailure(delivery, "INVALID_MESSAGE", String(error));
            throw error;
        });
    }
    _executeDelivery(delivery) {
        if (this._destroyed)
            return;
        const m = delivery.message;
        if (this._services && isServiceDelivery(m))
            return this._services.receive(m.d);
        if (!delivery.local && m.e === 2 && m.i !== undefined && this._resolveRequest(m.i, m.d, m.failure))
            return;
        if (m.t === "setup_broker_port" && isRecord(m.d))
            return this._initializeBrokerPort(m, m.d.brokerPort);
        return this._executeHandlers(delivery);
    }
    _executeHandlers(delivery) {
        const m = delivery.message;
        const handlers = delivery.publication ? this._subscriptions.get(m.t) : this._listeners[m.t];
        if (!handlers)
            return;
        let pending;
        for (const handler of handlers) {
            const result = this._invokeHandler(handler, delivery);
            if (result)
                (pending ?? (pending = [])).push(result);
            if (this._destroyed)
                break;
        }
        if (pending)
            return Promise.all(pending).then(() => { });
    }
    _invokeHandler(handler, delivery) {
        const m = delivery.message;
        const meta = { id: m.i, eventType: m.e, priority: m.p, signal: this._lifetime.signal,
            ordered: m.o, knownBytes: m.k, admissionId: m.q,
            topic: delivery.publication?.topic ?? m.t, senderId: delivery.publication?.senderId };
        try {
            const result = handler(m.d, meta);
            if (result && typeof result.then === "function") {
                return Promise.resolve(result).then(() => { }, error => this._deliveryFailure(delivery, "HANDLER_ERROR", this._errorText(error)));
            }
        }
        catch (error) {
            this._deliveryFailure(delivery, "HANDLER_ERROR", this._errorText(error));
        }
    }
    _errorText(error) { return error instanceof Error ? error.message : String(error); }
    _serviceDeliveryFailed(message, failure) {
        this._serviceTransportFailure?.(message, failure);
        if (isServiceDelivery(message))
            this._services?.failure(message.d, { code: 'OVERLOADED', message: failure.message });
    }
    _deliveryFailure(delivery, code, message) {
        if (this._destroyed)
            return;
        const m = delivery.message;
        const failure = { code, message, type: m.t, priority: m.p, requestId: m.i };
        this._reportFailure(failure);
        this._serviceDeliveryFailed(m, failure);
        if (delivery.control && code === "QUEUE_OVERFLOW") {
            this.destroy();
            return;
        }
        if (m.e !== 1 || m.i === undefined)
            return;
        if (delivery.local) {
            this._resolveRequest(m.i, undefined, failure);
            return;
        }
        try {
            this._sendToTarget({ ...serializeBusMessage(m.t, null, 0, 2, m.i), failure });
        }
        catch { /* Send failure is already reported. */ }
    }
    _reportFailure(failure) {
        if (this._destroyed)
            return;
        failure = { ...failure, message: failure.message.slice(0, 1024), type: failure.type?.slice(0, 256) };
        this._failureCount++;
        this._lastFailure = failure;
        if (this._options.onError) {
            try {
                this._options.onError(failure);
            }
            catch { /* Diagnostics never break delivery. */ }
        }
        else if (!this._reportedCodes.has(failure.code)) {
            this._reportedCodes.add(failure.code);
            console.error(`[Bus] ${failure.code}: ${failure.message}`);
        }
    }
    getDiagnostics() {
        return { ...this._dispatcher.stats(), failures: this._failureCount, lastFailure: this._lastFailure };
    }
}
//# sourceMappingURL=Bus.js.map