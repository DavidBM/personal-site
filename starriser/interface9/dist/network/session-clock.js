/** The sample is observed at receive time; RTT is an uncertainty bound, not a
 * claim of synchronized clocks. Shared timeOrigin makes the worker context clear. */
export function createSessionClock(now, timeOriginMs) {
    let anchor;
    return {
        sample(serverMs, sentAt) {
            const monotonicMs = now();
            anchor = { serverMs, monotonicMs, timeOriginMs, roundTripMs: Math.max(0, monotonicMs - sentAt) };
            return anchor;
        },
        serverNow() {
            if (!anchor)
                throw new Error('Server clock is not initialized');
            const elapsed = Math.max(0, now() - anchor.monotonicMs);
            if (!Number.isSafeInteger(Math.floor(elapsed)))
                throw new Error('Server clock observation is outside its safe interval');
            return anchor.serverMs + BigInt(Math.floor(elapsed));
        },
        anchor() {
            if (!anchor)
                throw new Error('Server clock is not initialized');
            return anchor;
        },
    };
}
//# sourceMappingURL=session-clock.js.map