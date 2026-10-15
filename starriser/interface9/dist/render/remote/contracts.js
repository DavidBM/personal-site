import { orbitBuffers } from '../../contracts/fleet-orbit.js';
export const MAX_BATCH_ENTITIES = 256;
export const MAX_STREAM_BYTES = 1024 * 1024;
export const MAX_STREAM_BATCHES = 4;
export const MAX_SNAPSHOT_ENTITIES = 16384;
export const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
/** Structural validation is bounded by a fixed number of views, not entity count. */
export function projectionBuffers(batch) {
    const count = batch.ids.byteLength / 16;
    const removed = batch.removedIds.byteLength / 16;
    if (![1, 2, 3, 4, 5, 6].includes(batch.layoutVersion) || !Number.isInteger(count) || !Number.isInteger(removed)
        || count + removed > MAX_BATCH_ENTITIES)
        throw new Error("Invalid projection batch size/layout");
    const views = [batch.ids, batch.revisions, batch.positions, batch.targets, batch.times, batch.moving, batch.removedIds];
    const coordinateBytes = count * (batch.layoutVersion >= 2 ? 24 : 16);
    const lengths = [count * 16, count * 8, coordinateBytes, coordinateBytes, count * 16, count, removed * 16];
    const constructors = [Uint8Array, BigUint64Array, Float64Array, Float64Array, BigUint64Array, Uint8Array, Uint8Array];
    if (batch.layoutVersion >= 3) {
        views.push(batch.appearance);
        lengths.push(count * 28);
        constructors.push(Uint32Array);
    }
    else if (batch.appearance !== undefined)
        throw new Error('Appearance requires projection layout 3 or 4');
    if (batch.layoutVersion >= 5) {
        const offsets = batch.pathOffsets, points = batch.pathPoints;
        if (!(offsets instanceof Uint32Array) || offsets.length !== count + 1 || offsets[0] !== 0
            || !(points instanceof Float64Array) || points.length !== offsets[count] * 3)
            throw new Error('Invalid projection paths');
        for (let i = 0; i < count; i++)
            if (offsets[i + 1] < offsets[i] || offsets[i + 1] - offsets[i] > 14)
                throw new Error('Projection path exceeds bound');
        if (!points.every(Number.isFinite))
            throw new Error('Invalid projection path point');
        views.push(offsets, points);
        lengths.push((count + 1) * 4, points.byteLength);
        constructors.push(Uint32Array, Float64Array);
    }
    const buffers = new Set();
    for (let i = 0; i < views.length; i++) {
        buffers.add(columnBuffer(views[i], constructors[i], lengths[i]));
    }
    if (batch.layoutVersion >= 6)
        for (const buffer of orbitBuffers(count, batch.orbitOffsets, batch.orbitBytes))
            buffers.add(buffer);
    return [...buffers];
}
export function bufferBytes(buffers) {
    let bytes = 0;
    for (const buffer of buffers)
        bytes += buffer.byteLength;
    return bytes;
}
function columnBuffer(view, constructor, length) {
    if (!view || !(view instanceof constructor) || view.byteLength !== length || !(view.buffer instanceof ArrayBuffer))
        throw new Error('Invalid projection column');
    return view.buffer;
}
//# sourceMappingURL=contracts.js.map