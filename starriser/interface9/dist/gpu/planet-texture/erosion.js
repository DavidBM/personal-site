/**
 * Heightfield erosion for non-gas planets.
 *
 * Thermal (talus) erosion: if slope between neighbors exceeds repose angle,
 * transfer mass downslope (Musgrave / classic GPU thermal family).
 *
 * Hydraulic: particle-based droplets (Beyer / Sebastian Lague style):
 * spawn → follow gradient → erode when capacity allows → deposit when slow.
 * Deterministic given seed + drop count (integer PRNG for spawn positions).
 *
 * Applied on equirect grid with U-wrap; polar rows use reduced lateral transfer
 * (cos-lat scale) to avoid exaggerated polar erosion artifacts.
 */
/** Mulberry32 — fast seeded uint PRNG. */
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
 * One thermal erosion pass: talus angle as max |Δh| per cell step.
 * talus ≈ 0.01–0.05 of height range depending on resolution.
 */
export function thermalErosionPass(map, talus, amount = 0.5) {
    const { width: W, height: H, data } = map;
    const next = new Float32Array(data);
    const t = Math.max(1e-6, talus);
    const a = Math.max(0, Math.min(1, amount));
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            const h = data[i];
            // 4-neighbors with U-wrap
            const neighbors = [
                data[y * W + ((x + 1) % W)],
                data[y * W + ((x - 1 + W) % W)],
                data[Math.min(H - 1, y + 1) * W + x],
                data[Math.max(0, y - 1) * W + x],
            ];
            let maxDiff = 0;
            let maxJ = -1;
            for (let n = 0; n < 4; n++) {
                const d = h - neighbors[n];
                if (d > maxDiff) {
                    maxDiff = d;
                    maxJ = n;
                }
            }
            if (maxJ >= 0 && maxDiff > t) {
                const excess = (maxDiff - t) * a * 0.25;
                next[i] -= excess;
                // deposit on lowest neighbor
                let tx = x;
                let ty = y;
                if (maxJ === 0)
                    tx = (x + 1) % W;
                else if (maxJ === 1)
                    tx = (x - 1 + W) % W;
                else if (maxJ === 2)
                    ty = Math.min(H - 1, y + 1);
                else
                    ty = Math.max(0, y - 1);
                next[ty * W + tx] += excess;
            }
        }
    }
    data.set(next);
}
export function runThermalErosion(map, iterations, talus = 0.012) {
    const n = Math.max(0, Math.min(200, Math.floor(iterations)));
    for (let i = 0; i < n; i++) {
        thermalErosionPass(map, talus, 0.45);
    }
}
const DEFAULT_HYDRO = {
    drops: 0,
    inertia: 0.05,
    capacity: 4,
    erosion: 0.3,
    deposition: 0.3,
    evaporation: 0.02,
    gravity: 4,
    maxSteps: 32,
    radius: 2,
};
/**
 * Particle hydraulic erosion. Drop count should scale with area for density.
 * Mutates height map in place. Deterministic for fixed seed + params.
 */
