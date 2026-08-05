/**
 * Shared heightfield + UV-offset helpers for the multi-method sphere demo.
 * Pure CPU math — no GPU, no DOM — so Node smoke can exercise the shipped path.
 *
 * Height convention: 1 = outer crust, 0 = near-core cavity.
 * Content: polar sinkhole at the north pole + huge geological fissure on the belly
 * (main trench, branches, raised rims — continuous SDF, not block glyphs).
 */
export const HEIGHT_TEX_SIZE = 512;
/** Max radial indent as a fraction of unit radius (almost to the core). */
export const DISPLACE_STRENGTH = 0.88;
/**
 * Parallax / POM height scale in UV units.
 *
 * Mid-band (not “all smear” ~0.2+, not “all plane” ~0.05):
 * - Enough travel for ground grain + fissure walls to read under camera motion
 * - Still clamped so the whole sphere does not wrap/smear
 * - Flat/normal never call these helpers
 */
export const PARALLAX_SCALE = 0.11;
/** Hard cap on classic/offset UV travel (anti-smear; mid-band). */
export const PARALLAX_MAX_OFFSET = 0.085;
/** Steep / POM step counts (must match WGSL defaults). */
export const STEEP_STEPS = 16;
export const POM_LINEAR_STEPS = 32;
export const POM_BINARY_STEPS = 8;
export const CONE_STEPS = 16;
/** Soft normal-map derivative strength (was 12 → chrome walls). */
export const NORMAL_MAP_STRENGTH = 2.8;
/** Human-readable feature tag for HUD / tests. */
export const BELLY_FEATURE = "fissure";
/**
 * Convert sphere UV → unit direction.
 * u ∈ [0,1) longitude, v ∈ [0,1] with v=0 south pole, v=1 north pole.
 */
export function uvToDir(u, v, out = new Float32Array(3)) {
    const uu = ((u % 1) + 1) % 1;
    const vv = Math.min(1, Math.max(0, v));
    const phi = uu * Math.PI * 2;
    const theta = (1 - vv) * Math.PI; // 0 at north, π at south
    const st = Math.sin(theta);
    out[0] = st * Math.cos(phi);
    out[1] = Math.cos(theta);
    out[2] = st * Math.sin(phi);
    return out;
}
/**
 * Convert unit direction → UV (inverse of {@link uvToDir}).
 */
export function dirToUv(x, y, z, out = new Float32Array(2)) {
    const len = Math.hypot(x, y, z) || 1;
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;
    const theta = Math.acos(Math.min(1, Math.max(-1, ny)));
    let phi = Math.atan2(nz, nx);
    if (phi < 0)
        phi += Math.PI * 2;
    out[0] = phi / (Math.PI * 2);
    out[1] = 1 - theta / Math.PI;
    return out;
}
/** Distance from point to segment (u,v). */
function distToSeg(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const ab2 = abx * abx + aby * aby || 1e-12;
    let t = (apx * abx + apy * aby) / ab2;
    t = Math.min(1, Math.max(0, t));
    const qx = ax + abx * t;
    const qy = ay + aby * t;
    return { d: Math.hypot(px - qx, py - qy), t };
}
/**
 * Huge belly fissure: meandering main trench + branches.
 * Continuous distance field — no pixel-grid glyphs.
 */
