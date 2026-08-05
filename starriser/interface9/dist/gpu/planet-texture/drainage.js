/**
 * Depression-handling drainage + flow accumulation for equirect height.
 *
 * Priority-flood (Barnes-style simplified) fills sinks so every land cell
 * has a descending path to the ocean / map border, then multi-pass steepest
 * descent accumulates flow for stream-power carving.
 *
 * Pure + deterministic. Oceans (h ≤ seaLevel) are spared.
 */
/**
 * Binary min-heap of (priority, index) for priority-flood.
 */
class MinHeap {
    constructor() {
        this.keys = [];
        this.vals = [];
    }
    get size() {
        return this.keys.length;
    }
    push(key, val) {
        this.keys.push(key);
        this.vals.push(val);
        this.up(this.keys.length - 1);
    }
    pop() {
        if (this.keys.length === 0)
            return null;
        const k0 = this.keys[0];
        const v0 = this.vals[0];
        const lastK = this.keys.pop();
        const lastV = this.vals.pop();
        if (this.keys.length > 0) {
            this.keys[0] = lastK;
            this.vals[0] = lastV;
            this.down(0);
        }
        return { key: k0, val: v0 };
    }
    up(i) {
        const keys = this.keys;
        const vals = this.vals;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (keys[p] <= keys[i])
                break;
            const tk = keys[p];
            keys[p] = keys[i];
            keys[i] = tk;
            const tv = vals[p];
            vals[p] = vals[i];
            vals[i] = tv;
            i = p;
        }
    }
    down(i) {
        const keys = this.keys;
        const vals = this.vals;
        const n = keys.length;
        for (;;) {
            let s = i;
            const l = i * 2 + 1;
            const r = l + 1;
            if (l < n && keys[l] < keys[s])
                s = l;
            if (r < n && keys[r] < keys[s])
                s = r;
            if (s === i)
                break;
            const tk = keys[s];
            keys[s] = keys[i];
            keys[i] = tk;
            const tv = vals[s];
            vals[s] = vals[i];
            vals[i] = tv;
            i = s;
        }
    }
}
/**
 * Priority-flood depression fill on land above seaLevel.
 * Mutates a copy-friendly return; does not mutate input if out provided.
 * Ocean cells stay at original height.
 *
 * Algorithm: seed queue with all ocean-adjacent land and ocean cells at their
 * height; flood inland raising pits to the lowest spill elevation.
 */
export function priorityFloodFill(map, seaLevel, out) {
    const { width: W, height: H, data } = map;
    const n = W * H;
    const filled = out ?? new Float32Array(n);
    filled.set(data);
    const sea = Math.max(0, Math.min(1, seaLevel));
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    // Seed: ocean cells + polar border land (escape to sea)
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            const h = data[i];
            if (h <= sea) {
                closed[i] = 1;
                heap.push(h, i);
            }
            else if (y === 0 || y === H - 1) {
                // Polar rows can drain off-map
                closed[i] = 1;
                heap.push(h, i);
            }
        }
    }
    const neigh = (i) => {
        const y = (i / W) | 0;
        const x = i - y * W;
        const o = [y * W + ((x + 1) % W), y * W + ((x - 1 + W) % W)];
        if (y + 1 < H)
            o.push((y + 1) * W + x);
        if (y - 1 >= 0)
            o.push((y - 1) * W + x);
        return o;
    };
    while (heap.size > 0) {
        const cur = heap.pop();
        const i = cur.val;
        const elev = filled[i];
        for (const j of neigh(i)) {
            if (closed[j])
                continue;
            closed[j] = 1;
            const hj = data[j];
            if (hj <= sea) {
                filled[j] = hj;
                heap.push(hj, j);
                continue;
            }
            // Raise pit to current water surface if below
            const nf = hj < elev ? elev : hj;
            filled[j] = nf;
            heap.push(nf, j);
        }
    }
    // Any unvisited (rare disconnected) keep original
    for (let i = 0; i < n; i++) {
        if (!closed[i])
            filled[i] = data[i];
    }
    return filled;
}
/**
 * Steepest-descent flow accumulation on a filled DEM.
 * Returns flow (rainfall units); ocean cells get 0.
 */
