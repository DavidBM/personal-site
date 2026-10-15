/**
 * Ship-shaped dart for the dart detail level (hull-lod.ts): a few flat facets
 * that keep a hull's top-view outline and rough thickness. Built offline from
 * the catalog's HIGH mesh by scripts/art/build-hull-darts.mjs.
 *
 * The top view (+Y down onto XZ) is rasterized and opened, so features thinner
 * than a few hundredths of the hull radius (antennas) drop out. The outline is
 * the farthest covered point along rays from a centre on the symmetry axis
 * (x = 0): star-shaped from that centre by construction and mirrored, so the
 * apex fans never fold. For each vertex count the outline with the least area
 * error is found exactly (bestOutlines); the fewest vertices whose polygon
 * still overlaps the silhouette by `minOverlap` (intersection over union) win.
 * A top and a bottom apex close the shape: two triangles per outline vertex,
 * so 6 to `maxTriangles` triangles.
 */
const EXTENT = 1.05;
const RAYS = 72;
const MAX_GAP = (170 / 180) * Math.PI;
const centreOf = (index, cell) => -EXTENT + (index + 0.5) * cell;
const inGrid = (n, i, k) => i >= 0 && k >= 0 && i < n && k < n;
function markCell(grid, i, k, y) {
    if (!inGrid(grid.n, i, k))
        return;
    const c = k * grid.n + i;
    grid.cover[c] = 1;
    grid.yMin[c] = Math.min(grid.yMin[c], y);
    grid.yMax[c] = Math.max(grid.yMax[c], y);
}
/** Cells whose centres fall inside the triangle's top-view projection, with the interpolated height. */
function rasterTriangle(grid, a, b, c) {
    const { n, cell } = grid;
    const toIndex = (v) => (v + EXTENT) / cell - 0.5;
    for (const p of [a, b, c])
        markCell(grid, Math.round(toIndex(p[0])), Math.round(toIndex(p[2])), p[1]);
    const area = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
    if (Math.abs(area) < 1e-12)
        return;
    const i0 = Math.max(0, Math.floor(toIndex(Math.min(a[0], b[0], c[0])))), i1 = Math.min(n - 1, Math.ceil(toIndex(Math.max(a[0], b[0], c[0]))));
    const k0 = Math.max(0, Math.floor(toIndex(Math.min(a[2], b[2], c[2])))), k1 = Math.min(n - 1, Math.ceil(toIndex(Math.max(a[2], b[2], c[2]))));
    for (let k = k0; k <= k1; k++)
        for (let i = i0; i <= i1; i++) {
            const x = centreOf(i, cell), z = centreOf(k, cell);
            const w1 = ((x - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (z - a[2])) / area;
            const w2 = ((b[0] - a[0]) * (z - a[2]) - (x - a[0]) * (b[2] - a[2])) / area;
            if (Math.min(w1, w2, 1 - w1 - w2) >= -1e-6)
                markCell(grid, i, k, (1 - w1 - w2) * a[1] + w1 * b[1] + w2 * c[1]);
        }
}
function rasterTopView(positions, stride, indices, n) {
    const grid = { n, cell: (2 * EXTENT) / n, cover: new Uint8Array(n * n),
        yMin: new Float32Array(n * n).fill(Infinity), yMax: new Float32Array(n * n).fill(-Infinity) };
    const vertex = (index) => {
        const o = index * stride;
        return [positions[o], positions[o + 1], positions[o + 2]];
    };
    for (let t = 0; t + 2 < indices.length; t += 3)
        rasterTriangle(grid, vertex(indices[t]), vertex(indices[t + 1]), vertex(indices[t + 2]));
    return grid;
}
/** Binary erosion (every disk neighbour set) or dilation (any set); outside the grid counts as empty. */
function morph(mask, n, radius, erode) {
    const disk = [];
    for (let dk = -radius; dk <= radius; dk++)
        for (let di = -radius; di <= radius; di++)
            if (di * di + dk * dk <= radius * radius)
                disk.push([di, dk]);
    const at = (i, k) => inGrid(n, i, k) && mask[k * n + i] === 1;
    const out = new Uint8Array(mask.length);
    for (let k = 0; k < n; k++)
        for (let i = 0; i < n; i++) {
            const hit = erode ? disk.every(([di, dk]) => at(i + di, k + dk)) : disk.some(([di, dk]) => at(i + di, k + dk));
            out[k * n + i] = hit ? 1 : 0;
        }
    return out;
}
/** Mirror-symmetric top silhouette, opened so spikes a few cells thin (antennas) drop out. */
function topSilhouette(grid, openCells) {
    const { n, cover } = grid;
    const symmetric = new Uint8Array(n * n);
    for (let k = 0; k < n; k++)
        for (let i = 0; i < n; i++)
            symmetric[k * n + i] = cover[k * n + i] | cover[k * n + (n - 1 - i)];
    const opened = morph(morph(symmetric, n, openCells, true), n, openCells, false);
    return opened.some(Boolean) ? opened : symmetric;
}
/** Centre on the symmetry axis (area centroid) and the farthest covered point per ray, nose (+Z) to tail on the +X side. */
function polarOutline(mask, grid) {
    const { n, cell } = grid;
    let zSum = 0, count = 0;
    for (let c = 0; c < n * n; c++)
        if (mask[c]) {
            zSum += centreOf(Math.floor(c / n), cell);
            count++;
        }
    const cz = count ? zSum / count : 0;
    const covered = (x, z) => {
        const i = Math.floor((x + EXTENT) / cell), k = Math.floor((z + EXTENT) / cell);
        return inGrid(n, i, k) && mask[k * n + i] === 1;
    };
    const half = [];
    for (let j = 0; j <= RAYS; j++) {
        const theta = (Math.PI * j) / RAYS, dx = Math.sin(theta), dz = Math.cos(theta);
        let far = cell;
        for (let t = 0; t < 1.6; t += cell * 0.5)
            if (covered(dx * t, cz + dz * t))
                far = t;
        far += cell * 0.5;
        half.push([dx * far, cz + dz * far]);
    }
    return { cz, half };
}
function polygonArea(poly) {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
}
function insidePolygon(poly, x, z) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i], [xj, zj] = poly[j];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
            inside = !inside;
    }
    return inside;
}
/** Intersection over union of a polygon and the silhouette, on the raster. */
function overlap(poly, mask, grid) {
    const { n, cell } = grid;
    let both = 0, either = 0;
    for (let k = 0; k < n; k++)
        for (let i = 0; i < n; i++) {
            const inPoly = insidePolygon(poly, centreOf(i, cell), centreOf(k, cell)), inMask = mask[k * n + i] === 1;
            both += Number(inPoly && inMask);
            either += Number(inPoly || inMask);
        }
    return either ? both / either : 0;
}
/** Optional nose, right-side vertices (half indices), optional tail, then the right side mirrored back toward the front. */
function outlinePolygon(half, nose, right, tail) {
    const side = right.map((j) => half[j]);
    return [
        ...(nose ? [half[0]] : []), ...side, ...(tail ? [half[half.length - 1]] : []),
        ...side.slice().reverse().map(([x, z]) => [-x, z]),
    ];
}
/**
 * Area error of each possible outline edge against the dense polar outline.
 * Both are star-shaped from the centre, so their symmetric difference is the
 * sum over rays of |r_a^2 - r_b^2| / 2 * dTheta, additive per edge. `span(i, j)`
 * joins two right-side vertices; `cap(j, front)` is the flat edge between a
 * vertex and its mirror, covering the rays from the axis to it (front) or from
 * it to the axis (back). Edges spanning 170° or more around the centre, which
 * would let the apex fans fold, cost Infinity.
 */
