import { isRecord } from "./bus-types.js";
const CONTROL_TYPES = new Set([
    "wrk_init", "wrk_ready", "wrk_error", "setup_broker_port", "terminate_worker",
    "register_worker", "unregister_worker", "worker_registered", "worker_pubsub_ready",
    "subscribe", "unsubscribe", "subscriptions_ready", "disconnect", "cleanup",
    "__service_control", "__service_result",
]);
/** Lifecycle control has bounded reserved admission; user realtime is ordinary work. */
export function isBusControl(message) {
    if (message.e === 2)
        return true;
    if (message.t === "__broker_port_message" && isRecord(message.d)) {
        const nested = message.d.message;
        return isRecord(nested) && typeof nested.t === "string" && CONTROL_TYPES.has(nested.t);
    }
    return CONTROL_TYPES.has(message.t);
}
//# sourceMappingURL=bus-control.js.map