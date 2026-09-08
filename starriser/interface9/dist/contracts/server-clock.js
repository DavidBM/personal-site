/** Only relative time enters the visual clock; authoritative u64 time stays
 * bigint. The final number is presentation precision, never a rule deadline. */
export function serverTimeForPresentation(serverMs, anchor, localMonotonicEpochMs, localFrameWallMs) {
    return localFrameWallMs + Number(serverMs - anchor.serverMs)
        + anchor.timeOriginMs + anchor.monotonicMs - localMonotonicEpochMs;
}
export function validateServerClock(anchor) {
    if (typeof anchor.serverMs !== "bigint" || anchor.serverMs < 0n || anchor.serverMs > 0xffffffffffffffffn
        || ![anchor.monotonicMs, anchor.timeOriginMs, anchor.roundTripMs].every(Number.isFinite)
        || anchor.monotonicMs < 0 || anchor.roundTripMs < 0)
        throw new Error("Invalid server clock observation");
}
//# sourceMappingURL=server-clock.js.map