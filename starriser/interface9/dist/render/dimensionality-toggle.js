export function togglePositionBufferDimensionality(positions, state) {
    const nextState = {
        flat2DActive: typeof state.flat2DActive === "boolean" ? state.flat2DActive : false,
        originalYPositions: state.originalYPositions,
    };
    if (!nextState.originalYPositions) {
        nextState.originalYPositions = new Float32Array(positions.length / 3);
        for (let i = 0, len = positions.length / 3; i < len; ++i) {
            nextState.originalYPositions[i] = positions[i * 3 + 1];
        }
    }
    nextState.flat2DActive = !nextState.flat2DActive;
    for (let i = 0, len = positions.length / 3; i < len; ++i) {
        if (nextState.flat2DActive) {
            positions[i * 3 + 1] = 0;
        }
        else {
            positions[i * 3 + 1] = nextState.originalYPositions[i];
        }
    }
    return nextState;
}
//# sourceMappingURL=dimensionality-toggle.js.map