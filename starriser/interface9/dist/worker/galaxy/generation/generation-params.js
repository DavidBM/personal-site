export function normalizeGalaxyParams(params) {
    const { numClusters = 1000, numSolarSystems = 100, minDistance = 300, galaxySize = 25, maxConnections = 3, batchSize = 100, onBatch, centerBias = 0.6, } = params;
    return {
        numClusters,
        numSolarSystems,
        minDistance,
        galaxySize,
        // Strict 2D: ignore caller heightVariation until an explicit 2.5D reintroduction.
        heightVariation: 0,
        maxConnections,
        batchSize,
        onBatch,
        centerBias,
    };
}
//# sourceMappingURL=generation-params.js.map