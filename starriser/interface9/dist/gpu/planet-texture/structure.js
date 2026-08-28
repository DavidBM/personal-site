/**
 * Orogen-class discrete plate / continent topology for planetary bakes.
 *
 * Structure-first land (not multi-noise “continentalness” alone):
 *   1. Farthest-point plate seeds on the unit sphere → nearest-plate ids
 *   2. Farthest-point continent seeds (typically 3–7 big masses) + ~45% land
 *   3. Domain-warped anisotropic growth (not geodesic discs) + multi-scale
 *      coastal roughening; growth radius capped vs seed separation so landmasses
 *      stay mostly separate (joining ok; avoid 1–2 supercontinents)
 *   4. Trapped-sea absorption + micro-island strip
 *   5. Coast / mountain / ocean distance fields → macro elevation prior
 *
 * Pure + seed-stable. Used by generateBaseHeight (CPU) and host prepass (GPU).
 *
 * Ref: World Orogen — farthest-point continents, round-robin growth, domain
 * warp for organic coasts (orogen.studio / planet_heightmap_generation).
 */
import { equirectToDir } from "./sphere-map.js";
import { fbm3, ridged3 } from "./noise.js";
import { sampleOceanBathymetry3d, polarSafeShelfCue, } from "./ocean-bathymetry.js";
function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}
function smoothstep(e0, e1, x) {
    const t = Math.max(0, Math.min(1, (x - e0) / Math.max(1e-8, e1 - e0)));
    return t * t * (3 - 2 * t);
}
/** Deterministic mulberry32 */
export function structureRng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/** Unit vector from spherical lon/lat (radians). */
function sphDir(lon, lat) {
    const cl = Math.cos(lat);
    return {
        x: cl * Math.cos(lon),
        y: Math.sin(lat),
        z: cl * Math.sin(lon),
    };
}
function dot3(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
/**
 * Target land fraction from bake params.
 * liquidLevel is sea height threshold after normalize; structure aims so
 * land mass ≈ 1 − liquidLevel, biased by continentScale and class.
 *
 * Earth-like defaults aim ~45% land with 3–7 big continents (joining ok).
 * Uncapped growth at high land still collapses to 1–2 supercontinents — growth
 * caps handle that, not by starving land share.
 */
export function targetLandFractionForParams(params) {
    const cls = params.planetClass;
    if (cls === "gas")
        return 0;
    if (cls === "rocky" && params.liquidKind === "none") {
        return clamp01(0.88 + params.continentScale * 0.05);
    }
    // Base from liquidLevel; continentScale nudges size slightly
    let t = (1 - params.liquidLevel) * (0.72 + params.continentScale * 0.12);
    if (cls === "temperate") {
        // Prefer ~45% land (big multi-continent Earth-ish); liquidLevel still nudges
        const nudge = (0.5 - params.liquidLevel) * 0.28;
        t = 0.45 + nudge;
        t = Math.min(Math.max(t, 0.34), 0.56);
    }
    else if (cls === "ocean") {
        // Slightly wetter default, still substantial continents (~42–45%)
        const nudge = (0.52 - params.liquidLevel) * 0.4;
        t = 0.43 + nudge;
        t = Math.min(Math.max(t, 0.28), 0.55);
    }
    else if (cls === "ice") {
        // Frozen temperate: same land-share band as Earth-like continents
        const nudge = (0.5 - params.liquidLevel) * 0.28;
        t = 0.45 + nudge;
        t = Math.min(Math.max(t, 0.34), 0.56);
    }
    else if (cls === "exotic") {
        t = clamp01(t * 0.95);
    }
    return clamp01(Math.max(0.12, Math.min(0.92, t)));
}
function plateCountForParams(params) {
    const base = 7 + Math.floor(params.continentScale * 5);
    return Math.max(6, Math.min(18, base));
}
/**
 * Continent seed count: 3–7 big landmasses (joining ok).
 * Fewer seeds → larger continents at the same land fraction.
 * Seed-stable variation so planets don't all look the same.
 */
function continentSeedCount(params, _targetLand) {
    const cls = params.planetClass;
    const rnd = structureRng((params.seed | 0) + 501);
    // Bias toward 4–5 big continents (3 and 6–7 less often)
    const u = rnd();
    let n = u < 0.12 ? 3 : u < 0.4 ? 4 : u < 0.72 ? 5 : u < 0.9 ? 6 : 7;
    if (cls === "rocky") {
        n = Math.max(3, Math.min(6, n));
    }
    else if (cls === "temperate") {
        n = Math.max(3, Math.min(7, n));
    }
    else if (cls === "ocean") {
        n = Math.max(3, Math.min(7, n));
    }
    else if (cls === "ice") {
        n = Math.max(3, Math.min(6, n));
    }
    else if (cls === "exotic") {
        n = Math.max(3, Math.min(7, n));
    }
    else {
        n = Math.max(3, Math.min(7, n));
    }
    // Higher continentScale → fewer, larger landmasses
    if (params.continentScale >= 1.2 && n > 3)
        n -= 1;
    if (params.continentScale <= 0.85 && n < 7)
        n += 1;
    return Math.max(3, Math.min(7, n));
}
/**
 * Farthest-point sampling on the unit sphere (deterministic).
 * Returns unit vectors.
 */
export function farthestPointSphereSeeds(count, seed, minDot = -1) {
    const rnd = structureRng(seed);
    const pts = [];
    // First seed: biased off poles slightly
    {
        const lon = rnd() * Math.PI * 2;
        const lat = (rnd() * 0.9 - 0.45) * Math.PI;
        pts.push(sphDir(lon, lat));
    }
    for (let k = 1; k < count; k++) {
        let best = pts[0];
        let bestScore = -Infinity;
        // Candidate pool
        const candN = 80 + k * 12;
        for (let c = 0; c < candN; c++) {
            const lon = rnd() * Math.PI * 2;
            // area-uniform: lat = asin(2u-1)
            const u = rnd();
            const lat = Math.asin(Math.max(-1, Math.min(1, 2 * u - 1)));
            const p = sphDir(lon, lat);
            // Score = min angular distance to existing (via max min-dot → min distance)
            let minD = Infinity;
            for (const q of pts) {
                const d = Math.acos(Math.max(-1, Math.min(1, dot3(p, q))));
                if (d < minD)
                    minD = d;
            }
            // Soft rejection if too close on first try
            if (minD < minDot && c < candN - 1)
                continue;
            if (minD > bestScore) {
                bestScore = minD;
                best = p;
            }
        }
        pts.push(best);
    }
    return pts;
}
/**
 * Nearest seed index by max dot product (angular Voronoi).
 */
function nearestSeed(d, seeds) {
    let best = 0;
    let bestDot = -Infinity;
    for (let i = 0; i < seeds.length; i++) {
        const dd = dot3(d, seeds[i]);
        if (dd > bestDot) {
            bestDot = dd;
            best = i;
        }
    }
    return best;
}
/**
 * Absorb trapped seas: ocean components that do not touch the largest ocean
 * component become land (inland seas filled) — unless keepInlandLakes keeps a
 * few closed mid-size basins as lakes (temperate).
 */
export function absorbTrappedSeas(landMask, W, H, opts = {}) {
    const n = W * H;
    const seen = new Uint8Array(n);
    const comps = [];
    const keepN = Math.max(0, Math.floor(opts.keepInlandLakes ?? 0));
    const minLake = Math.max(4, Math.floor(opts.minLakeCells ?? 12));
    const maxFrac = Math.max(0.02, Math.min(0.35, opts.maxLakeFracOfMain ?? 0.12));
    const neigh = (i) => {
        const y = (i / W) | 0;
        const x = i - y * W;
        const out = [];
        out.push(y * W + ((x + 1) % W));
        out.push(y * W + ((x - 1 + W) % W));
        if (y + 1 < H)
            out.push((y + 1) * W + x);
        if (y - 1 >= 0)
            out.push((y - 1) * W + x);
        return out;
    };
    for (let i = 0; i < n; i++) {
        if (landMask[i] !== 0 || seen[i])
            continue;
        const cells = [];
        const stack = [i];
        seen[i] = 1;
        let touchesPoleBand = false;
        while (stack.length) {
            const c = stack.pop();
            cells.push(c);
            const y = (c / W) | 0;
            // Treat polar rows as “open ocean connection” for small polar basins
            if (y <= 1 || y >= H - 2)
                touchesPoleBand = true;
            for (const j of neigh(c)) {
                if (landMask[j] === 0 && !seen[j]) {
                    seen[j] = 1;
                    stack.push(j);
                }
            }
        }
        comps.push({
            cells,
            touchesBorder: touchesPoleBand,
            size: cells.length,
        });
    }
    if (comps.length <= 1)
        return;
    // Largest ocean = main world ocean (keep open)
    comps.sort((a, b) => b.size - a.size);
    const main = comps[0];
    // Candidate lakes: closed, mid-size, not polar-border, not huge
    const lakeCandidates = comps
        .slice(1)
        .filter((c) => !c.touchesBorder &&
        c.size >= minLake &&
        c.size < main.size * maxFrac &&
        c.size < main.size * 0.55)
        .sort((a, b) => b.size - a.size);
    const keepSet = new Set();
    for (let k = 0; k < Math.min(keepN, lakeCandidates.length); k++) {
        keepSet.add(lakeCandidates[k]);
    }
    for (let k = 1; k < comps.length; k++) {
        const c = comps[k];
        if (keepSet.has(c))
            continue; // preserve as inland lake
        // Absorb if small or not polar-connected and much smaller than main
        const small = c.size < main.size * 0.35;
        const inland = !c.touchesBorder && c.size < main.size * 0.55;
        if (small || inland) {
            for (const i of c.cells)
                landMask[i] = 1;
        }
    }
}
/**
 * Remove land components smaller than minCells (delete → ocean).
 * Prevents island-soup / micro-blob fields between major continents.
 */
export function removeMicroLandComponents(landMask, W, H, minCells) {
    const n = W * H;
    const seen = new Uint8Array(n);
    let removed = 0;
    const minC = Math.max(1, minCells | 0);
    for (let i = 0; i < n; i++) {
        if (!landMask[i] || seen[i])
            continue;
        const cells = [];
        const stack = [i];
        seen[i] = 1;
        while (stack.length) {
            const c = stack.pop();
            cells.push(c);
            const y = (c / W) | 0;
            const x = c - y * W;
            const cand = [
                y * W + ((x + 1) % W),
                y * W + ((x - 1 + W) % W),
                y + 1 < H ? (y + 1) * W + x : -1,
                y - 1 >= 0 ? (y - 1) * W + x : -1,
            ];
            for (const j of cand) {
                if (j >= 0 && landMask[j] && !seen[j]) {
                    seen[j] = 1;
                    stack.push(j);
                }
            }
        }
        if (cells.length < minC) {
            for (const c of cells)
                landMask[c] = 0;
            removed += cells.length;
        }
    }
    return removed;
}
/**
 * One morphological close (dilate then erode, U-wrap): reconnects thin
 * isthmuses and kills 1-pixel speckles without growing land mass much.
 */
export function morphologyCloseLand(landMask, W, H) {
    const n = W * H;
    const dil = new Uint8Array(n);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            if (landMask[i]) {
                dil[i] = 1;
                continue;
            }
            // Dilate: become land if any 4-neighbor is land
            const L = landMask[y * W + ((x + 1) % W)] |
                landMask[y * W + ((x - 1 + W) % W)] |
                (y + 1 < H ? landMask[(y + 1) * W + x] : 0) |
                (y - 1 >= 0 ? landMask[(y - 1) * W + x] : 0);
            dil[i] = L ? 1 : 0;
        }
    }
    // Erode: stay land only if all 4-neighbors are land in dilated mask
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            if (!dil[i]) {
                landMask[i] = 0;
                continue;
            }
            const ok = dil[y * W + ((x + 1) % W)] &&
                dil[y * W + ((x - 1 + W) % W)] &&
                (y + 1 >= H || dil[(y + 1) * W + x]) &&
                (y - 1 < 0 || dil[(y - 1) * W + x]);
            landMask[i] = ok ? 1 : 0;
        }
    }
}
/**
 * Topology metrics for smoke / Orogen-like quality gates.
 * Pure; does not mutate mask.
 */