export function accumulateFlowD8(filled, W, H, seaLevel, sweeps = 8) {
    const n = W * H;
    const sea = Math.max(0, Math.min(1, seaLevel));
    const flow = new Float32Array(n);
    // Unit rainfall on land
    for (let i = 0; i < n; i++) {
        flow[i] = filled[i] > sea ? 1 : 0;
    }
    const receivers = new Int32Array(n);
    receivers.fill(-1);
    for (let y = 1; y < H - 1; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            const h = filled[i];
            if (h <= sea)
                continue;
            let best = -1;
            let bestDrop = 0;
            const cands = [
                y * W + ((x + 1) % W),
                y * W + ((x - 1 + W) % W),
                (y + 1) * W + x,
                (y - 1) * W + x,
                (y + 1) * W + ((x + 1) % W),
                (y + 1) * W + ((x - 1 + W) % W),
                (y - 1) * W + ((x + 1) % W),
                (y - 1) * W + ((x - 1 + W) % W),
            ];
            for (const j of cands) {
                const drop = h - filled[j];
                if (drop > bestDrop) {
                    bestDrop = drop;
                    best = j;
                }
            }
            if (best >= 0 && bestDrop > 1e-8)
                receivers[i] = best;
        }
    }
    // Topological-ish multi-sweep transfer (equirect not a perfect DAG)
    for (let s = 0; s < Math.max(1, sweeps); s++) {
        const add = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const r = receivers[i];
            if (r >= 0 && filled[i] > sea) {
                add[r] += flow[i] * 0.92;
            }
        }
        for (let i = 0; i < n; i++) {
            if (filled[i] > sea)
                flow[i] = 1 + add[i];
            else
                flow[i] = 0;
        }
    }
    return flow;
}
/**
 * Apply stream-power carving using precomputed flow.
 * Mutates map in place. Stronger than legacy few-sweep path.
 */
export function carveWithFlow(map, flow, uplift, k, seaLevel, maxDig = 0.055) {
    const { width: W, height: H, data } = map;
    const next = new Float32Array(data);
    const sea = Math.max(0, Math.min(1, seaLevel));
    for (let y = 1; y < H - 1; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            const h = data[i];
            if (h <= sea + 0.008)
                continue;
            const xl = (x - 1 + W) % W;
            const xr = (x + 1) % W;
            const gx = (data[y * W + xr] - data[y * W + xl]) * 0.5;
            const gy = (data[(y + 1) * W + x] - data[(y - 1) * W + x]) * 0.5;
            const slope = Math.hypot(gx, gy);
            if (slope < 1e-7)
                continue;
            let protect = 0;
            if (uplift)
                protect = Math.max(0, Math.min(1, uplift[i]));
            // E ∝ A^m * S^n — slightly higher m for dendritic channels
            const m = 0.55;
            const nExp = 1.15;
            const power = Math.pow(Math.max(flow[i], 1), m) * Math.pow(slope, nExp);
            const erodeAmt = k * power * (1 - protect * 0.72);
            if (erodeAmt <= 1e-9)
                continue;
            const maxBelow = Math.max(0, h - (sea + 0.015));
            const dig = Math.min(erodeAmt, maxBelow, maxDig);
            next[i] -= dig;
            // Deposit downslope
            let best = -1;
            let bestDrop = 0;
            const cands = [
                y * W + xr,
                y * W + xl,
                (y + 1) * W + x,
                (y - 1) * W + x,
            ];
            for (const j of cands) {
                const drop = h - data[j];
                if (drop > bestDrop) {
                    bestDrop = drop;
                    best = j;
                }
            }
            if (best >= 0 && data[best] > sea) {
                next[best] += dig * 0.55;
            }
        }
    }
    data.set(next);
}
/**
 * Full drainage upgrade: priority-flood → flow → multi-pass carve.
 * Mutates map. Returns max flow on land (for metrics).
 */
export function runPriorityFloodDrainage(map, uplift, iterations, k = 0.09, seaLevel = 0.45) {
    const nIter = Math.max(0, Math.min(10, Math.floor(iterations)));
    if (nIter === 0)
        return { maxFlow: 0, meanAbsDelta: 0 };
    const before = new Float32Array(map.data);
    const { width: W, height: H } = map;
    let maxFlow = 0;
    for (let it = 0; it < nIter; it++) {
        const filled = priorityFloodFill(map, seaLevel);
        // Use filled surface only for flow routing; carve original
        const flow = accumulateFlowD8(filled, W, H, seaLevel, 6 + it);
        for (let i = 0; i < flow.length; i++) {
            if (flow[i] > maxFlow)
                maxFlow = flow[i];
        }
        const kk = k * (1 - it * 0.08);
        carveWithFlow(map, flow, uplift, kk, seaLevel, 0.05);
    }
    let sum = 0;
    for (let i = 0; i < map.data.length; i++) {
        sum += Math.abs(map.data[i] - before[i]);
    }
    return {
        maxFlow,
        meanAbsDelta: sum / map.data.length,
    };
}
/**
 * Max flow on land for a height map (single fill + accumulate).
 * Used by smoke metrics — does not mutate height.
 */
export function measureMaxLandFlow(map, seaLevel) {
    const filled = priorityFloodFill(map, seaLevel);
    const flow = accumulateFlowD8(filled, map.width, map.height, seaLevel, 8);
    let max = 0;
    for (let i = 0; i < flow.length; i++) {
        if (flow[i] > max)
            max = flow[i];
    }
    return max;
}
//# sourceMappingURL=drainage.js.map