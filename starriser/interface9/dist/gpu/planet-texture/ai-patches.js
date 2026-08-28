/**
 * AI surface patches — stamp isolated kind×family textures on the sphere.
 *
 * Placement is seed-deterministic. Distance and UV are geodesic / tangent-frame
 * (not equirect pixel ellipses) so stamps near the poles do not stretch/pinch
 * when the belly is wrapped on the globe. U wraps at the longitude seam; pole
 * caps are rebuilt from the fully stamped belly so N/S products stay continuous.
 *
 * Kinds affect channels:
 *   texturization      → albedo only (large soft detail layer)
 *   colorized-normals  → albedo + paired true normals (major features)
 *
 * Planner defaults: each sourceIndex ≤1 per plan; same-role stamps pack without
 * substantial angular overlap; count is capped by bank size (no silent reuse).
 */
import { rasterizePoleCap, rasterizeCloudPoleCaps } from "./pole-cap.js";
import { fbm3, ridged3 } from "./noise.js";
import { dirToEquirect, equirectToDir } from "./sphere-map.js";
function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}
/** Relative luminance (Rec. 709), channels in [0,1]. */
function luma01(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Desaturate toward luma (sat=1 full color, sat=0 grey). */
export function desaturateStampRgb(r, g, b, sat) {
    const s = clamp01(sat);
    if (s >= 0.999)
        return [r, g, b];
    const y = luma01(r, g, b);
    return [y + (r - y) * s, y + (g - y) * s, y + (b - y) * s];
}
/**
 * Pull cool/blue stamp RGB into warm basalt / ash / ejecta range for lava worlds.
 * Pure function — channels in [0,1].
 */
export function warmStampRgb(sr, sg, sb) {
    let r = clamp01(sr);
    let g = clamp01(sg);
    let b = clamp01(sb);
    // Cool dominance: B is highest and clearly cooler than warm mid
    const cool = b > r + 0.04 && b > g + 0.02 && b > 0.28;
    if (cool) {
        // Map cool → warm ash: boost R, damp B, keep some G for basalt
        const l = luma01(r, g, b);
        r = clamp01(l * 1.15 + 0.12);
        g = clamp01(l * 0.55 + 0.06);
        b = clamp01(l * 0.22 + 0.02);
    }
    else {
        // Mild warm bias even on neutral greys (lava crust)
        r = clamp01(r * 1.05 + 0.02);
        g = clamp01(g * 0.92);
        b = clamp01(b * 0.72);
    }
    return [r, g, b];
}
/** One-channel soft-light (Photoshop-ish). */
function softLightCh(b, s) {
    if (s <= 0.5)
        return b - (1 - 2 * s) * b * (1 - b);
    // Use quadratic brighten (stable, no sqrt on tiny b)
    return b + (2 * s - 1) * (Math.sqrt(Math.max(b, 0)) - b);
}
/** One-channel overlay. */
function overlayCh(b, s) {
    return b < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
}
/**
 * Mix stamp RGB into base albedo with a selectable compositing mode.
 * Modes other than luminosity keep stamp chroma lightly when a is high;
 * luminosity preserves base chroma and only rewrites structure (optional tint).
 */
export function mixStampAlbedo(br, bg, bb, sr, sg, sb, a, mode = "luminosity", tint = 0, protectSnow = true) {
    const am = clamp01(a);
    if (am <= 1e-6) {
        return [br, bg, bb];
    }
    if (mode === "luminosity") {
        return mixStampAlbedoLuminosity(br, bg, bb, sr, sg, sb, am, tint, protectSnow);
    }
    const bR = br / 255;
    const bG = bg / 255;
    const bB = bb / 255;
    const sR = clamp01(sr);
    const sG = clamp01(sg);
    const sB = clamp01(sb);
    let oR = bR;
    let oG = bG;
    let oB = bB;
    if (mode === "lerp") {
        oR = bR * (1 - am) + sR * am;
        oG = bG * (1 - am) + sG * am;
        oB = bB * (1 - am) + sB * am;
    }
    else if (mode === "multiply") {
        // Darken only where stamp is dark — gentle ridges without crushing midtones as hard
        oR = bR * (1 - am) + bR * sR * am;
        oG = bG * (1 - am) + bG * sG * am;
        oB = bB * (1 - am) + bB * sB * am;
    }
    else if (mode === "screen") {
        oR = bR * (1 - am) + (1 - (1 - bR) * (1 - sR)) * am;
        oG = bG * (1 - am) + (1 - (1 - bG) * (1 - sG)) * am;
        oB = bB * (1 - am) + (1 - (1 - bB) * (1 - sB)) * am;
    }
    else if (mode === "overlay") {
        oR = bR * (1 - am) + overlayCh(bR, sR) * am;
        oG = bG * (1 - am) + overlayCh(bG, sG) * am;
        oB = bB * (1 - am) + overlayCh(bB, sB) * am;
    }
    else if (mode === "softLight") {
        oR = bR * (1 - am) + softLightCh(bR, sR) * am;
        oG = bG * (1 - am) + softLightCh(bG, sG) * am;
        oB = bB * (1 - am) + softLightCh(bB, sB) * am;
    }
    else {
        // linear: mid-grey stamp ≈ identity; dark stamp digs, light stamp lifts
        const k = am * 1.15;
        oR = clamp01(bR + (sR - 0.5) * k);
        oG = clamp01(bG + (sG - 0.5) * k);
        oB = clamp01(bB + (sB - 0.5) * k);
    }
    // Optional residual hue from stamp (same idea as luminosity tint)
    const t = clamp01(tint) * am;
    if (t > 1e-5 && mode !== "lerp") {
        const oL0 = Math.max(luma01(oR, oG, oB), 1e-4);
        const sL = Math.max(luma01(sR, sG, sB), 1e-4);
        const tr = clamp01((sR / sL) * oL0);
        const tg = clamp01((sG / sL) * oL0);
        const tb = clamp01((sB / sL) * oL0);
        oR = oR * (1 - t) + tr * t;
        oG = oG * (1 - t) + tg * t;
        oB = oB * (1 - t) + tb * t;
    }
    // Snow floor: compositing modes must not dirty bright ice
    if (protectSnow) {
        const bL = luma01(bR, bG, bB);
        const coolBase = bB + 0.02 >= bR && bB + 0.02 >= bG;
        if (bL >= 0.72 && coolBase) {
            const oL = luma01(oR, oG, oB);
            const floorL = bL * 0.94;
            if (oL < floorL && oL > 1e-5) {
                const k = floorL / oL;
                oR = clamp01(oR * k);
                oG = clamp01(oG * k);
                oB = clamp01(oB * k);
            }
        }
    }
    return [
        Math.round(clamp01(oR) * 255),
        Math.round(clamp01(oG) * 255),
        Math.round(clamp01(oB) * 255),
    ];
}
export function mixStampAlbedoLuminosity(br, bg, bb, sr, sg, sb, a, tint = 0, protectSnow = true) {
    // Strong structure so texture reads; wash is blocked by relative (not absolute) L
    const aStruct = clamp01(a * 1.55);
    const bR = br / 255;
    const bG = bg / 255;
    const bB = bb / 255;
    const bL = luma01(bR, bG, bB);
    const sL = luma01(sr, sg, sb);
    // Soft-light: mid-grey stamp ≈ identity; darks/lights swing around base L
    const soft = sL < 0.5
        ? 2 * bL * sL
        : 1 - 2 * (1 - bL) * (1 - sL);
    // Full soft-light structure (no absolute lerp toward stamp L — that washed terrain)
    let lum2 = bL * (1 - aStruct) + soft * aStruct;
    // Extra local contrast around mid-grey so fine ridges stay sharp
    lum2 = clamp01(lum2 + (sL - 0.5) * aStruct * 0.32);
    // Darken freely for relief; brighten only modestly (highlights, not full wash)
    if (lum2 > bL) {
        lum2 = bL + (lum2 - bL) * 0.55;
    }
    // Bright snow/ice: do not pull luminance down into dirty grey
    const coolBase = bB + 0.02 >= bR && bB + 0.02 >= bG;
    const isSnow = protectSnow && bL >= 0.72 && coolBase;
    if (isSnow) {
        const floorL = bL * 0.92;
        if (lum2 < floorL)
            lum2 = floorL;
        if (sL < bL * 0.85) {
            lum2 = Math.max(lum2, bL * 0.96);
        }
    }
    const scale = lum2 / Math.max(bL, 0.045);
    // Allow deep darks; cap bright peaks (~+25% local, not 2.5× blowout)
    const sc = Math.max(0.22, Math.min(1.28, scale));
    let r = clamp01(bR * sc);
    let g = clamp01(bG * sc);
    let b = clamp01(bB * sc);
    // Residual stamp hue at *output* luminance (structure stays, no re-brighten)
    const t = clamp01(tint) * clamp01(a) * (isSnow ? 0.12 : 1);
    if (t > 1e-5) {
        const oL0 = Math.max(luma01(r, g, b), 1e-4);
        const sLum = Math.max(sL, 1e-4);
        const tr = clamp01((sr / sLum) * oL0);
        const tg = clamp01((sg / sLum) * oL0);
        const tb = clamp01((sb / sLum) * oL0);
        r = r * (1 - t) + tr * t;
        g = g * (1 - t) + tg * t;
        b = b * (1 - t) + tb * t;
    }
    if (isSnow) {
        const oL = luma01(r, g, b);
        const floorL = bL * 0.92;
        if (oL < floorL && oL > 1e-5) {
            const k = floorL / oL;
            r = clamp01(r * k);
            g = clamp01(g * k);
            b = clamp01(b * k);
        }
    }
    // Soft ceiling: local peaks may go ~+22% above base; no sheet-wide blast
    const oL = luma01(r, g, b);
    if (oL > bL * 1.22 && oL > 1e-5) {
        const k = (bL * 1.22) / oL;
        r = clamp01(r * k);
        g = clamp01(g * k);
        b = clamp01(b * k);
    }
    return [
        Math.round(clamp01(r) * 255),
        Math.round(clamp01(g) * 255),
        Math.round(clamp01(b) * 255),
    ];
}
/** Mulberry32 — pure seed stream for patch planning. */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/**
 * Soft falloff alpha at distance d from stamp center (radius r in same units).
 * 1 at center → 0 at edge with smooth C1 cosine-squared. No hard cut inside r.
 */
export function softStampAlpha(d, radius) {
    if (radius <= 1e-8)
        return d <= 0 ? 1 : 0;
    const t = d / radius;
    if (t >= 1)
        return 0;
    // smoothstep-ish: (1 - t²)² — soft edge, no hard disk
    const u = 1 - t * t;
    return u * u;
}
/** Angular (great-circle) distance in radians between two unit directions. */
export function angularDistance(a, b) {
    const d = a.x * b.x + a.y * b.y + a.z * b.z;
    return Math.acos(Math.max(-1, Math.min(1, d)));
}
/**
 * Orthonormal tangent basis at sphere center `n` (unit).
 * e1,e2 span the local plane; rotation is applied in stamp loop.
 */
export function tangentBasis(n) {
    // Prefer world-up cross n unless near poles (then world-X)
    const useUp = Math.abs(n.y) < 0.92;
    const rx = useUp ? 0 : 1;
    const ry = useUp ? 1 : 0;
    const rz = 0;
    // e1 = normalize(cross(ref, n))
    let e1x = ry * n.z - rz * n.y;
    let e1y = rz * n.x - rx * n.z;
    let e1z = rx * n.y - ry * n.x;
    let len = Math.hypot(e1x, e1y, e1z);
    if (len < 1e-8) {
        e1x = 1;
        e1y = 0;
        e1z = 0;
        len = 1;
    }
    e1x /= len;
    e1y /= len;
    e1z /= len;
    // e2 = cross(n, e1)
    const e2x = n.y * e1z - n.z * e1y;
    const e2y = n.z * e1x - n.x * e1z;
    const e2z = n.x * e1y - n.y * e1x;
    return {
        e1: { x: e1x, y: e1y, z: e1z },
        e2: { x: e2x, y: e2y, z: e2z },
    };
}
/**
 * Project sphere point `p` into stamp local UV using geodesic distance + tangent frame.
 * Returns null if outside angular radius. UV centered at 0.5 with soft disc map.
 */
export function sphereStampLocalUv(center, e1, e2, p, angRadius, cosR, sinR) {
    if (angRadius <= 1e-8)
        return null;
    const cosC = Math.max(-1, Math.min(1, center.x * p.x + center.y * p.y + center.z * p.z));
    const ang = Math.acos(cosC);
    if (ang >= angRadius)
        return null;
    const sinA = Math.sin(ang);
    // Tangent direction of p relative to center (unit when ang>0)
    let tx;
    let ty;
    let tz;
    if (sinA < 1e-8) {
        tx = 0;
        ty = 0;
        tz = 0;
    }
    else {
        // p - center * cosC, then normalize
        tx = (p.x - center.x * cosC) / sinA;
        ty = (p.y - center.y * cosC) / sinA;
        tz = (p.z - center.z * cosC) / sinA;
    }
    // Radial coordinate in units of angRadius (edge = 1)
    const rr = ang / angRadius;
    let lx = (tx * e1.x + ty * e1.y + tz * e1.z) * rr;
    let ly = (tx * e2.x + ty * e2.y + tz * e2.z) * rr;
    // Rotate in local frame
    const rx = lx * cosR + ly * sinR;
    const ry = -lx * sinR + ly * cosR;
    return {
        u: clamp01(0.5 + rx * 0.48),
        v: clamp01(0.5 + ry * 0.48),
        ang,
    };
}
/**
 * Max |sphere Y| for gas stamp centers (sin of lat).
 * ~55° — poles lack room for band-aligned zonal stamps.
 */
export const GAS_STAMP_MAX_ABS_Y = 0.8192; // sin(55°)
/** Default angular separation margin: centers ≥ sum(radii) * margin. */
/**
 * Default same-role packing margin: centers must be ≥ (rA+rB)*margin apart.
 * 1.0 = disks just touch; >1 = hard gap; <1 = slight edge overlap allowed.
 */
export const STAMP_OVERLAP_MARGIN = 1.05;
/** Land texture/feature soft packing — a little overlap, not full stack. */
export const LAND_SOFT_OVERLAP_MARGIN = 0.88;
function clamp01Local(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}
function smoothstepLocal(e0, e1, x) {
    const t = Math.max(0, Math.min(1, (x - e0) / Math.max(1e-8, e1 - e0)));
    return t * t * (3 - 2 * t);
}
/**
 * Land elev above sea ∈ [0,1], or −1 if ocean / missing height.
 * Pure sampler for plan elevPrefer + stamp elevWeight.
 */
export function sampleLandElevAboveSea(u, v, heightRgba, width, height, seaLevel) {
    if (width < 1 || height < 1)
        return -1;
    let uu = u - Math.floor(u);
    if (uu < 0)
        uu += 1;
    const vv = clamp01Local(v);
    const x = Math.min(width - 1, Math.max(0, Math.floor(uu * width)));
    const y = Math.min(height - 1, Math.max(0, Math.floor(vv * height)));
    const h = (heightRgba[(y * width + x) * 4] ?? 0) / 255;
    const sea = clamp01Local(seaLevel);
    if (h <= sea)
        return -1;
    return clamp01Local((h - sea) / Math.max(1e-4, 1 - sea));
}
/** Accept probability for elevPrefer at a land elev [0,1]. */
export function elevPreferAccept(elev, prefer) {
    const e = clamp01Local(elev);
    if (prefer === "high") {
        // Peaks/plateaus: weak on lowland, strong on high elev
        return 0.06 + 0.94 * smoothstepLocal(0.22, 0.72, e);
    }
    // Low-mid land (green/desert belts): strong on lowland, weak on peaks
    return 0.06 + 0.94 * (1 - smoothstepLocal(0.18, 0.58, e));
}
/** Per-pixel stamp strength scale for elevWeight. */
export function elevWeightAt(elev, weight) {
    const e = clamp01Local(elev);
    if (weight === "high") {
        return 0.1 + 0.9 * smoothstepLocal(0.2, 0.68, e);
    }
    return 0.1 + 0.9 * (1 - smoothstepLocal(0.2, 0.55, e));
}
/**
 * Seeded multi-source clusters: each cluster places 2–N stamps of different
 * bank plates that intentionally overlap so they composite into larger terrain
 * massifs. Clusters pack against each other / occupiedStamps; members within a
 * cluster do not pack against siblings.
 *
 * `clusterCount` is the number of massifs (not total stamps). Total stamps ≈
 * clusterCount × avg(minMembers…maxMembers). Sources may reuse when
 * uniqueSources is false (needed once request ≫ bank size).
 */
export function planCompositeAiPatches(seed, clusterCount, sourceCount, opts = {}) {
    const nClusters = Math.max(0, Math.floor(clusterCount));
    const nSrc = Math.max(0, Math.floor(sourceCount));
    if (nClusters <= 0 || nSrc <= 0)
        return [];
    const minM = Math.max(1, Math.floor(opts.minMembers ?? 2));
    const maxM = Math.max(minM, Math.floor(opts.maxMembers ?? 4));
    const spreadFrac = Math.max(0.05, Math.min(0.95, opts.memberSpreadFrac ?? 0.5));
    const rScale = Math.max(0.35, Math.min(1.15, opts.memberRadiusScale ?? 0.74));
    // Anchor envelopes use the same packing as planAiPatches; members are free.
    const anchors = planAiPatches(seed, nClusters, nSrc, {
        salt: (opts.salt ?? 0) ^ 0xc0ffee,
        minRadiusFrac: opts.minRadiusFrac ?? 0.07,
        maxRadiusFrac: opts.maxRadiusFrac ?? 0.15,
        rotationMode: opts.rotationMode,
        maxAbsY: opts.maxAbsY,
        // Anchors only need unique packing geometry; sources assigned per member.
        uniqueSources: false,
        nonOverlap: opts.nonOverlap !== false,
        overlapMargin: opts.overlapMargin,
        occupiedStamps: opts.occupiedStamps,
        elevPrefer: opts.elevPrefer,
        heightRgba: opts.heightRgba,
        heightWidth: opts.heightWidth,
        heightHeight: opts.heightHeight,
        seaLevel: opts.seaLevel,
    });
    if (!anchors.length)
        return [];
    const rnd = mulberry32((seed >>> 0) ^ Math.imul(((opts.salt ?? 0) | 0) + 17, 0x85ebca6b));
    const unique = opts.uniqueSources === true;
    const used = opts.usedSourceIndices ?? (unique ? new Set() : null);
    const freeIdx = [];
    for (let i = 0; i < nSrc; i++) {
        if (!unique || !used || !used.has(i))
            freeIdx.push(i);
    }
    for (let i = freeIdx.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const tmp = freeIdx[i];
        freeIdx[i] = freeIdx[j];
        freeIdx[j] = tmp;
    }
    let freeCursor = 0;
    const out = [];
    for (let c = 0; c < anchors.length; c++) {
        const anchor = anchors[c];
        const members = minM + (maxM > minM ? Math.floor(rnd() * (maxM - minM + 1)) : 0);
        const center = equirectToDir(anchor.u, anchor.v);
        const { e1, e2 } = tangentBasis(center);
        const envAng = Math.max(0.008, anchor.radiusFrac * Math.PI);
        // Prefer distinct sources within a cluster so plates mix, not clone.
        const clusterSources = [];
        for (let m = 0; m < members; m++) {
            let sourceIndex;
            if (unique) {
                if (freeCursor >= freeIdx.length)
                    break;
                sourceIndex = freeIdx[freeCursor++];
                if (used)
                    used.add(sourceIndex);
            }
            else {
                // Avoid same index twice in one cluster when bank allows
                let picks = 0;
                do {
                    sourceIndex = Math.floor(rnd() * nSrc) % nSrc;
                    picks++;
                } while (clusterSources.includes(sourceIndex) && picks < 12 && nSrc > 1);
            }
            clusterSources.push(sourceIndex);
            // First member sits on the anchor; others offset in the tangent plane.
            let u = anchor.u;
            let v = anchor.v;
            if (m > 0) {
                const theta = rnd() * Math.PI * 2;
                const dist = envAng * spreadFrac * (0.35 + rnd() * 0.65);
                const lx = Math.cos(theta) * dist;
                const ly = Math.sin(theta) * dist;
                let px = center.x + e1.x * lx + e2.x * ly;
                let py = center.y + e1.y * lx + e2.y * ly;
                let pz = center.z + e1.z * lx + e2.z * ly;
                const len = Math.hypot(px, py, pz) || 1;
                px /= len;
                py /= len;
                pz /= len;
                const uv = dirToEquirect({ x: px, y: py, z: pz });
                u = uv.u;
                v = Math.max(0.02, Math.min(0.98, uv.v));
            }
            const radiusFrac = anchor.radiusFrac * rScale * (0.82 + rnd() * 0.28);
            const freeRot = rnd() * Math.PI * 2;
            const rotation = opts.rotationMode === "bandAligned" ? 0 : freeRot;
            // Slight strength variance so stacked plates don't flatten to one tone
            const strength = 0.58 + rnd() * 0.38;
            out.push({ u, v, radiusFrac, rotation, sourceIndex, strength });
        }
    }
    return out;
}
/**
 * Seeded stamp plan. Places up to `count` patches with varied size/rotation/source.
 * Pure given seed+count+sourceCount+opts (except optional usedSourceIndices mutation).
 * Centers use area-uniform sphere sampling (not equirect-uniform).
 *
 * Defaults enforce product rules:
 *  - uniqueSources: each library index ≤1 per plan (and vs usedSourceIndices)
 *  - nonOverlap: same-role stamps do not substantially overlap
 *  - count capped by remaining unique bank slots (no silent reuse)
 *
 * rotationMode:
 *  - "free" (default): full random in-plane spin — good for land geology/impacts.
 *  - "bandAligned": rotation = 0 so stamp local X follows the tangent e1 frame
 *    (east / latitude-parallel). Use for gas bands/currents so stamps do not
 *    spin zonal structure against the planet's belly rings.
 */
export function planAiPatches(seed, count, sourceCount, opts = {}) {
    const nWant = Math.max(0, Math.floor(count));
    const nSrc = Math.max(0, Math.floor(sourceCount));
    if (nWant <= 0 || nSrc <= 0)
        return [];
    const unique = opts.uniqueSources !== false;
    const nonOverlap = opts.nonOverlap !== false;
    const margin = opts.overlapMargin !== undefined && Number.isFinite(opts.overlapMargin)
        ? Math.max(0.5, opts.overlapMargin)
        : STAMP_OVERLAP_MARGIN;
    const used = opts.usedSourceIndices ??
        (unique ? new Set() : null);
    // Cap by remaining unique slots
    let freeSlots = nSrc;
    if (unique && used) {
        freeSlots = 0;
        for (let i = 0; i < nSrc; i++) {
            if (!used.has(i))
                freeSlots++;
        }
    }
    const n = unique ? Math.min(nWant, freeSlots) : nWant;
    if (n <= 0)
        return [];
    const rnd = mulberry32((seed >>> 0) ^ Math.imul((opts.salt ?? 0) | 0, 0x9e3779b9));
    const r0 = opts.minRadiusFrac ?? 0.06;
    const r1 = opts.maxRadiusFrac ?? 0.18;
    const bandAligned = opts.rotationMode === "bandAligned";
    const maxAbsY = opts.maxAbsY !== undefined && Number.isFinite(opts.maxAbsY)
        ? Math.max(0.05, Math.min(1, opts.maxAbsY))
        : 1;
    // Fisher–Yates shuffle of free source indices for unique assignment
    const freeIdx = [];
    for (let i = 0; i < nSrc; i++) {
        if (!unique || !used || !used.has(i))
            freeIdx.push(i);
    }
    for (let i = freeIdx.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const tmp = freeIdx[i];
        freeIdx[i] = freeIdx[j];
        freeIdx[j] = tmp;
    }
    let freeCursor = 0;
    const out = [];
    const centers = [];
    const angRadii = [];
    // Preload external occupied footprints (other roles / prior rounds)
    const occ = opts.occupiedStamps ?? [];
    for (let j = 0; j < occ.length; j++) {
        const o = occ[j];
        centers.push(equirectToDir(o.u, o.v));
        angRadii.push(Math.max(0.008, o.radiusFrac * Math.PI));
    }
    const occCount = centers.length;
    // Elev bias (terrain-features → high; colorized geology → low)
    const elevPrefer = opts.elevPrefer;
    const hRgba = opts.heightRgba;
    const hW = opts.heightWidth ?? 0;
    const hH = opts.heightHeight ?? 0;
    const sea = opts.seaLevel ?? 0.5;
    const useElev = (elevPrefer === "high" || elevPrefer === "low") &&
        hRgba &&
        hW > 0 &&
        hH > 0;
    // Extra attempts when packing rejects (non-overlap + polar + elev + occupied)
    // Dense land packs (texture×3+) need a large candidate pool
    const maxAttempts = Math.max(160, n * (useElev ? 200 : 128) + occCount * 16);
    let attempts = 0;
    while (out.length < n && attempts < maxAttempts) {
        attempts++;
        // Area-uniform on sphere with optional polar rejection
        let u = 0;
        let cosLat = 0;
        let lat = 0;
        let v = 0.5;
        for (let a = 0; a < 16; a++) {
            u = rnd();
            cosLat = rnd() * 2 - 1; // y ∈ [-1,1]
            if (Math.abs(cosLat) <= maxAbsY)
                break;
        }
        if (Math.abs(cosLat) > maxAbsY) {
            cosLat = (rnd() * 2 - 1) * maxAbsY;
        }
        lat = Math.asin(Math.max(-1, Math.min(1, cosLat)));
        v = 0.5 - lat / Math.PI;
        const radiusFrac = r0 + rnd() * (r1 - r0);
        // Consume RNG in bandAligned mode so free vs band share stream shape
        const freeRot = rnd() * Math.PI * 2;
        const rotation = bandAligned ? 0 : freeRot;
        const strength = 0.55 + rnd() * 0.4;
        let sourceIndex;
        if (unique) {
            if (freeCursor >= freeIdx.length)
                break;
            sourceIndex = freeIdx[freeCursor];
        }
        else {
            sourceIndex = Math.floor(rnd() * nSrc) % nSrc;
        }
        // Elev preference: reject ocean; bias high vs low land
        if (useElev && elevPrefer && hRgba) {
            const elev = sampleLandElevAboveSea(u, v, hRgba, hW, hH, sea);
            if (elev < 0)
                continue;
            if (rnd() > elevPreferAccept(elev, elevPrefer))
                continue;
        }
        const angR = Math.max(0.008, radiusFrac * Math.PI);
        const center = equirectToDir(u, v);
        if (nonOverlap && centers.length > 0) {
            let ok = true;
            for (let j = 0; j < centers.length; j++) {
                const minSep = (angR + angRadii[j]) * margin;
                if (angularDistance(center, centers[j]) < minSep) {
                    ok = false;
                    break;
                }
            }
            if (!ok)
                continue;
        }
        // Accept
        if (unique)
            freeCursor++;
        if (used)
            used.add(sourceIndex);
        centers.push(center);
        angRadii.push(angR);
        out.push({ u, v, radiusFrac, rotation, sourceIndex, strength });
    }
    return out;
}
/**
 * True when every pairwise stamp from list A vs list B is separated by
 * ≥ (rA+rB)*margin. Pure multi-role packing gate (major features across rounds).
 */
export function stampListsNonOverlapping(a, b, margin = STAMP_OVERLAP_MARGIN) {
    for (let i = 0; i < a.length; i++) {
        const sa = a[i];
        const ca = equirectToDir(sa.u, sa.v);
        const ra = Math.max(0.008, sa.radiusFrac * Math.PI);
        for (let j = 0; j < b.length; j++) {
            const sb = b[j];
            const cb = equirectToDir(sb.u, sb.v);
            const rb = Math.max(0.008, sb.radiusFrac * Math.PI);
            if (angularDistance(ca, cb) < (ra + rb) * margin)
                return false;
        }
    }
    return true;
}
/**
 * True when every pairwise same-role stamp pair is separated by ≥ sum radii * margin.
 * Pure helper for tests / bake gates (uses stamp plan centers, not pixels).
 */
export function stampsNonOverlapping(stamps, margin = STAMP_OVERLAP_MARGIN) {
    for (let i = 0; i < stamps.length; i++) {
        const a = stamps[i];
        const ca = equirectToDir(a.u, a.v);
        const ra = Math.max(0.008, a.radiusFrac * Math.PI);
        for (let j = i + 1; j < stamps.length; j++) {
            const b = stamps[j];
            const cb = equirectToDir(b.u, b.v);
            const rb = Math.max(0.008, b.radiusFrac * Math.PI);
            if (angularDistance(ca, cb) < (ra + rb) * margin)
                return false;
        }
    }
    return true;
}
/** True when each sourceIndex appears at most once. */
export function stampsUniqueSources(stamps) {
    const seen = new Set();
    for (const s of stamps) {
        if (seen.has(s.sourceIndex))
            return false;
        seen.add(s.sourceIndex);
    }
    return true;
}
/** Sample RGBA bilinear; RGB in [0,1], A in [0,1]. Clamp V, wrap U. */
function sampleSourceBilinearRgba(src, u, v, out) {
    const W = src.width;
    const H = src.height;
    let uu = u - Math.floor(u);
    if (uu < 0)
        uu += 1;
    const vv = clamp01(v);
    const x = uu * W - 0.5;
    const y = vv * H - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const x1 = x0 + 1;
    const y1 = Math.min(H - 1, y0 + 1);
    const y0c = Math.max(0, Math.min(H - 1, y0));
    const wrapX = (xi) => ((xi % W) + W) % W;
    const idx = (xi, yi) => (yi * W + wrapX(xi)) * 4;
    const i00 = idx(x0, y0c);
    const i10 = idx(x1, y0c);
    const i01 = idx(x0, y1);
    const i11 = idx(x1, y1);
    const r = src.rgba;
    for (let c = 0; c < 4; c++) {
        const a = r[i00 + c] * (1 - fx) + r[i10 + c] * fx;
        const b = r[i01 + c] * (1 - fx) + r[i11 + c] * fx;
        out[c] = (a * (1 - fy) + b * fy) / 255;
    }
}
/**
 * Decode tangent-space normal map RGB → unit normal.
 * Expects classic encoding (RGB = n*0.5+0.5, Z-up blue-dominant).
 * Does NOT invent normals from albedo luminance (that breaks colorized-normals).
 */
function decodeTangentNormal(r, g, b, out) {
    let nx = r * 2 - 1;
    let ny = g * 2 - 1;
    let nz = b * 2 - 1;
    // Flat/missing: keep Z-up
    if (Math.hypot(nx, ny) < 1e-5 && nz < 0.1) {
        out[0] = 0;
        out[1] = 0;
        out[2] = 1;
        return;
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    out[0] = nx / len;
    out[1] = ny / len;
    out[2] = nz / len;
}
/** Sample optional paired normal map (same local UV as color). */
function sampleNormalMapBilinear(nRgba, nW, nH, u, v, out) {
    const src = {
        width: nW,
        height: nH,
        rgba: nRgba,
    };
    sampleSourceBilinearRgba(src, u, v, out);
}
function encodeNormalByte(nx, ny, nz) {
    return [
        Math.round(clamp01(nx * 0.5 + 0.5) * 255),
        Math.round(clamp01(ny * 0.5 + 0.5) * 255),
        Math.round(clamp01(nz * 0.5 + 0.5) * 255),
    ];
}
/**
 * Stamp soft AI patches onto albedo and/or normal maps in place.
 * Does NOT full-frame hybrid-mix the sources.
 *
/**
 * High-freq land fleck after soft AI stamps (quality floor for landFineVariance).
 * Default amp 7 (half of legacy 14). Call once after all stamp rounds.
 */
export function reinjectLandGrit(set, amp = 7) {
    const W = set.albedo.width;
    const H = set.albedo.height;
    const rgba = set.albedo.rgba;
    const liq = set.liquidMask.rgba;
    const a = Math.max(0, amp);
    if (a < 1e-6)
        return;
    const seed = (set.params.seed | 0) ^ 0x5f3759df;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const o = (y * W + x) * 4;
            if (liq[o] > 140)
                continue;
            let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ seed;
            h = Math.imul(h ^ (h >>> 13), 1274126177);
            const n = ((h >>> 0) / 4294967296) * 2 - 1;
            let h2 = Math.imul(x + 17, 2246822519) ^
                Math.imul(y + 31, 3266489917) ^
                (seed + 1);
            h2 = Math.imul(h2 ^ (h2 >>> 15), 668265263);
            const n2 = ((h2 >>> 0) / 4294967296) * 2 - 1;
            // Half of legacy secondary fleck scale too (was 2.2 / 1.6)
            const n2s = 1.1;
            rgba[o] = Math.max(0, Math.min(255, rgba[o] + Math.round(n * a)));
            rgba[o + 1] = Math.max(0, Math.min(255, rgba[o + 1] + Math.round(n * a * 0.85 + n2 * n2s)));
            rgba[o + 2] = Math.max(0, Math.min(255, rgba[o + 2] + Math.round(n * a * 0.7 - n2 * (n2s * 0.73))));
        }
    }
}
/**
 * Distance is great-circle (angular); bank UV is in the stamp's tangent frame
 * projected onto the sphere — no equirect-pixel ellipses at the poles.
 * In-place alpha blend (no full-map float accumulators — those thrash 4K/8K).
 * Pole rebuild optional so multi-round stamping only pays once.
 */
