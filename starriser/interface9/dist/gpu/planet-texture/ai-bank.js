/**
 * Offline AI surface-patch library — isolated stamps by kind × family.
 *
 * Layout:
 *   assets/planets/ai/patches/<kind>/<family>/00.png …
 *   colorized-normals also ship paired tangent normals as 00.n.png
 *
 * Kinds:
 *   texturization      — color-only surface detail (geology + gas; NO impacts)
 *   colorized-normals  — major features: albedo color + true normal pair
 *
 * Families:
 *   impacts           — asteroid craters (land only; colorized-normals only)
 *   geology           — mountain chains, deserts, canyons, color variation, …
 *   gas               — cloud bands / vortices (gas class only; albedo; storms may omit normals)
 *   terrain-features  — green-screen mattes: structure detail, low color tint
 *                       (texturization only; no paired normals)
 *
 * Normals-only banks are retired. Every major land feature is color+normal.
 * Imagine is offline authoring only; no runtime diffusion.
 */
export const AI_PATCH_KINDS = [
    "texturization",
    "colorized-normals",
];
export const AI_PATCH_FAMILIES = [
    "impacts",
    "geology",
    "gas",
    "terrain-features",
];
/** Root of the patch-native library (repo-relative). */
export const AI_PATCH_ROOT = "assets/planets/ai/patches";
/**
 * Expected catalog sizes (gating).
 * texturization/geology is 19 after QA cull of bad stamps; colorized-normals
 * geology may be larger — loader uses this as the sequential index ceiling
 * for each kind×family that shares the family key (smoke requires ≥ this many
 * files under 00…N-1 for each product kind that hosts the family).
 * Impacts 40; gas 12.
 */
export const AI_PATCH_CATALOG = {
    impacts: 40,
    geology: 18,
    gas: 12,
    /** Green-screen terrain detail stamps (texturization only). */
    "terrain-features": 39,
};
/** Minimum impacts required when library is considered complete. */
export const AI_IMPACT_MIN = 40;
export const AI_CLOUD_CLASSES = [
    "cyclones",
    "long-and-sharp",
    "mixed",
    "spread-out-small-cluster-of-clouds",
    "unique-shapes",
    "huge-clouds",
];
/** Minimum total cloud stamps in the product bank. */
export const AI_CLOUD_MIN_COUNT = 110;
/**
 * Per-class floors from Downloads zips (sum ≥ AI_CLOUD_MIN_COUNT):
 * cyclones 29, long-and-sharp 27, mixed 16, spread-out 14, unique-shapes 11,
 * huge-clouds 13.
 */
export const AI_CLOUD_CATALOG = {
    cyclones: 29,
    "long-and-sharp": 27,
    mixed: 16,
    "spread-out-small-cluster-of-clouds": 14,
    "unique-shapes": 11,
    "huge-clouds": 13,
};
/**
 * Stamp composite: plain straight-alpha over only (matte keeps natural alpha).
 * Lighten weight stays 0 — dual brighten pass retired.
 */
export const CLOUD_STAMP_LIGHTEN_WEIGHT = 0;
export const CLOUD_STAMP_NORMAL_WEIGHT = 1;
/** Root for cloud stamps: assets/planets/ai/patches/clouds/<class>/NN.png */
export function aiCloudPath(cls, index) {
    const i = ((index % 1000) + 1000) % 1000;
    const n = i.toString().padStart(2, "0");
    return `${AI_PATCH_ROOT}/clouds/${cls}/${n}.png`;
}
export function listAiCloudPaths(cls, count) {
    const n = Math.max(0, Math.floor(count));
    const out = [];
    for (let i = 0; i < n; i++)
        out.push(aiCloudPath(cls, i));
    return out;
}
export function totalCloudCatalogCount() {
    let s = 0;
    for (const c of AI_CLOUD_CLASSES)
        s += AI_CLOUD_CATALOG[c];
    return s;
}
/**
 * Whether kind×family is a valid product path.
 * Texturization never hosts impacts (color detail only — no crater bank).
 * Gas never needs a normals-only bank (storms are albedo; optional .n omitted).
 */
export function isValidPatchSlot(kind, family) {
    if (kind === "texturization" && family === "impacts")
        return false;
    // Terrain-features are color-only structure stamps (no paired normals)
    if (kind === "colorized-normals" && family === "terrain-features")
        return false;
    return true;
}
/**
 * Repo-root relative path for a patch albedo (or sole) member.
 * Index is zero-padded to 2 digits (00…NN).
 */
export function aiPatchPath(kind, family, index) {
    const i = ((index % 1000) + 1000) % 1000;
    const n = i.toString().padStart(2, "0");
    return `${AI_PATCH_ROOT}/${kind}/${family}/${n}.png`;
}
/**
 * Paired tangent-space normal map next to a colorized-normals albedo.
 * Same family/index → `NN.n.png` (land impacts/geology required).
 */
export function aiPatchNormalPath(family, index) {
    const i = ((index % 1000) + 1000) % 1000;
    const n = i.toString().padStart(2, "0");
    return `${AI_PATCH_ROOT}/colorized-normals/${family}/${n}.n.png`;
}
/**
 * Seeded index in [0, bankSize). Pure — same seed+kind+family+salt → same index.
 */
