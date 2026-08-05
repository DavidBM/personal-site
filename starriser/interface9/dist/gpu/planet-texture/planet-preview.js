/**
 * Pure CPU planet sphere preview with Azure-family atmosphere + multi-map lighting.
 *
 * Orthographic unit-sphere disc (camera −Z). Samples equirect bake maps, applies
 * Lambert + specular from liquid mask, analytic atmosphere via planet-scatter
 * (same math family as solar-system disc). Outside limb: soft atm shell only.
 *
 * Pose: yaw/pitch rotate body (texture). lightYaw/lightPitch aim sun in view space.
 * No auto-animation — caller redraws on user input or bake complete.
 */
import { dirToEquirect, sampleEquirectRgba } from "./sphere-map.js";
import { PLANET_ATM_DEFAULTS, } from "../solar-system/planet-atm-params.js";
import { rayVsSphere, inScatter, } from "../solar-system/planet-scatter.js";
function rotY(x, y, z, a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [x * c + z * s, y, -x * s + z * c];
}
function rotX(x, y, z, a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [x, y * c - z * s, y * s + z * c];
}
function lightFromAngles(yaw, pitch) {
    // yaw around Y, pitch around X — sun on unit sphere
    let x = 0;
    let y = 0;
    let z = 1;
    [x, y, z] = rotX(x, y, z, pitch);
    [x, y, z] = rotY(x, y, z, yaw);
    const L = Math.hypot(x, y, z) || 1;
    return { x: x / L, y: y / L, z: z / L };
}
/**
 * Rasterize lit planet disc with optional analytic atmosphere.
 * Accepts full multi-map set or legacy single albedo buffer.
 */
