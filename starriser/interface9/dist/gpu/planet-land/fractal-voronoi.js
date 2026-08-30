/**
 * Fractal jittered Voronoi (BorisTheBrave, Shadertoy sfKSDw) — 3D lattice.
 *
 * 2D procedure (blog 2026-08-29): jittered sites per grid cell, then finer
 * layers at half size whose parent is the nearest coarser site; a point's
 * partition is the layer-0 root of its finest nearest site. Fractal coasts.
 *
 * Sphere wrap: same algorithm on a 3D integer lattice, sampled on the unit
 * sphere (p = n * freq). CPU and land-disc.wgsl.ts must stay bit-identical
 * (pcg3d + i32 floor cells + parent walk).
 *
 * Ref: https://www.boristhebrave.com/2026/08/29/fractal-jittered-voronoi-partitions/
 *      https://www.shadertoy.com/view/sfKSDw
 */
export const DEPTH_MAX = 6;
export const SEARCH_MAX = 2;
export function u32(n) {
    return n >>> 0;
}
/** WGSL `p * 1664525u + 1013904223u` then the pcg3d mix. */
export function pcg3d(x, y, z) {
    let v0 = u32(Math.imul(u32(x), 1664525) + 1013904223);
    let v1 = u32(Math.imul(u32(y), 1664525) + 1013904223);
    let v2 = u32(Math.imul(u32(z), 1664525) + 1013904223);
    v0 = u32(v0 + Math.imul(v1, v2));
    v1 = u32(v1 + Math.imul(v2, v0));
    v2 = u32(v2 + Math.imul(v0, v1));
    v0 ^= v0 >>> 16;
    v1 ^= v1 >>> 16;
    v2 ^= v2 >>> 16;
    v0 = u32(v0 + Math.imul(v1, v2));
    v1 = u32(v1 + Math.imul(v2, v0));
    v2 = u32(v2 + Math.imul(v0, v1));
    return [v0, v1, v2];
}
export function hash01(x, y, z) {
    return pcg3d(x, y, z)[0] / 4294967296;
}
export function cellsEqual(a, b) {
    return a.x === b.x && a.y === b.y && a.z === b.z;
}
export function cellSize(layer) {
    return 2 ** -Math.max(0, layer);
}
function siteRand(layer, cell, seed) {
    const s = u32(seed);
    const ux = u32(cell.x + 0x40000);
    const uy = u32(cell.y + 0x40000);
    const uz = u32(cell.z + 0x40000);
    const h = pcg3d(u32(ux + Math.imul(s, 17) + Math.imul(layer, 113)), u32(uy + Math.imul(s, 31) + Math.imul(layer, 157)), u32(uz + Math.imul(s, 47) + Math.imul(layer, 191)));
    return {
        x: h[0] / 4294967296,
        y: h[1] / 4294967296,
        z: h[2] / 4294967296,
    };
}
/** Site inside integer cell `cell` at `layer` (jitter 0 = cell center). */
export function site(layer, cell, jitter, seed) {
    const s = cellSize(layer);
    const o = siteRand(layer, cell, seed);
    const j = jitter < 0 ? 0 : jitter > 1 ? 1 : jitter;
    return {
        x: s * (cell.x + 0.5 + (o.x - 0.5) * j),
        y: s * (cell.y + 0.5 + (o.y - 0.5) * j),
        z: s * (cell.z + 0.5 + (o.z - 0.5) * j),
    };
}
export function nearestSites(layer, p, jitter, seed, searchR) {
    const s = cellSize(layer);
    const r = Math.max(1, Math.min(SEARCH_MAX, searchR | 0));
    const cx = Math.floor(p.x / s);
    const cy = Math.floor(p.y / s);
    const cz = Math.floor(p.z / s);
    const best = {
        cell: { x: cx, y: cy, z: cz },
        cell2: { x: cx, y: cy, z: cz },
        d1: 1e20,
        d2: 1e20,
        site: { x: 0, y: 0, z: 0 },
    };
    for (let dz = -r; dz <= r; dz++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                const cell = { x: cx + dx, y: cy + dy, z: cz + dz };
                const q = site(layer, cell, jitter, seed);
                const ddx = q.x - p.x;
                const ddy = q.y - p.y;
                const ddz = q.z - p.z;
                const d = ddx * ddx + ddy * ddy + ddz * ddz;
                if (d < best.d1) {
                    best.d2 = best.d1;
                    best.cell2 = best.cell;
                    best.d1 = d;
                    best.cell = cell;
                    best.site = q;
                }
                else if (d < best.d2) {
                    best.d2 = d;
                    best.cell2 = cell;
                }
            }
        }
    }
    return best;
}
export function rootCell(layer, cell, jitter, seed, searchR) {
    let l = Math.max(0, Math.min(DEPTH_MAX, layer | 0));
    let c = cell;
    while (l > 0) {
        const q = site(l, c, jitter, seed);
        c = nearestSites(l - 1, q, jitter, seed, searchR).cell;
        l -= 1;
    }
    return c;
}
export function partition(p, depth, jitter, seed, searchR) {
    const d = Math.max(0, Math.min(DEPTH_MAX, depth | 0));
    const n = nearestSites(d, p, jitter, seed, searchR);
    return rootCell(d, n.cell, jitter, seed, searchR);
}
/** Finest nearest + second; border is small when the two roots differ. */
export function partitionHit(p, depth, jitter, seed, searchR) {
    const d = Math.max(0, Math.min(DEPTH_MAX, depth | 0));
    const n = nearestSites(d, p, jitter, seed, searchR);
    const root = rootCell(d, n.cell, jitter, seed, searchR);
    const root2 = rootCell(d, n.cell2, jitter, seed, searchR);
    const f1 = Math.sqrt(Math.max(0, n.d1));
    const f2 = Math.sqrt(Math.max(0, n.d2));
    const same = cellsEqual(root, root2);
    return {
        root,
        root2,
        f1,
        border: same ? 1 : Math.max(0, f2 - f1),
    };
}
export function warpPoint(p, amt) {
    if (amt <= 1e-5)
        return p;
    const k = amt * 0.15;
    return {
        x: p.x + Math.sin(p.y * 3.1 + p.z * 1.7) * k,
        y: p.y + Math.sin(p.z * 2.9 + p.x * 1.3) * k,
        z: p.z + Math.sin(p.x * 3.3 + p.y * 1.9) * k,
    };
}
/** Layer-0 cell hash in [0,1) — land-fraction threshold. */
export function cellUnit(cell, salt) {
    return hash01(u32(cell.x + 0x1f4a7 + salt * 13), u32(cell.y + 0x9e377 + salt * 29), u32(cell.z + 0x85ebc + salt * 47));
}
/** Bright Shadertoy-style cell tint from a root id. */
export function cellRgb(cell) {
    const h = cellUnit(cell, 91);
    return [
        0.45 + 0.55 * Math.sin(h * 6.2831 * 3.7 + 0.2),
        0.45 + 0.55 * Math.sin(h * 6.2831 * 5.1 + 2.1),
        0.45 + 0.55 * Math.sin(h * 6.2831 * 2.3 + 4.2),
    ];
}
//# sourceMappingURL=fractal-voronoi.js.map