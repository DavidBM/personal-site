/** Birth-time CPU oracle for the production sampler (XYZ input, XZTY storage). */
export function appendTimedTrailSample(samples, ringBase, state, point, nowMs, layout) {
    const { ringSize, maxIntervalMs: interval, lifetimeMs } = layout;
    const mask = ringSize - 1;
    let head = (state.write - 1) & mask;
    const base = ringBase + head * 4;
    const previousBirth = samples[base + 2];
    const elapsed = nowMs - previousBirth;
    const write = (slot, x, y, z, birth) => {
        samples.set([x, z, birth, y], ringBase + slot * 4);
    };
    if (previousBirth < 0 || elapsed < 0 || elapsed >= lifetimeMs) {
        for (let i = 0; i < ringSize; i++)
            samples[ringBase + i * 4 + 2] = -1;
        write(0, ...point, nowMs);
        write(1, ...point, nowMs);
        return { write: 2, sinceSample: 0 };
    }
    const previous = [samples[base], samples[base + 3], samples[base + 1]];
    const total = Math.max(state.sinceSample, 0) + elapsed;
    const count = Math.floor((total + 0.001) / interval);
    const skip = count - Math.min(count, ringSize - 1);
    head = (head + skip) & mask;
    for (let i = skip; i < count; i++) {
        const offset = Math.min((i + 1) * interval - state.sinceSample, elapsed);
        const f = Math.max(0, Math.min(1, offset / Math.max(elapsed, 0.000001)));
        write(head, previous[0] + (point[0] - previous[0]) * f, previous[1] + (point[1] - previous[1]) * f, previous[2] + (point[2] - previous[2]) * f, previousBirth + offset);
        head = (head + 1) & mask;
    }
    write(head, ...point, nowMs);
    return { write: (head + 1) & mask, sinceSample: Math.max(total - count * interval, 0) };
}
//# sourceMappingURL=timed-trail-ref.js.map