export function stampAiPatches(set, sources, stamps, opts = {}) {
    if (!sources.length || !stamps.length) {
        return {
            usedPaths: [],
            stampCount: 0,
            normalsTouched: false,
            albedoTouched: false,
        };
    }
    const landS = clamp01(opts.landStrength ?? 0.55);
    const oceanS = clamp01(opts.oceanStrength ?? 0.06);
    const coastSoft = Math.max(0.02, opts.coastSoft ?? 0.14);
    const landOnly = opts.landOnly === true;
    const doPoles = opts.refreshPoles !== false;
    const normalS = clamp01(opts.normalStrength ?? 0.95);
    const lateralBoost = Math.max(1, Math.min(2.2, opts.normalLateralBoost ?? 1.65));
    const colorOp = clamp01(opts.colorOpacity ?? 0.55);
    const skipGrit = opts.skipGrit === true;
    const gritAmp = opts.gritAmp !== undefined && Number.isFinite(opts.gritAmp)
        ? Math.max(0, opts.gritAmp)
        : 7;
    const blendRaw = opts.albedoBlend ?? "luminosity";
    const albedoBlend = blendRaw === "lerp" ||
        blendRaw === "multiply" ||
        blendRaw === "softLight" ||
        blendRaw === "overlay" ||
        blendRaw === "screen" ||
        blendRaw === "linear" ||
        blendRaw === "luminosity"
        ? blendRaw
        : "luminosity";
    const tintOpt = opts.stampColorTint !== undefined && Number.isFinite(opts.stampColorTint)
        ? clamp01(opts.stampColorTint)
        : -1; // sentinel → kind default
    const protectSnow = opts.protectSnow !== false;
    const warmOnly = opts.warmOnly === true;
    const stampSat = opts.stampSaturation !== undefined && Number.isFinite(opts.stampSaturation)
        ? clamp01(opts.stampSaturation)
        : 1;
    const elevWeight = opts.elevWeight;
    const useElevW = elevWeight === "high" || elevWeight === "low";
    const sea = clamp01(set.params.liquidLevel);
    const W = set.albedo.width;
    const H = set.albedo.height;
    const rgba = set.albedo.rgba;
    const nrm = set.normal.rgba;
    const liq = set.liquidMask.rgba;
    const heightRgba = set.height.rgba;
    const used = new Set();
    const sample = [0, 0, 0, 0];
    const pn = [0, 0, 1];
    let albedoTouched = false;
    let normalsTouched = false;
    // Cap angular radius so 8K doesn't explode per-stamp work (~0.2 * π max)
    const maxAng = Math.min(Math.PI * 0.2, 0.65);
    for (const st of stamps) {
        const src = sources[st.sourceIndex];
        if (!src)
            continue;
        used.add(st.sourceIndex);
        const kind = opts.kind ?? src.kind ?? "texturization";
        const writeAlbedo = kind === "texturization" || kind === "colorized-normals";
        // Product bank: normals only via colorized-normals paired normalRgba
        const writeNormal = kind === "colorized-normals";
        // radiusFrac historically ≈ fraction of equirect height; height spans π lat
        const angRadius = Math.min(maxAng, Math.max(0.008, st.radiusFrac * Math.PI));
        const cosR = Math.cos(st.rotation);
        const sinR = Math.sin(st.rotation);
        const center = equirectToDir(st.u, st.v);
        const { e1, e2 } = tangentBasis(center);
        // Conservative equirect bbox covering the spherical cap
        const latC = Math.asin(Math.max(-1, Math.min(1, center.y)));
        const dLat = angRadius * 1.05;
        const v0 = clamp01(0.5 - (latC + dLat) / Math.PI);
        const v1 = clamp01(0.5 - (latC - dLat) / Math.PI);
        const y0 = Math.max(0, Math.floor(Math.min(v0, v1) * H - 1));
        const y1 = Math.min(H - 1, Math.ceil(Math.max(v0, v1) * H + 1));
        const cosLat = Math.max(0.12, Math.cos(latC));
        const dLon = Math.min(Math.PI, (angRadius * 1.15) / cosLat);
        const fullWidth = dLon >= Math.PI * 0.95;
        const uCenter = st.u;
        const du = dLon / (Math.PI * 2);
        const x0f = fullWidth ? 0 : Math.floor((uCenter - du) * W - 2);
        const x1f = fullWidth ? W - 1 : Math.ceil((uCenter + du) * W + 2);
        for (let y = y0; y <= y1; y++) {
            const v = (y + 0.5) / H;
            for (let xi = x0f; xi <= x1f; xi++) {
                const x = ((xi % W) + W) % W;
                const u = (x + 0.5) / W;
                const p = equirectToDir(u, v);
                const local = sphereStampLocalUv(center, e1, e2, p, angRadius, cosR, sinR);
                if (!local)
                    continue;
                const edgeA = softStampAlpha(local.ang, angRadius);
                if (edgeA <= 1e-4)
                    continue;
                const o = (y * W + x) * 4;
                const liquid = liq[o] / 255;
                const oceanW = clamp01((liquid - (1 - coastSoft)) / coastSoft);
                const landW = 1 - oceanW;
                if (landOnly && landW < 0.05)
                    continue;
                const baseStr = landW * landS + oceanW * oceanS;
                if (baseStr * st.strength <= 1e-5)
                    continue;
                sampleSourceBilinearRgba(src, local.u, local.v, sample);
                // Use source alpha when present (isolated patches); else full cover
                const srcA = sample[3] < 0.98 ? sample[3] : 1;
                if (srcA < 0.02)
                    continue;
                // Elev weight: TF stronger on peaks; colorized geology on low-mid land
                let elevW = 1;
                if (useElevW && elevWeight) {
                    const hh = (heightRgba[o] ?? 0) / 255;
                    const elev = hh <= sea ? 0 : clamp01((hh - sea) / Math.max(1e-4, 1 - sea));
                    elevW = elevWeightAt(elev, elevWeight);
                }
                // Full cover weight (no extra 0.9) for normals — albedo keeps 0.9 so
                // color stamps stay slightly softer than relief (visibility priority).
                const cover = edgeA * st.strength * baseStr * srcA * elevW;
                if (cover <= 1e-5)
                    continue;
                // Full cover for albedo structure (was *0.9 soft attenuation that washed stamps)
                const mix = cover;
                if (writeAlbedo) {
                    // Structure weight: colorized still scales cover; tint is separate residual hue
                    const aMix = kind === "colorized-normals" ? mix * Math.max(0.55, colorOp) : mix;
                    if (aMix > 1e-5) {
                        let sr = sample[0];
                        let sg = sample[1];
                        let sb = sample[2];
                        if (warmOnly) {
                            const w = warmStampRgb(sr, sg, sb);
                            sr = w[0];
                            sg = w[1];
                            sb = w[2];
                        }
                        if (stampSat < 0.999) {
                            const d = desaturateStampRgb(sr, sg, sb, stampSat);
                            sr = d[0];
                            sg = d[1];
                            sb = d[2];
                        }
                        const tint = tintOpt >= 0
                            ? tintOpt
                            : kind === "colorized-normals"
                                ? colorOp * 0.22
                                : 0.08;
                        const mixed = mixStampAlbedo(rgba[o], rgba[o + 1], rgba[o + 2], sr, sg, sb, aMix, albedoBlend, tint, protectSnow);
                        rgba[o] = mixed[0];
                        rgba[o + 1] = mixed[1];
                        rgba[o + 2] = mixed[2];
                        albedoTouched = true;
                    }
                }
                if (writeNormal) {
                    // True normals only from paired normalRgba (colorized-normals)
                    let haveN = false;
                    if (src.normalRgba &&
                        (src.normalWidth ?? 0) > 0 &&
                        (src.normalHeight ?? 0) > 0) {
                        const ns = [0, 0, 0, 0];
                        sampleNormalMapBilinear(src.normalRgba, src.normalWidth, src.normalHeight, local.u, local.v, ns);
                        // Paired normals are opaque AI maps; isolation = feature weight (not alpha)
                        decodeTangentNormal(ns[0], ns[1], ns[2], pn);
                        haveN = true;
                    }
                    if (haveN) {
                        // Opaque AI normals use neutral flat (0,0,1) outside the feature.
                        // Gate pure-flat margins (featureW≈0) so we don't wipe base terrain
                        // with (128,128,255); contribute from |lat|≳0.02, full by ~0.12.
                        // Lateral boost + no 0.9 attenuation → stamp relief visible over
                        // base height normals (was nMix ~0.15–0.25 drowning features).
                        let px = pn[0] * lateralBoost;
                        let py = pn[1] * lateralBoost;
                        let pz = pn[2];
                        {
                            const pl = Math.hypot(px, py, pz) || 1;
                            px /= pl;
                            py /= pl;
                            pz /= pl;
                        }
                        const lat = Math.hypot(px, py);
                        // Soft feature gate: |lat|≳0.02 → start; full by ~0.12 (smoothstep)
                        let featureW = (lat - 0.02) / 0.1;
                        if (featureW < 0)
                            featureW = 0;
                        if (featureW > 1)
                            featureW = 1;
                        featureW = featureW * featureW * (3 - 2 * featureW);
                        // nMix uses full cover (no 0.9) so normals punch through base terrain
                        const nMix = cover * normalS * featureW;
                        if (nMix > 1e-5) {
                            let bx = (nrm[o] / 255) * 2 - 1;
                            let by = (nrm[o + 1] / 255) * 2 - 1;
                            let bz = (nrm[o + 2] / 255) * 2 - 1;
                            let nx = bx * (1 - nMix) + px * nMix;
                            let ny = by * (1 - nMix) + py * nMix;
                            let nz = bz * (1 - nMix) + pz * nMix;
                            const len = Math.hypot(nx, ny, nz) || 1;
                            nx /= len;
                            ny /= len;
                            nz /= len;
                            const enc = encodeNormalByte(nx, ny, nz);
                            nrm[o] = enc[0];
                            nrm[o + 1] = enc[1];
                            nrm[o + 2] = enc[2];
                            normalsTouched = true;
                        }
                    }
                }
            }
        }
    }
    // Soft AI stamps average away procedural flecks — reinject cheap high-freq grit
    // once per bake (main calls reinjectLandGrit after all stamp rounds).
    // Skip by default here when skipGrit; stamp rounds stack if each reinjects.
    if (!skipGrit && albedoTouched) {
        reinjectLandGrit(set, gritAmp);
    }
    if (doPoles && albedoTouched) {
        refreshPolesFromAlbedo(set);
    }
    const usedPaths = [];
    for (const si of used) {
        const p = sources[si]?.path;
        if (p)
            usedPaths.push(p);
        else
            usedPaths.push(`source:${si}`);
    }
    return {
        usedPaths,
        stampCount: stamps.length,
        normalsTouched,
        albedoTouched,
    };
}
/** Rebuild N/S pole caps from current albedo (after patch rounds). */
export function refreshPolesFromAlbedo(set) {
    const W = set.albedo.width;
    const H = set.albedo.height;
    set.poleNorth = rasterizePoleCap(set.albedo.rgba, W, H, set.params.poleSize, true);
    set.poleSouth = rasterizePoleCap(set.albedo.rgba, W, H, set.params.poleSize, false);
    // Keep cloud dual-UV poles in sync when clouds exist
    const cp = rasterizeCloudPoleCaps(set.clouds, set.params.poleSize);
    set.cloudsPoleNorth = cp.poleNorth;
    set.cloudsPoleSouth = cp.poleSouth;
}
/**
 * Scale stamp counts for resolution so high-res bakes stay interactive.
 * Preview (≤1024): full counts; 2K ~0.7; 4K+ ~0.5.
 */
