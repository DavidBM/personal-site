/**
 * Rasterize north/south pole-cap textures with alpha gradients.
 *
 * Product map side always scales with equirect resolution to cover the dual-UV
 * polar radius at belly-like density — independent of ice footprint.
 * `poleSize` controls polar ice extent only (DEFAULT_POLE_SIZE=250 → full ice;
 * 1 → nearly none). It does not resize N/S product maps.
 */
import { poleAlpha, poleUvToDir } from "./sphere-map.js";
/**
 * Max square side for N/S pole products. Finite so 8K bakes do not allocate
 * huge squares; large enough for user-chosen high-res caps.
 */
export const POLE_CAP_MAX_SIDE = 4096;
/** Minimum pole-cap / ice-control value. */
export const POLE_CAP_MIN_SIDE = 1;
/**
 * Reference for ice extent scale 1.0 and legacy default when res unknown.
 * Product size prefers defaultPoleSizeForResolution(res).
 */
export const DEFAULT_POLE_SIZE = 250;
/** Dual-UV / product cap half-angle (rad) — fixed for density; ice paint is separate. */
export const DEFAULT_POLE_CAP_ANGLE_RAD = 0.65;
/**
 * Default pole product side scales with equirect long edge (~res/2).
 * 256→128, 512→256, 2K→1024, 8K→4096 (clamped).
 */
export function defaultPoleSizeForResolution(resolution) {
    if (resolution == null || !Number.isFinite(resolution) || resolution <= 0) {
        return DEFAULT_POLE_SIZE;
    }
    return clampPoleCapSide(Math.round(resolution * 0.5));
}
/**
 * Clamp requested poleSize into valid range (ice control / optional export floor).
 */
export function clampPoleCapSide(poleSize) {
    const n = Math.floor(Number(poleSize));
    if (!Number.isFinite(n))
        return DEFAULT_POLE_SIZE;
    return Math.max(POLE_CAP_MIN_SIDE, Math.min(POLE_CAP_MAX_SIDE, n));
}
/**
 * Map poleSize → polar ice extent scale (absolute vs DEFAULT_POLE_SIZE).
 * Independent of equirect resolution so sticky UI poleSize does not shrink
 * ice when resolution rises.
 *
 *   1   → ~0.004 (ice only at true poles)
 * 125   → 0.5
 * 250   → 1.0   (default full ice)
 * 500   → 1.5
 * 750+  → 2.0   (caps push into mid-latitudes)
 *
 * Values above 250 used to only add +45% max — looked dead in the UI.
 */
export function poleIceExtentScale(poleSize, _equirectWidth) {
    const s = clampPoleCapSide(poleSize);
    if (s <= DEFAULT_POLE_SIZE) {
        return Math.max(0.004, s / DEFAULT_POLE_SIZE);
    }
    // Linear grow: +1.0 scale per +500 poleSize units, cap 2.0
    return Math.min(2, 1 + (s - DEFAULT_POLE_SIZE) / 500);
}
/**
 * Angular half-extent for pole-cap UV mapping.
 * Product maps always use full DEFAULT angle so dual-UV covers the polar zone
 * at belly density; ice footprint is painted on the belly, not by shrinking maps.
 */
export function poleCapAngleRad(_poleSize, _equirectWidth) {
    return DEFAULT_POLE_CAP_ANGLE_RAD;
}
/**
 * Product pole map side: always scales with equirect resolution to cover
 * dual-UV polar radius (~0.65 rad) at belly-like density.
 * Completely independent of poleSize / ice footprint (sticky UI cannot pin
 * product at 100×100 or inflate via ice control).
 */
export function poleProductSide(equirectWidth, _poleSize) {
    const W = Math.max(64, Math.floor(equirectWidth));
    // Full dual-UV polar radius at belly density — independent of ice
    const angle = DEFAULT_POLE_CAP_ANGLE_RAD;
    let S = Math.round((angle / Math.PI) * W * 2.0);
    // Floor: ≥1/4 of equirect long edge (big poles at 8K)
    S = Math.max(S, Math.round(W * 0.25));
    return clampPoleCapSide(S);
}
/**
 * Build pole RGBA by sampling equirect albedo at the sphere directions
 * corresponding to each pole-cap texel (with radial alpha).
 * Product side = poleProductSide(bellyW) — poleSize is ignored for size
 * (kept in the signature for call-site compatibility / ice control context).
 */
export function rasterizePoleCap(bellyAlbedo, bellyW, bellyH, poleSize, north, capAngleRad) {
    // Product always res-scaled (ice footprint is painted on the belly albedo)
    const S = poleProductSide(bellyW, poleSize);
    const angle = capAngleRad != null && Number.isFinite(capAngleRad)
        ? Math.max(1e-4, capAngleRad)
        : poleCapAngleRad();
    const rgba = new Uint8ClampedArray(S * S * 4);
    const invS = 1 / S;
    const twoPi = Math.PI * 2;
    const invTwoPi = 1 / twoPi;
    const invPi = 1 / Math.PI;
    for (let y = 0; y < S; y++) {
        const v = (y + 0.5) * invS;
        for (let x = 0; x < S; x++) {
            const u = (x + 0.5) * invS;
            const a = poleAlpha(u, v);
            const o = (y * S + x) * 4;
            if (a <= 0.001) {
                rgba[o] = 0;
                rgba[o + 1] = 0;
                rgba[o + 2] = 0;
                rgba[o + 3] = 0;
                continue;
            }
            const dir = poleUvToDir(u, v, north, angle);
            const lon = Math.atan2(dir.z, dir.x);
            const lat = Math.asin(Math.max(-1, Math.min(1, dir.y)));
            let eu = lon * invTwoPi + 0.5;
            if (eu < 0)
                eu += 1;
            if (eu >= 1)
                eu -= 1;
            const ev = 0.5 - lat * invPi;
            const ex = Math.min(bellyW - 1, Math.max(0, (eu * bellyW) | 0));
            const ey = Math.min(bellyH - 1, Math.max(0, (ev * bellyH) | 0));
            const bi = (ey * bellyW + ex) * 4;
            rgba[o] = bellyAlbedo[bi];
            rgba[o + 1] = bellyAlbedo[bi + 1];
            rgba[o + 2] = bellyAlbedo[bi + 2];
            rgba[o + 3] = (a * 255 + 0.5) | 0;
        }
    }
    return { width: S, height: S, rgba };
}
/**
 * Optional: sample height on pole for consistency checks.
 */
export function poleHeightSample(height, u, v, north) {
    const dir = poleUvToDir(u, v, north);
    const { x: dx, y: dy, z: dz } = dir;
    const lon = Math.atan2(dz, dx);
    const lat = Math.asin(Math.max(-1, Math.min(1, dy)));
    let eu = lon / (Math.PI * 2) + 0.5;
    if (eu < 0)
        eu += 1;
    const ev = 0.5 - lat / Math.PI;
    const ex = Math.min(height.width - 1, Math.max(0, Math.floor(eu * height.width)));
    const ey = Math.min(height.height - 1, Math.max(0, Math.floor(ev * height.height)));
    return height.data[ey * height.width + ex];
}
//# sourceMappingURL=pole-cap.js.map