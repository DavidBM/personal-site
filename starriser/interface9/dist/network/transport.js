import { connectWebSocket } from './websocket-transport.js';
import { connectWebTransport } from './webtransport-transport.js';
export function validateEndpoints(endpoints) {
    const ws = new URL(endpoints.webSocketUrl);
    if (ws.protocol !== 'wss:' && !(ws.protocol === 'ws:' && loopback(ws)))
        throw new Error('WebSocket requires WSS outside loopback');
    if (!endpoints.webTransportUrl)
        return;
    const wt = new URL(endpoints.webTransportUrl);
    if (wt.protocol !== 'https:')
        throw new Error('WebTransport requires HTTPS');
    if (endpoints.certificateHashes?.length && !loopback(wt))
        throw new Error('Explicit certificate hashes are limited to loopback fixtures');
    validatePins(endpoints);
}
function loopback(url) { return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname); }
function validatePins(endpoints) {
    const pins = endpoints.certificateHashes ?? [];
    if (pins.length > 2)
        throw new Error('Certificate pin budget exceeded');
    for (const pin of pins) {
        if (pin.algorithm !== 'sha-256' || pin.value.byteLength !== 32)
            throw new Error('Certificate pins must be 32-byte SHA-256 hashes');
    }
}
/** Only establishment falls back. Once application bytes can be submitted, any
 * transport failure ends the session and leaves command outcomes unknown. */
export const connectTransport = async (endpoints, signal) => {
    validateEndpoints(endpoints);
    if (endpoints.webTransportUrl && typeof WebTransport !== 'undefined') {
        try {
            return await connectWebTransport(endpoints, signal);
        }
        catch (error) {
            if (signal.aborted)
                throw error;
        }
    }
    return connectWebSocket(endpoints.webSocketUrl, signal);
};
//# sourceMappingURL=transport.js.map