function buildFissurePaths() {
    // Main trench: SW → NE across the front belly (u≈0.5 is +Z face center).
    const main = [];
    const N = 28;
    for (let i = 0; i <= N; i++) {
        const t = i / N;
        // Long diagonal-ish gash with geological meanders
        const u = 0.22 +
            0.56 * t +
            0.045 * Math.sin(t * Math.PI * 3.2) +
            0.02 * Math.sin(t * Math.PI * 7.1);
        const v = 0.36 +
            0.28 * t +
            0.05 * Math.cos(t * Math.PI * 2.4) +
            0.018 * Math.sin(t * Math.PI * 5.5 + 0.7);
        main.push({ u, v });
    }
    // Secondary branch (forks off mid-trench toward lower-right)
    const branchA = [];
    const mid = main[Math.floor(N * 0.42)];
    for (let i = 0; i <= 14; i++) {
        const t = i / 14;
        branchA.push({
            u: mid.u + 0.14 * t + 0.02 * Math.sin(t * Math.PI * 4),
            v: mid.v - 0.02 - 0.12 * t + 0.015 * Math.cos(t * Math.PI * 3),
        });
    }
    // Tertiary hairline crack (upper-left spur)
    const branchB = [];
    const mid2 = main[Math.floor(N * 0.62)];
    for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        branchB.push({
            u: mid2.u - 0.11 * t + 0.015 * Math.sin(t * Math.PI * 5 + 1),
            v: mid2.v + 0.03 + 0.1 * t + 0.012 * Math.cos(t * Math.PI * 4),
        });
    }
    // Short cross-fault cutting the main trench (geological joint)
    const cross = [];
    const c0 = main[Math.floor(N * 0.55)];
    for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        cross.push({
            u: c0.u - 0.08 + 0.16 * t + 0.01 * Math.sin(t * Math.PI * 2),
            v: c0.v + 0.09 - 0.18 * t + 0.008 * Math.cos(t * Math.PI * 3),
        });
    }
    return [
        {
            pts: main,
            // Wide graben in the middle, pinches at ends
            halfWidth: (t) => 0.012 + 0.038 * Math.sin(Math.PI * Math.min(1, Math.max(0, t))),
            depth: 1,
        },
        {
            pts: branchA,
            halfWidth: (t) => 0.008 + 0.014 * (1 - t * 0.7),
            depth: 0.72,
        },
        {
            pts: branchB,
            halfWidth: (t) => 0.006 + 0.01 * (1 - t),
            depth: 0.55,
        },
        {
            pts: cross,
            halfWidth: (t) => 0.007 + 0.01 * Math.sin(Math.PI * t),
            depth: 0.65,
        },
    ];
}
const FISSURE_PATHS = buildFissurePaths();
/**
 * Distance-field sample of the belly geological fissure.
 * Returns cavity amount in [0,1] (1 = deep trench floor).
 *
 * @param widthScale Multiplier on path half-width + collapse-pit radius
 *   (1 = original educational size; ~⅓ for the Earth+crack showcase).
 */
export function sampleFissureCavity(u, v, widthScale = 1) {
    // Front belly sector only (keep polar / back crust clean)
    if (v < 0.28 || v > 0.78)
        return 0;
    if (u < 0.14 || u > 0.88)
        return 0;
    const ws = Math.max(1e-4, widthScale);
    let best = 0;
    for (const path of FISSURE_PATHS) {
        const pts = path.pts;
        if (pts.length < 2)
            continue;
        let minD = 1e9;
        let along = 0;
        let totalLen = 0;
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i];
            const b = pts[i + 1];
            totalLen += Math.hypot(b.u - a.u, b.v - a.v);
        }
        totalLen = totalLen || 1;
        let walked = 0;
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i];
            const b = pts[i + 1];
            const segLen = Math.hypot(b.u - a.u, b.v - a.v);
            const hit = distToSeg(u, v, a.u, a.v, b.u, b.v);
            if (hit.d < minD) {
                minD = hit.d;
                along = (walked + hit.t * segLen) / totalLen;
            }
            walked += segLen;
        }
        // Variable half-width + slight high-frequency wall roughness
        const hw = path.halfWidth(along) *
            ws *
            (1 + 0.12 * Math.sin(along * 40 + u * 30) * Math.cos(v * 25));
        // Soft outer damage zone (wider than core trench)
        const outer = hw * 2.4;
        if (minD >= outer)
            continue;
        // V-shaped profile: full depth in core, falloff to shoulders
        let core = 0;
        if (minD <= hw) {
            const x = minD / Math.max(hw, 1e-6);
            // Steep walls, flat-ish floor in center third
            core = x < 0.35 ? 1 : 1 - ((x - 0.35) / 0.65) ** 1.4;
        }
        else {
            // Collapsed shoulder / rubble apron
            const x = (minD - hw) / Math.max(outer - hw, 1e-6);
            core = Math.max(0, 0.35 * (1 - x) * (1 - x));
        }
        // Deepen mid-trench; shallow near tips
        const tipFade = Math.sin(Math.PI * Math.min(1, Math.max(0, along)));
        const depth = core * path.depth * (0.55 + 0.45 * tipFade);
        best = Math.max(best, depth);
    }
    // Occasional sink bowls along the main trench (geological collapse pits)
    const pits = [
        { u: 0.38, v: 0.44, r: 0.028 },
        { u: 0.52, v: 0.52, r: 0.035 },
        { u: 0.64, v: 0.58, r: 0.025 },
    ];
    for (const p of pits) {
        const pr = p.r * ws;
        const d = Math.hypot(u - p.u, v - p.v);
        if (d < pr) {
            const x = d / pr;
            const bowl = (1 - x * x) * 0.85;
            best = Math.max(best, bowl);
        }
    }
    return Math.min(1, Math.max(0, best));
}
/**
 * Raised tectonic rims / fault shoulders along the fissure (height bump amount).
 * Positive values lift crust slightly next to the trench.
 */
