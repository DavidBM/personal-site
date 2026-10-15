export function wheelEffort(delta, mode, viewportHeight) {
    if (!Number.isFinite(delta))
        return 0;
    const units = mode === 1 ? delta / 3 : mode === 2 ? delta * viewportHeight / 100 : delta / 100;
    // Preserve magnitude (including coalesced notches); bound pathological input.
    return Math.max(-8, Math.min(8, units));
}
/** Relative radius keeps miniature planets and fleets on the same control curve. */
export function wheelScaleRate(scale, distance, reference = 1) {
    if (scale === 'map')
        return .20 + .16 * Math.min(1, Math.max(0, Math.log2(1 + distance / 1000) / 8));
    // Selected planets/fleets span orders of magnitude. A full notch must leave
    // close range promptly; fractional trackpad effort still gives fine control.
    if (scale === 'orbit')
        return .20 + .08 * Math.min(1, Math.max(0, Math.log2(Math.max(1, distance / reference)) / 3));
    return .10 + .14 * Math.min(1, Math.max(0, Math.log2(Math.max(1, distance / reference)) / 5));
}
// Integral of gain: 1 for the first notch, rising to maxGain after six.
// Integrating effort avoids accelerating merely because a device emits more events.
function gainedEffort(e, maxGain) {
    const ramp = Math.max(0, Math.min(5, e - 1));
    const gain = maxGain - 1;
    return e + gain * ramp * ramp / 10 + gain * Math.max(0, e - 6);
}
export class DesktopWheel {
    constructor() {
        this.time = -Infinity;
        this.direction = 0;
        this.effort = 0;
        this.reversed = false;
    }
    reset() { this.time = -Infinity; this.direction = 0; this.effort = 0; this.reversed = false; }
    step(sample, viewportHeight, rate, maxGain = 3) {
        const units = wheelEffort(sample.deltaY, sample.deltaMode, viewportHeight);
        this.reversed = false;
        if (!units)
            return 0;
        const now = Number.isFinite(sample.timeStamp) ? sample.timeStamp : performance.now();
        const direction = Math.sign(units), elapsed = now - this.time;
        this.reversed = this.direction !== 0 && direction !== this.direction;
        if (this.reversed || elapsed < 0 || elapsed > 280)
            this.effort = 0;
        else
            this.effort *= Math.exp(-elapsed / 180);
        const next = this.effort + Math.abs(units);
        const delta = gainedEffort(next, maxGain) - gainedEffort(this.effort, maxGain);
        this.effort = Math.min(6, next);
        this.time = now;
        this.direction = direction;
        return direction * delta * rate;
    }
}
//# sourceMappingURL=desktop-wheel.js.map