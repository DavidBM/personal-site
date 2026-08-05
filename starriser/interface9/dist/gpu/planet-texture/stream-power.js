/**
 * Stylized stream-power / fluvial-style relief reduction on equirect height.
 *
 * Upgraded path (default): priority-flood depression fill + D8 flow
 * accumulation + stronger stream-power carving (dendritic valleys).
 * Legacy streamPowerPass kept for tests / light preview.
 *
 * Refs: stream-power law E ∝ A^m * S^n; Barnes priority-flood drainage.
 */
import { runPriorityFloodDrainage } from "./drainage.js";
/**
 * One stream-power-style pass: erode proportional to slope × flow, deposit downslope.
 * Mutates map in place. U-wraps longitude.
 *
 * @param uplift Optional same-size map 0–1; high values reduce erosion (orogeny protect).
 * @param k Erosion strength (default 0.08).
 * @param seaLevel Heights below this are barely eroded (ocean basins).
 */
export function streamPowerPass(map, uplift, k = 0.08, seaLevel = 0.45) {
    const { width: W, height: H, data } = map;
    const next = new Float32Array(data);
    const flow = new Float32Array(W * H);
    flow.fill(1); // unit rainfall
    // Accumulate flow downhill (few sweeps) — steeper neighbors receive more
    for (let sweep = 0; sweep < 3; sweep++) {
        const add = new Float32Array(W * H);
        for (let y = 1; y < H - 1; y++) {
            for (let x = 0; x < W; x++) {
                const i = y * W + x;
                const h = data[i];
                if (h <= seaLevel)
                    continue;
                // Find steepest descent among 4-neighbors
                let best = -1;
                let bestDrop = 0;
                const neigh = [
                    { j: y * W + ((x + 1) % W), dx: 1 },
                    { j: y * W + ((x - 1 + W) % W), dx: 1 },
                    { j: (y + 1) * W + x, dx: 1 },
                    { j: (y - 1) * W + x, dx: 1 },
                ];
                for (const n of neigh) {
                    const drop = h - data[n.j];
                    if (drop > bestDrop) {
                        bestDrop = drop;
                        best = n.j;
                    }
                }
                if (best >= 0 && bestDrop > 1e-6) {
                    add[best] += flow[i] * 0.85;
                }
            }
        }
        for (let i = 0; i < flow.length; i++) {
            flow[i] = 1 + add[i];
        }
    }
    // Erode / deposit
    for (let y = 1; y < H - 1; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            const h = data[i];
            if (h <= seaLevel + 0.01)
                continue;
            const xl = (x - 1 + W) % W;
            const xr = (x + 1) % W;
            const yu = y - 1;
            const yd = y + 1;
            const gx = (data[y * W + xr] - data[y * W + xl]) * 0.5;
            const gy = (data[yd * W + x] - data[yu * W + x]) * 0.5;
            const slope = Math.hypot(gx, gy);
            if (slope < 1e-6)
                continue;
            let protect = 0;
            if (uplift)
                protect = Math.max(0, Math.min(1, uplift[i]));
            // Stream power: E ∝ flow^m * slope^n ; protect by uplift
            const m = 0.5;
            const n = 1.2;
            const power = Math.pow(Math.max(flow[i], 1), m) * Math.pow(slope, n);
            const erodeAmt = k * power * (1 - protect * 0.75);
            if (erodeAmt <= 1e-8)
                continue;
            // Cap so we don't dig below sea + epsilon
            const maxDig = Math.max(0, h - (seaLevel + 0.02));
            const dig = Math.min(erodeAmt, maxDig, 0.04);
            next[i] -= dig;
            // Deposit fraction downslope
            let best = -1;
            let bestDrop = 0;
            const candidates = [
                y * W + xr,
                y * W + xl,
                yd * W + x,
                yu * W + x,
            ];
            for (const j of candidates) {
                const drop = h - data[j];
                if (drop > bestDrop) {
                    bestDrop = drop;
                    best = j;
                }
            }
            if (best >= 0) {
                next[best] += dig * 0.65;
            }
        }
    }
    data.set(next);
}
/**
 * Build a float uplift field for stream-power protection from tectonic samples.
 * Same resolution as height map; pure function of seed + sphere sample.
 */
export function buildUpliftField(width, height, seed, sampleUplift, equirectToDir) {
    const out = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        const v = (y + 0.5) / height;
        for (let x = 0; x < width; x++) {
            const u = (x + 0.5) / width;
            const d = equirectToDir(u, v);
            out[y * width + x] = sampleUplift(d.x, d.y, d.z);
        }
    }
    return out;
}
/**
 * Run drainage + stream-power carving.
 * Uses priority-flood hydrology (stronger dendritic valleys).
 * Returns mean |Δh| for tests.
 */
export function runStreamPowerErosion(map, uplift, iterations, k = 0.07, seaLevel = 0.45) {
    const n = Math.max(0, Math.min(12, Math.floor(iterations)));
    if (n === 0)
        return 0;
    // Prefer depression-handling drainage; slightly stronger k for valley read
    const r = runPriorityFloodDrainage(map, uplift, n, Math.max(k, 0.08), seaLevel);
    return r.meanAbsDelta;
}
/**
 * Legacy multi-sweep path (no priority-flood) — kept for parity probes.
 */
export function runStreamPowerErosionLegacy(map, uplift, iterations, k = 0.07, seaLevel = 0.45) {
    const n = Math.max(0, Math.min(12, Math.floor(iterations)));
    if (n === 0)
        return 0;
    const before = new Float32Array(map.data);
    for (let i = 0; i < n; i++) {
        streamPowerPass(map, uplift, k, seaLevel);
    }
    let sum = 0;
    for (let i = 0; i < map.data.length; i++) {
        sum += Math.abs(map.data[i] - before[i]);
    }
    return sum / map.data.length;
}
//# sourceMappingURL=stream-power.js.map