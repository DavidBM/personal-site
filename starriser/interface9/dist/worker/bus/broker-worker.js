/**
 * Broker Worker - Handles pub/sub message routing between workers
 *
 * This worker acts as a central message broker for efficient pub/sub communication
 * between workers within a single tab. It receives MessageChannel ports from the
 * main thread and routes messages between workers based on topic subscriptions.
 */
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
    let isReady = false;
    const debugLevel = bus._options.debug ?? 0;
    if (debugLevel >= 1) {
        console.log("🏢 Broker worker starting up");
    }
    // Register main thread as a special worker
    workerMetadata.set("main", {
        connected: true,
        subscriptions: new Set(),
    });
    /**
     * Handle worker registration - main thread sends us a MessageChannel port for each worker
     */
    bus.on("register_worker", ({ workerId, port }) => {
        if (debugLevel >= 1) {
            console.log(`🔌 Broker: Registering worker ${workerId}`);
        }
        workerPorts.set(workerId, port);
        workerMetadata.set(workerId, {
            connected: true,
            subscriptions: new Set(),
        });
        port.onmessage = (event) => {
            handleWorkerMessage(workerId, event.data);
        };
        port.start();
        bus.send("worker_registered", { workerId });
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
    /**
     * Handle publish requests from main thread
     */
    bus.on("publish", ({ topic, data }, meta) => {
        const priority = meta ? meta.priority || 1 : 1;
        handlePublish("main", { topic, data }, priority);
    });
    /**
     * Handle messages from individual workers via their MessageChannel ports
     */
    function handleWorkerMessage(workerId, message) {
        if (!isBrokerMessage(message)) {
            return;
        }
        const { t: type, d: data, p: priority = 1 } = message;
        if (debugLevel >= 2) {
            console.log(`📨 Broker: Received ${type} from ${workerId}`, data);
        }
        switch (type) {
            case "subscribe":
                handleSubscribe(workerId, data);
                break;
            case "unsubscribe":
                handleUnsubscribe(workerId, data);
                break;
            case "publish":
                handlePublish(workerId, data, priority);
                break;
            case "disconnect":
                handleDisconnect(workerId);
                break;
            default:
                if (debugLevel >= 1) {
                    console.warn(`🤷 Broker: Unknown message type ${type} from ${workerId}`);
                }
        }
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
            const metadata = workerMetadata.get(subscriberId);
            if (!metadata || !metadata.connected) {
                continue;
            }
            try {
                if (subscriberId === "main") {
                    if (priority === 0) {
                        mainBus.send_realtime("pub_message", {
                            topic,
                            data,
                            senderId: workerId,
                        });
                    }
                    else if (priority === 2) {
                        mainBus.send_background("pub_message", {
                            topic,
                            data,
                            senderId: workerId,
                        });
                    }
                    else {
                        mainBus.send("pub_message", { topic, data, senderId: workerId });
                    }
                    routedCount++;
                    if (debugLevel >= 2) {
                        console.log(`📤 Broker: Routed "${topic}" from ${workerId} to main thread`);
                    }
                }
                else {
                    const port = workerPorts.get(subscriberId);
                    if (port) {
                        const routedMessage = {
                            b: true,
                            t: "pub_message",
                            d: { topic, data, senderId: workerId },
                            p: priority,
                            e: 0,
                        };
                        port.postMessage(routedMessage);
                        routedCount++;
                        if (debugLevel >= 2) {
                            console.log(`📤 Broker: Routed "${topic}" from ${workerId} to ${subscriberId}`);
                        }
                    }
                }
            }
            catch (error) {
                console.error(`❌ Broker: Failed to route message to ${subscriberId}:`, error);
                handleDisconnect(subscriberId);
            }
        }
        if (debugLevel >= 1 && routedCount > 0) {
            console.log(`🚀 Broker: Routed "${topic}" from ${workerId} to ${routedCount} subscribers`);
        }
    }
    /**
     * Handle worker disconnection - clean up all subscriptions and ports
     */
    function handleDisconnect(workerId) {
        if (workerId === "main") {
            return;
        }
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
    // Return worker instance with cleanup method
    return {
        destroy: () => {
            if (debugLevel >= 1) {
                console.log("💀 Broker worker destroying");
            }
            for (const workerId of Array.from(workerPorts.keys())) {
                handleDisconnect(workerId);
            }
            subscriptions.clear();
            workerPorts.clear();
            workerMetadata.clear();
            isReady = false;
        },
        getStatus: () => ({
            isReady,
            workerCount: workerPorts.size,
            topicCount: subscriptions.size,
        }),
    };
}
//# sourceMappingURL=broker-worker.js.map