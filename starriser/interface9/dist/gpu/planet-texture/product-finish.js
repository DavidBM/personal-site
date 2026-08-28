/**
 * DOM-free product-finish pipeline (always-on hybrid).
 *
 * Same stamps / salts / radii / strengths as planet-texture.html:
 * texturization, terrain-features, colorized features, impacts, vegetation,
 * land grit, gas advection, temperate cloud bank, refreshPolesFromAlbedo.
 *
 * Catalog bakers pass preloaded `ProductFinishBanks` so N planets share one
 * AI library load. Browser `loadImageRgba` uses fetch + createImageBitmap;
 * inject a loader for Node / workers.
 */
import { AI_PATCH_CATALOG, AI_CLOUD_CLASSES, AI_CLOUD_CATALOG, AI_PATCH_KINDS, AI_PATCH_FAMILIES, GEOLOGY_COLORIZED_BANK, aiPatchPath, aiPatchNormalPath, aiCloudPath, planPatchDensity, textureFamilyForClass, featureFamilyForClass, classUsesImpactStamps, usesVegetationOverlay, isValidPatchSlot, } from "./ai-bank.js";
import { generateOrbitVegetationPatch, mergeAiGallery, planAiPatches, planCompositeAiPatches, refreshPolesFromAlbedo, reinjectLandGrit, scaleStampCount, stampAiPatches, GAS_STAMP_MAX_ABS_Y, LAND_SOFT_OVERLAP_MARGIN, } from "./ai-patches.js";
import { throwIfBakeAborted, isBakeAbortError } from "./bake.js";
import { renderLandHeightHeatmap, renderPureBiomeSplitMap } from "./climate.js";
import { generateGasVelocityField, advectAlbedoByGasVelocity, } from "./gas-flow.js";
import { generateClouds } from "./materials.js";
import { poleIceExtentScale, rasterizeCloudPoleCaps, rasterizePoleCap, } from "./pole-cap.js";
function patchBankCeiling(kind, family) {
    const catalog = AI_PATCH_CATALOG[family] ?? 14;
    return kind === "colorized-normals" && family === "geology"
        ? Math.max(catalog, 40)
        : catalog;
}
function patchCacheKey(kind, family) {
    return `${kind}/${family}`;
}
/**
 * Browser image loader (fetch + createImageBitmap + canvas).
 * Inject a different loader via loadProductFinishBanks / finishPlanetProduct.
 */
export async function loadImageRgba(url) {
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`fetch ${url} ${res.status}`);
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const id = ctx.getImageData(0, 0, c.width, c.height);
    bmp.close();
    return { width: c.width, height: c.height, rgba: id.data };
}
/** Load offline cloud stamp bank (all categories) for bake compose. */
export async function loadCloudBankSources(loadImage = loadImageRgba, signal) {
    const out = [];
    for (const cls of AI_CLOUD_CLASSES) {
        const n = AI_CLOUD_CATALOG[cls] ?? 0;
        for (let i = 0; i < n; i++) {
            throwIfBakeAborted(signal);
            const path = aiCloudPath(cls, i);
            try {
                const img = await loadImage(path);
                out.push({
                    width: img.width,
                    height: img.height,
                    rgba: img.rgba,
                    strength: 1,
                    category: cls,
                });
            }
            catch {
                /* skip missing */
            }
        }
    }
    return out;
}
/**
 * Load kind×family patch sources in ascending library index order.
 * Skips missing files so partial libraries still bake.
 * colorized-normals also load paired `…/<idx>.n.png` true normals.
 * Dense array: each source is a unique path (planner uniqueSources → unique paths).
 */
