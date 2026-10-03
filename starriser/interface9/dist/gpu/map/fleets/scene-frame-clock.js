/** A bounded visual clock. Suspension never creates an unbounded catch-up queue. */
export class SceneFrameClock {
    constructor() {
        this.previous = null;
        this.remainder = 0;
        this.duration = 0;
        this.elapsed = 0;
        this.intervalStart = 0;
        this.intervalEnd = 0;
    }
    get integrationDt() { return this.duration; }
    get integrationTime() { return this.intervalEnd; }
    /** Changing cadence retains elapsed motion time, but starts a new scheduling interval. */
    resetCadence() { this.remainder = 0; this.duration = 0; }
    preview(time, dt, active, everyFrame = false) {
        const gap = this.previous == null ? dt : time - this.previous;
        if (!active || gap < 0 || gap > 0.3) {
            return { tick: false, remainder: 0, held: true, duration: 0, elapsed: 0 };
        }
        const elapsed = this.elapsed + gap;
        if (everyFrame)
            return { tick: elapsed > 0, remainder: 0, held: false, duration: elapsed, elapsed: 0 };
        const pending = this.remainder + gap;
        const intervals = Math.floor((pending + 1e-9) / dt), tick = intervals > 0;
        const remainder = Math.max(0, pending - intervals * dt);
        // One dispatch even when a rendered frame spans several scheduled ticks.
        // Leave the fractional interval pending, so poses have cadence-aligned
        // timestamps instead of alternating short/long integration spans.
        return { tick, remainder, held: false,
            duration: tick ? elapsed - remainder : 0, elapsed: tick ? remainder : elapsed };
    }
    /** Same instant for affine GPU presentation and camera prediction, without ticking. */
    presentationTime(time, dt, active, lastTick, everyFrame = false) {
        const step = this.preview(time, dt, active, everyFrame);
        if (step.held)
            return lastTick;
        if (everyFrame)
            return time;
        return Math.min(time - dt, step.tick ? time - step.remainder : lastTick);
    }
    advance(time, dt, active, everyFrame = false) {
        const step = this.preview(time, dt, active, everyFrame);
        this.previous = time;
        this.remainder = step.remainder;
        this.duration = step.duration;
        this.elapsed = step.elapsed;
        if (step.held)
            this.intervalStart = this.intervalEnd = time;
        else if (step.tick) {
            this.intervalEnd = time - step.remainder;
            this.intervalStart = this.intervalEnd - step.duration;
        }
        // Coalesced ticks can span several intervals. Blend their actual timestamps;
        // remainder/dt assumes a single interval and can reverse displayed motion.
        const span = this.intervalEnd - this.intervalStart;
        const alpha = step.held || everyFrame || span <= 0 ? 1 : Math.max(0, Math.min(1, (time - dt - this.intervalStart) / span));
        return { tick: step.tick, alpha };
    }
}
//# sourceMappingURL=scene-frame-clock.js.map