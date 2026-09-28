/** Offline simulation time. Pause holds fleet jumps and ship motion on this clock. */
export function simNowMs(realNowMs, state) {
    if (state.paused)
        return state.frozenSimMs;
    return realNowMs - state.pauseAccumMs;
}
export function readSimPause(payload, previousFrozen = 0) {
    const pauseAccumMs = typeof payload.pauseAccumMs === "number"
        && Number.isFinite(payload.pauseAccumMs)
        && payload.pauseAccumMs > 0
        ? payload.pauseAccumMs
        : 0;
    const frozenSimMs = typeof payload.frozenSimMs === "number" && Number.isFinite(payload.frozenSimMs)
        ? payload.frozenSimMs
        : previousFrozen;
    return { paused: payload.paused === true, pauseAccumMs, frozenSimMs };
}
/** Main-thread owner. Workers apply the snapshot; they do not measure the gap themselves. */
export function createSimPauseController(realNow = () => Date.now()) {
    let paused = false;
    let pauseAccumMs = 0;
    let frozenSimMs = 0;
    let pauseRealStart = 0;
    const state = () => ({ paused, pauseAccumMs, frozenSimMs });
    return {
        get paused() { return paused; },
        now() { return simNowMs(realNow(), state()); },
        state,
        setPaused(next) {
            if (next !== paused) {
                const real = realNow();
                if (next) {
                    frozenSimMs = real - pauseAccumMs;
                    pauseRealStart = real;
                    paused = true;
                }
                else {
                    pauseAccumMs += Math.max(0, real - pauseRealStart);
                    paused = false;
                }
            }
            return state();
        },
    };
}
//# sourceMappingURL=sim-clock.js.map