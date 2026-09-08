/**
 * Broker pub/sub: enable, register ports, publish / subscribe.
 * Operates on a host object with the Bus underscore fields (public by convention).
 */
import { isBusMessage, isRecord } from "./bus-types.js";
import { awaitWorkerAcknowledgement, createWorkerRegistrationId } from "./bus-worker-readiness.js";
import { isServiceDelivery, registerMainServiceDelivery } from './service-transport.js';
function debugLevel(host) {
    return typeof host._options.debug === "number" ? host._options.debug : 0;
}
/**
 * Enable pub/sub by launching the broker worker (main thread only).
 */
export async function enablePubSub(host) {
    if (host._brokerReady)
        return;
    if (typeof window === "undefined") {
        throw new Error("Pub/sub can only be enabled on main thread");
    }
    if (debugLevel(host) >= 1) {
        console.log("🚀 Enabling pub/sub system");
    }
    try {
        const brokerInfo = await host.launchWorker("./broker-worker.js", {
            workerId: "broker",
            busOptions: { debug: host._options.debug, brokerMode: true },
        });
        if (host.isDestroyed())
            throw new Error("Bus destroyed during broker initialization");
        if (host.getWorker("broker")?.worker !== brokerInfo.worker)
            throw new Error("Broker terminated during initialization");
        host._brokerWorker = brokerInfo.worker;
        host._brokerBus = brokerInfo.bus;
        // wrk_ready is emitted after the broker constructor has installed routing.
        host._brokerReady = true;
        registerMainServiceDelivery(host);
        host._brokerBus?._setMessageSink('pub_message', {
            reserve: (size, signal) => host._reserveIngress(size, signal),
            deliver: (message, reservation) => handleBrokerMessage(host, message, reservation),
        });
        if (debugLevel(host) >= 1) {
            console.log("✅ Pub/sub system ready");
        }
    }
    catch (error) {
        console.error("❌ Failed to enable pub/sub:", error);
        throw error;
    }
}
/**
 * Register a worker with the broker for pub/sub communication.
 */
export async function registerWorkerWithBroker(host, workerId, worker, signal, registrationId = createWorkerRegistrationId(workerId)) {
    if (!host._brokerReady) {
        throw new Error("Pub/sub not enabled. Call enablePubSub() first.");
    }
    if (!host._brokerBus)
        throw new Error("Broker bus missing");
    const brokerBus = host._brokerBus;
    const channel = new MessageChannel();
    const mainPort = channel.port1;
    const workerPort = channel.port2;
    host._workerPorts.set(workerId, mainPort);
    const brokerTarget = brokerBus._target;
    try {
        await awaitWorkerAcknowledgement({
            bus: brokerBus, worker, workerId, event: "worker_pubsub_ready", signal, registrationId,
            timeoutMs: host._options.workerStartupTimeoutMs,
            start: () => {
                brokerTarget.postMessage({ b: true, t: "register_worker", d: { workerId, registrationId, port: mainPort }, p: 1, e: 0 }, [mainPort]);
                worker.postMessage({ b: true, t: "setup_broker_port", d: { brokerPort: workerPort }, p: 0, e: 0 }, [workerPort]);
            },
        });
    }
    catch (error) {
        mainPort.close();
        workerPort.close();
        if (host._workerPorts.get(workerId) === mainPort)
            host._workerPorts.delete(workerId);
        brokerBus.send("unregister_worker", { workerId, registrationId });
        throw error;
    }
    if (debugLevel(host) >= 1) {
        console.log(`🔗 Registered worker ${workerId} with broker`);
    }
}
/**
 * Setup broker port for worker-side communication.
 */
export function setupBrokerPort(host, brokerPort) {
    if (host.isDestroyed()) {
        brokerPort.close();
        return;
    }
    if (host._brokerPort) {
        if (host._brokerPort !== brokerPort)
            brokerPort.close();
        console.warn("Broker port already set up");
        return;
    }
    if (!brokerPort || typeof brokerPort !== "object") {
        console.error("Invalid broker port provided:", brokerPort);
        throw new Error("Invalid MessagePort provided for broker setup");
    }
    try {
        host._brokerPort = brokerPort;
        host._brokerPort.onmessage = (event) => {
            try {
                if (!isBusMessage(event.data))
                    throw new Error('Invalid broker message');
                host._receiveFrom(brokerPort, event.data, (message, reservation) => handleBrokerMessage(host, message, reservation));
            }
            catch (error) {
                host._reportFailure({ code: "INVALID_MESSAGE", message: String(error) });
            }
        };
        host._brokerPort.onmessageerror = () => {
            host._reportFailure({ code: "MESSAGE_ERROR", message: "Broker port message could not be cloned or decoded" });
        };
        host._brokerPort.start();
        if (debugLevel(host) >= 1) {
            console.log("🔗 Broker port set up for worker");
        }
    }
    catch (error) {
        console.error("Failed to setup broker port:", error);
        brokerPort.close();
        host._brokerPort = null;
        throw error;
    }
}
/**
 * Handle messages from broker (worker-side).
 */
