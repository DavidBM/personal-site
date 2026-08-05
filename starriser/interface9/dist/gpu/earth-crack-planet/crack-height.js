/**
 * Crack-only structural height for the Earth+crack showcase.
 * Pure CPU — no polar sinkhole, no ground undulation/grit; only the
 * geological belly fissure at a wide planar scale (≫ prior ~⅓ product width).
 *
 * Height atlas is baked in planet-disc UV space for classic ray-heightfield.
 * Clouds stay unwarped (geometric UV).
 */
import { dirToUv, sampleFissureCavity, sampleHeightUV, } from "../sphere-surface-methods/heightfield.js";
/**
 * Planar half-width scale vs the original educational fissure (1 = educational).
 * Product uses a wide trench (well above the old ~⅓ scale).
 */
export const CRACK_WIDTH_SCALE = 1.25;
/** Prior product scale kept for smoke ratio checks. */
export const CRACK_WIDTH_SCALE_PRIOR = 1 / 3;
/** Known deep trench / collapse-pit probe (heightfield UV / fissure space). */
export const CRACK_TRENCH_UV = { u: 0.52, v: 0.52 };
/** Far crust probe (no fissure). */
export const CRACK_CRUST_UV = { u: 0.05, v: 0.12 };
/**
 * Height source tag for smoke / HUD — crack/fissure only (not full sampleHeightUV).
 */
export const CRACK_HEIGHT_SOURCE = "crack-only";
/**
 * Product surface UV mode: equirect land maps follow classic ray **hit UV**
 * when parallax is on (sphere-surface style deformation). Clouds stay geometric.
 */
export const CRACK_SURFACE_UV_MODE = "hit";
/**
 * Soft cap for docs/smoke — classic ray may travel further on steep walls;
 * not enforced as a hard clamp (clamping reintroduced the geom-only look).
 */
export const CRACK_SURFACE_UV_MAX_OFFSET = 0.5;
/** Floor height at trench center (not a hard clamp — end of smooth dig curve). */
export const CRACK_FLOOR_H = 0.06;
/**
 * Dig starts rising only after this cavity (keeps far crust at h=1 without a
 * hard cliff). Must use smoothstep — no `if (cav <= T) return 1` step.
 * Wide [start, full] band = soft terrain lip at product scale.
 */
export const CRACK_DIG_START = 0.05;
/**
 * Cavity level at which dig is fully open. Moderately tight walls; floor open
 * in the shader removes the planet film (not height softness alone).
 */
export const CRACK_DIG_FULL = 0.55;
/** UV half-spacing for cavity soft taps (damps HF wall roughness peaks). */
export const CRACK_CAVITY_SOFT_R = 0.01;
function smoothstep01(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0 || 1e-12)));
    return t * t * (3 - 2 * t);
}
/**
 * Optional multi-tap cavity average (tests / offline). **Not** used by the
 * hot height sample or 512² bake — that was 13×5 fissure walks per texel and
 * hung the page. Prefer atlas blur in {@link bakeCrackHeightRgba}.
 */
export function sampleFissureCavitySoft(u, v, widthScale = CRACK_WIDTH_SCALE, softR = CRACK_CAVITY_SOFT_R) {
    const uu = ((u % 1) + 1) % 1;
    const vv = Math.min(1, Math.max(0, v));
    const r = softR;
    // 5-tap only (cheap enough for occasional probes)
    const offs = [
        [0, 0],
        [r, 0],
        [-r, 0],
        [0, r],
        [0, -r],
    ];
    let sum = 0;
    for (const [du, dv] of offs) {
        const u2 = ((uu + du) % 1 + 1) % 1;
        const v2 = Math.min(1, Math.max(0, vv + dv));
        sum += sampleFissureCavity(u2, v2, widthScale);
    }
    return sum / offs.length;
}
/**
 * Structural height in [0,1] in **heightfield / fissure UV** space.
 *
 * Convention: **1 = crust** (zero indent), **~CRACK_FLOOR_H = floor**.
 * Soft dig via smoothstep (no hard cliff / floor clamps). O(1) per sample so
 * a 512² atlas bake stays interactive.
 *
 * GPU atlas applies a cheap post blur in {@link bakeCrackHeightRgba}.
 */
