import { SERVICE_CONTROL, SERVICE_DELIVERY, SERVICE_RESULT, SERVICE_ROUTE } from './service-types.js';
export function registerMainServiceDelivery(host) {
    for (const type of [SERVICE_DELIVERY, SERVICE_RESULT]) {
        host._brokerBus?._setMessageSink(type, {
            reserve: (size, signal) => host._reserveIngress(size, signal),
            deliver: (message, reservation) => host._processMessage(message, reservation),
        });
    }
}
export function serviceEnvelope(packet, priority = 1, ordered) {
    const routing = packet.type === 'request' || packet.type === 'publish';
    return { b: true, t: routing ? SERVICE_ROUTE : SERVICE_CONTROL, d: packet, p: priority, e: 0, o: ordered, k: packet.bytes, x: packet.expiresAt };
}
export function serviceDelivery(packet, priority = 0, ordered) {
    // Service events check expiry in the receiver and still reply to release their
    // semantic route. Transport expiry here would bypass that release.
    return { b: true, t: packet.type === 'result' ? SERVICE_RESULT : SERVICE_DELIVERY, d: packet,
        p: priority, e: 0, o: ordered, k: packet.bytes };
}
export function sendService(bus, packet, priority, ordered, signal) {
    const envelope = serviceEnvelope(packet, priority, ordered);
    if (bus._brokerBus && bus._brokerReady)
        return bus._brokerBus._sendOn(bus._brokerBus._target, envelope, signal);
    if (!bus._brokerPort)
        throw new Error('Bind services after the broker port is ready');
    return bus._sendOn(bus._brokerPort, envelope, signal);
}
export function isServiceDelivery(message) {
    return message.t === SERVICE_RESULT || message.t === SERVICE_DELIVERY;
}
//# sourceMappingURL=service-transport.js.map