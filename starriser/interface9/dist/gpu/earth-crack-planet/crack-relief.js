/**
 * Crack relief knobs for the Earth+crack disc (pure, smoke-assertable).
 *
 * Product land path = sphere-surface **classic-parallax** ray-heightfield
 * with hit UV deformation on shell hits and true miss transparency (no fake
 * equirect floor sample, no albedo depth-darken overlay).
 */
import { methodIndex } from "../sphere-surface-methods/heightfield.js";
/** Land surface technique id — matches SURFACE_METHODS. */
export const CRACK_LAND_METHOD = "classic-parallax";
/** methodIndex("classic-parallax") — smoke asserts alignment. */
export const CRACK_LAND_METHOD_ID = methodIndex(CRACK_LAND_METHOD);
/**
 * Radial indent scale for dig walls / floor (rSurf = 1 − (1−h)·scale).
 * Depth slider overrides live. **Max indent is capped** ({@link CRACK_MAX_RADIAL_INDENT})
 * so dig shell never projects as a much smaller sphere that peels off before
 * the land limb (“parallax retracts too early”).
 */
export const CRACK_CLASSIC_HEIGHT_SCALE = 0.2;
/**
 * Hard cap on radial dig indent (fraction of unit radius).
 * Dig floor rSurf ≥ 1 − this. Uncapped scale 0.2 + deep dig → r≈0.81
 * (dig disc ~19% smaller than land; dig rotates away before planet limb).
 */
export const CRACK_MAX_RADIAL_INDENT = 0.025;
/**
 * Near disc limb (zSphere below this), dig tunnels are forced solid.
 * Graze dig rays miss the dig shell and open black holes that peel off
 * before the land edge — dig looks like a smaller sphere retracting early.
 */
export const CRACK_DIG_LIMB_Z_SOLID = 0.45;
/**
 * Classic linear step floor — denser than sphere-surface “mid”, near “quality”.
 * Higher → better wall/floor hits, fewer miss/step artifacts.
 */
export const CRACK_CLASSIC_STEPS = 32;
/** Chord sample spacing (unit-sphere units). Smaller → denser march. */
export const CRACK_RAY_STEP = 0.008;
/** Binary refine after linear hit (sharper trench walls). */
export const CRACK_BIN_REFINE = 12;
/** Hard loop ceiling for WGSL (≥ adaptive max from step/span). */
export const CRACK_RAY_LOOP_CEIL = 96;
/**
 * Finite-difference height→normal gain — disabled.
 * (gain≈18 over-exposed the disc; classic ray-heightfield is the relief.)
 */
export const CRACK_NORMAL_GAIN = 0;
export const CRACK_NORMAL_BLEND_MAX = 0;
export const CRACK_NORMAL_GAIN_BROKEN = 18;
export const CRACK_NORMAL_BLEND_BROKEN = 0.85;
/**
 * Structural height at deepest crack floor (sampleCrackOnlyHeight min ~0.05).
 * Used as the deep end of the albedo darken curve (not full-black crush).
 */
export const CRACK_DEPTH_H_MIN = 0.05;
/**
 * Day-map multiply at dig is **1** (no depth darken).
 * Dig = ray hit/miss + hit UV (sphere-surface style).
 */
export const CRACK_DEPTH_ALBEDO_FLOOR = 1;
/**
 * Soft graze weight for CRACK_LIMB_BLEND (equirect → limb blue).
 * z = sqrt(1−rr²). Extreme graze foreshortens equirect; we blend toward
 * limb blue + boost atm (not pure black). Softstep(SOFT0 → Z_MIN).
 * Narrower band than 0.38 so real land stays lit longer under the shell.
 */
export const CRACK_LIMB_Z_MIN = 0.22;
/** Softstep start for limbTexOn (zSphere). */
export const CRACK_LIMB_TEX_SOFT0 = 0.06;
/**
 * @deprecated Old constant mild gray multiply — not used.
 */
export const CRACK_SHADE_FLOOR_REMOVED = 0.55;
/** Product land path is classic ray-heightfield. */
export function isClassicRayHeightfieldLand() {
    return (CRACK_LAND_METHOD === "classic-parallax" &&
        CRACK_CLASSIC_HEIGHT_SCALE > 0.1 &&
        CRACK_CLASSIC_STEPS >= 4);
}
/**
 * Albedo multiply for dig — identity (always 1). Kept for API/smoke stability.
 * Depth cue is ray-heightfield hit/miss + hit UV, not an albedo gradient.
 */
export function crackDepthDarken(_h, _hMin = CRACK_DEPTH_H_MIN, albedoFloor = CRACK_DEPTH_ALBEDO_FLOOR) {
    return Math.min(1, Math.max(0, albedoFloor));
}
/**
 * @deprecated Alias — prefer {@link crackDepthDarken}.
 */
export function crackShadeFromHeight(h) {
    return crackDepthDarken(h);
}
/**
 * Unit-sphere surface radius after classic height indent (CPU parity of WGSL).
 * height 1 = crust, 0 = deep trench floor. Indent capped so dig shell ≈ planet size.
 */
export function classicSurfaceRadius(height, heightScale = CRACK_CLASSIC_HEIGHT_SCALE, maxIndent = CRACK_MAX_RADIAL_INDENT) {
    const h = Math.min(1, Math.max(0, height));
    const s = Math.max(0, heightScale);
    const indent = Math.min((1 - h) * s, Math.max(0, maxIndent));
    return 1 - indent;
}
//# sourceMappingURL=crack-relief.js.map