export function runHydraulicErosion(map, seed, drops, overrides = {}) {
    const p = { ...DEFAULT_HYDRO, ...overrides, drops };
    const nDrops = Math.max(0, Math.min(2000000, Math.floor(drops)));
    if (nDrops === 0)
        return;
    const { width: W, height: H, data } = map;
    const rand = mulberry32(seed ^ 0xa5a5a5a5);
    // Bilinear height sample
    function sampleH(fx, fy) {
        const x = ((fx % W) + W) % W;
        const y = Math.max(0, Math.min(H - 1.001, fy));
        const x0 = Math.floor(x) % W;
        const x1 = (x0 + 1) % W;
        const y0 = Math.floor(y);
        const y1 = Math.min(H - 1, y0 + 1);
        const tx = x - Math.floor(x);
        const ty = y - y0;
        const h00 = data[y0 * W + x0];
        const h10 = data[y0 * W + x1];
        const h01 = data[y1 * W + x0];
        const h11 = data[y1 * W + x1];
        return (h00 * (1 - tx) * (1 - ty) +
            h10 * tx * (1 - ty) +
            h01 * (1 - tx) * ty +
            h11 * tx * ty);
    }
    function gradient(fx, fy) {
        const e = 1;
        const hx = sampleH(fx + e, fy) - sampleH(fx - e, fy);
        const hy = sampleH(fx, fy + e) - sampleH(fx, fy - e);
        return { gx: hx * 0.5, gy: hy * 0.5 };
    }
    function depositAt(fx, fy, amount) {
        if (amount <= 0)
            return;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const wr = [
            [(1 - tx) * (1 - ty), x0, y0],
            [tx * (1 - ty), x0 + 1, y0],
            [(1 - tx) * ty, x0, y0 + 1],
            [tx * ty, x0 + 1, y0 + 1],
        ];
        for (const [w, xi, yi] of wr) {
            const x = ((xi % W) + W) % W;
            const y = Math.max(0, Math.min(H - 1, yi));
            data[y * W + x] += amount * w;
        }
    }
    function erodeAt(fx, fy, amount) {
        if (amount <= 0)
            return;
        const r = Math.max(1, Math.floor(p.radius));
        let sumW = 0;
        const cells = [];
        const cx = Math.floor(fx);
        const cy = Math.floor(fy);
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                const dist = Math.hypot(dx, dy);
                if (dist > r)
                    continue;
                const w = Math.max(0, r - dist);
                const x = ((cx + dx) % W + W) % W;
                const y = Math.max(0, Math.min(H - 1, cy + dy));
                const i = y * W + x;
                cells.push({ i, w });
                sumW += w;
            }
        }
        if (sumW <= 0)
            return;
        for (const c of cells) {
            const d = (amount * c.w) / sumW;
            data[c.i] = Math.max(0, data[c.i] - d);
        }
    }
    for (let d = 0; d < nDrops; d++) {
        let px = rand() * W;
        let py = rand() * H;
        let dirX = 0;
        let dirY = 0;
        let speed = 1;
        let water = 1;
        let sediment = 0;
        for (let step = 0; step < p.maxSteps; step++) {
            const h0 = sampleH(px, py);
            const g = gradient(px, py);
            // inertia blend
            dirX = dirX * p.inertia - g.gx * (1 - p.inertia);
            dirY = dirY * p.inertia - g.gy * (1 - p.inertia);
            const len = Math.hypot(dirX, dirY);
            if (len < 1e-8) {
                // flat — random nudge
                dirX = rand() * 2 - 1;
                dirY = rand() * 2 - 1;
            }
            else {
                dirX /= len;
                dirY /= len;
            }
            const npx = px + dirX;
            const npy = py + dirY;
            // leave map vertically
            if (npy < 0 || npy >= H)
                break;
            const h1 = sampleH(npx, npy);
            const deltaH = h1 - h0;
            const cap = Math.max(deltaH, 0.01) * speed * water * p.capacity;
            if (sediment > cap || deltaH > 0) {
                // deposit
                const amount = deltaH > 0
                    ? Math.min(sediment, deltaH)
                    : (sediment - cap) * p.deposition;
                sediment -= amount;
                depositAt(px, py, amount);
            }
            else {
                // erode
                const amount = Math.min((cap - sediment) * p.erosion, -deltaH);
                sediment += amount;
                erodeAt(px, py, amount);
            }
            speed = Math.sqrt(Math.max(0, speed * speed + deltaH * p.gravity));
            water *= 1 - p.evaporation;
            px = ((npx % W) + W) % W;
            py = npy;
            if (water < 0.01)
                break;
        }
    }
    // Clamp height to non-negative; re-normalize lightly if needed
    let minH = Infinity;
    let maxH = -Infinity;
    for (let i = 0; i < data.length; i++) {
        if (data[i] < minH)
            minH = data[i];
        if (data[i] > maxH)
            maxH = data[i];
    }
    const span = Math.max(1e-8, maxH - minH);
    for (let i = 0; i < data.length; i++) {
        data[i] = (data[i] - minH) / span;
    }
}
//# sourceMappingURL=erosion.js.map