export function sampleFissureRim(u, v) {
    if (v < 0.28 || v > 0.78)
        return 0;
    if (u < 0.14 || u > 0.88)
        return 0;
    let rim = 0;
    for (const path of FISSURE_PATHS) {
        if (path.depth < 0.9)
            continue; // main trench only for big rims
        const pts = path.pts;
        let minD = 1e9;
        let along = 0;
        let walked = 0;
        let totalLen = 0;
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i];
            const b = pts[i + 1];
            totalLen += Math.hypot(b.u - a.u, b.v - a.v);
        }
        totalLen = totalLen || 1;
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i];
            const b = pts[i + 1];
            const segLen = Math.hypot(b.u - a.u, b.v - a.v);
            const hit = distToSeg(u, v, a.u, a.v, b.u, b.v);
            if (hit.d < minD) {
                minD = hit.d;
                along = (walked + hit.t * segLen) / totalLen;
            }
            walked += segLen;
        }
        const hw = path.halfWidth(along);
        // Rim peak sits just outside the trench wall
        const peak = hw * 1.15;
        const band = hw * 0.85;
        const distFromPeak = Math.abs(minD - peak);
        if (distFromPeak < band) {
            const x = distFromPeak / band;
            const tip = Math.sin(Math.PI * along);
            rim = Math.max(rim, (1 - x * x) * 0.9 * tip * path.depth);
        }
    }
    return rim;
}
/**
 * @deprecated Alias — belly feature is a geological fissure, not letters.
 * Kept so older call sites keep working.
 */
export function sampleLetterCavity(u, v) {
    return sampleFissureCavity(u, v);
}
/**
 * Polar hole cavity [0,1] near the north pole (v→1).
 * Angular disk around +Y so the hole is circular in 3D, not UV.
 */
export function samplePolarHoleCavity(u, v) {
    const dir = uvToDir(u, v);
    // Angle from +Y
    const ang = Math.acos(Math.min(1, Math.max(-1, dir[1])));
    const holeAng = 0.32; // radians ~18°
    const feather = 0.06;
    if (ang >= holeAng + feather)
        return 0;
    if (ang <= holeAng * 0.35) {
        // Deep well floor + slight rim lip variation
        return 1;
    }
    // Steep walls toward rim
    const t = (ang - holeAng * 0.35) / (holeAng + feather - holeAng * 0.35);
    return 1 - t * t;
}
/**
 * Continuous structural height in [0,1] at sphere UV (geometric displace).
 * Deep features approach 0 (near core when displaced).
 */
