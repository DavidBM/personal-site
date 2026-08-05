/**
 * Sphere ↔ equirectangular + polar-cap projection / blend math.
 *
 * Equirect (belly):
 *   u ∈ [0,1) → longitude λ = 2π(u − 0.5)
 *   v ∈ [0,1] → latitude  φ = π(0.5 − v)   (v=0 north, v=1 south)
 *   unit dir: x=cosφ cosλ, y=sinφ, z=cosφ sinλ
 *
 * U-wrap: column 0 neighbors column W−1 (same latitude).
 *
 * Pole caps (user strategy / EVE dual-UV spirit):
 *   Square texture, center = pole, radius maps to angular cap.
 *   Planar stereographic-ish: (nx,nz) = radial from pole in local frame.
 *   Alpha: 1 at center → 0 at outer radius (smoothstep) so caps blend over
 *   equirect without polar pinching as the sole strategy.
 *
 * EVE Dominion used runtime spherical belly + planar poles with interpolation;
 * we export pre-baked belly + N/S alpha-gradient caps for offline batch use.
 */
export function equirectToDir(u, v) {
    // Wrap u into [0,1)
    let uu = u - Math.floor(u);
    if (uu < 0)
        uu += 1;
    const vv = v < 0 ? 0 : v > 1 ? 1 : v;
    const lon = (uu - 0.5) * Math.PI * 2;
    const lat = (0.5 - vv) * Math.PI;
    const cosLat = Math.cos(lat);
    return {
        x: cosLat * Math.cos(lon),
        y: Math.sin(lat),
        z: cosLat * Math.sin(lon),
    };
}
export function dirToEquirect(d) {
    const len = Math.hypot(d.x, d.y, d.z) || 1;
    const x = d.x / len;
    const y = d.y / len;
    const z = d.z / len;
    const lon = Math.atan2(z, x); // −π..π
    const lat = Math.asin(Math.max(-1, Math.min(1, y)));
    let u = lon / (Math.PI * 2) + 0.5;
    if (u < 0)
        u += 1;
    if (u >= 1)
        u -= 1;
    const v = 0.5 - lat / Math.PI;
    return { u, v };
}
/**
 * Pole-cap UV (square [0,1]²) → unit direction.
 * north=true → +Y pole; false → −Y.
 * capAngleRad: angular half-extent from pole that maps to outer radius
 * (default ~35° ≈ 0.61 rad covers polar distortion zone).
 */
export function poleUvToDir(u, v, north, capAngleRad = 0.65) {
    // Center at 0.5,0.5; radius 0.5 at edge of circle inscribed in square
    const px = (u - 0.5) * 2; // −1..1
    const pz = (v - 0.5) * 2;
    const r = Math.hypot(px, pz);
    if (r < 1e-8) {
        return { x: 0, y: north ? 1 : -1, z: 0 };
    }
    // Map r∈[0,1] → angle from pole ∈ [0, capAngle]
    const ang = Math.min(1, r) * capAngleRad;
    const az = Math.atan2(pz, px);
    const sinA = Math.sin(ang);
    const cosA = Math.cos(ang);
    // Local: Y is polar axis
    const x = sinA * Math.cos(az);
    const z = sinA * Math.sin(az);
    const y = north ? cosA : -cosA;
    const len = Math.hypot(x, y, z) || 1;
    return { x: x / len, y: y / len, z: z / len };
}
/**
 * Radial alpha for pole cap: 1 at center, 0 at outer radius.
 * falloffStart (0–1): where fade begins; falloffEnd: fully transparent.
 */
export function poleAlpha(u, v, falloffStart = 0.55, falloffEnd = 0.98) {
    const px = (u - 0.5) * 2;
    const pz = (v - 0.5) * 2;
    const r = Math.hypot(px, pz);
    if (r <= falloffStart)
        return 1;
    if (r >= falloffEnd)
        return 0;
    const t = (r - falloffStart) / Math.max(1e-6, falloffEnd - falloffStart);
    // Smoothstep out
    const s = t * t * (3 - 2 * t);
    return 1 - s;
}
/**
 * Sample equirect buffer with U-wrap (longitude) and V-clamp (latitude).
 * Returns RGBA 0–255 floats in out.
 */