export function continentTopologyMetrics(landMask, W, H, opts) {
    const n = W * H;
    const topK = opts?.topK ?? 5;
    // Micro = smaller than ~0.15% of map or 48 cells (whichever larger at low res)
    const microMax = opts?.microMaxCells ?? Math.max(48, Math.floor(n * 0.0015));
    const majorMin = Math.max(microMax * 2, Math.floor(n * 0.008));
    const seen = new Uint8Array(n);
    const sizes = [];
    let landCells = 0;
    for (let i = 0; i < n; i++) {
        if (!landMask[i] || seen[i])
            continue;
        let size = 0;
        const stack = [i];
        seen[i] = 1;
        while (stack.length) {
            const c = stack.pop();
            size++;
            const y = (c / W) | 0;
            const x = c - y * W;
            const cand = [
                y * W + ((x + 1) % W),
                y * W + ((x - 1 + W) % W),
                y + 1 < H ? (y + 1) * W + x : -1,
                y - 1 >= 0 ? (y - 1) * W + x : -1,
            ];
            for (const j of cand) {
                if (j >= 0 && landMask[j] && !seen[j]) {
                    seen[j] = 1;
                    stack.push(j);
                }
            }
        }
        sizes.push(size);
        landCells += size;
    }
    sizes.sort((a, b) => b - a);
    const topSizes = sizes.slice(0, topK);
    let topSum = 0;
    for (const s of topSizes)
        topSum += s;
    let microCells = 0;
    let microCount = 0;
    let majorCount = 0;
    for (const s of sizes) {
        if (s < microMax) {
            microCells += s;
            microCount++;
        }
        if (s >= majorMin)
            majorCount++;
    }
    return {
        landFraction: landCells / n,
        landCells,
        componentCount: sizes.length,
        majorComponentCount: majorCount,
        topKLandShare: landCells > 0 ? topSum / landCells : 0,
        microIslandCellFrac: landCells > 0 ? microCells / landCells : 0,
        microIslandCount: microCount,
        topSizes,
    };
}
/**
 * Domain-warp a unit direction (Orogen-style organic deformation).
 * Multi-octave FBM offsets then renormalize — breaks geodesic disc silhouettes.
 */