export async function loadPatchLibrarySources(kind, family, _seed, count, _salt, signal, loadImage = loadImageRgba) {
    const catalog = AI_PATCH_CATALOG[family] ?? 14;
    const bankSize = kind === "colorized-normals" && family === "geology"
        ? Math.max(catalog, 40)
        : catalog;
    const n = Math.max(0, Math.min(bankSize, Math.max(0, Math.floor(count))));
    const sources = [];
    for (let idx = 0; idx < bankSize && sources.length < n; idx++) {
        throwIfBakeAborted(signal);
        const path = aiPatchPath(kind, family, idx);
        try {
            const img = await loadImage(path);
            const src = {
                width: img.width,
                height: img.height,
                rgba: img.rgba,
                path,
                kind,
            };
            if (kind === "colorized-normals") {
                const nPath = aiPatchNormalPath(family, idx);
                try {
                    const nImg = await loadImage(nPath);
                    src.normalRgba = nImg.rgba;
                    src.normalWidth = nImg.width;
                    src.normalHeight = nImg.height;
                }
                catch {
                    /* gas storms may be albedo-only */
                }
            }
            sources.push(src);
        }
        catch {
            /* skip missing */
        }
    }
    return sources;
}
async function sourcesFromBanks(banks, kind, family, count, loadImage, signal) {
    const key = patchCacheKey(kind, family);
    let all = banks.patches.get(key);
    if (!all) {
        const bankSize = patchBankCeiling(kind, family);
        all = await loadPatchLibrarySources(kind, family, 0, bankSize, 0, signal, loadImage);
        banks.patches.set(key, all);
    }
    const n = Math.max(0, Math.min(all.length, Math.max(0, Math.floor(count))));
    return all.slice(0, n);
}
export async function loadProductFinishBanks(loadImage, signal) {
    const load = loadImage ?? loadImageRgba;
    throwIfBakeAborted(signal);
    const clouds = await loadCloudBankSources(load, signal);
    const patches = new Map();
    for (const kind of AI_PATCH_KINDS) {
        for (const family of AI_PATCH_FAMILIES) {
            if (!isValidPatchSlot(kind, family))
                continue;
            throwIfBakeAborted(signal);
            const bankSize = patchBankCeiling(kind, family);
            const sources = await loadPatchLibrarySources(kind, family, 0, bankSize, 0, signal, load);
            patches.set(patchCacheKey(kind, family), sources);
        }
    }
    return { clouds, patches };
}
/**
 * Bake-time gas flow warp: precompute UV velocity at sim res, advect albedo.
 * Strength/steps scale mildly with bake width (cheap at preview, richer at 2K+).
 */
export function advectGasAlbedoInPlace(set) {
    const W = set.albedo.width;
    const H = set.albedo.height;
    const p = set.params;
    // Sim res: full width capped for cost (8K → 1024×512 class still OK)
    const simW = Math.min(W, 1024);
    const simH = Math.max(4, Math.round((simW * H) / W / 2) * 2);
    // Stronger advection so base gas bands move visibly (stamps secondary)
    const steps = W >= 2048 ? 22 : W >= 1024 ? 16 : 12;
    const strength = 1.55;
    const vel = generateGasVelocityField(p.seed, simW, simH, p.bandStrength, p.stormDensity, p.warp);
    const meanDelta = advectAlbedoByGasVelocity(set.albedo.rgba, W, H, vel, steps, strength);
    return { meanDelta, steps };
}
/**
 * Apply the same always-on hybrid as planet-texture.html:
 * texturization, terrain-features, colorized features, impacts, vegetation,
 * land grit, gas advection, temperate cloud bank, refreshPolesFromAlbedo.
 */
