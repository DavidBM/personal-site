/**
 * Public entry for planet texture generation.
 * Product bake: bakePlanetTexturesAuto / bakePlanetTexturesGpu (WebGPU).
 * Node smoke: bakePlanetTexturesGpuCpuRef (sequential pure-JS twin).
 *
 * Look: ISS-like dark oceans, land-locked coasts, regional biomes, polar ice.
 */
// PlanetClass re-export for UI bank pickers
export { RESOLUTION_OPTIONS, MAX_RESOLUTION, MIN_RESOLUTION, } from "./types.js";
export { bakePlanetTextures, completeBakeFromHeight, hashRgba, hashTextureSet, scaledHydraulicDrops, } from "./bake.js";
export { throwIfBakeAborted, isBakeAbortError } from "./bake.js";
export { defaultParams, paramsForPreset, cloneParams, clampResolution, PRESET_NAMES, } from "./presets.js";
export { equirectToDir, dirToEquirect, poleUvToDir, poleAlpha, sampleEquirectRgba, sampleClampRgba, compositeSphereSample, seamEdgeMaxDelta, } from "./sphere-map.js";
export { encodePngRgba, isPngMagic, PNG_MAGIC_HEX } from "./encode-png.js";
export { analyzeAlbedoQuality, analyzeMinimapAntiPatterns, meanRgbDistance, } from "./quality.js";
export { rasterizePlanetPreview, hashPreviewRgba, previewLightDir, } from "./planet-preview.js";
export { createAuthoringPlanetGpu, isAuthoringPlanetGpuAvailable, uploadBakeTexturePack, packBakeCloudsForDiscShader, buildNightEmissiveRgba, clampAuthoringZoom, AUTHORING_ZOOM_MIN, AUTHORING_ZOOM_MAX, trackballOrient, trackballLightDir, orientationFromYawPitch, lightDirFromAngles, defaultAuthoringOrientation, defaultAuthoringLightDir, } from "./authoring-planet-gpu.js";
export { countLandLocalMaxima, countLandLocalMaximaRgba, effectiveLayerTally, layerStackDescription, } from "./density.js";
export { PLANET_HEIGHT_LAYER_STACK, generateBaseHeight, reinjectPeakDetail, sampleTectonicControls, sampleHeightAtDir, sampleMicroReliefAtDir, } from "./heightfield.js";
export { generateGasField, generateGasVelocityField, advectAlbedoByGasVelocity, } from "./gas-flow.js";
export { buildPlanetStructure, buildStructureMapsForBake, structureBakeResolution, upsampleLandMask, upsampleLandMaskSmooth, upsampleLandMaskNearest, upsampleFloatField, structureMetrics, continentTopologyMetrics, continentShapeMetrics, isoperimetricCircularity, targetLandFractionForParams, farthestPointSphereSeeds, absorbTrappedSeas, countLandComponents, removeMicroLandComponents, morphologyCloseLand, equirectDistanceField, } from "./structure.js";
export { priorityFloodFill, accumulateFlowD8, runPriorityFloodDrainage, measureMaxLandFlow, carveWithFlow, } from "./drainage.js";
export { sampleClimateDrivers, classifyClimate, climateClassColor, softBiomeColor, scalePoleLatThresh, ClimateClass, CLIMATE_CLASS_COUNT, PureBiome, PURE_BIOME_DEBUG_RGB, PURE_BIOME_LABELS, renderPureBiomeSplitMap, } from "./climate.js";
export { validateEquirectAlbedo, applyImportedAlbedo, applyImportedHeight, syntheticSeamlessEquirect, syntheticBrokenSeamEquirect, } from "./equirect-import.js";
export { streamPowerPass, runStreamPowerErosion, runStreamPowerErosionLegacy, buildUpliftField, } from "./stream-power.js";
export { hybridMixAlbedo, hybridReplaceAlbedo, prepareAiEquirect, softFixEquirectSeam, resizeRgbaNearest, } from "./hybrid-mix.js";
export { AI_EQUIRECT_ASSETS, AI_BANK_CLASSES, AI_BANK_MIN_COUNT, AI_PATCH_ROOT, AI_PATCH_KINDS, AI_PATCH_FAMILIES, AI_PATCH_CATALOG, GEOLOGY_COLORIZED_BANK, AI_IMPACT_MIN, AI_CLOUD_MIN_COUNT, AI_CLOUD_CATALOG, AI_CLOUD_CLASSES, CLOUD_STAMP_LIGHTEN_WEIGHT, CLOUD_STAMP_NORMAL_WEIGHT, aiBankPath, aiPatchPath, aiPatchNormalPath, aiCloudPath, listAiCloudPaths, totalCloudCatalogCount, isValidPatchSlot, pickAiBankIndex, pickAiPatchIndex, planPatchDensity, primaryBankForClass, textureFamilyForClass, featureFamilyForClass, classUsesImpactStamps, usesVegetationOverlay, listAiBankPaths, listAiPatchPaths, } from "./ai-bank.js";
export { softStampAlpha, planAiPatches, planCompositeAiPatches, stampAiPatches, reinjectLandGrit, mixStampAlbedo, mixStampAlbedoLuminosity, warmStampRgb, stampsNonOverlapping, stampListsNonOverlapping, stampsUniqueSources, refreshPolesFromAlbedo, scaleStampCount, scoreOrbitVegetation, generateOrbitVegetationPatch, freshPresetSeed, mergeAiGallery, mulberry32, angularDistance, tangentBasis, sphereStampLocalUv, GAS_STAMP_MAX_ABS_Y, STAMP_OVERLAP_MARGIN, LAND_SOFT_OVERLAP_MARGIN, } from "./ai-patches.js";
export { softOceanPassesForResolution, lavaChannelField, lavaBasinBarrier, computeLavaFlowMap, splitMegaLavaSeas, seedMicroLavaPonds, dilateLavaLakes, hardenLavaShores, cullSmallLavaRivers, LAVA_RIVER_CHANNEL_THR, LAVA_RIVER_MIN_AREA, paletteForParams, gasPaletteFamilyIndex, gasPaletteByFamily, PALETTE_GAS_JUPITER, PALETTE_GAS_ICE, PALETTE_GAS_TEAL, PALETTE_GAS_VIOLET, frozenIceSeaColor, carveLavaRiverHeight, LAVA_LIQUID_SPEC, generateClouds, stampCloudSourcesOntoMap, compositeCloudStampSample, CLOUD_COMPOSITE_LIGHTEN, CLOUD_COMPOSITE_NORMAL, CLOUD_CYCLONE_MAX, CLOUD_HUGE_TARGET_COVER, CLOUD_HUGE_MAX_STAMPS, CLOUD_HUGE_ANG_CAP, sphereCapCoverFrac, cloudDensityHeat, BASE_LAND_GRAIN_AMP_EARTH, BASE_LAND_GRAIN_AMP_OTHER, BASE_LAND_GRAIN_AMP_POLAR, BASE_LAND_GRAIN_N1, QUIET_BROKEN_LAND_GRAIN_AMP_EARTH, QUIET_BROKEN_LAND_GRAIN_N1, } from "./materials.js";
export { buildLandWindField, sampleWindField, pickCloudCategoryFromWind, longStampYawFromWind, WIND_SPEED_LOW, WIND_SPEED_HIGH, WIND_VORTICITY_HIGH, WIND_LONG_MAX_BEND, } from "./wind-field.js";
export { softCoastFilter, pullCoastHeightsTowardSea, coastSpikeRatio, heightToNormalMap, flattenLiquidNormals, enforceStructureLandMask, } from "./heightfield.js";
export { softOceanAlbedo, oceanNeighborAbs, } from "./materials.js";
export { sampleOceanBathymetry3d, oceanHeightFromShallow, oceanPaintDepth, polarSafeShelfCue, } from "./ocean-bathymetry.js";
export { rasterizePoleCap, defaultPoleSizeForResolution, clampPoleCapSide, poleIceExtentScale, poleCapAngleRad, poleProductSide, POLE_CAP_MAX_SIDE, POLE_CAP_MIN_SIDE, DEFAULT_POLE_SIZE, DEFAULT_POLE_CAP_ANGLE_RAD, } from "./pole-cap.js";
export { paramsToQuery, paramsFromQuery } from "./url-state.js";
export const LIGHTBOX_SCALE_MIN = 0.5;
export const LIGHTBOX_SCALE_MAX = 24;
export function clampLightboxScale(s) {
    if (!Number.isFinite(s))
        return 1;
    return Math.max(LIGHTBOX_SCALE_MIN, Math.min(LIGHTBOX_SCALE_MAX, s));
}
/** Apply wheel zoom about a point in the view box (cx,cy). */
export function lightboxZoomAt(view, factor, cx, cy) {
    const old = clampLightboxScale(view.scale);
    const next = clampLightboxScale(old * factor);
    if (next === old)
        return { ...view, scale: next };
    // Keep the content under (cx,cy) stable: pan' = (pan - c) * (next/old) + c
    const k = next / old;
    return {
        scale: next,
        panX: (view.panX - cx) * k + cx,
        panY: (view.panY - cy) * k + cy,
    };
}
export function lightboxPan(view, dx, dy) {
    return {
        scale: clampLightboxScale(view.scale),
        panX: view.panX + dx,
        panY: view.panY + dy,
    };
}
export function defaultLightboxView() {
    return { scale: 1, panX: 0, panY: 0 };
}
/**
 * Whether a pointer gesture counts as a pan (vs a pure click).
 * Used so pan-release does not dismiss the texture lightbox.
 */
export function lightboxPointerWasPan(startX, startY, endX, endY, thresholdPx = 4) {
    const t = Math.max(0, thresholdPx);
    return Math.hypot(endX - startX, endY - startY) >= t;
}
/**
 * Lightbox dismiss policy for a click event:
 * - Never dismiss when the click lands on the stage (inspect / pan surface)
 * - Never dismiss after a pan gesture (even if click still fires)
 * - Allow dismiss only for true backdrop shell clicks without prior pan
 */
export function lightboxShouldDismissOnClick(opts) {
    if (opts.didPan)
        return false;
    if (opts.targetIsStage)
        return false;
    return opts.targetIsShell;
}
export { bakePlanetTexturesGpu, bakePlanetTexturesGpuCpuRef, bakePlanetTexturesAuto, isWebGpuBakeAvailable, requestPlanetBakeDevice, hashAlbedo, gpuGenerateBaseHeight, gpuBakeFull, formatStageMs, formatStageReport, isGpuStageTiming, } from "./bake-gpu.js";
export { PLANET_FULL_BAKE_PRODUCT_WGSL, PLANET_FULL_BAKE_TERRAIN_WGSL, } from "./shaders/planet-full-bake.wgsl.js";
//# sourceMappingURL=generator.js.map