function domainWarpDir(x, y, z, seed, amp) {
    const a = Math.max(0, amp);
    // Multi-octave isotropic warp (continent bays + finer coast roughness)
    const wx = (fbm3(x * 1.1, y * 1.1, z * 1.1, seed + 11, 5) * 2 - 1) * a +
        (fbm3(x * 2.8 + 3, y * 2.8, z * 2.8, seed + 21, 4) * 2 - 1) * a * 0.5 +
        (fbm3(x * 6.5, y * 6.5, z * 6.5, seed + 71, 3) * 2 - 1) * a * 0.22;
    const wy = (fbm3(x * 1.1 + 7, y * 1.1, z * 1.1, seed + 31, 5) * 2 - 1) * a +
        (fbm3(x * 2.8, y * 2.8 + 5, z * 2.8, seed + 41, 4) * 2 - 1) * a * 0.5 +
        (fbm3(x * 6.5 + 2, y * 6.5, z * 6.5, seed + 81, 3) * 2 - 1) * a * 0.22;
    const wz = (fbm3(x * 1.1, y * 1.1 + 2, z * 1.1 + 9, seed + 51, 5) * 2 - 1) * a +
        (fbm3(x * 2.8, y * 2.8, z * 2.8 + 4, seed + 61, 4) * 2 - 1) * a * 0.5 +
        (fbm3(x * 6.5, y * 6.5 + 3, z * 6.5, seed + 91, 3) * 2 - 1) * a * 0.22;
    let nx = x + wx;
    let ny = y + wy;
    let nz = z + wz;
    const len = Math.hypot(nx, ny, nz) || 1;
    return { x: nx / len, y: ny / len, z: nz / len };
}
/**
 * Orthonormal tangent basis at sphere point c (for anisotropic stretch).
 */
function tangentBasis(c) {
    // Prefer cross with world-up; fallback if near pole
    let ax = 0;
    let ay = 1;
    let az = 0;
    if (Math.abs(c.y) > 0.92) {
        ax = 1;
        ay = 0;
        az = 0;
    }
    // u = normalize(cross(up, c))
    let ux = ay * c.z - az * c.y;
    let uy = az * c.x - ax * c.z;
    let uz = ax * c.y - ay * c.x;
    let ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    // v = cross(c, u)
    const vx = c.y * uz - c.z * uy;
    const vy = c.z * ux - c.x * uz;
    const vz = c.x * uy - c.y * ux;
    return {
        u: { x: ux, y: uy, z: uz },
        v: { x: vx, y: vy, z: vz },
    };
}
/**
 * Anisotropic angular distance from continent center (elongated continents).
 * stretchU/V > 1 compresses that axis (shorter extent).
 */
function anisotropicAngDist(d, c, basis, stretchU, stretchV) {
    const ang = Math.acos(Math.max(-1, Math.min(1, dot3(d, c))));
    if (ang < 1e-6)
        return 0;
    // Project d onto tangent plane at c
    const cd = dot3(d, c);
    let tx = d.x - c.x * cd;
    let ty = d.y - c.y * cd;
    let tz = d.z - c.z * cd;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const pu = tx * basis.u.x + ty * basis.u.y + tz * basis.u.z;
    const pv = tx * basis.v.x + ty * basis.v.y + tz * basis.v.z;
    // Elliptical metric in tangent plane, mapped back to angular scale
    const su = Math.max(0.45, stretchU);
    const sv = Math.max(0.45, stretchV);
    const ell = Math.hypot(pu * su, pv * sv);
    // Preserve angular magnitude: scale unit ellipse by ang
    return ang * ell;
}
/**
 * Multi-scale coastal / body radius modulation (peninsulas, embayments).
 * Clamped so interiors stay connected (no island soup).
 */
function coastRadiusMod(x, y, z, seed, k) {
    // Macro lobes (continent-scale)
    const macro = fbm3(x * 1.35 + k * 0.7, y * 1.35, z * 1.35, seed + 100 + k * 17, 5) *
        2 -
        1;
    // Meso bays / peninsulas
    const meso = fbm3(x * 3.6 + 2, y * 3.6, z * 3.6 - k, seed + 200 + k * 19, 4) * 2 - 1;
    // Fine headlands (more octaves — firm varied coasts without soft-coast blur)
    const fine = ridged3(x, y, z, seed + 300 + k * 23, 5, 7.5) * 2 - 1;
    // Micro fjord/creek detail
    const micro = ridged3(x, y, z, seed + 400 + k * 29, 4, 16.0) * 2 - 1;
    let m = 1 + macro * 0.3 + meso * 0.18 + fine * 0.14 + micro * 0.08;
    // Soft clamp: keep growth continuous
    if (m < 0.48)
        m = 0.48;
    if (m > 1.72)
        m = 1.72;
    return m;
}
/**
 * Grow continents from seeds with Orogen-inspired irregular silhouettes:
 * domain-warped sample dirs, anisotropic stretch, multi-scale coast modulation.
 * Post: absorb trapped seas, morphological close, strip micro-islands.
 */