export function rasterizePlanetPreview(mapsOrAlbedo, opts = {}) {
    // Legacy: first arg was albedo buffer
    const maps = "albedo" in mapsOrAlbedo && mapsOrAlbedo.albedo
        ? mapsOrAlbedo
        : {
            albedo: mapsOrAlbedo,
        };
    const size = Math.max(32, Math.min(2048, Math.floor(opts.size ?? 384)));
    const yaw = opts.yaw ?? 0.35;
    const pitch = opts.pitch ?? 0.15;
    const atmOn = opts.atmosphere !== false;
    const ambient = opts.ambient ?? PLANET_ATM_DEFAULTS.ambient;
    const day = opts.dayStrength ?? PLANET_ATM_DEFAULTS.dayStrength;
    const specStr = opts.specStrength ?? PLANET_ATM_DEFAULTS.specStrength;
    const specPow = opts.specPower ?? PLANET_ATM_DEFAULTS.specPower;
    const texI = opts.texIntensity ?? PLANET_ATM_DEFAULTS.texIntensity;
    // Bake cloud map already holds stamp alpha; use full amount (no extra whitening filter)
    const cloudAmt = opts.cloudAmount ?? 1;
    const cloudUOff = opts.cloudUOffset ?? 0;
    const atmP = { ...PLANET_ATM_DEFAULTS, ...opts.atm };
    const camDist = atmP.camDist;
    const rInner = atmP.rInner;
    const atmThick = atmP.atmThick;
    const atmOuter = atmP.atmOuter;
    // Scale scatter intensity to Azure-ish limb without blowing out
    const atmIntensity = atmP.intensity * 0.35;
    const atmGain = atmP.atmGain;
    const extScale = atmP.extScale;
    let light;
    if (opts.light) {
        const L = Math.hypot(opts.light.x, opts.light.y, opts.light.z) || 1;
        light = {
            x: opts.light.x / L,
            y: opts.light.y / L,
            z: opts.light.z / L,
        };
    }
    else {
        light = lightFromAngles(opts.lightYaw ?? -0.7, opts.lightPitch ?? 0.35);
    }
    const albedo = maps.albedo;
    const normal = maps.normal ?? null;
    const liquid = maps.liquidMask ?? null;
    const clouds = maps.clouds ?? null;
    const rgba = new Uint8ClampedArray(size * size * 4);
    const sample = [0, 0, 0, 0];
    const nSample = [0, 0, 0, 0];
    const lSample = [0, 0, 0, 0];
    const cSample = [0, 0, 0, 0];
    let discCount = 0;
    let minL = Infinity;
    let maxL = -Infinity;
    let atmMax = 0;
    const inv = 2 / size;
    // Disc radius in NDC: surface at 1.0; atm extends to atmOuter
    const rrAtm = Math.max(atmOuter, 1.05);
    for (let py = 0; py < size; py++) {
        const ny = 1 - (py + 0.5) * inv;
        for (let px = 0; px < size; px++) {
            const nx = (px + 0.5) * inv - 1;
            const r2 = nx * nx + ny * ny;
            const rr = Math.sqrt(r2);
            const o = (py * size + px) * 4;
            if (rr > rrAtm) {
                rgba[o] = 0;
                rgba[o + 1] = 0;
                rgba[o + 2] = 0;
                rgba[o + 3] = 0;
                continue;
            }
            // Atmosphere scatter at disc point (view ray toward sphere)
            let atmR = 0;
            let atmG = 0;
            let atmB = 0;
            if (atmOn) {
                const camPos = { x: 0, y: 0, z: camDist };
                const dir = {
                    x: nx,
                    y: ny,
                    z: -camDist,
                };
                const dL = Math.hypot(dir.x, dir.y, dir.z) || 1;
                dir.x /= dL;
                dir.y /= dL;
                dir.z /= dL;
                const rOuter = rInner + atmThick;
                const atmHit = rayVsSphere(camPos, dir, rOuter);
                let eNear = atmHit.tNear;
                let eFar = atmHit.tFar;
                if (eNear <= eFar && eNear > 0) {
                    // Hard surface clamp on-disc
                    if (rr <= 1) {
                        const surf = rayVsSphere(camPos, dir, rInner);
                        if (surf.tNear < surf.tFar && surf.tNear > 0) {
                            eFar = Math.min(eFar, surf.tNear);
                        }
                    }
                    if (eFar > eNear) {
                        // inScatter returns SCATTER_INTENSITY-scaled values (order ~0–8)
                        const sc = inScatter(camPos, dir, eNear, eFar, light);
                        // Map to display RGB add (limb-readable; Azure-family blue bias)
                        const scale = (atmIntensity / 6) * atmGain * (0.55 / Math.max(0.02, extScale));
                        // sc is already intensity-scaled (~0–8); map to sRGB-ish add
                        atmR = Math.min(4, sc.x * scale * 0.04);
                        atmG = Math.min(4, sc.y * scale * 0.06);
                        atmB = Math.min(5, sc.z * scale * 0.1);
                        // Limb glow: stronger near silhouette
                        const limbBoost = 1.0 + 2.2 * Math.pow(Math.min(1, rr), 1.8);
                        atmR *= limbBoost * (0.35 + 0.65 * (atmP.colorR / 36));
                        atmG *= limbBoost * (0.45 + 0.55 * (atmP.colorG / 36));
                        atmB *= limbBoost * (0.55 + 0.55 * (atmP.colorB / 36));
                        atmR *= 0.8 + atmP.glowMul;
                        atmG *= 0.8 + atmP.glowMul;
                        atmB *= 0.8 + atmP.glowMul;
                    }
                }
                atmMax = Math.max(atmMax, atmR, atmG, atmB);
            }
            if (rr > 1) {
                // Exterior atmosphere shell only — soft alpha from atm + radial falloff
                const shell = 1 - smoothstep(1, rrAtm, rr);
                const a = Math.min(1, (atmR + atmG + atmB) * 0.55 * shell);
                if (a < 0.004) {
                    rgba[o] = 0;
                    rgba[o + 1] = 0;
                    rgba[o + 2] = 0;
                    rgba[o + 3] = 0;
                }
                else {
                    // Premultiplied-style store as straight RGB with alpha
                    rgba[o] = Math.round(Math.min(255, (atmR / Math.max(a, 1e-3)) * 40 * a));
                    rgba[o + 1] = Math.round(Math.min(255, (atmG / Math.max(a, 1e-3)) * 55 * a));
                    rgba[o + 2] = Math.round(Math.min(255, (atmB / Math.max(a, 1e-3)) * 90 * a));
                    rgba[o + 3] = Math.round(a * 255);
                }
                continue;
            }
            // On-disc surface
            const nz = Math.sqrt(Math.max(0, 1 - r2));
            let wx = nx;
            let wy = ny;
            let wz = nz;
            [wx, wy, wz] = rotX(wx, wy, wz, -pitch);
            [wx, wy, wz] = rotY(wx, wy, wz, -yaw);
            const nlen = Math.hypot(wx, wy, wz) || 1;
            wx /= nlen;
            wy /= nlen;
            wz /= nlen;
            const { u, v } = dirToEquirect({ x: wx, y: wy, z: wz });
            sampleEquirectRgba(albedo.rgba, albedo.width, albedo.height, u, v, sample);
            // Normal map (equirect) — optional bump for lighting
            let nxL = nx;
            let nyL = ny;
            let nzL = nz;
            if (normal) {
                sampleEquirectRgba(normal.rgba, normal.width, normal.height, u, v, nSample);
                // Tangent-ish: blend map normal into view normal
                const mx = (nSample[0] / 255) * 2 - 1;
                const my = (nSample[1] / 255) * 2 - 1;
                const mz = (nSample[2] / 255) * 2 - 1;
                nxL = nx + mx * 0.25 * (atmP.normalStrength * 4);
                nyL = ny + my * 0.25 * (atmP.normalStrength * 4);
                nzL = nz + mz * 0.15;
                const nl = Math.hypot(nxL, nyL, nzL) || 1;
                nxL /= nl;
                nyL /= nl;
                nzL /= nl;
            }
            const ndotl = Math.max(0, nxL * light.x + nyL * light.y + nzL * light.z);
            const dayTerm = ambient + day * ndotl;
            // Spec from liquid mask (water wetness) — lava is matte melt, no sun glints
            let wet = 0.08;
            let isLavaLiq = false;
            if (liquid) {
                sampleEquirectRgba(liquid.rgba, liquid.width, liquid.height, u, v, lSample);
                // Lava liquid: liquid mask + R-dominant albedo (mid orange counts too)
                isLavaLiq =
                    lSample[0] > 100 &&
                        sample[0] > 100 &&
                        sample[0] > sample[2] + 20 &&
                        sample[0] >= sample[1] * 0.75;
                if (!isLavaLiq) {
                    wet = Math.max(wet, (lSample[0] / 255) * 0.85 + (lSample[1] / 255) * 0.3);
                }
                else {
                    wet = 0; // molten basalt: blackbody glow, not specular water
                }
            }
            // Blinn-ish: half between light and view (0,0,1)
            const hx = light.x;
            const hy = light.y;
            const hz = light.z + 1;
            const hl = Math.hypot(hx, hy, hz) || 1;
            const ndoth = Math.max(0, (nxL * hx + nyL * hy + nzL * hz) / hl);
            const spec = wet * specStr * Math.pow(ndoth, specPow * 0.35);
            // Lava: day = full lit orange; shadow/night = soft dark neon (softer penumbra)
            let r;
            let g;
            let b;
            if (isLavaLiq) {
                const sr = sample[0] / 255;
                const sg = sample[1] / 255;
                const sb = sample[2] / 255;
                // dayTerm ∈ ~[ambient, ambient+day]; smooth penumbra (not hard on/off)
                let dayAmt = (dayTerm - ambient) / Math.max(1e-4, day);
                if (dayAmt < 0)
                    dayAmt = 0;
                if (dayAmt > 1)
                    dayAmt = 1;
                // Smoothstep softens terminator; night floor ~0.10 of albedo
                dayAmt = dayAmt * dayAmt * (3 - 2 * dayAmt);
                const nightFloor = 0.1;
                const term = nightFloor + dayAmt * (1 - nightFloor);
                r = sr * texI * term;
                g = sg * texI * (nightFloor * 0.4 + dayAmt * 0.88);
                b = sb * texI * (nightFloor * 0.22 + dayAmt * 0.78);
                // intentionally no water-class specular on lava
            }
            else {
                r = (sample[0] / 255) * texI * dayTerm;
                g = (sample[1] / 255) * texI * dayTerm;
                b = (sample[2] / 255) * texI * dayTerm;
                r += spec;
                g += spec;
                b += spec;
            }
            // Clouds: straight-alpha over with stamp RGB; optional U drift over land.
            if (clouds && cloudAmt > 0.01) {
                let cu = u + cloudUOff;
                cu = cu - Math.floor(cu);
                sampleEquirectRgba(clouds.rgba, clouds.width, clouds.height, cu, v, cSample);
                const ca = (cSample[3] / 255) * cloudAmt;
                if (ca > 0.004) {
                    const cr = (cSample[0] / 255) * dayTerm;
                    const cg = (cSample[1] / 255) * dayTerm;
                    const cb = (cSample[2] / 255) * dayTerm;
                    r = r * (1 - ca) + cr * ca;
                    g = g * (1 - ca) + cg * ca;
                    b = b * (1 - ca) + cb * ca;
                }
            }
            // Atmosphere additive (emissive) — surface alpha only (premul style)
            r += atmR * 0.85;
            g += atmG * 1.0;
            b += atmB * 1.15;
            // Soft limb AA
            const edge = Math.min(1, (1 - rr) * size * 0.5);
            const aa = edge < 1 ? edge : 1;
            const R = Math.min(255, r * 255);
            const G = Math.min(255, g * 255);
            const B = Math.min(255, b * 255);
            rgba[o] = Math.round(R);
            rgba[o + 1] = Math.round(G);
            rgba[o + 2] = Math.round(B);
            rgba[o + 3] = Math.round(255 * aa);
            discCount++;
            const L = (R + G + B) / 3;
            if (L < minL)
                minL = L;
            if (L > maxL)
                maxL = L;
        }
    }
    return {
        width: size,
        height: size,
        rgba,
        discPixelCount: discCount,
        interiorLuminanceSpan: discCount > 0 ? maxL - minL : 0,
        atmMax,
    };
}
function smoothstep(e0, e1, x) {
    const t = Math.max(0, Math.min(1, (x - e0) / Math.max(1e-8, e1 - e0)));
    return t * t * (3 - 2 * t);
}
/** Hash of preview RGBA for dual-call identity checks. */
export function hashPreviewRgba(buf) {
    let h = 0x811c9dc5;
    for (let i = 0; i < buf.rgba.length; i++) {
        h ^= buf.rgba[i];
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
}
/**
 * Build sun direction from lightYaw/lightPitch (exported for unit tests).
 */
export function previewLightDir(lightYaw, lightPitch) {
    return lightFromAngles(lightYaw, lightPitch);
}
//# sourceMappingURL=planet-preview.js.map