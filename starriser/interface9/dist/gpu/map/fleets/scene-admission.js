/** Publish only seeded rows. Membership removal/relocation still uses a full rebuild. */
export function publishSceneAdmission(queue, maps, range, fleet, first, count, instanceBase) {
    if (count === 0)
        return;
    const start = range.start + first;
    const available = Math.min(range.cap, maps.instances.length - range.start, maps.fleets.length - range.start, maps.instanceBuffer.size / 4 - range.start, maps.fleetBuffer.size / 4 - range.start);
    if (first < 0 || count < 0 || range.start < 0 || first + count > available) {
        throw new RangeError('Scene admission exceeds its allocated range');
    }
    const instanceStart = instanceBase == null ? fleet.instanceStart + first : instanceBase + start;
    const gpuSlot = (fleet.gpuSlot ?? 0xffffffff) >>> 0;
    for (let i = 0; i < count; i++) {
        const instance = (instanceStart + i) >>> 0;
        maps.instances[start + i] = instance;
        maps.fleets[start + i] = gpuSlot;
        maps.live.push(instance);
    }
    const offset = start * 4, bytes = count * 4;
    queue.writeBuffer(maps.instanceBuffer, offset, maps.instances.buffer, maps.instances.byteOffset + offset, bytes);
    queue.writeBuffer(maps.fleetBuffer, offset, maps.fleets.buffer, maps.fleets.byteOffset + offset, bytes);
}
//# sourceMappingURL=scene-admission.js.map