function buildLandMask(W, H, contSeeds, targetLand, seed, continentScale, 
/** Domain warp UI (0–2-ish) — scales coast irregularity. */
warp = 0.6, 
/** Sparse inland lakes for temperate (0 = fill all trapped seas). */
keepInlandLakes = 0) {
    const n = W * H;
    const landMask = new Uint8Array(n);
    const continentId = new Int16Array(n);
    continentId.fill(-1);
    const rnd = structureRng(seed + 900);
    const nCont = contSeeds.length;
    // Per-continent size + anisotropy (Orogen "continent size variety")
    const seedScale = new Float32Array(nCont);
    const stretchU = new Float32Array(nCont);
    const stretchV = new Float32Array(nCont);
    const bases = [];
    for (let k = 0; k < nCont; k++) {
        // Size variety among big continents (not micro-islands)
        seedScale[k] = 0.92 + rnd() * 0.36; // ~0.92–1.28
        // Elongation: one axis often longer (not circular)
        const elong = 0.6 + rnd() * 0.85; // 0.6–1.45
        const aspect = 0.55 + rnd() * 0.5; // relative cross-axis
        if (rnd() > 0.5) {
            stretchU[k] = elong;
            stretchV[k] = elong * aspect;
        }
        else {
            stretchU[k] = elong * aspect;
            stretchV[k] = elong;
        }
        // Rotate basis randomly in tangent plane for varied orientations
        const b0 = tangentBasis(contSeeds[k]);
        const ang = rnd() * Math.PI * 2;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        bases.push({
            u: {
                x: b0.u.x * ca + b0.v.x * sa,
                y: b0.u.y * ca + b0.v.y * sa,
                z: b0.u.z * ca + b0.v.z * sa,
            },
            v: {
                x: -b0.u.x * sa + b0.v.x * ca,
                y: -b0.u.y * sa + b0.v.y * ca,
                z: -b0.u.z * sa + b0.v.z * ca,
            },
        });
    }
    // Domain-warp amplitude: UI warp + continentScale (stronger → more irregular coasts)
    const warpAmp = (0.22 / Math.max(0.85, continentScale)) * (0.45 + Math.max(0, warp) * 1.1);
    // effectiveDist[i] = anisotropic warped distance to nearest seed / seedScale
    // Used for binary search on threshold R
    const nearest = new Int16Array(n);
    const effDist = new Float32Array(n);
    // Also keep unwarped ang for open-ocean island placement
    const plainAng = new Float32Array(n);
    for (let y = 0; y < H; y++) {
        const v = (y + 0.5) / H;
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            const d0 = equirectToDir((x + 0.5) / W, v);
            const d = domainWarpDir(d0.x, d0.y, d0.z, seed + 77, warpAmp);
            let best = 0;
            let bestEff = Infinity;
            let bestPlain = Infinity;
            for (let k = 0; k < nCont; k++) {
                const c = contSeeds[k];
                const plain = Math.acos(Math.max(-1, Math.min(1, dot3(d0, c))));
                const aniso = anisotropicAngDist(d, c, bases[k], stretchU[k], stretchV[k]);
                // Multi-scale coast modulation shrinks/grows local radius → lower/higher dist
                const rMod = coastRadiusMod(d.x, d.y, d.z, seed, k);
                const eff = aniso / (seedScale[k] * rMod);
                if (eff < bestEff) {
                    bestEff = eff;
                    best = k;
                }
                if (plain < bestPlain)
                    bestPlain = plain;
            }
            nearest[i] = best;
            effDist[i] = bestEff;
            plainAng[i] = bestPlain;
        }
    }
    // Per-seed growth cap from nearest-neighbor angular gap.
    // Close pairs may join; isolated seeds still grow to mid size.
    // (A single global min-gap cap strangles every continent when any two seeds
    // land near each other.)
    const nnAng = new Float32Array(nCont);
    for (let a = 0; a < nCont; a++) {
        let best = Math.PI;
        for (let b = 0; b < nCont; b++) {
            if (a === b)
                continue;
            const ang = Math.acos(Math.max(-1, Math.min(1, dot3(contSeeds[a], contSeeds[b]))));
            if (ang < best)
                best = ang;
        }
        nnAng[a] = best;
    }
    // Growth caps: big continents at ~45% land without full Pangaea fuse.
    // High-land worlds (ice crust, dry rocky) may join freely to hit land share.
    const multiContinentCaps = targetLand <= 0.55 && nCont >= 3;
    // Soft = roomy landmass; hard = max inflate before neighbors usually fuse.
    // Tuned for ~45% land with 3–7 big continents (not micro-islands).
    // landRoom: higher target land → slightly more join room (still not Pangaea).
    const landRoom = multiContinentCaps
        ? Math.max(0, Math.min(1, (targetLand - 0.32) / 0.2))
        : 1;
    const joinSoft = multiContinentCaps
        ? (nCont <= 3
            ? 0.52
            : nCont <= 4
                ? 0.5
                : nCont <= 5
                    ? 0.48
                    : nCont <= 6
                        ? 0.46
                        : 0.44) +
            landRoom * 0.06
        : 0.95;
    const hardJoin = multiContinentCaps
        ? (nCont <= 3
            ? 0.64
            : nCont <= 4
                ? 0.6
                : nCont <= 5
                    ? 0.57
                    : nCont <= 6
                        ? 0.54
                        : 0.52) +
            landRoom * 0.08
        : 1.4;
    const seedRCap = new Float32Array(nCont);
    const seedHard = new Float32Array(nCont);
    let maxSeedCap = 0.22;
    for (let k = 0; k < nCont; k++) {
        // Mild NN floor: close pairs may join; distant seeds still grow large
        const nn = Math.max(nnAng[k], multiContinentCaps ? 0.65 : 0.35);
        const soft = Math.max(0.28, Math.min(1.6, nn * joinSoft));
        const hard = Math.max(soft, Math.min(1.85, nn * hardJoin));
        seedRCap[k] = soft;
        seedHard[k] = hard;
        if (soft > maxSeedCap)
            maxSeedCap = soft;
    }
    const cellCap = (i) => seedRCap[nearest[i]];
    // Inflate toward hardJoin if land undershoots — never past hardJoin
    {
        let landAtCap = 0;
        for (let i = 0; i < n; i++) {
            if (effDist[i] <= cellCap(i))
                landAtCap++;
        }
        if (landAtCap / n < targetLand * 0.92) {
            for (let step = 0; step < 12 && landAtCap / n < targetLand * 0.97; step++) {
                for (let k = 0; k < nCont; k++) {
                    seedRCap[k] = Math.min(seedHard[k], seedRCap[k] * 1.05);
                    if (seedRCap[k] > maxSeedCap)
                        maxSeedCap = seedRCap[k];
                }
                landAtCap = 0;
                for (let i = 0; i < n; i++) {
                    if (effDist[i] <= cellCap(i))
                        landAtCap++;
                }
            }
        }
        // Last-resort: small hard-cap lift if still short of ~45% (keeps corridors)
        if (multiContinentCaps && landAtCap / n < targetLand * 0.88) {
            for (let k = 0; k < nCont; k++) {
                seedHard[k] = Math.min(1.9, seedHard[k] * 1.1);
                seedRCap[k] = Math.min(seedHard[k], seedRCap[k] * 1.08);
                if (seedRCap[k] > maxSeedCap)
                    maxSeedCap = seedRCap[k];
            }
        }
    }
    // Binary-search global R; each cell also limited by its seed's neighbor gap
    let lo = 0.05;
    let hi = Math.min(2.5, maxSeedCap);
    let bestR = Math.min(0.6, maxSeedCap);
    for (let iter = 0; iter < 18; iter++) {
        const mid = (lo + hi) * 0.5;
        let land = 0;
        for (let i = 0; i < n; i++) {
            if (effDist[i] <= Math.min(mid, cellCap(i)))
                land++;
        }
        if (land / n > targetLand)
            hi = mid;
        else
            lo = mid;
        bestR = mid;
    }
    for (let i = 0; i < n; i++) {
        if (effDist[i] <= Math.min(bestR, cellCap(i))) {
            landMask[i] = 1;
            continentId[i] = nearest[i];
        }
    }
    // Sparse large archipelago: irregular medium islands (warped discs), not speckles
    const nIslands = rnd() < 0.5 ? 1 + ((rnd() * 1.4) | 0) : 0;
    for (let isl = 0; isl < nIslands; isl++) {
        let placed = false;
        for (let attempt = 0; attempt < 50 && !placed; attempt++) {
            const x = (rnd() * W) | 0;
            const y = (2 + rnd() * (H - 4)) | 0;
            const i = y * W + x;
            if (landMask[i])
                continue;
            if (plainAng[i] < bestR * 1.15)
                continue;
            const rad = Math.max(4, Math.floor(H * (0.03 + rnd() * 0.04)));
            const cx = (x + 0.5) / W;
            const cy = (y + 0.5) / H;
            const cdir = equirectToDir(cx, cy);
            for (let dy = -rad; dy <= rad; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= H)
                    continue;
                for (let dx = -rad; dx <= rad; dx++) {
                    const xx = (x + dx + W) % W;
                    const j = yy * W + xx;
                    if (landMask[j])
                        continue;
                    const pd = equirectToDir((xx + 0.5) / W, (yy + 0.5) / H);
                    const wd = domainWarpDir(pd.x, pd.y, pd.z, seed + 500 + isl, 0.25);
                    const ang = Math.acos(Math.max(-1, Math.min(1, dot3(wd, cdir))));
                    const rMod = coastRadiusMod(wd.x, wd.y, wd.z, seed + 600, isl);
                    // Angular radius of island ~ rad / (H) * pi/2 scale
                    const maxAng = (rad / H) * Math.PI * 0.9 * rMod;
                    if (ang <= maxAng) {
                        landMask[j] = 1;
                        continentId[j] = nearest[j];
                    }
                }
            }
            placed = true;
        }
    }
    absorbTrappedSeas(landMask, W, H, {
        keepInlandLakes,
        // Scale min lake size with map resolution
        minLakeCells: Math.max(12, Math.floor(n * 0.00015)),
        maxLakeFracOfMain: 0.1,
    });
    // Morphology close reconnects thin ocean corridors into supercontinents —
    // skip it for multi-continent mid-land layouts (coasts stay from growth field).
    if (!multiContinentCaps) {
        morphologyCloseLand(landMask, W, H);
    }
    const minKeep = Math.max(64, Math.floor(n * 0.003));
    removeMicroLandComponents(landMask, W, H, minKeep);
    // Grow if undershot — still respect per-seed caps (no global flood merge)
    let landCount = 0;
    for (let i = 0; i < n; i++)
        if (landMask[i])
            landCount++;
    if (landCount / n < targetLand * 0.88) {
        for (let step = 0; step < 12 && landCount / n < targetLand * 0.95; step++) {
            const growR = bestR * (1.03 + step * 0.025);
            let grew = 0;
            for (let i = 0; i < n; i++) {
                if (landMask[i])
                    continue;
                if (effDist[i] <= Math.min(growR, cellCap(i))) {
                    landMask[i] = 1;
                    landCount++;
                    grew++;
                }
            }
            if (grew === 0)
                break;
        }
        // No second morphologyClose after grow — it re-bridges ocean corridors
        removeMicroLandComponents(landMask, W, H, minKeep);
    }
    // Seal equirect U-wrap: columns 0 and W−1 must agree (avoids albedo seam spikes
    // when high-frequency coast detail differs at discrete lon edges)
    for (let y = 0; y < H; y++) {
        const i0 = y * W;
        const i1 = y * W + (W - 1);
        // Majority of a 3-column ring (wrap): prefer continuity over freckles
        const im = y * W + 1;
        const votes = (landMask[i0] ? 1 : 0) + (landMask[i1] ? 1 : 0) + (landMask[im] ? 1 : 0);
        const land = votes >= 2 ? 1 : 0;
        landMask[i0] = land;
        landMask[i1] = land;
    }
    for (let i = 0; i < n; i++) {
        if (landMask[i])
            continentId[i] = nearest[i];
        else
            continentId[i] = -1;
    }
    return { landMask, continentId };
}
/**
 * Isoperimetric circularity 4πA/P² for a set of land cells (4-connected perimeter).
 * Perfect disc → ~1; irregular continents well below ~0.65 on equirect majors.
 */
