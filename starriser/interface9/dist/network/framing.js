import { MAX_MESSAGE_BYTES, MAX_TOPOLOGY_BYTES } from './limits.js';
export function frameMessage(payload) {
    if (payload.byteLength < 1 || payload.byteLength > MAX_MESSAGE_BYTES)
        throw new RangeError('Invalid network frame length');
    const frame = new Uint8Array(payload.byteLength + 4);
    new DataView(frame.buffer).setUint32(0, payload.byteLength, true);
    frame.set(payload, 4);
    return frame;
}
export function unframeMessage(frame) {
    if (frame.byteLength < 5 || frame.byteLength > MAX_TOPOLOGY_BYTES + 4)
        throw new RangeError('Invalid network frame length');
    const size = new DataView(frame).getUint32(0, true);
    if (size !== frame.byteLength - 4)
        throw new Error('WebSocket message must contain exactly one complete frame');
    return new Uint8Array(frame, 4);
}
function boundedChunk(value, maxBytes) {
    if (value.byteLength === 0 || value.byteLength > maxBytes || value.buffer.byteLength > maxBytes)
        throw new Error('Transport read chunk budget exceeded');
    return value;
}
/** Retains one bounded transport chunk and one frame; split/coalesced stream
 * reads are independent of message boundaries. EOF within a frame is an error. */
export function createFrameReader(reader, maxChunkBytes) {
    let chunk = new Uint8Array(0);
    let offset = 0;
    let ended = false;
    async function exact(size, allowEof) {
        const target = new Uint8Array(size);
        let written = 0;
        while (written < size) {
            if (offset === chunk.byteLength) {
                const result = await reader.read();
                if (result.done) {
                    ended = true;
                    break;
                }
                chunk = boundedChunk(result.value, maxChunkBytes);
                offset = 0;
            }
            const count = Math.min(size - written, chunk.byteLength - offset);
            target.set(chunk.subarray(offset, offset + count), written);
            offset += count;
            written += count;
        }
        if (written === size)
            return target;
        if (allowEof && written === 0)
            return null;
        throw new Error('Truncated reliable network frame');
    }
    return {
        async receive() {
            if (ended)
                return null;
            const header = await exact(4, true);
            if (!header)
                return null;
            const size = new DataView(header.buffer, header.byteOffset, 4).getUint32(0, true);
            if (size < 1 || size > MAX_TOPOLOGY_BYTES)
                throw new RangeError('Invalid network frame length');
            return exact(size, false);
        },
    };
}
//# sourceMappingURL=framing.js.map