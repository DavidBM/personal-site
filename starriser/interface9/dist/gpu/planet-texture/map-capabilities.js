/** Diagnostic products are class-specific; none of these imply physical climate. */
export function planetMapCapabilities(planetClass) {
    const biome = ["ocean", "temperate", "ice"].includes(planetClass);
    return {
        surfaceHeight: biome || planetClass === "rocky" || planetClass === "exotic",
        biome,
    };
}
export function supportsPlanetMap(planetClass, key) {
    const capability = planetMapCapabilities(planetClass);
    if (key === "height" || key === "height_diagnostic")
        return capability.surfaceHeight;
    if (key === "biome")
        return capability.biome;
    return true;
}
//# sourceMappingURL=map-capabilities.js.map