export function sampleHeightUV(u, v) {
    const uu = ((u % 1) + 1) % 1;
    const vv = Math.min(1, Math.max(0, v));
    // Base crust with mild low-frequency undulation (keeps flat regions interesting)
    const und = 0.035 * Math.sin(uu * Math.PI * 6) * Math.cos(vv * Math.PI * 4) +
        0.015 * Math.sin(uu * Math.PI * 14 + vv * 9);
    let h = 1 + und;
    // Tectonic rim lift (fault shoulders) before carving the trench
    const rim = sampleFissureRim(uu, vv);
    h += rim * 0.07;
    const pole = samplePolarHoleCavity(uu, vv);
    const fissure = sampleFissureCavity(uu, vv);
    // Deep cut: almost to core (height → ~0.05)
    const cavity = Math.max(pole, fissure * 0.98);
    h = h * (1 - cavity) + 0.05 * cavity;
    // Extra dig on trench floor / collapse pits so POM reads as a real void
    if (fissure > 0.55) {
        h = Math.min(h, 0.07);
    }
    if (fissure > 0.85) {
        h = Math.min(h, 0.05);
    }
    if (pole > 0.85) {
        h = Math.min(h, 0.06);
    }
    return Math.min(1, Math.max(0, h));
}
/**
 * Mid-frequency ground micro-relief in [0,1] (dirt grit).
 * Enough contrast that UV walks show grain sliding; not pure high-freq static.
 */
export function sampleGroundDetail(u, v) {
    const uu = ((u % 1) + 1) % 1;
    const vv = Math.min(1, Math.max(0, v));
    const d = 0.45 * Math.sin(uu * Math.PI * 28) * Math.cos(vv * Math.PI * 20) +
        0.32 * Math.sin(uu * Math.PI * 52 + 1.7) * Math.sin(vv * Math.PI * 36) +
        0.23 * Math.cos(uu * Math.PI * 80 + vv * 48);
    return Math.min(1, Math.max(0, 0.55 + 0.45 * d));
}
/**
 * Height channel for classic/steep/POM UV walks (not near-core structural).
 * Mid-band remap: cavities deep enough to read, not 0.05-core blowups.
 * Previous 0.72+0.28*struct made depth ≈ 0.03–0.08 and everything looked plane.
 */
export function sampleParallaxHeight(u, v) {
    const struct = sampleHeightUV(u, v);
    const detail = sampleGroundDetail(u, v);
    // Remap structural [0.05..1] → [0.42..1]
    const softStruct = 0.42 + 0.58 * struct;
    // Grain adds readable micro-depth on crust
    return Math.min(1, Math.max(0, softStruct * (0.72 + 0.28 * detail)));
}
/** Clamp a UV offset vector to max length (shared anti-smear guard). */
export function clampParallaxOffset(du, dv, maxLen = PARALLAX_MAX_OFFSET) {
    const len = Math.hypot(du, dv);
    if (!(len > maxLen) || maxLen <= 0)
        return { du, dv };
    const s = maxLen / len;
    return { du: du * s, dv: dv * s };
}
/** Bilinear sample of a packed height atlas (single channel R). */
export function sampleHeightMapBilinear(data, width, height, u, v) {
    const uu = ((u % 1) + 1) % 1;
    const vv = Math.min(1, Math.max(0, v));
    const x = uu * (width - 1);
    const y = vv * (height - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const fx = x - x0;
    const fy = y - y0;
    const h00 = data[y0 * width + x0];
    const h10 = data[y0 * width + x1];
    const h01 = data[y1 * width + x0];
    const h11 = data[y1 * width + x1];
    return (h00 * (1 - fx) * (1 - fy) +
        h10 * fx * (1 - fy) +
        h01 * (1 - fx) * fy +
        h11 * fx * fy);
}
/** Bake a float height atlas from {@link sampleHeightUV}. */
export function bakeHeightAtlas(width = HEIGHT_TEX_SIZE, height = HEIGHT_TEX_SIZE) {
    const data = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        const v = y / (height - 1);
        for (let x = 0; x < width; x++) {
            const u = x / width; // seamless in U: last column ≈ first
            data[y * width + x] = sampleHeightUV(u, v);
        }
    }
    return data;
}
/**
 * Wrap UV like the WGSL helper (repeat U, clamp V).
 */
