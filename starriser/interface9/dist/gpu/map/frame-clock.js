import { readSimPause } from "../../lib/sim-clock.js";
export function createFrameClock() {
    return { nowMs: () => performance.now(), epochOriginMs: Date.now() - performance.now() };
}
/**
 * Sample once per frame. Simulation, Kepler, jumps and ship motion share that
 * sample. Pause holds it. Camera dt and {@link realWallMs} keep advancing.
 */
export class FrameTimeline {
    constructor(clock = createFrameClock()) {
        this.previousMs = null;
        this.paused = false;
        this.pauseAccumMs = 0;
        this.frozenSimMs = 0;
        this.elapsedMs = 0;
        this.cameraDtMs = 16.67;
        this.simDtMs = 16;
        this.clock = clock;
        this.startedAt = clock.nowMs();
    }
    applySimPause(payload) {
        const next = readSimPause(payload, this.frozenSimMs);
        this.paused = next.paused;
        this.pauseAccumMs = next.pauseAccumMs;
        this.frozenSimMs = next.frozenSimMs;
        if (this.paused) {
            this.elapsedMs = this.frozenSimMs - this.epochMs;
            this.simDtMs = 0;
            return;
        }
        this.elapsedMs = this.clock.nowMs() - this.startedAt - this.pauseAccumMs;
    }
    sample() {
        const now = this.clock.nowMs();
        const dt = this.previousMs === null ? null : now - this.previousMs;
        this.cameraDtMs = dt === null ? 16.67 : Math.max(1, Math.min(50, dt));
        if (this.paused) {
            this.elapsedMs = this.frozenSimMs - this.epochMs;
            this.simDtMs = 0;
        }
        else {
            this.elapsedMs = now - this.startedAt - this.pauseAccumMs;
            this.simDtMs = dt === null ? 16 : Math.max(0, Math.min(50, dt));
        }
        this.previousMs = now;
    }
    get epochMs() { return this.clock.epochOriginMs + this.startedAt; }
    /** Simulation epoch milliseconds. Pause holds this value. */
    get wallMs() { return this.epochMs + this.elapsedMs; }
    /** Unpaused wall clock for scene enter/exit holds. */
    get realWallMs() { return this.clock.epochOriginMs + this.clock.nowMs(); }
    observeClock(timeOriginMs) {
        const now = this.clock.nowMs();
        return { monotonicEpochMs: timeOriginMs + now, wallMs: this.clock.epochOriginMs + now };
    }
    get seconds() { return this.elapsedMs / 1000; }
    toGpuMs(domainEpochMs) { return domainEpochMs - this.epochMs; }
}
//# sourceMappingURL=frame-clock.js.map