function outlineCosts(half, cz) {
    const last = half.length - 1, dTheta = Math.PI / last;
    const theta = half.map((_, j) => j * dTheta);
    const r2 = half.map(([x, z]) => x * x + (z - cz) * (z - cz));
    // Shared axis rays (nose and tail) belong half to each side.
    const weight = (k) => (k === 0 || k === last ? 0.5 : 1) * dTheta / 2;
    const rayError = (k, t) => Math.abs(r2[k] - t * t) * weight(k);
    /** Distance along ray k to the line through a and b. */
    const along = (k, a, b) => {
        const ex = b[0] - a[0], ez = b[1] - a[1];
        return (a[0] * ez - (a[1] - cz) * ex) / (Math.sin(theta[k]) * ez - Math.cos(theta[k]) * ex);
    };
    const span = (i, j) => {
        if (j <= i || theta[j] - theta[i] >= MAX_GAP)
            return Infinity;
        let error = 0;
        for (let k = i + 1; k < j; k++) {
            const t = along(k, half[i], half[j]);
            if (!(t > 0))
                return Infinity;
            error += rayError(k, t);
        }
        return error;
    };
    const cap = (j, front) => {
        const dz = half[j][1] - cz, angle = front ? theta[j] : Math.PI - theta[j];
        if (angle * 2 >= MAX_GAP || (front ? dz <= 0 : dz >= 0))
            return Infinity;
        const [from, to] = front ? [0, j - 1] : [j + 1, last];
        let error = 0;
        for (let k = from; k <= to; k++)
            error += rayError(k, dz / Math.cos(theta[k]));
        return error;
    };
    return { spans: half.map((_, i) => half.map((__, j) => span(i, j))), cap };
}
/** best[m][j]: least error of m right-side vertices ending at j, front included; from[m][j] is the previous vertex. */
function chains(costs, last, nose, maxPairs) {
    const best = [[], Array.from({ length: last + 1 }, (_, j) => (j === 0 || j === last ? Infinity : nose ? costs.spans[0][j] : costs.cap(j, true)))];
    const from = [[], best[1].map(() => -1)];
    for (let m = 2; m <= maxPairs; m++) {
        best[m] = best[1].map(() => Infinity);
        from[m] = best[1].map(() => -1);
        for (let j = 1; j < last; j++)
            for (let i = 1; i < j; i++) {
                const value = best[m - 1][i] + costs.spans[i][j];
                if (value < best[m][j]) {
                    best[m][j] = value;
                    from[m][j] = i;
                }
            }
    }
    return { best, from };
}
/** Cheapest last right-side vertex for chains of one length, closed by the tail vertex or a back cap. */
function bestEnd(chainErrors, costs, tail) {
    const last = chainErrors.length - 1;
    let end = -1, error = Infinity;
    for (let j = 1; j < last; j++) {
        const value = chainErrors[j] + (tail ? costs.spans[j][last] : costs.cap(j, false));
        if (value < error) {
            error = value;
            end = j;
        }
    }
    return { end, error };
}
/** Closes each chain and keeps the best outline per vertex count. */
function closeChains(half, costs, nose, maxVertices, keep) {
    const maxPairs = Math.floor(maxVertices / 2);
    const { best, from } = chains(costs, half.length - 1, nose, maxPairs);
    for (const tail of [true, false])
        for (let m = 1; m <= maxPairs; m++) {
            const vertices = 2 * m + Number(nose) + Number(tail);
            if (vertices < 3 || vertices > maxVertices)
                continue;
            const { end, error } = bestEnd(best[m], costs, tail);
            if (end < 0 || !(error < (keep.get(vertices)?.error ?? Infinity)))
                continue;
            const right = [];
            for (let j = end, level = m; level >= 1; j = from[level][j], level--)
                right.unshift(j);
            keep.set(vertices, { vertices, error, polygon: outlinePolygon(half, nose, right, tail) });
        }
}
/**
 * Least-error outline for every vertex count from 3 to maxVertices, by exact
 * dynamic programming over the polar half outline (outlineCosts). The front is
 * the nose vertex or a flat cap, the back the tail vertex or a flat cap.
 */