export function wrapUV(u, v) {
    let uu = u % 1;
    if (uu < 0)
        uu += 1;
    return { u: uu, v: Math.min(1, Math.max(0, v)) };
}
/**
 * Classic parallax UV offset (divide by view Z in tangent space).
 * viewTS points toward the camera; z must be > 0 on front faces.
 * height 1 = crust, 0 = deep; depth = (1-height)*scale.
 * Result is added to UV (same as WGSL: uv + du where du = -(view.xy/view.z)*depth).
 *
 * IMPORTANT: do NOT abs(viewZ) — that blows grazing offsets and looks noisy/reflective.
 */
export function classicParallaxOffset(viewTsX, viewTsY, viewTsZ, height, scale = PARALLAX_SCALE) {
    // Hybrid: partial /z (depth cue) but never divide by tiny z (graze smear).
    const vz = Math.max(viewTsZ, 0.28);
    const depth = (1 - height) * scale;
    return clampParallaxOffset(-(viewTsX / vz) * depth, -(viewTsY / vz) * depth);
}
/**
 * Offset-limiting parallax (no /viewZ) — more stable at grazing angles.
 */
export function offsetLimitingParallaxOffset(viewTsX, viewTsY, _viewTsZ, height, scale = PARALLAX_SCALE) {
    const depth = (1 - height) * scale;
    return clampParallaxOffset(-viewTsX * depth, -viewTsY * depth);
}
/**
 * Apply classic parallax: sample height at UV, return offset UV.
 * Defaults to {@link sampleParallaxHeight} (game-style camera UV slide).
 */
export function applyClassicParallaxUV(u, v, viewTsX, viewTsY, viewTsZ, scale = PARALLAX_SCALE, heightFn = sampleParallaxHeight) {
    const height = heightFn(u, v);
    const { du, dv } = classicParallaxOffset(viewTsX, viewTsY, viewTsZ, height, scale);
    const w = wrapUV(u + du, v + dv);
    return { u: w.u, v: w.v, height };
}
/**
 * Iterative parallax (common game middle step): classic offset, then refine
 * by re-sampling height a few times. Mirrors WGSL parallax_iterative.
 */
export function applyIterativeParallaxUV(u, v, viewTsX, viewTsY, viewTsZ, scale = PARALLAX_SCALE, iterations = 4, heightFn = sampleParallaxHeight) {
    const n = Math.max(1, iterations | 0);
    const vz = Math.max(viewTsZ, 0.28);
    let dirU = (viewTsX / vz) * scale;
    let dirV = (viewTsY / vz) * scale;
    const clamped = clampParallaxOffset(dirU, dirV, PARALLAX_MAX_OFFSET);
    dirU = clamped.du;
    dirV = clamped.dv;
    let curU = u;
    let curV = v;
    let h = heightFn(curU, curV);
    for (let i = 0; i < n; i++) {
        const depth = 1 - h;
        const w = wrapUV(curU - dirU * (depth / n), curV - dirV * (depth / n));
        curU = w.u;
        curV = w.v;
        h = heightFn(curU, curV);
    }
    return { u: curU, v: curV, height: h };
}
/**
 * Steep parallax: fixed layer steps into the heightfield (mirrors WGSL).
 * heightFn returns 1=crust, 0=deep. Marches while layerDepth < (1-height).
 */
