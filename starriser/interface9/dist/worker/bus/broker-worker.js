/**
 * Broker Worker - Handles pub/sub message routing between workers
 *
 * This worker acts as a central message broker for efficient pub/sub communication
 * between workers within a single tab. It receives MessageChannel ports from the
 * main thread and routes messages between workers based on topic subscriptions.
 */
import { isBusMessage } from "./bus-types.js";
import { createServiceRouter } from './service-router.js';
import { serviceDelivery } from './service-transport.js';
import { SERVICE_CONTROL, SERVICE_ROUTE } from './service-types.js';
import { publishAdmitted } from './broker-publication.js';
import { serializeBusMessage } from './bus-types.js';
const isRecord = (value) => typeof value === "object" && value !== null;
const isBrokerMessage = (value) => {
    if (!isRecord(value))
        return false;
    return value.b === true && typeof value.t === "string";
};
const getTopic = (payload) => {
    if (!isRecord(payload))
        return null;
    const topic = payload.topic;
    return typeof topic === "string" ? topic : null;
};
/**
 * Broker Worker Constructor - called by worker bootstrap
 */
export function busConstructor(bus) {
    // Topic subscriptions: topic -> Set of workerIds
    const subscriptions = new Map();
    // Worker connections: workerId -> MessagePort
    const workerPorts = new Map();
    // Worker metadata: workerId -> { connected: boolean, subscriptions: Set }
    const workerMetadata = new Map();
    // Main thread Bus reference for special handling
    const mainBus = bus;
    const services = createServiceRouter((host, packet, priority, ordered, signal) => {
        const message = serviceDelivery(packet, priority, ordered);
        if (host === 'main')
            return bus._observe(bus._sendOn(bus._target, message, signal));
        const port = workerPorts.get(host);
        if (!port)
            throw new Error('Service worker is disconnected');
        return bus._observe(bus._sendOn(port, message, signal));
    });
    for (const type of [SERVICE_CONTROL, SERVICE_ROUTE]) {
        bus.on(type, (packet, meta) => services.receive('main', packet, meta.priority));
    }
    bus._serviceTransportFailure = (message, failure) => {
        const wrapper = message.t === '__broker_port_message' && isRecord(message.d) ? message.d : undefined;
        const nested = wrapper ? wrapper.message : message;
        if (!isBusMessage(nested) || ![SERVICE_CONTROL, SERVICE_ROUTE].includes(nested.t))
            return;
        const host = wrapper ? String(wrapper.workerId) : 'main';
        services.reject(host, nested.d, { code: 'OVERLOADED', message: failure.message });
    };
    let isReady = false;
    const debugLevel = bus.getDebugLevel();
    if (debugLevel >= 1) {
        console.log("🏢 Broker worker starting up");
    }
    // Register main thread as a special worker
    workerMetadata.set("main", {
        registrationId: null,
        connected: true,
        subscriptions: new Set(),
    });
    /**
     * Handle worker registration - main thread sends us a MessageChannel port for each worker
     */
    bus.on("register_worker", ({ workerId, registrationId, port }) => {
        if (debugLevel >= 1) {
            console.log(`🔌 Broker: Registering worker ${workerId}`);
        }
        if (workerPorts.has(workerId))
            handleDisconnect(workerId);
        workerPorts.set(workerId, port);
        workerMetadata.set(workerId, {
            registrationId,
            connected: true,
            subscriptions: new Set(),
        });
        port.onmessage = (event) => {
            if (!isBusMessage(event.data)) {
                if (isRecord(event.data) && event.data.b === true)
                    bus._reportFailure({ code: "INVALID_MESSAGE", message: "Invalid broker worker envelope" });
                return;
            }
            bus._receiveFrom(port, event.data, (message, reservation) => bus._processMessage({ b: true, t: "__broker_port_message", p: message.p, e: 0,
                o: message.o === undefined ? undefined : `${workerId.length}:${workerId}:${registrationId}:${message.o}`, k: message.k,
                x: message.x, d: { workerId, registrationId, message } }, reservation));
        };
        port.onmessageerror = () => bus._reportFailure({ code: "MESSAGE_ERROR", message: `Broker port ${workerId} could not decode a message` });
        port.start();
        bus.send("worker_registered", { workerId });
    });
    bus.on("__broker_port_message", data => {
        if (!isCurrentWorkerMessage(data.workerId, data.registrationId, data.message))
            return;
        if ([SERVICE_CONTROL, SERVICE_ROUTE].includes(data.message.t)) {
            return services.receive(data.workerId, data.message.d, data.message.p);
        }
        return handleWorkerMessage(data.workerId, data.registrationId, data.message);
    });
    /**
     * Handle subscribe requests from main thread
     */
    bus.on("subscribe", ({ topic }) => {
        handleSubscribe("main", { topic });
    });
    /**
     * Handle unsubscribe requests from main thread
     */
    bus.on("unsubscribe", ({ topic }) => {
        handleUnsubscribe("main", { topic });
    });
    bus.on("unregister_worker", ({ workerId, registrationId }) => {
        if (workerMetadata.get(workerId)?.registrationId === registrationId)
            handleDisconnect(workerId);
    });
    /**
     * Handle publish requests from main thread
     */
    bus.on("publish", (payload, meta) => {
        const priority = meta.priority ?? 1;
        if (meta.eventType === 1 && meta.id !== undefined)
            return acknowledgedPublication('main', meta.id, payload, priority, meta.admissionId);
        handlePublish("main", payload, priority);
    });
    /**
     * Handle messages from individual workers via their MessageChannel ports
     */
    function isCurrentWorkerMessage(workerId, registrationId, message) {
        return workerMetadata.get(workerId)?.registrationId === registrationId && isBrokerMessage(message);
    }
    function handleWorkerMessage(workerId, registrationId, message) {
        if (!isCurrentWorkerMessage(workerId, registrationId, message))
            return;
        const { t: type, d: data, p: priority = 1 } = message;
        if (debugLevel >= 2) {
            console.log(`Bus broker received ${type} from ${workerId}`);
        }
        switch (type) {
            case "subscribe":
                handleSubscribe(workerId, data);
                break;
            case "subscriptions_ready":
                // This port's FIFO guarantees all preceding subscriptions are installed.
                bus.send_realtime("worker_pubsub_ready", { workerId, registrationId });
                break;
            case "unsubscribe":
                handleUnsubscribe(workerId, data);
                break;
            case "publish":
                return receivedPublication(workerId, message, priority);
            case "disconnect":
                handleDisconnect(workerId);
                break;
            default:
                if (debugLevel >= 1) {
                    console.warn(`🤷 Broker: Unknown message type ${type} from ${workerId}`);
                }
        }
    }
    function receivedPublication(workerId, message, priority) {
        if (message.e === 1 && message.i !== undefined)
            return acknowledgedPublication(workerId, message.i, message.d, priority, message.q);
        handlePublish(workerId, message.d, priority);
    }
    function publicationRecipients(topic, required) {
        const ids = subscriptions.get(topic) ?? new Set();
        for (const id of required)
            if (!ids.has(id) || !workerMetadata.get(id)?.connected)
                throw new Error(`Required subscriber ${id} is unavailable`);
        return Array.from(ids, id => {
            const metadata = workerMetadata.get(id);
            const target = id === 'main' ? bus._target : workerPorts.get(id);
            if (!target || !metadata?.connected)
                throw new Error(`Subscriber ${id} disconnected`);
            return { id, target, current: () => workerMetadata.get(id) === metadata && metadata.connected
                    && subscriptions.get(topic)?.has(id) === true };
        });
    }
    async function acknowledgedPublication(workerId, requestId, payload, priority, admissionId) {
        const target = workerId === 'main' ? bus._target : workerPorts.get(workerId);
        if (!target)
            throw new Error('Publisher disconnected');
        const reply = serializeBusMessage('publish', null, 0, 2, requestId);
        const signal = admissionId === undefined ? bus.signal : bus._admissionRequestSignal(target, admissionId);
        try {
            await publishAdmitted(bus, workerId, payload, priority, publicationRecipients, signal);
        }
        catch (error) {
            reply.failure = { code: 'SEND_ERROR', message: String(error) };
        }
        finally {
            if (admissionId !== undefined)
                bus._finishAdmissionRequest(target, admissionId);
        }
        await bus._sendOn(target, reply);
    }
    /**
     * Handle subscription requests from workers
     */
    function handleSubscribe(workerId, payload) {
        const topic = getTopic(payload);
        if (!topic) {
            console.warn(`⚠️ Broker: Invalid topic in subscribe from ${workerId}`);
            return;
        }
        if (!subscriptions.has(topic)) {
            subscriptions.set(topic, new Set());
        }
        subscriptions.get(topic)?.add(workerId);
        const metadata = workerMetadata.get(workerId);
        if (metadata) {
            metadata.subscriptions.add(topic);
        }
        if (debugLevel >= 1) {
            console.log(`📢 Broker: ${workerId} subscribed to "${topic}"`);
        }
    }
    /**
     * Handle unsubscription requests from workers
     */
    function handleUnsubscribe(workerId, payload) {
        const topic = getTopic(payload);
        if (!topic) {
            console.warn(`⚠️ Broker: Invalid topic in unsubscribe from ${workerId}`);
            return;
        }
        const topicSubs = subscriptions.get(topic);
        if (topicSubs) {
            topicSubs.delete(workerId);
            if (topicSubs.size === 0) {
                subscriptions.delete(topic);
            }
        }
        const metadata = workerMetadata.get(workerId);
        if (metadata) {
            metadata.subscriptions.delete(topic);
        }
        if (debugLevel >= 1) {
            console.log(`🔇 Broker: ${workerId} unsubscribed from "${topic}"`);
        }
    }
    /**
     * Handle publish requests from workers - route to all subscribers
     */
    function handlePublish(workerId, payload, priority) {
        const topic = getTopic(payload);
        if (!topic) {
            console.warn(`⚠️ Broker: Invalid topic in publish from ${workerId}`);
            return;
        }
        const data = isRecord(payload) ? payload.data : undefined;
        const subscribers = subscriptions.get(topic);
        if (!subscribers || subscribers.size === 0) {
            if (debugLevel >= 2) {
                console.log(`📭 Broker: No subscribers for topic "${topic}" from ${workerId}`);
            }
            return;
        }
        let routedCount = 0;
        for (const subscriberId of subscribers) {
            if (routeToSubscriber(subscriberId, { topic, data, senderId: workerId }, priority))
                routedCount++;
        }
        if (debugLevel >= 2 && routedCount > 0) {
            console.log(`🚀 Broker: Routed "${topic}" from ${workerId} to ${routedCount} subscribers`);
        }
    }
    function routeToSubscriber(subscriberId, payload, priority) {
        if (!workerMetadata.get(subscriberId)?.connected)
            return false;
        try {
            if (subscriberId === "main") {
                const send = priority === 0 ? mainBus.send_realtime : priority === 2 ? mainBus.send_background : mainBus.send;
                send.call(mainBus, "pub_message", payload);
            }
            else {
                const port = workerPorts.get(subscriberId);
                if (!port)
                    return false;
                port.postMessage({ b: true, t: "pub_message", d: payload, p: priority, e: 0 });
            }
            return true;
        }
        catch (error) {
            bus._reportFailure({ code: "SEND_ERROR", message: `Broker route to ${subscriberId} failed: ${String(error)}` });
            handleDisconnect(subscriberId);
            return false;
        }
    }
    /**
     * Handle worker disconnection - clean up all subscriptions and ports
     */
    function handleDisconnect(workerId) {
        if (workerId === "main") {
            return;
        }
        services.disconnect(workerId);
        if (debugLevel >= 1) {
            console.log(`🔌 Broker: Disconnecting worker ${workerId}`);
        }
        const metadata = workerMetadata.get(workerId);
        if (metadata) {
            for (const topic of metadata.subscriptions) {
                const topicSubs = subscriptions.get(topic);
                if (topicSubs) {
                    topicSubs.delete(workerId);
                    if (topicSubs.size === 0) {
                        subscriptions.delete(topic);
                    }
                }
            }
            metadata.connected = false;
        }
        const port = workerPorts.get(workerId);
        if (port) {
            bus._disconnectEndpoint(port);
            try {
                port.close();
            }
            catch (error) {
                // Port might already be closed
            }
            workerPorts.delete(workerId);
        }
        workerMetadata.delete(workerId);
        bus.send("worker_disconnected", { workerId });
    }
    /**
     * Handle cleanup request from main thread
     */
    bus.on("cleanup", () => {
        if (debugLevel >= 1) {
            console.log("🧹 Broker: Cleaning up all workers");
        }
        for (const workerId of Array.from(workerPorts.keys())) {
            if (workerId !== "main") {
                handleDisconnect(workerId);
            }
        }
        const mainMetadata = workerMetadata.get("main");
        if (mainMetadata) {
            for (const topic of mainMetadata.subscriptions) {
                const topicSubs = subscriptions.get(topic);
                if (topicSubs) {
                    topicSubs.delete("main");
                    if (topicSubs.size === 0) {
                        subscriptions.delete(topic);
                    }
                }
            }
            mainMetadata.subscriptions.clear();
        }
    });
    /**
     * Handle status requests for debugging
     */
    bus.on("get_status", (data, meta) => {
        if (meta && meta.eventType === 1) {
            const status = {
                isReady,
                workerCount: workerPorts.size,
                topicCount: subscriptions.size,
                workers: Array.from(workerMetadata.keys()),
                topics: Array.from(subscriptions.keys()).map((topic) => ({
                    topic,
                    subscriberCount: subscriptions.get(topic)?.size ?? 0,
                    subscribers: Array.from(subscriptions.get(topic) ?? []),
                })),
            };
            if (typeof meta.id === "number") {
                bus.respond(meta.id, "get_status", status);
            }
        }
    });
    // Mark broker as ready
    isReady = true;
    bus.send("worker_ready", { role: "broker" });
    if (debugLevel >= 1) {
        console.log("✅ Broker worker ready");
    }
    function destroy() {
        if (debugLevel >= 1) {
            console.log("💀 Broker worker destroying");
        }
        for (const workerId of Array.from(workerPorts.keys())) {
            handleDisconnect(workerId);
        }
        subscriptions.clear();
        workerPorts.clear();
        workerMetadata.clear();
        services.dispose();
        bus._serviceTransportFailure = undefined;
        isReady = false;
        bus.signal.removeEventListener("abort", destroy);
    }
    bus.signal.addEventListener("abort", destroy, { once: true });
    // Return worker instance with cleanup method.
    return {
        destroy,
        getStatus: () => ({
            isReady,
            workerCount: workerPorts.size,
            topicCount: subscriptions.size,
        }),
    };
}
//# sourceMappingURL=broker-worker.js.map