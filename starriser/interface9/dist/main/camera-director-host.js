/**
 * Live playback for {@link ../gpu/camera-director.ts}.
 * Applies eased poses each rAF. No pointer events.
 */
import { createDirectorQueue, directorFlyToSystem, directorLerpPose, } from "../gpu/camera-director.js";
export function createCameraDirectorHost(opts) {
    const queue = createDirectorQueue();
    let playing = null;
    let lastPose = null;
    const startNext = (nowMs) => {
        const step = queue.next();
        if (!step) {
            playing = null;
            return;
        }
        playing = { step, t0: nowMs };
    };
    return {
        enqueue(step) {
            queue.enqueue(step);
        },
        flyToSystem(from, system, height, durationMs) {
            const step = directorFlyToSystem(from, system, height, durationMs);
            queue.enqueue(step);
            return step;
        },
        tick(nowMs) {
            if (!playing)
                startNext(nowMs);
            if (!playing)
                return false;
            const { step, t0 } = playing;
            const dur = Math.max(1, step.durationMs);
            const t = (nowMs - t0) / dur;
            const pose = directorLerpPose(step.from, step.to, t);
            lastPose = pose;
            opts.applyPose(pose);
            if (t >= 1) {
                playing = null;
                startNext(nowMs);
            }
            return playing != null || queue.remaining() > 0;
        },
        isPlaying() {
            return playing != null || queue.remaining() > 0;
        },
        currentPose() {
            return lastPose;
        },
        currentMeta() {
            const meta = playing?.step.meta ?? queue.peek()?.meta;
            return meta ?? null;
        },
    };
}
//# sourceMappingURL=camera-director-host.js.map