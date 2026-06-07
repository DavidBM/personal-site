export function captureRenderBufferYPositions(positions) {
    const yPositions = new Float32Array(positions.length / 3);
    for (let i = 0, len = yPositions.length; i < len; ++i) {
        yPositions[i] = positions[i * 3 + 1];
    }
    return yPositions;
}
export function applyRenderBufferFlatYState(positions, originalYPositions, flat2DActive) {
    for (let i = 0, len = positions.length / 3; i < len; ++i) {
        positions[i * 3 + 1] = flat2DActive ? 0 : originalYPositions[i];
    }
}
export function toggleGalaxyRenderDimensionality({ flat2DActive, solarSystemPositions, originalSolarSystemYPositions, connectionPositions, originalConnectionYPositions, }) {
    const nextFlat2DActive = !(typeof flat2DActive === "boolean" ? flat2DActive : false);
    const solarY = originalSolarSystemYPositions ??
        captureRenderBufferYPositions(solarSystemPositions);
    const connectionY = connectionPositions && !originalConnectionYPositions
        ? captureRenderBufferYPositions(connectionPositions)
        : originalConnectionYPositions;
    applyRenderBufferFlatYState(solarSystemPositions, solarY, nextFlat2DActive);
    if (connectionPositions && connectionY) {
        applyRenderBufferFlatYState(connectionPositions, connectionY, nextFlat2DActive);
    }
    return {
        flat2DActive: nextFlat2DActive,
        originalSolarSystemYPositions: solarY,
        originalConnectionYPositions: connectionY,
        solarSystemsChanged: true,
        connectionsChanged: connectionPositions !== null && connectionY !== null,
    };
}
//# sourceMappingURL=galaxy-render-dimensionality.js.map