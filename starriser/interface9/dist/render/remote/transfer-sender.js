import { bufferBytes, MAX_STREAM_BATCHES, MAX_STREAM_BYTES, projectionBuffers } from "./contracts.js";
import { validStreamOptions } from "./transfer-port.js";
function validReturnedBuffers(value, bytes) {
    if (!Array.isArray(value) || value.length > 7)
        return false;
    if (new Set(value).size !== value.length || !value.every((buffer) => buffer instanceof ArrayBuffer))
        return false;
    return bufferBytes(value) === bytes;
}
/**
 * Credits cover actual backing buffers, including bytes outside a view. onReturned
 * receives ownership for pooling. The connection owner disposes both endpoints
 * after transport failure or worker exit; a closed MessagePort has no peer-close event.
 */
export function createProjectionSender(port, options) {
    const maxBytes = options.maxBytes ?? MAX_STREAM_BYTES;
    const maxBatches = options.maxBatches ?? MAX_STREAM_BATCHES;
    validStreamOptions(options.generation, maxBytes, maxBatches);
    const pending = new Map();
    let inFlightBytes = 0;
    let ticket = 0;
    let closed = false;
    function dispose() {
        if (closed)
            return;
        closed = true;
        port.removeEventListener("message", onMessage);
        port.removeEventListener("messageerror", onMessageError);
        port.close();
        pending.clear();
        inFlightBytes = 0;
    }
    function fail(error) {
        if (closed)
            return;
        dispose();
        options.onError(error instanceof Error ? error : new Error(String(error)));
    }
    function onMessageError() { fail(new Error("Projection credit could not be deserialized")); }
    function onMessage(event) {
        const message = event.data;
        if (closed || message?.type !== "released" || message.connectionGeneration !== options.generation)
            return;
        const bytes = pending.get(message.ticket);
        if (bytes === undefined)
            return; // Duplicate/obsolete credit never increases allowance.
        const buffers = message.buffers;
        if (!validReturnedBuffers(buffers, bytes)) {
            fail(new Error("Invalid returned projection buffers"));
            return;
        }
        pending.delete(message.ticket);
        inFlightBytes -= bytes;
        try {
            options.onReturned?.(buffers);
        }
        catch (error) {
            fail(error);
        }
    }
    port.addEventListener("message", onMessage);
    port.addEventListener("messageerror", onMessageError);
    port.start();
    return {
        /** False means backpressured: caller still owns every input buffer. */
        send(batch) {
            if (closed)
                throw new Error("Projection stream is closed");
            const buffers = projectionBuffers(batch);
            const bytes = bufferBytes(buffers);
            if (bytes > maxBytes)
                throw new RangeError("Projection batch exceeds stream byte budget");
            if (pending.size >= maxBatches || inFlightBytes + bytes > maxBytes)
                return false;
            if (ticket === Number.MAX_SAFE_INTEGER)
                throw new Error("Projection stream ticket space exhausted");
            const packet = { type: "projection", connectionGeneration: options.generation, ticket: ++ticket, batch };
            pending.set(ticket, bytes);
            inFlightBytes += bytes;
            try {
                port.postMessage(packet, buffers);
            }
            catch (error) {
                fail(error);
                throw error;
            }
            return true;
        },
        inspect: () => ({ closed, inFlightBytes, inFlightBatches: pending.size }),
        dispose,
    };
}
//# sourceMappingURL=transfer-sender.js.map