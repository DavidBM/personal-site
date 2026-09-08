/** Bounded metadata only; no payload summaries, metric labels or timing reflection. */
export function createServiceObservation() {
    const counters = new Map();
    let ring = [], capacity = 0, sampleEvery = 1, cursor = 0, samples = 0;
    function record(contract, service, kind, bytes, context) {
        let entry = counters.get(contract);
        if (!entry && counters.size < 1024) {
            entry = { contract, messages: 0, knownBytes: 0, unknownSizes: 0, failures: 0 };
            counters.set(contract, entry);
        }
        if (entry) {
            if (kind === 'failure')
                entry.failures++;
            else {
                entry.messages++;
                if (bytes === undefined)
                    entry.unknownSizes++;
                else
                    entry.knownBytes += bytes;
            }
        }
        if (!capacity || samples++ % sampleEvery !== 0)
            return;
        ring[cursor++ % capacity] = { time: performance.now(), kind, contract, service, context };
    }
    return {
        record,
        configure(value) {
            if (!Number.isSafeInteger(value.capacity) || value.capacity < 0 || value.capacity > 1024)
                throw new Error('Invalid trace capacity');
            if (!Number.isSafeInteger(value.sampleEvery) || value.sampleEvery < 1)
                throw new Error('Invalid trace sampling');
            capacity = value.capacity;
            sampleEvery = value.sampleEvery;
            ring = [];
            cursor = samples = 0;
        },
        snapshot: () => ({ observed: Array.from(counters.values(), value => ({ ...value })),
            trace: ring.length < capacity ? ring.slice() : ring.slice(cursor % capacity).concat(ring.slice(0, cursor % capacity)) }),
        clear() { counters.clear(); ring = []; },
    };
}
//# sourceMappingURL=service-observation.js.map