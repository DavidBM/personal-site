/**
 * Broker pub/sub: enable, register ports, publish / subscribe.
 * Operates on a host object with the Bus underscore fields (public by convention).
 */
import { isBusMessage, isRecord } from "./bus-types.js";
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
        host._brokerWorker = brokerInfo.worker;
        host._brokerBus = brokerInfo.bus;
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error("Broker initialization timeout"));
            }, 5000);
            host._brokerBus?.on("worker_ready", (data) => {
                const role = isRecord(data) ? data.role : undefined;
                if (role === "broker") {
                    clearTimeout(timeout);
                    host._brokerReady = true;
                    resolve();
                }
            });
        });
        host._brokerBus?.on("pub_message", (data) => {
            if (!isRecord(data))
                return;
            const topic = typeof data.topic === "string" ? data.topic : "";
            const payload = data.data;
            const senderId = typeof data.senderId === "string" ? data.senderId : undefined;
            if (topic) {
                handlePubMessage(host, topic, payload, senderId);
            }
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
export async function registerWorkerWithBroker(host, workerId, worker) {
    if (!host._brokerReady) {
        throw new Error("Pub/sub not enabled. Call enablePubSub() first.");
    }
    const channel = new MessageChannel();
    const mainPort = channel.port1;
    const workerPort = channel.port2;
    host._workerPorts.set(workerId, mainPort);
    if (!host._brokerBus) {
        throw new Error("Broker bus missing");
    }
    const brokerTarget = host._brokerBus._target;
    brokerTarget.postMessage({
        b: true,
        t: "register_worker",
        d: { workerId, port: mainPort },
        p: 1,
        e: 0,
    }, [mainPort]);
    worker.postMessage({
        b: true,
        t: "setup_broker_port",
        d: { brokerPort: workerPort },
        p: 0,
        e: 0,
    }, [workerPort]);
    if (debugLevel(host) >= 1) {
        console.log(`🔗 Registered worker ${workerId} with broker`);
    }
}
/**
 * Setup broker port for worker-side communication.
 */
export function setupBrokerPort(host, brokerPort) {
    if (host._brokerPort) {
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
                handleBrokerMessage(host, event.data);
            }
            catch (error) {
                console.error("Error handling broker message:", error);
            }
        };
        host._brokerPort.onmessageerror = (event) => {
            console.error("Broker port message error:", event);
        };
        host._brokerPort.start();
        if (debugLevel(host) >= 1) {
            console.log("🔗 Broker port set up for worker");
        }
    }
    catch (error) {
        console.error("Failed to setup broker port:", error);
        host._brokerPort = null;
        throw error;
    }
}
/**
 * Handle messages from broker (worker-side).
 */
export function handleBrokerMessage(host, message) {
    if (!isBusMessage(message))
        return;
    const type = message.t;
    const data = message.d;
    if (type === "pub_message" && isRecord(data)) {
        const topic = typeof data.topic === "string" ? data.topic : "";
        const payload = data.data;
        const senderId = typeof data.senderId === "string" ? data.senderId : undefined;
        if (topic) {
            handlePubMessage(host, topic, payload, senderId);
        }
    }
}
/**
 * Dispatch a published message to local subscribers.
 */
export function handlePubMessage(host, topic, data, senderId) {
    const handlers = host._subscriptions.get(topic);
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
    if (debugLevel(host) >= 2) {
        console.log(`📨 Received pub message on topic "${topic}" from ${senderId}`, data);
    }
}
/**
 * Publish a message to a topic.
 */
export function publish(host, topic, data, priority = 1) {
    if (host._brokerBus && host._brokerReady) {
        if (priority === 0) {
            host._brokerBus.send_realtime("publish", { topic, data });
        }
        else if (priority === 2) {
            host._brokerBus.send_background("publish", { topic, data });
        }
        else {
            host._brokerBus.send("publish", { topic, data });
        }
        if (debugLevel(host) >= 2) {
            console.log(`📤 Main published to "${topic}":`, data);
        }
        return;
    }
    if (!host._brokerPort) {
        throw new Error("Pub/sub not enabled. Worker must receive broker port first.");
    }
    const message = {
        b: true,
        t: "publish",
        d: { topic, data },
        p: priority,
        e: 0,
    };
    host._brokerPort.postMessage(message);
    if (debugLevel(host) >= 2) {
        console.log(`📤 Worker published to "${topic}":`, data);
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
        host._brokerBus.send("subscribe", { topic });
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
        p: 1,
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
        host._brokerBus.send("unsubscribe", { topic });
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
        p: 1,
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
export function getWorkerPort(host, workerId) {
    return host._workerPorts.get(workerId) || null;
}
export function sendToWorker(host, workerId, type, data, priority = 1) {
    const port = host._workerPorts.get(workerId);
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
    if (debugLevel(host) >= 2) {
        console.log(`📤 Direct message to ${workerId}:`, type, data);
    }
}
//# sourceMappingURL=bus-pubsub.js.map