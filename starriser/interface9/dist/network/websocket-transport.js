import { createFrameInbox } from './frame-inbox.js';
import { frameMessage, unframeMessage } from './framing.js';
import { SESSION_LIMITS } from './session-contracts.js';
export async function connectWebSocket(url, signal) {
    if (signal.aborted)
        throw new Error('Network connection aborted');
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    const inbox = createFrameInbox(SESSION_LIMITS.readBytes, SESSION_LIMITS.readFrames);
    let stopped = false;
    let resolveReady;
    let rejectReady;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    function stop(error = new Error('WebSocket session closed')) {
        if (stopped)
            return;
        stopped = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        inbox.close(error);
        rejectReady(error);
        socket.close();
    }
    function onAbort() { stop(new Error('Network connection aborted')); }
    const timer = setTimeout(() => stop(new Error('WebSocket establishment timed out')), SESSION_LIMITS.handshakeMs);
    signal.addEventListener('abort', onAbort, { once: true });
    socket.onopen = () => { clearTimeout(timer); resolveReady(); };
    socket.onerror = () => stop(new Error('WebSocket transport failed'));
    socket.onclose = () => stop();
    socket.onmessage = ({ data }) => {
        try {
            if (!(data instanceof ArrayBuffer))
                throw new Error('Network WebSocket requires binary frames');
            inbox.push(unframeMessage(data));
        }
        catch (error) {
            stop(error instanceof Error ? error : new Error(String(error)));
        }
    };
    await ready;
    if (signal.aborted || stopped)
        throw new Error('Network connection aborted');
    return {
        kind: 'websocket', receive: inbox.receive,
        async send(payload) {
            if (stopped || socket.readyState !== WebSocket.OPEN)
                throw new Error('WebSocket is closed');
            const frame = frameMessage(payload);
            if (socket.bufferedAmount + frame.byteLength > SESSION_LIMITS.sendBytes)
                throw new Error('WebSocket send budget exceeded');
            socket.send(frame);
        },
        close: () => stop(),
    };
}
//# sourceMappingURL=websocket-transport.js.map