function bestOutlines(half, cz, maxVertices) {
    const costs = outlineCosts(half, cz), keep = new Map();
    for (const nose of [true, false])
        closeChains(half, costs, nose, maxVertices, keep);
    return [...keep.values()].sort((a, b) => a.vertices - b.vertices);
}
function maxAngularGap(poly, cz) {
    const angles = poly.map(([x, z]) => Math.atan2(x, z - cz)).sort((a, b) => a - b);
    let gap = angles[0] + 2 * Math.PI - angles[angles.length - 1];
    for (let i = 1; i < angles.length; i++)
        gap = Math.max(gap, angles[i] - angles[i - 1]);
    return gap;
}
function percentile(values, q) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;
}
/** Mean mid-height of the nearest covered cells (growing square search). */
function midHeight(grid, [x, z]) {
    const { n, cell, cover, yMin, yMax } = grid;
    const ci = Math.floor((x + EXTENT) / cell), ck = Math.floor((z + EXTENT) / cell);
    for (let r = 2; r <= 12; r += 2) {
        let sum = 0, found = 0;
        for (let k = ck - r; k <= ck + r; k++)
            for (let i = ci - r; i <= ci + r; i++) {
                if (!inGrid(n, i, k) || !cover[k * n + i])
                    continue;
                sum += (yMin[k * n + i] + yMax[k * n + i]) / 2;
                found++;
            }
        if (found)
            return sum / found;
    }
    return 0;
}
/**
 * Outline vertices at the local mid-height; apexes at the hull's upper and
 * lower surfaces (80th / 20th percentile), above and below every outline
 * vertex. Every vertex stays inside the catalog's unit origin radius.
 */