export async function finishPlanetProduct(set, opts) {
    const signal = opts?.signal ?? null;
    const loadImage = opts?.loadImage ?? loadImageRgba;
    throwIfBakeAborted(signal);
    // Catalog baker: pass loadProductFinishBanks() once and reuse.
    // Empty / omitted banks: load the full library (or lazy-fill missing keys).
    const banks = opts?.banks ?? (await loadProductFinishBanks(loadImage, signal));
    const cls = set.params.planetClass;
    const seed = set.params.seed;
    const gallery = [];
    const resW = set.albedo.width;
    const density = planPatchDensity(cls);
    const texFam = textureFamilyForClass(cls);
    const featFam = featureFamilyForClass(cls);
    const lavaWorld = set.params.liquidKind === "lava";
    const iceWorld = cls === "ice";
    // Ice: structure-only stamps — keep the snow plate white (no soot lerp)
    const iceStampSat = iceWorld ? 0.12 : 1;
    const landS = set.params.hybridLandDetail ??
        (cls === "gas"
            ? 0.32
            : iceWorld
                ? 0.18
                : cls === "ocean" || cls === "temperate"
                    ? 0.52
                    : 0.5);
    const oceanS = set.params.hybridOceanDetail ??
        (cls === "gas" ? 0.28 : iceWorld ? 0.08 : 0.02);
    try {
        const noteParts = [];
        let totalStamps = 0;
        // Global used paths this planet: each library path ≤1 stamp
        const usedPaths = new Set();
        // 1) Large texturization (geology land / gas bands) — denser coverage
        // Rocky: terrain-features only (skip geology texture bank)
        {
            const nTex = scaleStampCount(density.textureLarge, resW);
            const bankN = AI_PATCH_CATALOG[texFam] ?? 12;
            throwIfBakeAborted(signal);
            const sources = await sourcesFromBanks(banks, "texturization", texFam, bankN, loadImage, signal);
            if (sources.length && nTex > 0) {
                const stamps = planAiPatches(seed, nTex, sources.length, {
                    salt: 11,
                    // Texturization = soft layer; compact radii + soft margin for dense pack
                    minRadiusFrac: cls === "gas" ? 0.12 : 0.042,
                    maxRadiusFrac: cls === "gas" ? 0.28 : 0.1,
                    rotationMode: cls === "gas" ? "bandAligned" : "free",
                    maxAbsY: cls === "gas" ? GAS_STAMP_MAX_ABS_Y : undefined,
                    // Allow reuse when request > bank so land gets more stamps
                    uniqueSources: nTex <= sources.length,
                    nonOverlap: true,
                    // Texture decks edge-overlap more so ~3× counts can place
                    overlapMargin: cls === "gas" ? 1.0 : 0.72,
                });
                const r = stampAiPatches(set, sources, stamps, {
                    kind: "texturization",
                    landStrength: landS,
                    oceanStrength: oceanS,
                    // Ice: stamp all non-deep liquid (frozen crust is "land")
                    landOnly: cls !== "gas",
                    refreshPoles: false,
                    // Grit once after all stamp rounds (see reinjectLandGrit below)
                    skipGrit: true,
                    albedoBlend: "luminosity",
                    stampColorTint: cls === "gas" ? 0.4 : iceWorld ? 0.02 : 0.08,
                    protectSnow: true,
                    warmOnly: lavaWorld,
                    stampSaturation: iceStampSat,
                });
                for (const p of r.usedPaths) {
                    gallery.push({ path: p, role: "primary" });
                    usedPaths.add(p);
                }
                totalStamps += r.stampCount;
                noteParts.push(`tex×${r.stampCount}/${texFam}`);
            }
        }
        // 1b) Terrain-features (green-screen mattes): structure/contrast on land,
        // very low residual color so biomes keep palette.
        // Two-pass: composite massifs (2–5 plates mixed per cluster) + dense scatter
        // fill. Bank reuse allowed — catalog is small vs stamp demand.
        {
            const nTf = scaleStampCount(density.terrainFeatures, resW);
            if (nTf > 0 && cls !== "gas") {
                const bankN = AI_PATCH_CATALOG["terrain-features"] ?? 40;
                throwIfBakeAborted(signal);
                const sources = await sourcesFromBanks(banks, "texturization", "terrain-features", bankN, loadImage, signal);
                if (sources.length && nTf > 0) {
                    const tfBlendRaw = set.params.terrainFeatureBlend ?? "linear";
                    const tfBlend = tfBlendRaw === "lerp" ||
                        tfBlendRaw === "multiply" ||
                        tfBlendRaw === "softLight" ||
                        tfBlendRaw === "overlay" ||
                        tfBlendRaw === "screen" ||
                        tfBlendRaw === "linear" ||
                        tfBlendRaw === "luminosity"
                        ? tfBlendRaw
                        : "linear";
                    const tfStr = set.params.terrainFeatureStrength !== undefined &&
                        Number.isFinite(set.params.terrainFeatureStrength)
                        ? Math.max(0, Math.min(1, set.params.terrainFeatureStrength))
                        : 1;
                    // Strength is absolute cover for TF (not stacked on hybridLandDetail)
                    const tfLand = tfStr;
                    // TF → high elev; stamp + plan both bias using baked height heat
                    const elevPlan = {
                        elevPrefer: "high",
                        heightRgba: set.height.rgba,
                        heightWidth: set.height.width,
                        heightHeight: set.height.height,
                        seaLevel: set.params.liquidLevel,
                    };
                    const tfOpts = {
                        kind: "texturization",
                        landStrength: iceWorld ? Math.min(0.22, tfLand) : tfLand,
                        oceanStrength: 0,
                        landOnly: true,
                        refreshPoles: false,
                        skipGrit: true,
                        albedoBlend: iceWorld ? "luminosity" : tfBlend,
                        stampColorTint: iceWorld
                            ? 0.02
                            : tfBlend === "lerp"
                                ? 0.12
                                : 0.04,
                        protectSnow: true,
                        warmOnly: lavaWorld,
                        elevWeight: "high",
                        stampSaturation: iceStampSat,
                    };
                    // Massifs: multi-plate clusters — normal-to-large, varied size
                    const nClusters = Math.max(10, Math.min(Math.floor(nTf * 0.2), Math.floor(nTf / 2.8)));
                    const compositeStamps = planCompositeAiPatches(seed, nClusters, sources.length, {
                        salt: 53,
                        minMembers: 2,
                        maxMembers: 5,
                        minRadiusFrac: 0.07,
                        maxRadiusFrac: 0.18,
                        memberSpreadFrac: 0.55,
                        memberRadiusScale: 0.82,
                        uniqueSources: false,
                        nonOverlap: true,
                        overlapMargin: 0.7,
                        ...elevPlan,
                    });
                    let tfCount = 0;
                    if (compositeStamps.length && tfLand > 1e-4) {
                        const rC = stampAiPatches(set, sources, compositeStamps, {
                            ...tfOpts,
                            // Slightly stronger on composites so the massif reads as one unit
                            landStrength: Math.min(1, tfLand * 1.12),
                        });
                        for (const p of rC.usedPaths) {
                            gallery.push({ path: p, role: "detail" });
                            usedPaths.add(p);
                        }
                        tfCount += rC.stampCount;
                    }
                    // Mid scatter: medium plates filling land between massifs
                    const nScatter = Math.max(Math.floor(nTf * 0.7), nTf - Math.floor(compositeStamps.length * 0.25));
                    let scatterPlaced = 0;
                    if (nScatter > 0 && tfLand > 1e-4) {
                        // Varied mid-size stamps (normal → large)
                        const scatterStamps = planAiPatches(seed, nScatter, sources.length, {
                            salt: 59,
                            minRadiusFrac: 0.035,
                            maxRadiusFrac: 0.11,
                            uniqueSources: false,
                            nonOverlap: true,
                            overlapMargin: 0.52,
                            occupiedStamps: compositeStamps,
                            ...elevPlan,
                        });
                        if (scatterStamps.length) {
                            const rS = stampAiPatches(set, sources, scatterStamps, tfOpts);
                            for (const p of rS.usedPaths) {
                                gallery.push({ path: p, role: "detail" });
                                usedPaths.add(p);
                            }
                            scatterPlaced = rS.stampCount;
                            tfCount += rS.stampCount;
                        }
                    }
                    // Smaller fillers (still readable, not micro-speckles)
                    const nMicro = Math.max(20, Math.floor(nTf * 0.35));
                    if (nMicro > 0 && tfLand > 1e-4) {
                        const microStamps = planAiPatches(seed, nMicro, sources.length, {
                            salt: 61,
                            minRadiusFrac: 0.022,
                            maxRadiusFrac: 0.055,
                            uniqueSources: false,
                            nonOverlap: true,
                            overlapMargin: 0.45,
                            ...elevPlan,
                        });
                        if (microStamps.length) {
                            const rM = stampAiPatches(set, sources, microStamps, {
                                ...tfOpts,
                                landStrength: Math.min(1, tfLand * 0.85),
                            });
                            for (const p of rM.usedPaths) {
                                gallery.push({ path: p, role: "detail" });
                                usedPaths.add(p);
                            }
                            tfCount += rM.stampCount;
                        }
                    }
                    totalStamps += tfCount;
                    noteParts.push(`tf×${tfCount}/terrain-features↑elev` +
                        (compositeStamps.length
                            ? `(${nClusters} massifs+scatter${scatterPlaced ? `×${scatterPlaced}` : ""})`
                            : "") +
                        `@${tfBlend}×${tfStr.toFixed(2)}`);
                }
            }
        }
        // Major features share one packing space (geology features + impacts):
        // no major-on-major overlap across sequential plan rounds.
        const majorOccupied = [];
        // 2) Prominent colorized features (geology land / gas storms) — normals+color
        {
            const nFeat = scaleStampCount(density.features, resW);
            // Geology colorized bank is fuller than texturization catalog floor
            const bankN = featFam === "geology"
                ? GEOLOGY_COLORIZED_BANK
                : (AI_PATCH_CATALOG[featFam] ?? 10);
            throwIfBakeAborted(signal);
            const sources = await sourcesFromBanks(banks, "colorized-normals", featFam, bankN, loadImage, signal);
            if (sources.length && nFeat > 0) {
                // Colorized geology → low-mid elev (green/desert); gas: no elev bias
                const elevPlanLow = cls === "gas"
                    ? {}
                    : {
                        elevPrefer: "low",
                        heightRgba: set.height.rgba,
                        heightWidth: set.height.width,
                        heightHeight: set.height.height,
                        seaLevel: set.params.liquidLevel,
                    };
                const stamps = planAiPatches(seed, nFeat, sources.length, {
                    salt: 29,
                    minRadiusFrac: cls === "gas" ? 0.04 : 0.024,
                    maxRadiusFrac: cls === "gas" ? 0.09 : 0.08,
                    rotationMode: cls === "gas" ? "bandAligned" : "free",
                    maxAbsY: cls === "gas" ? GAS_STAMP_MAX_ABS_Y : undefined,
                    uniqueSources: nFeat <= sources.length,
                    nonOverlap: true,
                    // Slight edge overlap among features; still pack vs impacts
                    overlapMargin: cls === "gas" ? 1.0 : Math.min(0.82, LAND_SOFT_OVERLAP_MARGIN),
                    occupiedStamps: majorOccupied,
                    ...elevPlanLow,
                });
                for (const st of stamps) {
                    majorOccupied.push({
                        u: st.u,
                        v: st.v,
                        radiusFrac: st.radiusFrac,
                    });
                }
                const r = stampAiPatches(set, sources, stamps, {
                    kind: "colorized-normals",
                    landStrength: cls === "gas" ? landS : iceWorld ? 0.16 : Math.min(0.88, landS + 0.18),
                    oceanStrength: cls === "gas" ? oceanS : 0,
                    landOnly: cls !== "gas",
                    refreshPoles: false,
                    skipGrit: true,
                    normalStrength: iceWorld ? 0.55 : 0.93,
                    normalLateralBoost: iceWorld ? 1.2 : 1.6,
                    colorOpacity: cls === "gas" ? 0.42 : iceWorld ? 0.18 : 0.72,
                    albedoBlend: "luminosity",
                    stampColorTint: cls === "gas" ? 0.32 : iceWorld ? 0.02 : 0.14,
                    protectSnow: true,
                    warmOnly: lavaWorld,
                    elevWeight: cls === "gas" ? undefined : "low",
                    stampSaturation: iceStampSat,
                });
                for (const p of r.usedPaths) {
                    gallery.push({ path: p, role: "detail" });
                    usedPaths.add(p);
                }
                totalStamps += r.stampCount;
                noteParts.push(`feat×${r.stampCount}/${featFam}${cls === "gas" ? "" : "↓elev"}`);
            }
        }
        // 3) Asteroid impacts — paired color+normal; avoid major-on-major vs features
        {
            const nImp = scaleStampCount(density.impacts, resW);
            if (nImp > 0 && classUsesImpactStamps(cls)) {
                throwIfBakeAborted(signal);
                const colSrc = await sourcesFromBanks(banks, "colorized-normals", "impacts", AI_PATCH_CATALOG.impacts, loadImage, signal);
                if (colSrc.length && nImp > 0) {
                    const stamps = planAiPatches(seed, nImp, colSrc.length, {
                        salt: 73,
                        minRadiusFrac: 0.012,
                        maxRadiusFrac: cls === "rocky" ? 0.05 : iceWorld ? 0.048 : 0.038,
                        uniqueSources: true,
                        nonOverlap: true,
                        // Prefer clear of geology features; slight edge OK with denser majors
                        overlapMargin: 0.95,
                        // Pack around already-placed geology features (shared major space)
                        occupiedStamps: majorOccupied,
                    });
                    for (const st of stamps) {
                        majorOccupied.push({
                            u: st.u,
                            v: st.v,
                            radiusFrac: st.radiusFrac,
                        });
                    }
                    const r = stampAiPatches(set, colSrc, stamps, {
                        kind: "colorized-normals",
                        landStrength: iceWorld ? 0.14 : 0.82,
                        oceanStrength: 0,
                        landOnly: true,
                        refreshPoles: false,
                        skipGrit: true,
                        normalStrength: iceWorld ? 0.5 : 0.94,
                        normalLateralBoost: iceWorld ? 1.15 : 1.7,
                        colorOpacity: iceWorld ? 0.16 : 0.72,
                        albedoBlend: "luminosity",
                        stampColorTint: lavaWorld ? 0.22 : iceWorld ? 0.02 : 0.14,
                        protectSnow: true,
                        warmOnly: lavaWorld,
                        stampSaturation: iceStampSat,
                    });
                    for (const p of r.usedPaths) {
                        gallery.push({ path: p, role: "detail" });
                        usedPaths.add(p);
                    }
                    totalStamps += r.stampCount;
                    noteParts.push(`imp×${r.stampCount}`);
                }
            }
        }
        // 4) Procedural orbit vegetation on temperate/ocean land (no legacy veg bank)
        if (usesVegetationOverlay(cls)) {
            const synth = generateOrbitVegetationPatch(seed ^ 0x0eaf00d, 512, 256);
            const vegSources = [
                {
                    width: synth.width,
                    height: synth.height,
                    rgba: synth.rgba,
                    path: "procedural:orbit-vegetation",
                    kind: "texturization",
                },
            ];
            // Vegetation is synthetic single source — allow multi-stamp (uniqueSources off)
            const vStamps = planAiPatches(seed, scaleStampCount(12, resW), 1, {
                salt: 99,
                minRadiusFrac: 0.05,
                maxRadiusFrac: 0.11,
                uniqueSources: false,
                nonOverlap: true,
            });
            const vr = stampAiPatches(set, vegSources, vStamps, {
                kind: "texturization",
                landStrength: 0.32,
                oceanStrength: 0,
                landOnly: true,
                refreshPoles: false,
                skipGrit: true,
                protectSnow: true,
            });
            gallery.push({ path: "procedural:orbit-vegetation", role: "vegetation" });
            totalStamps += vr.stampCount;
            noteParts.push(`veg×${vr.stampCount}`);
        }
        // One land grit pass after all stamp rounds (half legacy amp; no stacking)
        if (cls !== "gas" && totalStamps > 0) {
            reinjectLandGrit(set, 7);
        }
        // Gas: advect baseline albedo (materials + stamps) by sphere flow so
        // currents/vortices carry painted color — not only overlay stamp RGB.
        if (cls === "gas") {
            const { meanDelta, steps } = advectGasAlbedoInPlace(set);
            noteParts.push(`flowWarp Δ${meanDelta.toFixed(2)}×${steps}`);
        }
        // Cloud bank: temperate only (azure-ocean preset is temperate)
        if (cls === "temperate" && set.params.cloudCover > 0.01) {
            throwIfBakeAborted(signal);
            let cloudSrc = banks.clouds;
            if (cloudSrc.length === 0) {
                cloudSrc = await loadCloudBankSources(loadImage, signal);
                banks.clouds = cloudSrc;
            }
            if (cloudSrc.length >= 4) {
                const rgba = generateClouds(set.params, set.albedo.width, set.albedo.height, cloudSrc, {
                    liquidRgba: set.liquidMask.rgba,
                    liquidW: set.liquidMask.width,
                    liquidH: set.liquidMask.height,
                    heightRgba: set.height.rgba,
                    heightW: set.height.width,
                    heightH: set.height.height,
                });
                if (rgba) {
                    set.clouds = {
                        width: set.albedo.width,
                        height: set.albedo.height,
                        rgba,
                    };
                    const cp = rasterizeCloudPoleCaps(set.clouds, set.params.poleSize);
                    set.cloudsPoleNorth = cp.poleNorth;
                    set.cloudsPoleSouth = cp.poleSouth;
                    noteParts.push(`cloudsBank×${cloudSrc.length}+poles`);
                }
            }
        }
        // Always rebuild poles after all stamp rounds so N/S inherit seam-safe belly
        refreshPolesFromAlbedo(set);
        if (!noteParts.length) {
            void usedPaths;
            return {
                note: "AI patches: library empty",
                gallery: [],
                stampCount: 0,
            };
        }
        void usedPaths;
        return {
            note: `AI patches ${cls} Σ${totalStamps} (${noteParts.join(" ")})`,
            gallery: mergeAiGallery(gallery),
            stampCount: totalStamps,
        };
    }
    catch (e) {
        if (isBakeAbortError(e))
            throw e;
        return {
            note: `AI patch failed: ${e instanceof Error ? e.message : String(e)}`,
            gallery: [],
            stampCount: 0,
        };
    }
}
/** Fill set.intermediates with pureBiomeSplit + heightHeat (full-res capable). */
export function attachBiomeIntermediates(set, maxWidth = 1024) {
    const cap = maxWidth != null && Number.isFinite(maxWidth) && maxWidth > 0
        ? Math.floor(maxWidth)
        : 1024;
    // Gas / non-earth: skip (biome split is for ocean/temperate land paint)
    const cls = set.params.planetClass;
    const heightHeat = renderLandHeightHeatmap(set.height.rgba, set.height.width, set.height.height, set.params.liquidLevel, cap);
    if (cls === "gas" || cls === "rocky" || cls === "exotic") {
        set.intermediates = {
            pureBiomeSplit: undefined,
            pureBiomeCounts: undefined,
            heightHeat: {
                width: heightHeat.width,
                height: heightHeat.height,
                rgba: heightHeat.rgba,
            },
        };
        return;
    }
    const iceScale = poleIceExtentScale(set.params.poleSize);
    const map = renderPureBiomeSplitMap(set.height.rgba, set.height.width, set.height.height, set.params.liquidLevel, set.params.seed, iceScale, cap);
    const counts = {};
    for (const [k, v] of Object.entries(map.counts)) {
        if (v)
            counts[k] = v;
    }
    set.intermediates = {
        pureBiomeSplit: {
            width: map.width,
            height: map.height,
            rgba: map.rgba,
        },
        pureBiomeCounts: counts,
        heightHeat: {
            width: heightHeat.width,
            height: heightHeat.height,
            rgba: heightHeat.rgba,
        },
    };
}
/** Rasterize extra pole products for catalog (normal + night). */
export function rasterizeExtraPoleProducts(set, nightRgba) {
    const poleSize = set.params.poleSize;
    const nW = set.normal.width;
    const nH = set.normal.height;
    const aW = set.albedo.width;
    const aH = set.albedo.height;
    return {
        normalPoleNorth: rasterizePoleCap(set.normal.rgba, nW, nH, poleSize, true),
        normalPoleSouth: rasterizePoleCap(set.normal.rgba, nW, nH, poleSize, false),
        nightPoleNorth: rasterizePoleCap(nightRgba, aW, aH, poleSize, true),
        nightPoleSouth: rasterizePoleCap(nightRgba, aW, aH, poleSize, false),
    };
}
/** Box/average downsample RGBA (used by catalog baker for 1024 previews). */
export function downsampleRgba(src, srcW, srcH, dstW, dstH) {
    const sw = Math.max(0, srcW | 0);
    const sh = Math.max(0, srcH | 0);
    const dw = Math.max(0, dstW | 0);
    const dh = Math.max(0, dstH | 0);
    const out = new Uint8ClampedArray(dw * dh * 4);
    if (sw < 1 || sh < 1 || dw < 1 || dh < 1)
        return out;
    const scaleX = sw / dw;
    const scaleY = sh / dh;
    for (let y = 0; y < dh; y++) {
        const y0 = Math.max(0, Math.min(sh - 1, Math.floor(y * scaleY)));
        const y1 = Math.max(y0 + 1, Math.min(sh, Math.ceil((y + 1) * scaleY)));
        for (let x = 0; x < dw; x++) {
            const x0 = Math.max(0, Math.min(sw - 1, Math.floor(x * scaleX)));
            const x1 = Math.max(x0 + 1, Math.min(sw, Math.ceil((x + 1) * scaleX)));
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            let n = 0;
            for (let sy = y0; sy < y1; sy++) {
                const yy = Math.max(0, Math.min(sh - 1, sy));
                for (let sx = x0; sx < x1; sx++) {
                    const xx = Math.max(0, Math.min(sw - 1, sx));
                    const i = (yy * sw + xx) * 4;
                    r += src[i] ?? 0;
                    g += src[i + 1] ?? 0;
                    b += src[i + 2] ?? 0;
                    a += src[i + 3] ?? 0;
                    n++;
                }
            }
            const o = (y * dw + x) * 4;
            const inv = n > 0 ? 1 / n : 0;
            out[o] = r * inv;
            out[o + 1] = g * inv;
            out[o + 2] = b * inv;
            out[o + 3] = a * inv;
        }
    }
    return out;
}
//# sourceMappingURL=product-finish.js.map