export function isoperimetricCircularity(landMask, W, H, cells) {
    if (cells.length < 4)
        return 1;
    const set = new Uint8Array(W * H);
    for (const i of cells)
        set[i] = 1;
    let perimeter = 0;
    for (const i of cells) {
        const y = (i / W) | 0;
        const x = i - y * W;
        // Count land→ocean edges (4-neigh)
        const neigh = [
            y * W + ((x + 1) % W),
            y * W + ((x - 1 + W) % W),
            y + 1 < H ? (y + 1) * W + x : -1,
            y - 1 >= 0 ? (y - 1) * W + x : -1,
        ];
        for (const j of neigh) {
            if (j < 0 || !set[j])
                perimeter++;
        }
    }
    if (perimeter < 1)
        return 1;
    const A = cells.length;
    // Equirect cells aren't equal area, but metric is stable enough for disc vs irregular
    return (4 * Math.PI * A) / (perimeter * perimeter);
}
/**
 * Shape metrics for major land components (anti-disc-blob gates).
 */
export function continentShapeMetrics(landMask, W, H, opts) {
    const n = W * H;
    const majorMin = opts?.majorMinCells ?? Math.max(80, Math.floor(n * 0.008));
    const seen = new Uint8Array(n);
    const circularities = [];
    const areas = [];
    for (let i = 0; i < n; i++) {
        if (!landMask[i] || seen[i])
            continue;
        const cells = [];
        const stack = [i];
        seen[i] = 1;
        while (stack.length) {
            const c = stack.pop();
            cells.push(c);
            const y = (c / W) | 0;
            const x = c - y * W;
            const cand = [
                y * W + ((x + 1) % W),
                y * W + ((x - 1 + W) % W),
                y + 1 < H ? (y + 1) * W + x : -1,
                y - 1 >= 0 ? (y - 1) * W + x : -1,
            ];
            for (const j of cand) {
                if (j >= 0 && landMask[j] && !seen[j]) {
                    seen[j] = 1;
                    stack.push(j);
                }
            }
        }
        if (cells.length < majorMin)
            continue;
        const circ = isoperimetricCircularity(landMask, W, H, cells);
        circularities.push(circ);
        areas.push(cells.length);
    }
    let sum = 0;
    let mx = 0;
    let mn = 1;
    for (const c of circularities) {
        sum += c;
        if (c > mx)
            mx = c;
        if (c < mn)
            mn = c;
    }
    return {
        majorCount: circularities.length,
        meanCircularity: circularities.length ? sum / circularities.length : 0,
        maxCircularity: circularities.length ? mx : 0,
        minCircularity: circularities.length ? mn : 0,
        circularities,
        areas,
    };
}
/**
 * Multi-source BFS distance field on equirect (U-wrap).
 * sources: pixels where mask[i]===1 are sources (distance 0).
 */
