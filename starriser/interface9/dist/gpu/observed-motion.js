/** Camera-only reconstruction of sparse observations. Never writes simulation poses. */
import { warpPosition } from './warp-motion.js';
export const OBSERVATION_PREDICT_SECONDS = 2 / 30;
function moved(a, b) { return a.x !== b.x || a.y !== b.y || a.z !== b.z; }
/** One tracker per camera target, not per ship. New readbacks do not snap the eye. */
export class ObservedMotion {
    constructor() {
        this.sample = null;
        this.correction = { x: 0, y: 0, z: 0 };
        this.correctedAt = 0;
    }
    reset() { this.sample = null; }
    at(next, nowMs) {
        // Admission/removal can change a center while simulation time is paused.
        if (this.sample?.observedMs === next.observedMs && moved(this.sample, next))
            this.reset();
        if (!this.sample || this.sample.observedMs !== next.observedMs)
            this.adopt(next, nowMs);
        return this.position(nowMs);
    }
    adopt(next, nowMs) {
        const previous = this.sample ? this.position(nowMs) : null;
        this.sample = next;
        const predicted = this.position(nowMs, false);
        this.correctedAt = nowMs;
        // A large discontinuity is a scene/warp cut, not local motion to smooth.
        const continuous = previous && Math.hypot(previous.x - predicted.x, previous.y - predicted.y, previous.z - predicted.z) < 0.01;
        this.correction.x = continuous ? previous.x - predicted.x : 0;
        this.correction.y = continuous ? previous.y - predicted.y : 0;
        this.correction.z = continuous ? previous.z - predicted.z : 0;
    }
    position(nowMs, correct = true) {
        const s = this.sample;
        if (s.warp)
            return warpPosition(s.warp, nowMs);
        const age = Math.min(OBSERVATION_PREDICT_SECONDS, Math.max(0, (nowMs - s.observedMs) / 1000));
        const decay = correct ? Math.exp(-Math.max(0, nowMs - this.correctedAt) / 45) : 0;
        return { x: s.x + s.vx * age + this.correction.x * decay,
            y: s.y + s.vy * age + this.correction.y * decay,
            z: s.z + s.vz * age + this.correction.z * decay };
    }
}
//# sourceMappingURL=observed-motion.js.map