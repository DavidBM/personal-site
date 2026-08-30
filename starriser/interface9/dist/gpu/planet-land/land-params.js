/**
 * Planet-land authoring params, URL query, and paint overrides.
 * DOM-free. GPU pack lives here so the lab and smokes share one layout.
 */
import { DEPTH_MAX, SEARCH_MAX, cellUnit, cellsEqual, partitionHit, warpPoint, } from "./fractal-voronoi.js";
export const VIEW_MODE = {
    land: 0,
    continents: 1,
    islands: 2,
    lakes: 3,
    height: 4,
};
export const PAINT_TOOL = {
    continent: 0,
    island: 1,
    ocean: 2,
    erase: 3,
};
export const LAND_LAYER = {
    continent: 0,
    island: 1,
    lake: 2,
};
/** 1 = force land (continent/island/lake), 2 = force water. */
export const OVERRIDE_LAND = 1;
export const OVERRIDE_WATER = 2;
export const MAX_OVERRIDES = 64;
export const LAND_FRAME_UNIFORM_SIZE = 112;
export const LAND_BODY_UNIFORM_SIZE = 64;
export const LAND_PARAM_UNIFORM_SIZE = 128;
export const LAND_OVERRIDE_UNIFORM_SIZE = 16 + MAX_OVERRIDES * 16;
export const LAND_KIND = {
    ocean: 0,
    continent: 1,
    island: 2,
    lake: 3,
    ice: 4,
};
const NUM_KEYS = [
    "seed",
    "jitter",
    "searchR",
    "warp",
    "viewMode",
    "contFreq",
    "contFill",
    "contDepth",
    "islandFreq",
    "islandFill",
    "islandDepth",
    "lakeFreq",
    "lakeFill",
    "lakeDepth",
    "coastWidth",
    "mountain",
    "iceLat",
    "atmStrength",
    "heightScale",
];
export function defaultLandParams() {
    return {
        seed: 42,
        jitter: 0.88,
        searchR: 1,
        warp: 0.18,
        viewMode: VIEW_MODE.land,
        showBorders: true,
        contFreq: 0.72,
        contFill: 0.4,
        contDepth: 4,
        islandFreq: 2.35,
        islandFill: 0.07,
        islandDepth: 2,
        lakeFreq: 3.6,
        lakeFill: 0.035,
        lakeDepth: 2,
        coastWidth: 0.045,
        mountain: 0.55,
        iceLat: 0.78,
        atmStrength: 0.55,
        heightScale: 1,
    };
}
export function clampLandParams(p) {
    const clamp = (v, lo, hi) => Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
    const mode = p.viewMode | 0;
    return {
        seed: clamp(p.seed | 0, 0, 1e9),
        jitter: clamp(p.jitter, 0, 1),
        searchR: clamp(p.searchR | 0, 1, SEARCH_MAX),
        warp: clamp(p.warp, 0, 1.5),
        viewMode: (mode < 0 || mode > 4 ? 0 : mode),
        showBorders: !!p.showBorders,
        contFreq: clamp(p.contFreq, 0.2, 3.5),
        contFill: clamp(p.contFill, 0, 1),
        contDepth: clamp(p.contDepth | 0, 0, DEPTH_MAX),
        islandFreq: clamp(p.islandFreq, 0.4, 8),
        islandFill: clamp(p.islandFill, 0, 1),
        islandDepth: clamp(p.islandDepth | 0, 0, DEPTH_MAX),
        lakeFreq: clamp(p.lakeFreq, 0.4, 10),
        lakeFill: clamp(p.lakeFill, 0, 1),
        lakeDepth: clamp(p.lakeDepth | 0, 0, DEPTH_MAX),
        coastWidth: clamp(p.coastWidth, 0.004, 0.2),
        mountain: clamp(p.mountain, 0, 1.5),
        iceLat: clamp(p.iceLat, 0.45, 0.98),
        atmStrength: clamp(p.atmStrength, 0, 1.5),
        heightScale: clamp(p.heightScale, 0, 2),
    };
}
export function cloneLandParams(p) {
    return { ...p };
}
export function paramsForPreset(id, seed = 42) {
    const p = defaultLandParams();
    p.seed = seed | 0;
    if (id === "archipelago") {
        p.contFreq = 1.15;
        p.contFill = 0.12;
        p.contDepth = 3;
        p.islandFreq = 3.1;
        p.islandFill = 0.26;
        p.islandDepth = 2;
        p.lakeFill = 0.02;
    }
    else if (id === "pangaea") {
        p.contFreq = 0.42;
        p.contFill = 0.5;
        p.contDepth = 4;
        p.islandFreq = 2.0;
        p.islandFill = 0.03;
        p.islandDepth = 2;
        p.lakeFill = 0.05;
    }
    else if (id === "lakeland") {
        p.contFreq = 0.8;
        p.contFill = 0.52;
        p.contDepth = 3;
        p.islandFill = 0.04;
        p.lakeFreq = 3.2;
        p.lakeFill = 0.18;
        p.lakeDepth = 3;
    }
    return clampLandParams(p);
}
export function paramsToQuery(p) {
    const c = clampLandParams(p);
    const q = new URLSearchParams();
    for (const k of NUM_KEYS) {
        q.set(k, String(c[k]));
    }
    q.set("showBorders", c.showBorders ? "1" : "0");
    return q.toString();
}
export function paramsFromQuery(search, fallback = defaultLandParams()) {
    const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const p = cloneLandParams(fallback);
    for (const k of NUM_KEYS) {
        const raw = q.get(k);
        if (raw == null || raw === "")
            continue;
        const n = Number(raw);
        if (Number.isFinite(n))
            p[k] = n;
    }
    const b = q.get("showBorders");
    if (b === "0" || b === "1")
        p.showBorders = b === "1";
    return clampLandParams(p);
}
export function findOverride(list, cell, layer) {
    for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (o.layer === layer && cellsEqual(o.cell, cell))
            return i;
    }
    return -1;
}
export function upsertOverride(list, cell, layer, klass) {
    const next = list.slice();
    const i = findOverride(next, cell, layer);
    if (klass === 0) {
        if (i >= 0)
            next.splice(i, 1);
        return next;
    }
    const item = {
        cell: { x: cell.x, y: cell.y, z: cell.z },
        layer,
        klass,
    };
    if (i >= 0)
        next[i] = item;
    else {
        if (next.length >= MAX_OVERRIDES)
            next.shift();
        next.push(item);
    }
    return next;
}
function overrideClass(list, cell, layer) {
    const i = findOverride(list, cell, layer);
    return i < 0 ? 0 : list[i].klass;
}
function saltFor(seed, layer) {
    return (seed | 0) + (layer + 1) * 10007;
}
function landFromFill(cell, fill, seed, layer, overrides) {
    const ov = overrideClass(overrides, cell, layer);
    if (ov === OVERRIDE_LAND)
        return true;
    if (ov === OVERRIDE_WATER)
        return false;
    return cellUnit(cell, saltFor(seed, layer)) < fill;
}
export function classifyLand(n, params, overrides = []) {
    const p = clampLandParams(params);
    const L = Math.hypot(n.x, n.y, n.z) || 1;
    const nx = n.x / L;
    const ny = n.y / L;
    const nz = n.z / L;
    const search = p.searchR;
    const jitter = p.jitter;
    const seed = p.seed;
    const pc = warpPoint({ x: nx * p.contFreq, y: ny * p.contFreq, z: nz * p.contFreq }, p.warp);
    const hitC = partitionHit(pc, p.contDepth, jitter, seed, search);
    const isCont = landFromFill(hitC.root, p.contFill, seed, LAND_LAYER.continent, overrides);
    let isIsland = false;
    let hitIRoot = { x: 0, y: 0, z: 0 };
    if (!isCont && p.islandFill > 1e-4) {
        const pi = warpPoint({
            x: nx * p.islandFreq + 17.1,
            y: ny * p.islandFreq - 9.3,
            z: nz * p.islandFreq + 4.7,
        }, p.warp * 0.7);
        const hitI = partitionHit(pi, p.islandDepth, jitter, seed + 91, search);
        hitIRoot = hitI.root;
        isIsland = landFromFill(hitI.root, p.islandFill, seed, LAND_LAYER.island, overrides);
    }
    let isLake = false;
    let hitLRoot = { x: 0, y: 0, z: 0 };
    if (isCont && p.lakeFill > 1e-4) {
        const pl = warpPoint({
            x: nx * p.lakeFreq - 11.0,
            y: ny * p.lakeFreq + 3.2,
            z: nz * p.lakeFreq + 8.8,
        }, p.warp * 0.5);
        const hitL = partitionHit(pl, p.lakeDepth, jitter, seed + 190, search);
        hitLRoot = hitL.root;
        isLake = landFromFill(hitL.root, p.lakeFill, seed, LAND_LAYER.lake, overrides);
    }
    let kind = LAND_KIND.ocean;
    let border = 1;
    if (isCont && !isLake) {
        kind = LAND_KIND.continent;
        border = hitC.border;
    }
    else if (isIsland) {
        kind = LAND_KIND.island;
        border = 0.08;
    }
    else if (isLake) {
        kind = LAND_KIND.lake;
        border = hitC.border;
    }
    if (kind !== LAND_KIND.ocean && Math.abs(ny) > p.iceLat) {
        kind = LAND_KIND.ice;
    }
    const inland = 1 - Math.exp(-border / Math.max(1e-4, p.coastWidth));
    return {
        kind,
        rootC: hitC.root,
        rootI: hitIRoot,
        rootL: hitLRoot,
        border,
        inland,
    };
}
export function layerRoot(n, params, layer) {
    const p = clampLandParams(params);
    const L = Math.hypot(n.x, n.y, n.z) || 1;
    const nx = n.x / L;
    const ny = n.y / L;
    const nz = n.z / L;
    let q = { x: nx * p.contFreq, y: ny * p.contFreq, z: nz * p.contFreq };
    let depth = p.contDepth;
    let seed = p.seed;
    let warpAmt = p.warp;
    if (layer === LAND_LAYER.island) {
        q = {
            x: nx * p.islandFreq + 17.1,
            y: ny * p.islandFreq - 9.3,
            z: nz * p.islandFreq + 4.7,
        };
        depth = p.islandDepth;
        seed = p.seed + 91;
        warpAmt = p.warp * 0.7;
    }
    else if (layer === LAND_LAYER.lake) {
        q = {
            x: nx * p.lakeFreq - 11.0,
            y: ny * p.lakeFreq + 3.2,
            z: nz * p.lakeFreq + 8.8,
        };
        depth = p.lakeDepth;
        seed = p.seed + 190;
        warpAmt = p.warp * 0.5;
    }
    return partitionHit(warpPoint(q, warpAmt), depth, p.jitter, seed, p.searchR).root;
}
export function inspectRoot(n, params, layer) {
    return layerRoot(n, params, layer);
}
/** 32 floats — must match land-disc LandUniforms. */
export function packLandUniforms(p, highlight, highlightLayer, paintLayer) {
    const c = clampLandParams(p);
    const out = new Float32Array(LAND_PARAM_UNIFORM_SIZE / 4);
    out[0] = c.seed;
    out[1] = c.jitter;
    out[2] = c.searchR;
    out[3] = c.viewMode;
    out[4] = c.contFreq;
    out[5] = c.contFill;
    out[6] = c.contDepth;
    out[7] = c.seed;
    out[8] = c.islandFreq;
    out[9] = c.islandFill;
    out[10] = c.islandDepth;
    out[11] = c.seed + 91;
    out[12] = c.lakeFreq;
    out[13] = c.lakeFill;
    out[14] = c.lakeDepth;
    out[15] = c.coastWidth;
    out[16] = c.mountain;
    out[17] = c.iceLat;
    out[18] = c.warp;
    out[19] = paintLayer;
    out[20] = 0; // overrideCount written by packOverrides into override buf
    out[21] = c.showBorders ? 1 : 0;
    out[22] = highlightLayer;
    out[23] = c.atmStrength;
    out[24] = highlight.x;
    out[25] = highlight.y;
    out[26] = highlight.z;
    out[27] = c.heightScale;
    out[28] = 0.05;
    out[29] = 0.18;
    out[30] = 0.42;
    out[31] = 0.85;
    return out;
}
export function packOverrides(list) {
    const out = new Int32Array(LAND_OVERRIDE_UNIFORM_SIZE / 4);
    const n = Math.min(MAX_OVERRIDES, list.length);
    out[0] = n;
    for (let i = 0; i < n; i++) {
        const o = list[i];
        const b = 4 + i * 4;
        out[b] = o.cell.x | 0;
        out[b + 1] = o.cell.y | 0;
        out[b + 2] = o.cell.z | 0;
        out[b + 3] = (o.layer & 15) | ((o.klass & 15) << 4);
    }
    return out;
}
//# sourceMappingURL=land-params.js.map