export function equirectDistanceField(sourceMask, W, H, invert = false) {
    const n = W * H;
    const dist = new Float32Array(n);
    dist.fill(1e9);
    const qx = new Int32Array(n);
    const qy = new Int32Array(n);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < n; i++) {
        const isSrc = invert ? sourceMask[i] === 0 : sourceMask[i] === 1;
        if (isSrc) {
            dist[i] = 0;
            qx[tail] = i % W;
            qy[tail] = (i / W) | 0;
            tail++;
        }
    }
    const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ];
    while (head < tail) {
        const x = qx[head];
        const y = qy[head];
        head++;
        const i = y * W + x;
        const d0 = dist[i];
        for (const [dx, dy] of dirs) {
            const xx = (x + dx + W) % W;
            const yy = y + dy;
            if (yy < 0 || yy >= H)
                continue;
            const j = yy * W + xx;
            const nd = d0 + 1;
            if (nd < dist[j]) {
                dist[j] = nd;
                qx[tail] = xx;
                qy[tail] = yy;
                tail++;
            }
        }
    }
    return dist;
}
/**
 * Count 4-connected land components (U-wrap).
 */
export function countLandComponents(landMask, W, H, minCells = 4) {
    const n = W * H;
    const seen = new Uint8Array(n);
    let comps = 0;
    for (let i = 0; i < n; i++) {
        if (!landMask[i] || seen[i])
            continue;
        let size = 0;
        const stack = [i];
        seen[i] = 1;
        while (stack.length) {
            const c = stack.pop();
            size++;
            const y = (c / W) | 0;
            const x = c - y * W;
            const cand = [
                y * W + ((x + 1) % W),
                y * W + ((x - 1 + W) % W),
                y + 1 < H ? (y + 1) * W + x : -1,
                y - 1 >= 0 ? (y - 1) * W + x : -1,
            ];
            for (const j of cand) {
                if (j >= 0 && landMask[j] && !seen[j]) {
                    seen[j] = 1;
                    stack.push(j);
                }
            }
        }
        if (size >= minCells)
            comps++;
    }
    return comps;
}
/**
 * Build full structure maps for non-gas planets.
 */