export function handleBrokerMessage(host, message, reservation) {
    if (!isBusMessage(message)) {
        if (isRecord(message) && message.b === true)
            host._reportFailure({ code: "INVALID_MESSAGE", message: "Invalid broker envelope" });
        return Promise.resolve();
    }
    const type = message.t;
    const data = message.d;
    if (isServiceDelivery(message) || message.e === 2)
        return host._processMessage(message, reservation);
    if (type === "pub_message" && isRecord(data)) {
        return enqueueBrokerPublication(host, message, data, reservation);
    }
    reservation?.release();
    return Promise.resolve();
}
function enqueueBrokerPublication(host, message, data, reservation) {
    if (typeof data.topic !== 'string' || !data.topic) {
        reservation?.release();
        return Promise.reject(new Error('Invalid publication topic'));
    }
    const sender = typeof data.senderId === 'string' ? data.senderId : undefined;
    return host._enqueuePublication(data.topic, data.data, sender, message.p, reservation, message.x);
}
/**
 * Dispatch a published message to local subscribers.
 */
export function handlePubMessage(host, topic, data, senderId, priority = 1) {
    return host._enqueuePublication(topic, data, senderId, priority);
}
/** Resolves after every snapshotted recipient has admitted the publication.
 * It does not claim that subscriber handlers have completed. */
export function publishWithBackpressure(host, topic, data, priority, options = {}, expiresAt) {
    if (host.isDestroyed())
        return Promise.reject(new Error('Bus destroyed'));
    const payload = { topic, data, requiredSubscribers: options.requiredSubscribers, expiresAt };
    if (host._brokerBus && host._brokerReady)
        return host._brokerBus._requestOn(host._brokerBus._target, 'publish', payload, priority, options, expiresAt);
    if (!host._brokerPort)
        return Promise.reject(new Error('Pub/sub is not enabled'));
    return host._requestOn(host._brokerPort, 'publish', payload, priority, options, expiresAt);
}
export async function publishExpiring(host, topic, data, expiresAt, priority) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), Math.max(0, expiresAt - performance.timeOrigin - performance.now()));
    try {
        await publishWithBackpressure(host, topic, data, priority, { signal: abort.signal }, expiresAt);
    }
    catch (error) {
        if (!abort.signal.aborted)
            throw error;
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * Subscribe to a topic.
 */
export function subscribe(host, topic, handler) {
    if (!host._subscriptions.has(topic)) {
        host._subscriptions.set(topic, new Set());
    }
    host._subscriptions.get(topic)?.add(handler);
    if (host._brokerBus && host._brokerReady) {
        // Control traffic must not be overtaken by a subsequent realtime publish.
        host._brokerBus.send_realtime("subscribe", { topic });
        if (debugLevel(host) >= 1) {
            console.log(`📢 Main subscribed to "${topic}"`);
        }
        return;
    }
    if (!host._brokerPort) {
        throw new Error("Pub/sub not enabled. Worker must receive broker port first.");
    }
    const message = {
        b: true,
        t: "subscribe",
        d: { topic },
        p: 0,
        e: 0,
    };
    host._brokerPort.postMessage(message);
    if (debugLevel(host) >= 1) {
        console.log(`📢 Worker subscribed to "${topic}"`);
    }
}
/**
 * Unsubscribe from a topic.
 */
export function unsubscribe(host, topic, handler) {
    const handlers = host._subscriptions.get(topic);
    if (!handlers)
        return;
    handlers.delete(handler);
    if (handlers.size !== 0)
        return;
    host._subscriptions.delete(topic);
    if (host._brokerBus && host._brokerReady) {
        host._brokerBus.send_realtime("unsubscribe", { topic });
        if (debugLevel(host) >= 1) {
            console.log(`🔇 Main unsubscribed from "${topic}"`);
        }
        return;
    }
    if (!host._brokerPort) {
        console.warn("Pub/sub not enabled, cannot unsubscribe");
        return;
    }
    const message = {
        b: true,
        t: "unsubscribe",
        d: { topic },
        p: 0,
        e: 0,
    };
    host._brokerPort.postMessage(message);
    if (debugLevel(host) >= 1) {
        console.log(`🔇 Worker unsubscribed from "${topic}"`);
    }
}
/**
 * Broker status for debugging and monitoring.
 */
export async function getBrokerStatus(host) {
    if (!host._brokerReady || !host._brokerBus) {
        return {
            enabled: false,
            ready: false,
            error: "Pub/sub system not enabled or broker not ready",
        };
    }
    try {
        const status = await host._brokerBus.request("get_status", {}, 2000);
        return {
            enabled: true,
            ready: true,
            broker: status,
            localWorkers: Array.from(host._workerPorts.keys()),
            localSubscriptions: Array.from(host._subscriptions.keys()),
        };
    }
    catch (error) {
        return {
            enabled: true,
            ready: false,
            error: error instanceof Error ? error.message : "Unknown error",
            localWorkers: Array.from(host._workerPorts.keys()),
            localSubscriptions: Array.from(host._subscriptions.keys()),
        };
    }
}
//# sourceMappingURL=bus-pubsub.js.map