export function scaleStampCount(base, width) {
    const n = Math.max(1, Math.floor(base));
    if (width >= 4096)
        return Math.max(16, Math.floor(n * 0.45));
    if (width >= 2048)
        return Math.max(24, Math.floor(n * 0.65));
    return n;
}
/**
 * Orbit-scale vegetation quality: green dominant + moderate spatial frequency.
 * Rejects macro leaf textures (very high neighbor |Δ| + saturated green blotches).
 */
export function scoreOrbitVegetation(rgba, width, height) {
    const W = width;
    const H = height;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let n = 0;
    let neigh = 0;
    let neighN = 0;
    let greenDomN = 0;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const o = (y * W + x) * 4;
            const r = rgba[o];
            const g = rgba[o + 1];
            const b = rgba[o + 2];
            sumR += r;
            sumG += g;
            sumB += b;
            n++;
            if (g > r + 8 && g > b + 4)
                greenDomN++;
            if (x + 1 < W) {
                const o2 = o + 4;
                neigh +=
                    Math.abs(r - rgba[o2]) +
                        Math.abs(g - rgba[o2 + 1]) +
                        Math.abs(b - rgba[o2 + 2]);
                neighN++;
            }
        }
    }
    const meanR = sumR / Math.max(1, n);
    const meanG = sumG / Math.max(1, n);
    const meanB = sumB / Math.max(1, n);
    const greenDom = greenDomN / Math.max(1, n);
    const neighborAbs = neighN > 0 ? neigh / neighN : 0;
    // Macro leaves: extreme high-frequency detail + very green
    // Orbit canopy: green-ish but neighborAbs typically moderate (< ~45 at 1024)
    const leafLike = neighborAbs > 55 && greenDom > 0.35;
    // Orbit-ok: green bias without leaf-like HF; not pure grey
    const ok = !leafLike &&
        meanG > meanR * 0.95 &&
        meanG > meanB * 0.9 &&
        neighborAbs < 50 &&
        greenDom > 0.12;
    return { ok, greenDom, neighborAbs, leafLike, meanG, meanR, meanB };
}
/**
 * Synthesize orbit-scale vegetation canopy (equirect): low/mid-frequency green
 * mottling — NOT macro leaf photography. Soft basin-scale canopy variation.
 */