export function buildPlanetStructure(params, width, height) {
    const W = width;
    const H = height;
    const n = W * H;
    const cls = params.planetClass;
    const targetLand = targetLandFractionForParams(params);
    if (cls === "gas") {
        return {
            width: W,
            height: H,
            landMask: new Uint8Array(n),
            plateId: new Int16Array(n),
            continentId: new Int16Array(n).fill(-1),
            coastDist: new Float32Array(n),
            mountain: new Float32Array(n),
            elevationPrior: new Float32Array(n).fill(0.5),
            landFraction: 0,
            continentCount: 0,
            plateCount: 0,
            targetLandFraction: 0,
        };
    }
    const seed = params.seed | 0;
    const nPlates = plateCountForParams(params);
    const plateSeeds = farthestPointSphereSeeds(nPlates, seed + 11, 0.35);
    const plateId = new Int16Array(n);
    for (let y = 0; y < H; y++) {
        const v = (y + 0.5) / H;
        for (let x = 0; x < W; x++) {
            const d = equirectToDir((x + 0.5) / W, v);
            plateId[y * W + x] = nearestSeed(d, plateSeeds);
        }
    }
    const nCont = continentSeedCount(params, targetLand);
    // Separation for 3–7 big seeds: room to grow without starting fused
    const minSep = Math.max(0.42, 1.4 / Math.sqrt(nCont));
    const contSeeds = farthestPointSphereSeeds(nCont, seed + 77, minSep);
    // Temperate: a few closed inland lakes (not rivers). Ocean/rocky fill all.
    const keepLakes = cls === "temperate" ? 6 : 0;
    const { landMask, continentId } = buildLandMask(W, H, contSeeds, targetLand, seed, params.continentScale, params.warp, keepLakes);
    // Plate-boundary mountain mask (nearest-plate Voronoi edges on the sphere).
    // Raw edges look like straight cell walls in height/normals — keep edge cue
    // softer and multi-blur so chains read as ridges, not wireframe plates.
    const mountain = new Float32Array(n);
    for (let y = 1; y < H - 1; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            const p = plateId[i];
            const xl = (x - 1 + W) % W;
            const xr = (x + 1) % W;
            let edge = 0;
            if (plateId[y * W + xl] !== p)
                edge++;
            if (plateId[y * W + xr] !== p)
                edge++;
            if (plateId[(y - 1) * W + x] !== p)
                edge++;
            if (plateId[(y + 1) * W + x] !== p)
                edge++;
            // Diagonal neighbors: thicker, less “pixel wire” plate boundaries
            if (plateId[(y - 1) * W + xl] !== p)
                edge += 0.5;
            if (plateId[(y - 1) * W + xr] !== p)
                edge += 0.5;
            if (plateId[(y + 1) * W + xl] !== p)
                edge += 0.5;
            if (plateId[(y + 1) * W + xr] !== p)
                edge += 0.5;
            // Continent interior ridges: organic FBM (not only plate walls)
            const d = equirectToDir((x + 0.5) / W, (y + 0.5) / H);
            const ridge = ridged3(d.x, d.y, d.z, seed + 703, 4, 3.2) * 0.55 +
                ridged3(d.x, d.y, d.z, seed + 713, 3, 6.5) * 0.35 +
                Math.abs(Math.sin(d.x * 5.5 + d.z * 3.2 + seed * 0.0007) *
                    Math.cos(d.y * 6.1 - d.x * 2.4)) *
                    0.25;
            // Weaker edge weight so Voronoi lines don't dominate height/normals
            let m = clamp01(edge * 0.12 + ridge * 0.72);
            if (landMask[i]) {
                m = clamp01(m + edge * 0.1);
            }
            else {
                m *= 0.35; // mid-ocean ridges lighter
            }
            mountain[i] = m;
        }
    }
    // Multi-pass blur — dissolves sharp plate-edge polylines into mountain belts
    const mtnBlur = new Float32Array(n);
    const blurPass = (src, dst) => {
        for (let y = 1; y < H - 1; y++) {
            for (let x = 0; x < W; x++) {
                const i = y * W + x;
                const xl = (x - 1 + W) % W;
                const xr = (x + 1) % W;
                dst[i] =
                    (src[i] * 4 +
                        src[y * W + xl] +
                        src[y * W + xr] +
                        src[(y - 1) * W + x] +
                        src[(y + 1) * W + x] +
                        src[(y - 1) * W + xl] +
                        src[(y - 1) * W + xr] +
                        src[(y + 1) * W + xl] +
                        src[(y + 1) * W + xr]) /
                        12;
            }
        }
    };
    blurPass(mountain, mtnBlur);
    blurPass(mtnBlur, mountain);
    blurPass(mountain, mtnBlur);
    mountain.set(mtnBlur);
    // Distance fields
    const distToOcean = equirectDistanceField(landMask, W, H, false); // 0 on land? wait
    // sourceMask land=1 → dist 0 on land, increases into ocean when inverted
    // We want:
    //   inlandDist: 0 at coast land, increases inland
    //   oceanDist: 0 at coast ocean, increases seaward
    const landAsSource = landMask;
    // Distance from ocean (into land): sources = ocean
    const distFromOcean = equirectDistanceField(landAsSource, W, H, true);
    // Distance from land (into ocean): sources = land
    const distFromLand = equirectDistanceField(landAsSource, W, H, false);
    const coastDist = new Float32Array(n);
    let maxIn = 1;
    let maxOut = 1;
    for (let i = 0; i < n; i++) {
        if (landMask[i]) {
            coastDist[i] = distFromOcean[i];
            if (distFromOcean[i] > maxIn)
                maxIn = distFromOcean[i];
        }
        else {
            coastDist[i] = -distFromLand[i];
            if (distFromLand[i] > maxOut)
                maxOut = distFromLand[i];
        }
    }
    // Elevation prior (Orogen-ish harmonic blend)
    const elevationPrior = new Float32Array(n);
    const mtnScale = Math.max(0.35, params.mountainScale);
    for (let i = 0; i < n; i++) {
        const d = equirectToDir(((i % W) + 0.5) / W, (((i / W) | 0) + 0.5) / H);
        if (landMask[i]) {
            const inland = distFromOcean[i] / maxIn;
            const coast = 1 - smoothstep(0, 0.08, inland); // near coast
            // Base craton plateau — keep mid elevations so paint stays chromatic
            let h = 0.5 +
                inland * 0.1 +
                mountain[i] * 0.22 * mtnScale +
                smoothstep(0.15, 0.55, inland) * 0.06;
            // Shelf lip: slightly lower near coast
            h -= coast * 0.05;
            if (cls === "ice")
                h += Math.abs(d.y) * 0.05;
            if (cls === "rocky")
                h += mountain[i] * 0.08 * mtnScale;
            elevationPrior[i] = clamp01(h);
        }
        else {
            // Open ocean: unit-sphere 3D basins/ridges/trenches (NOT equirect-only
            // distance-to-coast — that pinches poles into concentric blue rings).
            // Near-continent shelf still lifts via soft coast proximity (polar-damped).
            const dCoast = distFromLand[i];
            const shelfRaw = 1 - smoothstep(0, Math.max(5, W * 0.045), dCoast); // 1 at coast
            // Reuse polar-safe cue so high-lat equirect BFS rings don't force shelf
            const shelfW = polarSafeShelfCue(0.22 + shelfRaw * 0.55, Math.abs(d.y));
            const shallow3d = sampleOceanBathymetry3d(d.x, d.y, d.z, seed + 40, params.heightFreq);
            // prior high = shallower. Open ocean mostly 3D field (scaled so land > ocean mean).
            let h = shallow3d * 0.5 * (1 - shelfW * 0.75) +
                (0.48 + mountain[i] * 0.1) * shelfW +
                mountain[i] * 0.04 * (1 - shelfW);
            h += ((plateId[i] % 5) - 2) * 0.006;
            if (cls === "rocky")
                h *= 0.85;
            elevationPrior[i] = clamp01(h);
        }
    }
    let landCount = 0;
    for (let i = 0; i < n; i++)
        if (landMask[i])
            landCount++;
    const continentCount = countLandComponents(landMask, W, H, Math.max(8, (n * 0.0005) | 0));
    return {
        width: W,
        height: H,
        landMask,
        plateId,
        continentId,
        coastDist,
        mountain,
        elevationPrior,
        landFraction: landCount / n,
        continentCount,
        plateCount: nPlates,
        targetLandFraction: targetLand,
    };
}
/**
 * Host topology resolution for WebGPU full bake = full equirect width.
 * Continents/coasts are authored at bake resolution (including 8K).
 * Micro height + drainage still run as GPU compute (that was the expensive part).
 */
