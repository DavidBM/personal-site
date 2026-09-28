/** A bounded visual clock. Suspension never creates an unbounded catch-up queue. */
export class SceneFrameClock {
    constructor() {
        this.previous = null;
        this.remainder = 0;
        this.duration = 0;
        this.elapsed = 0;
    }
    get integrationDt() { return this.duration; }
    /** Changing cadence retains elapsed motion time, but starts a new scheduling interval. */
    resetCadence() { this.remainder = 0; this.duration = 0; }
    preview(time, dt, active, everyFrame = false) {
        const gap = this.previous == null ? dt : time - this.previous;
        if (!active || gap < 0 || gap > 0.3) {
            return { tick: false, alpha: 1, remainder: 0, held: true, duration: 0, elapsed: 0 };
        }
        const elapsed = this.elapsed + gap;
        if (everyFrame)
            return { tick: elapsed > 0, alpha: 1, remainder: 0, held: false, duration: elapsed, elapsed: 0 };
        let remainder = Math.min(this.remainder + gap, 2 * dt);
        const tick = remainder + 1e-9 >= dt;
        if (tick)
            remainder = Math.max(0, remainder - dt);
        return { tick, alpha: Math.min(1, remainder / dt), remainder, held: false, duration: tick ? elapsed : 0, elapsed: tick ? 0 : elapsed };
    }
    /** Same instant for affine GPU presentation and camera prediction, without ticking. */
    presentationTime(time, dt, active, lastTick, everyFrame = false) {
        const step = this.preview(time, dt, active, everyFrame);
        if (step.held)
            return lastTick;
        if (everyFrame)
            return time;
        return Math.min(time - dt, step.tick ? time : lastTick);
    }
    advance(time, dt, active, everyFrame = false) {
        const step = this.preview(time, dt, active, everyFrame);
        this.previous = time;
        this.remainder = step.remainder;
        this.duration = step.duration;
        this.elapsed = step.elapsed;
        return { tick: step.tick, alpha: step.alpha };
    }
}
//# sourceMappingURL=scene-frame-clock.js.map