export function generateOrbitVegetationPatch(seed, width, height) {
    const W = Math.max(8, width | 0);
    const H = Math.max(4, height | 0);
    const rgba = new Uint8ClampedArray(W * H * 4);
    const s = seed | 0;
    for (let y = 0; y < H; y++) {
        const v = (y + 0.5) / H;
        for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W;
            const d = equirectToDir(u, v);
            // Low-freq canopy density + mid detail (orbit scale, not leaf HF)
            const a = fbm3(d.x * 1.8, d.y * 1.8, d.z * 1.8, s + 11, 5) * 0.5 + 0.5;
            const b = fbm3(d.x * 4.2, d.y * 4.2, d.z * 4.2, s + 29, 4) * 0.5 + 0.5;
            const c = fbm3(d.x * 9.0, d.y * 9.0, d.z * 9.0, s + 37, 3) * 0.5 + 0.5;
            const ridge = ridged3(d.x, d.y, d.z, s + 41, 3, 2.8);
            const cover = clamp01(0.28 + a * 0.4 + b * 0.22 + c * 0.1 - ridge * 0.06);
            // Forest greens → lighter scrub; mild chroma variation, no single-leaf contrast
            const r = clamp01(0.1 + cover * 0.2 + (1 - cover) * 0.2 + (b - 0.5) * 0.04);
            const g = clamp01(0.22 + cover * 0.48 + (c - 0.5) * 0.06);
            const bl = clamp01(0.08 + cover * 0.14 + (1 - cover) * 0.1);
            const o = (y * W + x) * 4;
            rgba[o] = Math.round(r * 255);
            rgba[o + 1] = Math.round(g * 255);
            rgba[o + 2] = Math.round(bl * 255);
            rgba[o + 3] = 255;
        }
    }
    return { width: W, height: H, rgba };
}
/**
 * Fresh uint32 seed for Apply preset — different each call when salt differs.
 * Pass explicit nowMs/entropy for tests; browser uses Date.now + Math.random.
 */
export function freshPresetSeed(nowMs = Date.now(), entropy = Math.random() * 0x100000000) {
    let h = (nowMs >>> 0) ^ Math.imul(entropy >>> 0, 0x9e3779b9);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
}
/** Dedupe gallery paths preserving order. */
export function mergeAiGallery(...lists) {
    const seen = new Set();
    const out = [];
    for (const list of lists) {
        for (const e of list) {
            if (!e.path || seen.has(e.path))
                continue;
            seen.add(e.path);
            out.push(e);
        }
    }
    return out;
}
//# sourceMappingURL=ai-patches.js.map