export function structureBakeResolution(fullWidth) {
    const W = Math.max(64, Math.floor(fullWidth));
    // Even width for clean height = width/2
    return W % 2 === 0 ? W : W - 1;
}
/**
 * Nearest-neighbor upsample of 0/1 land mask (blocky — prefer smooth path).
 */
export function upsampleLandMaskNearest(src, srcW, srcH, dstW, dstH) {
    const out = new Uint8Array(dstW * dstH);
    for (let y = 0; y < dstH; y++) {
        const sy = Math.min(srcH - 1, Math.floor(((y + 0.5) / dstH) * srcH));
        for (let x = 0; x < dstW; x++) {
            const sx = Math.min(srcW - 1, Math.floor(((x + 0.5) / dstW) * srcW));
            out[y * dstW + x] = src[sy * srcW + sx];
        }
    }
    return out;
}
/** @deprecated alias — use upsampleLandMaskSmooth for coasts */
export function upsampleLandMask(src, srcW, srcH, dstW, dstH) {
    return upsampleLandMaskSmooth(src, srcW, srcH, dstW, dstH);
}
/**
 * Smooth land-mask upsample via signed distance field:
 *   low-res SDF → bilinear upsample → re-threshold at 0.
 * Avoids nearest-neighbor “pixelated 90°” coasts when structure is ≤1K
 * and bake is 4K/8K. Still a hard mask after threshold (for enforce).
 */
export function upsampleLandMaskSmooth(src, srcW, srcH, dstW, dstH) {
    if (srcW === dstW && srcH === dstH) {
        return new Uint8Array(src);
    }
    // Distance into land (from ocean) and into ocean (from land)
    const distInland = equirectDistanceField(src, srcW, srcH, true);
    const distSeaward = equirectDistanceField(src, srcW, srcH, false);
    const signed = new Float32Array(srcW * srcH);
    // Scale so 1 unit ≈ ~1 destination pixel (smooth zero-crossing under bilinear)
    const scale = Math.max(dstW / srcW, dstH / srcH);
    for (let i = 0; i < signed.length; i++) {
        signed[i] = src[i]
            ? distInland[i] * scale
            : -distSeaward[i] * scale;
    }
    const up = upsampleFloatField(signed, srcW, srcH, dstW, dstH);
    const out = new Uint8Array(dstW * dstH);
    for (let i = 0; i < up.length; i++) {
        out[i] = up[i] >= 0 ? 1 : 0;
    }
    // One morph close at full res: kills 1-px SDF stairstep noise, reconnects necks
    if (dstW >= 256) {
        morphologyCloseLand(out, dstW, dstH);
    }
    return out;
}
/**
 * Bilinear upsample of float fields (elevation prior / mountain).
 */
export function upsampleFloatField(src, srcW, srcH, dstW, dstH) {
    const out = new Float32Array(dstW * dstH);
    for (let y = 0; y < dstH; y++) {
        const v = ((y + 0.5) / dstH) * srcH - 0.5;
        const y0 = Math.max(0, Math.min(srcH - 1, Math.floor(v)));
        const y1 = Math.min(srcH - 1, y0 + 1);
        const fy = Math.max(0, Math.min(1, v - y0));
        for (let x = 0; x < dstW; x++) {
            const u = ((x + 0.5) / dstW) * srcW - 0.5;
            const x0 = Math.max(0, Math.min(srcW - 1, Math.floor(u)));
            const x1 = (x0 + 1) % srcW; // U-wrap longitude
            const fx = Math.max(0, Math.min(1, u - Math.floor(u)));
            // When not wrapping mid-image, clamp x1
            const x1c = x0 === srcW - 1 && u < srcW - 1.5 ? x0 : x0 === srcW - 1 ? 0 : x1;
            const a = src[y0 * srcW + x0];
            const b = src[y0 * srcW + x1c];
            const c = src[y1 * srcW + x0];
            const d = src[y1 * srcW + x1c];
            const top = a + (b - a) * fx;
            const bot = c + (d - c) * fx;
            out[y * dstW + x] = top + (bot - top) * fy;
        }
    }
    return out;
}
/**
 * Build low-res structure and upsample mask + elevation prior to full bake size.
 * Pure; used by GPU full bake host prepass (topology only — no micro FBM).
 */
export function buildStructureMapsForBake(params, fullW, fullH) {
    const sW = structureBakeResolution(fullW);
    const sH = Math.max(1, Math.floor(sW / 2));
    const maps = buildPlanetStructure(params, sW, sH);
    if (sW === fullW && sH === fullH) {
        return {
            landMask: maps.landMask,
            elevationPrior: maps.elevationPrior,
            mountain: maps.mountain,
            structureWidth: sW,
            structureHeight: sH,
            landFraction: maps.landFraction,
            continentCount: maps.continentCount,
        };
    }
    return {
        // SDF upsample — not nearest (nearest → pixelated 90° coasts at 4K/8K)
        landMask: upsampleLandMaskSmooth(maps.landMask, sW, sH, fullW, fullH),
        elevationPrior: upsampleFloatField(maps.elevationPrior, sW, sH, fullW, fullH),
        mountain: upsampleFloatField(maps.mountain, sW, sH, fullW, fullH),
        structureWidth: sW,
        structureHeight: sH,
        landFraction: maps.landFraction,
        continentCount: maps.continentCount,
    };
}
/**
 * Structure metrics for smoke / quality gates.
 */
export function structureMetrics(maps) {
    const { landMask, elevationPrior, width: W, height: H } = maps;
    const n = W * H;
    let landSum = 0;
    let oceanSum = 0;
    let landN = 0;
    let oceanN = 0;
    for (let i = 0; i < n; i++) {
        if (landMask[i]) {
            landSum += elevationPrior[i];
            landN++;
        }
        else {
            oceanSum += elevationPrior[i];
            oceanN++;
        }
    }
    return {
        landFraction: maps.landFraction,
        targetLandFraction: maps.targetLandFraction,
        continentCount: maps.continentCount,
        plateCount: maps.plateCount,
        landHeightMean: landN > 0 ? landSum / landN : 0,
        oceanHeightMean: oceanN > 0 ? oceanSum / oceanN : 0,
    };
}
//# sourceMappingURL=structure.js.map