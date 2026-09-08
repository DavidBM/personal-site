export function createFrameClock() {
    return { nowMs: () => performance.now(), epochOriginMs: Date.now() - performance.now() };
}
/** Sample once per frame; all simulation, Kepler and diagnostics share that sample. */
export class FrameTimeline {
    constructor(clock = createFrameClock()) {
        this.previousMs = null;
        this.elapsedMs = 0;
        this.cameraDtMs = 16.67;
        this.simDtMs = 16;
        this.clock = clock;
        this.startedAt = clock.nowMs();
    }
    sample() {
        const now = this.clock.nowMs();
        const dt = this.previousMs === null ? null : now - this.previousMs;
        this.elapsedMs = now - this.startedAt;
        this.cameraDtMs = dt === null ? 16.67 : Math.max(1, Math.min(50, dt));
        this.simDtMs = dt === null ? 16 : Math.max(0, Math.min(50, dt));
        this.previousMs = now;
    }
    get epochMs() { return this.clock.epochOriginMs + this.startedAt; }
    get wallMs() { return this.epochMs + this.elapsedMs; }
    observeClock(timeOriginMs) {
        const now = this.clock.nowMs();
        return { monotonicEpochMs: timeOriginMs + now, wallMs: this.clock.epochOriginMs + now };
    }
    get seconds() { return this.elapsedMs / 1000; }
    toGpuMs(domainEpochMs) { return domainEpochMs - this.epochMs; }
}
//# sourceMappingURL=frame-clock.js.map