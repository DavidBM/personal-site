export const MAX_BATCH_ENTITIES = 256;
export const MAX_STREAM_BYTES = 1024 * 1024;
export const MAX_STREAM_BATCHES = 4;
export const MAX_SNAPSHOT_ENTITIES = 16384;
export const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
/** Structural validation is bounded by a fixed number of views, not entity count. */
export function projectionBuffers(batch) {
    const count = batch.ids.byteLength / 16;
    const removed = batch.removedIds.byteLength / 16;
    if (batch.layoutVersion !== 1 || !Number.isInteger(count) || !Number.isInteger(removed)
        || count + removed > MAX_BATCH_ENTITIES)
        throw new Error("Invalid projection batch size/layout");
    const views = [batch.ids, batch.revisions, batch.positions, batch.targets, batch.times, batch.moving, batch.removedIds];
    const lengths = [count * 16, count * 8, count * 16, count * 16, count * 16, count, removed * 16];
    const constructors = [Uint8Array, BigUint64Array, Float64Array, Float64Array, BigUint64Array, Uint8Array, Uint8Array];
    const buffers = new Set();
    for (let i = 0; i < views.length; i++) {
        const view = views[i];
        if (!(view instanceof constructors[i]) || view.byteLength !== lengths[i]
            || !(view.buffer instanceof ArrayBuffer))
            throw new Error("Invalid projection column");
        buffers.add(view.buffer);
    }
    return [...buffers];
}
export function bufferBytes(buffers) {
    let bytes = 0;
    for (const buffer of buffers)
        bytes += buffer.byteLength;
    return bytes;
}
//# sourceMappingURL=contracts.js.map