export function applySteepParallaxUV(u, v, viewTsX, viewTsY, viewTsZ, scale = PARALLAX_SCALE, steps = STEEP_STEPS, heightFn = sampleParallaxHeight) {
    const n = Math.max(1, steps | 0);
    const layerDepth = 1 / n;
    const vz = Math.max(viewTsZ, 0.28);
    const full = clampParallaxOffset((viewTsX / vz) * scale, (viewTsY / vz) * scale, PARALLAX_MAX_OFFSET * 1.75);
    const dU = full.du / n;
    const dV = full.dv / n;
    let curU = u;
    let curV = v;
    let curLayer = 0;
    let h = heightFn(curU, curV);
    let i = 0;
    for (; i < n; i++) {
        if (curLayer >= 1 - h)
            break;
        const w = wrapUV(curU - dU, curV - dV);
        curU = w.u;
        curV = w.v;
        h = heightFn(curU, curV);
        curLayer += layerDepth;
    }
    return { u: curU, v: curV, layers: i };
}
/**
 * POM: steep linear search + binary refine (mirrors WGSL).
 */
export function applyPomParallaxUV(u, v, viewTsX, viewTsY, viewTsZ, scale = PARALLAX_SCALE, linSteps = POM_LINEAR_STEPS, binSteps = POM_BINARY_STEPS, heightFn = sampleParallaxHeight) {
    const n = Math.max(1, linSteps | 0);
    const layerDepth = 1 / n;
    const vz = Math.max(viewTsZ, 0.28);
    const full = clampParallaxOffset((viewTsX / vz) * scale, (viewTsY / vz) * scale, PARALLAX_MAX_OFFSET * 1.75);
    const dU = full.du / n;
    const dV = full.dv / n;
    let prevU = u;
    let prevV = v;
    let curU = u;
    let curV = v;
    let prevLayer = 0;
    let curLayer = 0;
    let h = heightFn(curU, curV);
    let i = 0;
    for (; i < n; i++) {
        if (curLayer >= 1 - h)
            break;
        prevU = curU;
        prevV = curV;
        prevLayer = curLayer;
        const w = wrapUV(curU - dU, curV - dV);
        curU = w.u;
        curV = w.v;
        h = heightFn(curU, curV);
        curLayer += layerDepth;
    }
    let aU = prevU;
    let aV = prevV;
    let bU = curU;
    let bV = curV;
    let aLayer = prevLayer;
    let bLayer = curLayer;
    const bins = Math.max(0, binSteps | 0);
    for (let j = 0; j < bins; j++) {
        const mid = wrapUV((aU + bU) * 0.5, (aV + bV) * 0.5);
        const midLayer = (aLayer + bLayer) * 0.5;
        const mh = heightFn(mid.u, mid.v);
        if (midLayer >= 1 - mh) {
            bU = mid.u;
            bV = mid.v;
            bLayer = midLayer;
        }
        else {
            aU = mid.u;
            aV = mid.v;
            aLayer = midLayer;
        }
    }
    const out = wrapUV((aU + bU) * 0.5, (aV + bV) * 0.5);
    return { u: out.u, v: out.v, layers: i };
}
/**
 * World → tangent-space view (toward camera). TBN columns = T, B, N with
 * B = cross(T, N) (v increases with +B / north on our sphere).
 */
export function worldToViewTS(viewWorldX, viewWorldY, viewWorldZ, tx, ty, tz, nx, ny, nz) {
    // Orthonormalize T against N
    let tdx = tx - nx * (tx * nx + ty * ny + tz * nz);
    let tdy = ty - ny * (tx * nx + ty * ny + tz * nz);
    let tdz = tz - nz * (tx * nx + ty * ny + tz * nz);
    let tlen = Math.hypot(tdx, tdy, tdz);
    if (tlen < 1e-6) {
        tdx = 1;
        tdy = 0;
        tdz = 0;
        tlen = 1;
    }
    tdx /= tlen;
    tdy /= tlen;
    tdz /= tlen;
    // B = cross(T, N) — right-handed, +V = north
    const bx = tdy * nz - tdz * ny;
    const by = tdz * nx - tdx * nz;
    const bz = tdx * ny - tdy * nx;
    // viewTS = transpose(TBN) * viewWorld = (dot(T,V), dot(B,V), dot(N,V))
    const x = tdx * viewWorldX + tdy * viewWorldY + tdz * viewWorldZ;
    const y = bx * viewWorldX + by * viewWorldY + bz * viewWorldZ;
    const z = nx * viewWorldX + ny * viewWorldY + nz * viewWorldZ;
    const len = Math.hypot(x, y, z) || 1;
    return { x: x / len, y: y / len, z: z / len };
}
/**
 * Geometric displacement: unit-sphere radius after height push.
 * height=1 → radius 1; height=0 → radius 1 - strength (near core).
 */