export function sampleCrackOnlyHeight(u, v, widthScale = CRACK_WIDTH_SCALE) {
    const uu = ((u % 1) + 1) % 1;
    const vv = Math.min(1, Math.max(0, v));
    // Single cavity sample — multi-tap here made bake hang (minutes of main thread)
    const cav = sampleFissureCavity(uu, vv, widthScale);
    // Single smoothstep — double-smooth made a very wide soft lip (planet film)
    const digSoft = smoothstep01(CRACK_DIG_START, CRACK_DIG_FULL, cav);
    const h = 1 - digSoft * (1 - CRACK_FLOOR_H);
    return Math.min(1, Math.max(0, h));
}
/** Separable box blur on a float height atlas (O(n·radius), not O(n·fissure)). */
export function blurHeightAtlas(data, width, height, radius = 2) {
    if (radius < 1)
        return data;
    const tmp = new Float32Array(width * height);
    const out = new Float32Array(width * height);
    const w = Math.max(1, radius * 2 + 1);
    // Horizontal
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let sum = 0;
            for (let k = -radius; k <= radius; k++) {
                const xx = Math.min(width - 1, Math.max(0, x + k));
                sum += data[y * width + xx];
            }
            tmp[y * width + x] = sum / w;
        }
    }
    // Vertical
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let sum = 0;
            for (let k = -radius; k <= radius; k++) {
                const yy = Math.min(height - 1, Math.max(0, y + k));
                sum += tmp[yy * width + x];
            }
            out[y * width + x] = sum / w;
        }
    }
    return out;
}
/**
 * Max |Δh| between adjacent samples on a 1D UV scan (for smoke smoothness).
 * Scans product height along a line; returns max jump per step.
 */
export function maxAdjacentHeightJump(u0, v0, u1, v1, steps = 128, widthScale = CRACK_WIDTH_SCALE) {
    let maxJump = 0;
    let minH = 1;
    let maxH = 0;
    let prev = sampleCrackOnlyHeight(u0, v0, widthScale);
    minH = Math.min(minH, prev);
    maxH = Math.max(maxH, prev);
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = u0 + (u1 - u0) * t;
        const v = v0 + (v1 - v0) * t;
        const h = sampleCrackOnlyHeight(u, v, widthScale);
        maxJump = Math.max(maxJump, Math.abs(h - prev));
        minH = Math.min(minH, h);
        maxH = Math.max(maxH, h);
        prev = h;
    }
    return { maxJump, minH, maxH };
}
/**
 * Planet-disc `sphereToUv` inverse: equirect UV → unit direction.
 * Must match `planet-disc.wgsl.ts` sphereToUv (lon=atan2(x,z), v=0.5−lat/π).
 */
export function planetDiscUvToDir(u, v, out = new Float32Array(3)) {
    const uu = ((u % 1) + 1) % 1;
    const vv = Math.min(1, Math.max(0, v));
    const lon = (uu - 0.5) * Math.PI * 2;
    const lat = (0.5 - vv) * Math.PI;
    const cl = Math.cos(lat);
    out[0] = cl * Math.sin(lon);
    out[1] = Math.sin(lat);
    out[2] = cl * Math.cos(lon);
    return out;
}
/**
 * Height at a **planet-disc** equirect UV: convert disc UV → dir → heightfield UV
 * → crack-only height. Use this for GPU atlas bake so texHeight aligns with
 * disc `sphereToUv` samples (not raw heightfield UV, which differs).
 */
export function sampleCrackOnlyHeightPlanetUv(planetU, planetV, widthScale = CRACK_WIDTH_SCALE) {
    const dir = planetDiscUvToDir(planetU, planetV);
    const hf = dirToUv(dir[0], dir[1], dir[2]);
    return sampleCrackOnlyHeight(hf[0], hf[1], widthScale);
}
/**
 * Legacy tangent-space UV offset helper — product path uses classic ray hit UV
 * in the shader, not this offset. Kept for API stability; returns zero.
 */
export function crackSurfaceUvOffset(_viewTsX, _viewTsY, _viewTsZ, _height) {
    return { du: 0, dv: 0, mode: CRACK_SURFACE_UV_MODE };
}
/**
 * Lateral half-width of the cavity: distance along **±V only** from a
 * centerline sample until cavity &lt; thresh on **both** sides.
 * Path-parallel extent is long; V is mostly cross-track for the belly trench,
 * so this tracks planar width (and thus widthScale).
 */
