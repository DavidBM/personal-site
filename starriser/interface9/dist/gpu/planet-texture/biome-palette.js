/**
 * Hard biome class after FBM partition (intermediate debug — no soft blend).
 * Order is display/legend only; classification uses priority in softBiomeColor.
 */
export const PureBiome = {
    Ocean: 0,
    Beach: 1,
    Grass: 2,
    Forest: 3,
    Deep: 4,
    Desert: 5,
    Gray: 6,
    Tundra: 7,
    Snow: 8,
};
/** Diagnostic flat colors for pure biome split map (not product albedo). */
export const PURE_BIOME_DEBUG_RGB = {
    [PureBiome.Ocean]: { r: 0.08, g: 0.22, b: 0.55 },
    [PureBiome.Beach]: { r: 0.92, g: 0.82, b: 0.45 },
    [PureBiome.Grass]: { r: 0.35, g: 0.85, b: 0.25 },
    [PureBiome.Forest]: { r: 0.12, g: 0.52, b: 0.18 },
    [PureBiome.Deep]: { r: 0.04, g: 0.22, b: 0.1 },
    [PureBiome.Desert]: { r: 0.78, g: 0.62, b: 0.4 },
    [PureBiome.Gray]: { r: 0.55, g: 0.55, b: 0.58 },
    [PureBiome.Tundra]: { r: 0.55, g: 0.62, b: 0.7 },
    [PureBiome.Snow]: { r: 0.95, g: 0.97, b: 1.0 },
};
export const PURE_BIOME_LABELS = {
    [PureBiome.Ocean]: "ocean",
    [PureBiome.Beach]: "beach",
    [PureBiome.Grass]: "grass / lowland",
    [PureBiome.Forest]: "forest",
    [PureBiome.Deep]: "forest deep",
    [PureBiome.Desert]: "desert",
    [PureBiome.Gray]: "gray / rock",
    [PureBiome.Tundra]: "tundra",
    [PureBiome.Snow]: "snow",
};
//# sourceMappingURL=biome-palette.js.map