export function displaceRadius(height, strength = DISPLACE_STRENGTH) {
    return 1 - (1 - height) * strength;
}
/**
 * Build a simple cone ratio atlas (empty-space aid for cone-step mapping).
 * For each texel, cone = min over nearby samples of (Δuv / max(Δh, eps)).
 * Stored as float in [0, 1] (clamped).
 */
export function bakeConeAtlas(heightData, width, height) {
    const out = new Float32Array(width * height);
    // Sparse ring samples (not full disc) — O(n² · rings) instead of O(n² · r²).
    const radii = [1, 2, 4, 8, 12];
    const angles = 12;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const h0 = heightData[y * width + x];
            let cone = 1;
            for (const rad of radii) {
                for (let a = 0; a < angles; a++) {
                    const th = (a / angles) * Math.PI * 2;
                    const dx = Math.round(Math.cos(th) * rad);
                    const dy = Math.round(Math.sin(th) * rad);
                    if (dx === 0 && dy === 0)
                        continue;
                    const xx = (x + dx + width) % width;
                    const yy = Math.min(height - 1, Math.max(0, y + dy));
                    const h1 = heightData[yy * width + xx];
                    const dh = h0 - h1;
                    if (dh <= 0)
                        continue;
                    const dist = Math.hypot(dx / width, dy / height);
                    const ratio = dist / Math.max(dh, 1e-4);
                    if (ratio < cone)
                        cone = ratio;
                }
            }
            out[y * width + x] = Math.min(1, Math.max(0.002, cone * 4));
        }
    }
    return out;
}
/**
 * Tangent-space normal from height via central differences.
 * Keep strength modest (∼3–4): large values make cavity walls specular chrome.
 */
export function heightToNormal(heightData, width, height, x, y, strength = NORMAL_MAP_STRENGTH) {
    const xm = (x - 1 + width) % width;
    const xp = (x + 1) % width;
    const ym = Math.max(0, y - 1);
    const yp = Math.min(height - 1, y + 1);
    const hl = heightData[y * width + xm];
    const hr = heightData[y * width + xp];
    const hd = heightData[ym * width + x];
    const hu = heightData[yp * width + x];
    const dx = (hr - hl) * strength;
    const dy = (hu - hd) * strength;
    // Normal in tangent space: (-dH/du, -dH/dv, 1)
    let nx = -dx;
    let ny = -dy;
    let nz = 1;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    return { nx, ny, nz };
}
export const SURFACE_METHODS = [
    { id: "flat", label: "Flat ground albedo", short: "Flat" },
    { id: "normal", label: "Normal mapping only", short: "Normal" },
    {
        id: "classic-parallax",
        label: "Sphere classic (ray-heightfield)",
        short: "Sph classic",
    },
    {
        id: "iterative-parallax",
        label: "Sphere iterative (ray-heightfield)",
        short: "Sph iter",
    },
    {
        id: "offset-limit",
        label: "Sphere offset-limit (ray-heightfield)",
        short: "Sph offset",
    },
    {
        id: "steep-parallax",
        label: "Sphere steep (ray-heightfield)",
        short: "Sph steep",
    },
    { id: "pom", label: "Sphere POM (ray-heightfield)", short: "Sph POM" },
    { id: "cone-step", label: "Sphere cone-step", short: "Sph cone" },
];
export function methodIndex(id) {
    const i = SURFACE_METHODS.findIndex((m) => m.id === id);
    return i < 0 ? 0 : i;
}
//# sourceMappingURL=heightfield.js.map