export function cavityLateralHalfWidth(u0, v0, widthScale, thresh = 0.08, maxR = 0.15, step = 0.001) {
    for (let r = step; r <= maxR; r += step) {
        const up = sampleFissureCavity(u0, v0 + r, widthScale);
        const dn = sampleFissureCavity(u0, v0 - r, widthScale);
        if (up < thresh && dn < thresh)
            return r;
    }
    return maxR;
}
/** @deprecated alias — lateral half-width (not path-length extent). */
export function cavityFootprintRadius(u0, v0, widthScale, thresh = 0.08, maxR = 0.15, step = 0.001) {
    return cavityLateralHalfWidth(u0, v0, widthScale, thresh, maxR, step);
}
/**
 * Mean cavity in a small UV window — smaller widthScale → lower mass (less area).
 */
export function cavityLocalMass(u0, v0, widthScale, radius = 0.06, step = 0.004) {
    let sum = 0;
    let n = 0;
    for (let du = -radius; du <= radius; du += step) {
        for (let dv = -radius; dv <= radius; dv += step) {
            sum += sampleFissureCavity(u0 + du, v0 + dv, widthScale);
            n++;
        }
    }
    return n > 0 ? sum / n : 0;
}
/**
 * Bake R-channel height atlas in **planet-disc equirect UV** (RGBA8).
 * Fast path: 1 cavity sample/texel + separable blur (soft lip without hang).
 */
export function bakeCrackHeightRgba(width, height, widthScale = CRACK_WIDTH_SCALE) {
    const raw = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        const v = y / Math.max(1, height - 1);
        for (let x = 0; x < width; x++) {
            const u = x / width;
            raw[y * width + x] = sampleCrackOnlyHeightPlanetUv(u, v, widthScale);
        }
    }
    // Minimal lip soften (shader true-wall gate removes soft-lip planet film)
    const blurred = blurHeightAtlas(raw, width, height, 1);
    const out = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        const h = Math.min(1, Math.max(0, blurred[i]));
        const b = Math.min(255, (h * 255) | 0);
        const o = i * 4;
        out[o] = b;
        out[o + 1] = b;
        out[o + 2] = b;
        out[o + 3] = 255;
    }
    return out;
}
/** Probe pack for smoke: crack-only vs full educational height + width scale. */
export function probeCrackOnlyVsFull() {
    const { u: tu, v: tv } = CRACK_TRENCH_UV;
    const { u: cu, v: cv } = CRACK_CRUST_UV;
    // North pole UV (v≈1) — full heightfield digs a polar hole; crack-only must not
    const poleU = 0.5;
    const poleV = 0.98;
    const crackTrenchH = sampleCrackOnlyHeight(tu, tv);
    const crackCrustH = sampleCrackOnlyHeight(cu, cv);
    const crackPoleH = sampleCrackOnlyHeight(poleU, poleV);
    const fullTrenchH = sampleHeightUV(tu, tv);
    const fullCrustH = sampleHeightUV(cu, cv);
    const fullPoleH = sampleHeightUV(poleU, poleV);
    const footprintEdu = cavityLateralHalfWidth(tu, tv, 1);
    const footprintProduct = cavityLateralHalfWidth(tu, tv, CRACK_WIDTH_SCALE);
    const footprintPrior = cavityLateralHalfWidth(tu, tv, CRACK_WIDTH_SCALE_PRIOR);
    const footprintRatioVsEdu = footprintEdu > 1e-6 ? footprintProduct / footprintEdu : 0;
    const footprintRatioVsPrior = footprintPrior > 1e-6 ? footprintProduct / footprintPrior : 0;
    const massEdu = cavityLocalMass(tu, tv, 1);
    const massProduct = cavityLocalMass(tu, tv, CRACK_WIDTH_SCALE);
    const massPrior = cavityLocalMass(tu, tv, CRACK_WIDTH_SCALE_PRIOR);
    return {
        crackTrenchH,
        crackCrustH,
        fullTrenchH,
        fullCrustH,
        fullHasPole: fullPoleH < 0.5,
        crackHasPole: crackPoleH < 0.5,
        /** @deprecated alias — educational width=1 lateral half-width */
        footprintFull: footprintEdu,
        /** Product width lateral half-width */
        footprintScaled: footprintProduct,
        footprintEdu,
        footprintProduct,
        footprintPrior,
        footprintRatio: footprintRatioVsEdu,
        footprintRatioVsEdu,
        footprintRatioVsPrior,
        massFull: massEdu,
        massScaled: massProduct,
        massEdu,
        massProduct,
        massPrior,
        massRatio: massEdu > 1e-6 ? massProduct / massEdu : 0,
        widthScale: CRACK_WIDTH_SCALE,
        widthScalePrior: CRACK_WIDTH_SCALE_PRIOR,
        heightSource: CRACK_HEIGHT_SOURCE,
    };
}
//# sourceMappingURL=crack-height.js.map