function liftOutline(grid, mask, polygon, cz) {
    const tops = [], bottoms = [];
    for (let c = 0; c < mask.length; c++)
        if (mask[c] && grid.cover[c]) {
            tops.push(grid.yMax[c]);
            bottoms.push(grid.yMin[c]);
        }
    const outline = polygon.map((p) => [p[0], midHeight(grid, p), p[1]]);
    const ys = outline.map((v) => v[1]);
    const top = [0, Math.max(percentile(tops, 0.8), Math.max(...ys) + 0.03), cz];
    const bottom = [0, Math.min(percentile(bottoms, 0.2), Math.min(...ys) - 0.03), cz];
    for (const v of [...outline, top, bottom]) {
        const scale = Math.min(1, 0.999 / Math.hypot(...v));
        for (let a = 0; a < 3; a++)
            v[a] = v[a] * scale;
    }
    return { outline, top, bottom };
}
/** Top and bottom apex fans with flat normals, three corners per triangle. */
function fanTriangles(outline, top, bottom, ccw) {
    // For triangle (apex, a, b), normal.y = -cross2d(a - apex, b - apex) in (x, z),
    // so on a counter-clockwise (x, z) outline the top fan swaps a and b.
    const faces = [];
    outline.forEach((a, i) => {
        const b = outline[(i + 1) % outline.length];
        faces.push(ccw ? [top, b, a] : [top, a, b], ccw ? [bottom, a, b] : [bottom, b, a]);
    });
    const positions = new Float32Array(faces.length * 9), normals = new Float32Array(faces.length * 9);
    faces.forEach(([a, b, c], f) => {
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const nrm = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        const len = Math.hypot(...nrm) || 1;
        [a, b, c].forEach((v, j) => {
            positions.set(v, f * 9 + j * 3);
            normals.set(nrm.map((x) => x / len), f * 9 + j * 3);
        });
    });
    return { positions, normals };
}
export function buildHullDart(positions, stride, indices, options = {}) {
    const maxTriangles = Math.max(6, Math.min(options.maxTriangles ?? 20, 2 * RAYS)), minOverlap = options.minOverlap ?? 0.85;
    const grid = rasterTopView(positions, stride, indices, options.grid ?? 160);
    const mask = topSilhouette(grid, options.openCells ?? 3);
    const { cz, half } = polarOutline(mask, grid);
    const scored = bestOutlines(half, cz, Math.floor(maxTriangles / 2)).map((o) => ({ ...o, overlap: overlap(o.polygon, mask, grid) }));
    if (!scored.length)
        throw new Error('Hull dart: no outline within the triangle budget');
    const chosen = scored.find((o) => o.overlap >= minOverlap) ?? scored.reduce((a, b) => (b.overlap > a.overlap ? b : a));
    if (maxAngularGap(chosen.polygon, cz) >= MAX_GAP)
        throw new Error('Hull dart: outline is not star-shaped around its apex');
    const { outline, top, bottom } = liftOutline(grid, mask, chosen.polygon, cz);
    const faces = fanTriangles(outline, top, bottom, polygonArea(chosen.polygon) > 0);
    return {
        ...faces, triangles: faces.positions.length / 9, outline, top, bottom, overlap: chosen.overlap,
        outlineOverlap: overlap(outlinePolygon(half, true, half.slice(1, -1).map((_, j) => j + 1), true), mask, grid),
    };
}
//# sourceMappingURL=hull-dart.js.map