export function sampleEquirectRgba(rgba, width, height, u, v, out) {
    let uu = u - Math.floor(u);
    if (uu < 0)
        uu += 1;
    const vv = v < 0 ? 0 : v > 1 ? 1 : v;
    // Bilinear
    const x = uu * width - 0.5;
    const y = vv * height - 0.5;
    let x0 = Math.floor(x);
    let y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    // wrap x
    x0 = ((x0 % width) + width) % width;
    const x1 = (x0 + 1) % width;
    y0 = Math.max(0, Math.min(height - 1, y0));
    const y1 = Math.max(0, Math.min(height - 1, y0 + 1));
    const i00 = (y0 * width + x0) * 4;
    const i10 = (y0 * width + x1) * 4;
    const i01 = (y1 * width + x0) * 4;
    const i11 = (y1 * width + x1) * 4;
    for (let c = 0; c < 4; c++) {
        const a = rgba[i00 + c] * (1 - fx) + rgba[i10 + c] * fx;
        const b = rgba[i01 + c] * (1 - fx) + rgba[i11 + c] * fx;
        out[c] = a * (1 - fy) + b * fy;
    }
}
/**
 * Sample a planar square texture (pole caps) with U/V clamp — never wrap.
 * Wrapping would mix opposite edges of the polar disc and create seams.
 * Returns RGBA 0–255 floats in out.
 */
export function sampleClampRgba(rgba, width, height, u, v, out) {
    const uu = u < 0 ? 0 : u > 1 ? 1 : u;
    const vv = v < 0 ? 0 : v > 1 ? 1 : v;
    const x = uu * (width - 1);
    const y = vv * (height - 1);
    let x0 = Math.floor(x);
    let y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    x0 = Math.max(0, Math.min(width - 1, x0));
    y0 = Math.max(0, Math.min(height - 1, y0));
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const i00 = (y0 * width + x0) * 4;
    const i10 = (y0 * width + x1) * 4;
    const i01 = (y1 * width + x0) * 4;
    const i11 = (y1 * width + x1) * 4;
    for (let c = 0; c < 4; c++) {
        const a = rgba[i00 + c] * (1 - fx) + rgba[i10 + c] * fx;
        const b = rgba[i01 + c] * (1 - fx) + rgba[i11 + c] * fx;
        out[c] = a * (1 - fy) + b * fy;
    }
}
/**
 * Composite belly equirect + pole caps at a sphere direction.
 * Pole UV is planar (clamp sample). Alpha comes from the baked pole texel
 * only (rasterizePoleCap already writes poleAlpha into A — do not multiply
 * poleAlpha again).
 */
export function compositeSphereSample(belly, poleN, poleS, dir, capAngleRad = 0.65, out) {
    const { u, v } = dirToEquirect(dir);
    sampleEquirectRgba(belly.rgba, belly.width, belly.height, u, v, out);
    // Project to pole UV if inside cap
    const lat = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    const poleLatN = Math.PI / 2 - capAngleRad;
    const poleLatS = -Math.PI / 2 + capAngleRad;
    if (lat > poleLatN) {
        // North: angle from +Y
        const ang = Math.PI / 2 - lat;
        const r = ang / capAngleRad;
        const az = Math.atan2(dir.z, dir.x);
        const pu = 0.5 + 0.5 * r * Math.cos(az);
        const pv = 0.5 + 0.5 * r * Math.sin(az);
        const tmp = [0, 0, 0, 0];
        // Planar pole map — clamp UV (never wrap)
        sampleClampRgba(poleN.rgba, poleN.width, poleN.height, pu, pv, tmp);
        // Single alpha: baked A already encodes radial falloff
        const ca = tmp[3] / 255;
        if (ca > 1e-6) {
            for (let c = 0; c < 3; c++) {
                out[c] = out[c] * (1 - ca) + tmp[c] * ca;
            }
            out[3] = 255;
        }
    }
    else if (lat < poleLatS) {
        const ang = Math.PI / 2 + lat;
        const r = ang / capAngleRad;
        const az = Math.atan2(dir.z, dir.x);
        const pu = 0.5 + 0.5 * r * Math.cos(az);
        const pv = 0.5 + 0.5 * r * Math.sin(az);
        const tmp = [0, 0, 0, 0];
        sampleClampRgba(poleS.rgba, poleS.width, poleS.height, pu, pv, tmp);
        const ca = tmp[3] / 255;
        if (ca > 1e-6) {
            for (let c = 0; c < 3; c++) {
                out[c] = out[c] * (1 - ca) + tmp[c] * ca;
            }
            out[3] = 255;
        }
    }
}
/** Max |left−right| channel delta on equirect vertical edges (same row). */
export function seamEdgeMaxDelta(rgba, width, height) {
    let maxD = 0;
    for (let y = 0; y < height; y++) {
        const iL = (y * width + 0) * 4;
        const iR = (y * width + (width - 1)) * 4;
        for (let c = 0; c < 3; c++) {
            const d = Math.abs(rgba[iL + c] - rgba[iR + c]);
            if (d > maxD)
                maxD = d;
        }
    }
    return maxD;
}
//# sourceMappingURL=sphere-map.js.map