export function pickAiPatchIndex(seed, kind, bankSize, salt = 0) {
    const n = Math.max(1, Math.floor(bankSize));
    let h = (seed >>> 0) ^ Math.imul(salt | 0, 0x9e3779b9);
    const s = String(kind);
    for (let i = 0; i < s.length; i++) {
        h = Math.imul(h ^ s.charCodeAt(i), 0x85ebca6b);
    }
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) % n;
}
/** List expected albedo paths for a kind×family (tests / manifests). */
export function listAiPatchPaths(kind, family, count) {
    const n = Math.max(0, Math.floor(count));
    const out = [];
    for (let i = 0; i < n; i++)
        out.push(aiPatchPath(kind, family, i));
    return out;
}
/**
 * Primary albedo family for large texture stamps by planet class.
 * Gas never pulls land geology/impacts for its main set.
 */
export function textureFamilyForClass(cls) {
    return cls === "gas" ? "gas" : "geology";
}
/**
 * Feature family for prominent colorized stamps.
 * Gas uses storm/vortex set; land classes use geology.
 */
export function featureFamilyForClass(cls) {
    return cls === "gas" ? "gas" : "geology";
}
/** True when class may schedule impact stamps (solid land). */
export function classUsesImpactStamps(cls) {
    // Rocky: terrain-features only; gas has no impacts
    return cls !== "gas" && cls !== "rocky";
}
/**
 * Density requests (upper bounds). Effective stamps = min(request, bank, packing).
 * Texturization is the larger soft layer; colorized-normals (features) add relief.
 * Requests are high so land is well covered; packing allows light same-role overlap.
 */
export function planPatchDensity(cls) {
    // Counts are upper bounds; planner caps to bank + packing.
    // Reuse allowed when request > bank (texturization geology = 18 on disk).
    // Terrain-features: composite massifs + dense scatter (bank reuse OK).
    // Counts are high — packing + resolution scale set effective coverage.
    switch (cls) {
        case "rocky":
            // Rocky product path: terrain-features only (no geology/impact banks).
            return {
                textureLarge: 0,
                features: 0,
                impacts: 0,
                terrainFeatures: 900,
                normalsOnly: 0,
            };
        case "ice":
            return {
                textureLarge: 132,
                features: 78,
                impacts: 26,
                terrainFeatures: 700,
                normalsOnly: 0,
            };
        case "exotic":
            return {
                textureLarge: 138,
                features: 78,
                impacts: 28,
                terrainFeatures: 780,
                normalsOnly: 0,
            };
        case "gas":
            return {
                textureLarge: 12,
                features: 4,
                impacts: 0,
                terrainFeatures: 0,
                normalsOnly: 0,
            };
        case "ocean":
        case "temperate":
        default:
            return {
                textureLarge: 144,
                features: 84,
                impacts: 28,
                terrainFeatures: 820,
                normalsOnly: 0,
            };
    }
}
/**
 * How many colorized-normals geology pairs to scan on disk.
 * Fuller than AI_PATCH_CATALOG.geology (texturization cull floor = 18).
 */
export const GEOLOGY_COLORIZED_BANK = 28;
/** Whether vegetation-style green detail overlay still applies (procedural). */
export function usesVegetationOverlay(cls) {
    return cls === "ocean" || cls === "temperate";
}
/** @deprecated Patch catalog is kind×family, not class banks. */
export const AI_BANK_CLASSES = [
    "impacts",
    "geology",
];
/** @deprecated Prefer AI_PATCH_CATALOG.impacts. */
export const AI_BANK_MIN_COUNT = AI_IMPACT_MIN;
/**
 * @deprecated Map old class bank calls → patch paths.
 * impacts → colorized-normals/impacts; geology → texturization/geology.
 */
export function aiBankPath(cls, index) {
    if (cls === "impacts" || cls === "rocky") {
        return aiPatchPath("colorized-normals", "impacts", index);
    }
    if (cls === "geology" || cls === "vegetation") {
        return aiPatchPath("texturization", "geology", index);
    }
    if (cls === "gas") {
        return aiPatchPath("texturization", "gas", index);
    }
    if (cls === "ice") {
        return aiPatchPath("colorized-normals", "geology", index);
    }
    return aiPatchPath("texturization", "geology", index);
}
/** @deprecated Prefer pickAiPatchIndex. */
export function pickAiBankIndex(seed, cls, bankSize, salt = 0) {
    return pickAiPatchIndex(seed, String(cls), bankSize, salt);
}
/** @deprecated Class no longer selects a primary bank. */
export function primaryBankForClass(cls) {
    if (cls === "rocky")
        return "impacts";
    return "geology";
}
/** @deprecated */
export function listAiBankPaths(cls, count) {
    const n = Math.max(0, Math.floor(count));
    const out = [];
    for (let i = 0; i < n; i++)
        out.push(aiBankPath(cls, i));
    return out;
}
/**
 * Showcase / import override paths (first geology texturization member).
 * Not full-planet equirect banks.
 */
export const AI_EQUIRECT_ASSETS = {
    azure: aiPatchPath("texturization", "geology", 0),
    rocky: aiPatchPath("colorized-normals", "impacts", 0),
    ocean: aiPatchPath("texturization", "geology", 1),
    temperate: aiPatchPath("texturization", "geology", 2),
    gas: aiPatchPath("texturization", "gas", 0),
    ice: aiPatchPath("colorized-normals", "geology", 0),
    exotic: aiPatchPath("colorized-normals", "geology", 1),
    vegetation: aiPatchPath("texturization", "geology", 4),
};
//# sourceMappingURL=ai-bank.js.map