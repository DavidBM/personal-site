import { createFrameReader, frameMessage } from './framing.js';
import { SESSION_LIMITS } from './session-contracts.js';
export async function connectWebTransport(endpoints, signal) {
    if (signal.aborted)
        throw new Error('Network connection aborted');
    const serverCertificateHashes = endpoints.certificateHashes?.map((hash) => ({ algorithm: hash.algorithm, value: new Uint8Array(hash.value) }));
    const session = new WebTransport(endpoints.webTransportUrl, { serverCertificateHashes });
    let reader;
    let datagrams;
    let writer;
    let stopped = false;
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    // Also observe before racing: close/dispose can arrive at any async seam.
    void aborted.catch(() => { });
    function close() {
        if (stopped)
            return;
        stopped = true;
        signal.removeEventListener('abort', onAbort);
        rejectAbort(new Error('WebTransport connection aborted'));
        if (datagrams)
            void datagrams.cancel().catch(() => { }).finally(() => datagrams?.releaseLock());
        if (reader)
            void reader.cancel().catch(() => { }).finally(() => reader?.releaseLock());
        if (writer)
            void writer.abort().catch(() => { }).finally(() => writer?.releaseLock());
        session.close();
    }
    function onAbort() { close(); }
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(close, SESSION_LIMITS.handshakeMs);
    void session.closed.then(close, close);
    try {
        await Promise.race([session.ready, aborted]);
        const opening = session.createBidirectionalStream().then((stream) => {
            if (stopped)
                discardStream(stream);
            return stream;
        });
        const stream = await Promise.race([opening, aborted]);
        if (stopped || signal.aborted) {
            discardStream(stream);
            throw new Error('WebTransport connection aborted');
        }
        reader = stream.readable.getReader();
        writer = stream.writable.getWriter();
        session.datagrams.incomingHighWaterMark = 1;
        session.datagrams.incomingMaxAge = 2000;
        datagrams = session.datagrams.readable.getReader();
        return { ...createConnectedTransport(reader, writer, close, () => stopped),
            async receiveDatagram() { const item = await datagrams.read(); return item.done ? null : item.value; } };
    }
    catch (error) {
        close();
        throw error;
    }
    finally {
        clearTimeout(timer);
    }
}
function discardStream(stream) {
    void stream.readable.cancel().catch(() => { });
    void stream.writable.abort().catch(() => { });
}
function createConnectedTransport(reader, writer, close, stopped) {
    const framing = createFrameReader(reader, SESSION_LIMITS.readBytes);
    let queuedBytes = 0;
    let queuedFrames = 0;
    let tail = Promise.resolve();
    return {
        kind: 'webtransport', receive: framing.receive, close,
        send(payload) {
            if (stopped())
                return Promise.reject(new Error('WebTransport is closed'));
            const frame = frameMessage(payload);
            if (queuedBytes + frame.byteLength > SESSION_LIMITS.sendBytes || queuedFrames >= SESSION_LIMITS.sendFrames)
                return Promise.reject(new Error('WebTransport send budget exceeded'));
            queuedBytes += frame.byteLength;
            queuedFrames++;
            const sending = tail.then(async () => {
                if (stopped())
                    throw new Error('WebTransport is closed');
                await writer.ready;
                await writer.write(frame);
            }).finally(() => { queuedBytes -= frame.byteLength; queuedFrames--; });
            tail = sending.catch(() => { close(); });
            return sending;
        },
    };
}
//# sourceMappingURL=webtransport-transport.js.map