/**
 * Ray-march quality profiles for the multi-method demo.
 * Pure constants — UI + uniforms + smoke all share this registry.
 *
 * Adaptive step count (WGSL):
 *   n = clamp(max(requested, ceil(chordSpan / rayStep)), 1..maxSteps)
 * Smaller rayStep + larger maxSteps → denser march (quality).
 * Larger rayStep + small maxSteps → coarse march (performance).
 */
/**
 * Tight spread so switching is obvious in both ms and silhouette/cavity detail.
 * Mid ≈ historical demo defaults; performance is aggressive; quality is dense.
 */
export const QUALITY_PROFILES = [
    {
        id: "performance",
        label: "performance",
        rayStep: 0.055,
        maxSteps: 12,
        classic: 2,
        iterative: 3,
        offset: 3,
        steep: 5,
        pomLinear: 8,
        pomBinary: 2,
        cone: 5,
        binaryRefine: 2,
    },
    {
        id: "mid",
        label: "mid",
        rayStep: 0.018,
        maxSteps: 40,
        classic: 4,
        iterative: 10,
        offset: 6,
        steep: 16,
        pomLinear: 32,
        pomBinary: 6,
        cone: 16,
        binaryRefine: 6,
    },
    {
        id: "quality",
        label: "quality",
        rayStep: 0.008,
        maxSteps: 80,
        classic: 12,
        iterative: 24,
        offset: 16,
        steep: 40,
        pomLinear: 64,
        pomBinary: 12,
        cone: 40,
        binaryRefine: 12,
    },
];
export function getQualityProfile(id) {
    const p = QUALITY_PROFILES.find((q) => q.id === id);
    if (!p)
        throw new Error(`Unknown quality profile: ${id}`);
    return p;
}
export const DEFAULT_QUALITY_PROFILE = "mid";
//# sourceMappingURL=quality-profiles.js.map