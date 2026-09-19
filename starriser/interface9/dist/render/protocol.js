/** Wall remaining for jumping/cooldown: startTime + durationMs − FrameTimeline.wallMs. */
export function sceneFleetRemainingSec(state, wallMs) {
    if (state.state !== "jumping" && state.state !== "cooldown")
        return null;
    const remainingMs = state.startTime + state.durationMs - wallMs;
    if (!Number.isFinite(remainingMs))
        return null;
    return Math.max(0, Math.floor(remainingMs / 1000));
}
//# sourceMappingURL=protocol.js.map