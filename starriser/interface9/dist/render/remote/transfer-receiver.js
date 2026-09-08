import { validatePlaybackCorrection } from './playback-correction.js';
import { bufferBytes, MAX_STREAM_BATCHES, MAX_STREAM_BYTES, projectionBuffers } from "./contracts.js";
import { validStreamOptions } from "./transfer-port.js";
/**
 * apply must finish all CPU view use before resolving, respect abort before later
 * state changes, and leave buffer transfer to this receiver. The connection owner
 * disposes both endpoints after failure/worker exit; disposal cannot preempt JS.
 */
export function createProjectionReceiver(port, options) {
    const maxBytes = options.maxBytes ?? MAX_STREAM_BYTES;
    const maxBatches = options.maxBatches ?? MAX_STREAM_BATCHES;
    validStreamOptions(options.generation, maxBytes, maxBatches);
    const pending = new Set();
    const controller = new AbortController();
    let retainedBytes = 0;
    let lastTicket = 0;
    let closed = false;
    let correctionActive = false, correctionTicket = 0;
    let tail = Promise.resolve();
    function dispose() {
        if (closed)
            return;
        closed = true;
        port.removeEventListener("message", onMessage);
        port.removeEventListener("messageerror", onMessageError);
        port.close();
        controller.abort();
    }
    function fail(error) {
        if (closed)
            return;
        dispose();
        options.onError(error instanceof Error ? error : new Error(String(error)));
    }
    function release(packet, buffers, bytes) {
        pending.delete(packet.ticket);
        retainedBytes -= bytes;
        if (closed)
            return;
        const reply = { type: "released", connectionGeneration: options.generation, ticket: packet.ticket, buffers };
        port.postMessage(reply, buffers);
    }
    function accept(packet) {
        if (!Number.isSafeInteger(packet.ticket) || packet.ticket <= lastTicket)
            throw new Error("Invalid projection ticket order");
        const buffers = projectionBuffers(packet.batch);
        const bytes = bufferBytes(buffers);
        if (pending.size >= maxBatches || retainedBytes + bytes > maxBytes)
            throw new Error("Projection receiver overloaded");
        lastTicket = packet.ticket;
        retainedBytes += bytes;
        pending.add(packet.ticket);
        tail = tail.then(async () => {
            try {
                if (!closed)
                    await options.apply(packet.batch, controller.signal);
            }
            catch (error) {
                fail(error);
            }
            finally {
                release(packet, buffers, bytes);
            }
        }).catch(fail);
    }
    function correction(packet) {
        if (!Number.isSafeInteger(packet.ticket) || packet.ticket <= correctionTicket || correctionActive)
            return;
        correctionTicket = packet.ticket;
        correctionActive = true;
        tail = tail.then(async () => {
            try {
                if (!closed) {
                    try {
                        validatePlaybackCorrection(packet.correction);
                    }
                    catch {
                        return;
                    }
                    await options.correct?.(packet.correction, controller.signal);
                }
            }
            catch (error) {
                fail(error);
            }
            finally {
                correctionActive = false;
                if (!closed)
                    port.postMessage({ type: 'playbackConsumed', connectionGeneration: options.generation, ticket: packet.ticket });
            }
        }).catch(fail);
    }
    function onMessageError() { fail(new Error("Projection batch could not be deserialized")); }
    function onMessage(event) {
        const packet = event.data;
        if (closed || packet?.connectionGeneration !== options.generation)
            return;
        if (packet.type === 'playbackCorrection') {
            correction(packet);
            return;
        }
        if (packet.type !== 'projection')
            return;
        try {
            accept(packet);
        }
        catch (error) {
            fail(error);
        }
    }
    port.addEventListener("message", onMessage);
    port.addEventListener("messageerror", onMessageError);
    port.start();
    return {
        inspect: () => ({ closed, retainedBytes, retainedBatches: pending.size }),
        dispose,
    };
}
//# sourceMappingURL=transfer-receiver.js.map