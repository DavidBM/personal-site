/**
 * WebGPU full-fidelity planet bake (multi-pass compute).
 *
 * Strictly sequential stages (fenced) to keep peak VRAM low and timings honest:
 *   low-res host structure (mask/prior) → GPU structure compose + soft-coast →
 *   thermal → GPU stream drainage → hydraulic → reinject → seal →
 *   paint (Köppen climate) → normals → clouds → readback
 *
 * Buffer lifetime is phased: stream scratch freed before hydraulic; hydro scratch
 * freed before product maps; height ping-pong B freed after terrain; maps read
 * back one-at-a-time and destroyed. Pixel work within a stage still uses GPU
 * threads; stages never run concurrently.
 *
 * Gas: CPU gas field + completeBakeFromHeight (unchanged).
 * No silent CPU fallback on GPU failure — errors propagate to the caller/UI.
 *
 * Policies match bake.ts / completeBakeFromHeight (metric parity for parallel hydro).
 */
import { MAX_RESOLUTION, MIN_RESOLUTION } from "./types.js";
import { cloneParams } from "./presets.js";
import { carveLavaRiverHeight, liquidKindForClass, paintSurface, paletteForParams, softOceanAlbedo, } from "./materials.js";
import { allocateHeightMap, heightToGrayRgba, heightToNormalMap, sealEquirectSeam, softCoastFilter, } from "./heightfield.js";
import { generateGasField } from "./gas-flow.js";
import { completeBakeFromHeight, scaledHydraulicDrops, throwIfBakeAborted, } from "./bake.js";
import { buildStructureMapsForBake } from "./structure.js";
import { bakePlanetTexturesGpuCpuRef } from "./bake-gpu-cpu-ref.js";
import { PLANET_FULL_HEIGHT_WGSL } from "./shaders/planet-full-height.wgsl.js";
import { PLANET_FULL_BAKE_TERRAIN_WGSL, PLANET_FULL_BAKE_PRODUCT_WGSL, PLANET_FULL_BAKE_HYDRO_WGSL, } from "./shaders/planet-full-bake.wgsl.js";
import { readGpuBuffer } from "../buffer-readback.js";
import { buildSphereLuts } from "./gpu-bake-math.js";
import { clampPoleCapSide, poleIceExtentScale, rasterizePoleCap, rasterizeCloudPoleCaps, } from "./pole-cap.js";
import { countLandLocalMaxima, effectiveLayerTally, } from "./density.js";
export { bakePlanetTexturesGpuCpuRef };
function clampParams(p) {
    const o = cloneParams(p);
    o.resolution = Math.max(MIN_RESOLUTION, Math.min(MAX_RESOLUTION, Math.floor(o.resolution)));
    if (o.resolution % 2 !== 0)
        o.resolution -= 1;
    // Independent of equirect width — clamp to pole-cap max only
    o.poleSize = clampPoleCapSide(o.poleSize);
    o.liquidLevel = Math.max(0, Math.min(1, o.liquidLevel));
    o.liquidKind = liquidKindForClass(o.planetClass, o.liquidKind);
    o.heightOctaves = Math.max(1, Math.min(10, Math.floor(o.heightOctaves)));
    o.thermalIters = Math.max(0, Math.min(80, Math.floor(o.thermalIters)));
    return o;
}
export function isWebGpuBakeAvailable() {
    return typeof navigator !== "undefined" && !!navigator.gpu;
}
export async function requestPlanetBakeDevice() {
    if (!navigator.gpu)
        throw new Error("WebGPU not available");
    const adapter = await navigator.gpu.requestAdapter({
        powerPreference: "high-performance",
    });
    if (!adapter)
        throw new Error("No WebGPU adapter");
    const maxStorage = adapter.limits.maxStorageBufferBindingSize;
    const need = 256 * 1024 * 1024;
    return adapter.requestDevice({
        requiredLimits: {
            maxStorageBufferBindingSize: Math.min(maxStorage, Math.max(need, 128 * 1024 * 1024)),
            maxBufferSize: Math.min(adapter.limits.maxBufferSize, Math.max(need, 128 * 1024 * 1024)),
        },
    });
}
function classToId(cls) {
    switch (cls) {
        case "ocean":
            return 0;
        case "temperate":
            return 1;
        case "rocky":
            return 2;
        case "ice":
            return 3;
        case "gas":
            return 4;
        case "exotic":
            return 5;
        default:
            return 0;
    }
}
function liquidKindToId(k) {
    switch (k) {
        case "water":
            return 0;
        case "methane":
            return 1;
        case "acid":
            return 2;
        case "lava":
            return 3;
        case "none":
            return 4;
        default:
            return 0;
    }
}
function makeBuf(device, size, usage, label) {
    return device.createBuffer({ label, size: Math.max(4, size), usage });
}
function packPalette(pal, out, base) {
    const order = [
        "liquidDeep",
        "liquidMid",
        "liquidShelf",
        "liquidShallow",
        "beach",
        "arid",
        "aridHot",
        "grassland",
        "forest",
        "forestDeep",
        "lowland",
        "highland",
        "mountain",
        "rockDark",
        "snow",
        "tundra",
        "gasA",
        "gasB",
        "gasC",
        "gasStorm",
    ];
    for (let i = 0; i < order.length; i++) {
        const c = pal[order[i]];
        const o = base + i * 4;
        out[o] = c.r;
        out[o + 1] = c.g;
        out[o + 2] = c.b;
        out[o + 3] = 0;
    }
}
/** Uniform size: 10×16 header + 20×vec4 palette = 480 bytes. */
const UNIFORM_BYTES = 480;
function writeParams(device, uniformBuf, params, W, H, extras) {
    const ab = new ArrayBuffer(UNIFORM_BYTES);
    const u32 = new Uint32Array(ab);
    const i32 = new Int32Array(ab);
    const f32 = new Float32Array(ab);
    u32[0] = W;
    u32[1] = H;
    i32[2] = params.seed | 0;
    i32[3] = classToId(params.planetClass);
    i32[4] = params.heightOctaves | 0;
    i32[5] = liquidKindToId(params.liquidKind);
    i32[6] = params.thermalIters | 0;
    i32[7] = extras.hydroDrops | 0;
    f32[8] = params.heightFreq;
    f32[9] = params.warp;
    f32[10] = params.continentScale;
    f32[11] = params.mountainScale;
    f32[12] = params.liquidLevel;
    f32[13] = params.colorBoost;
    f32[14] = params.cloudCover;
    f32[15] = params.wetness;
    f32[16] = extras.talus;
    f32[17] = 0.09; // stream k — stronger GPU drainage (no host priority-flood)
    f32[18] = 0.05; // inertia
    f32[19] = 4; // capacity
    f32[20] = 0.3; // erosion
    f32[21] = 0.3; // deposition
    f32[22] = 0.02; // evap
    f32[23] = 4; // gravity
    i32[24] = extras.hydroMaxSteps | 0;
    i32[25] = 1; // radius
    i32[26] = extras.blendCols | 0;
    i32[27] = (extras.hydroStepIdx ?? 0) | 0;
    f32[28] = extras.normalStrength;
    // reinject scales with heightOctaves so the UI knob changes full-bake height
    {
        const oct = Math.max(2, Math.min(8, Math.floor(params.heightOctaves)));
        const octScale = 0.45 + (oct / 8) * 1.35;
        f32[29] = 0.12 * octScale;
    }
    f32[30] = params.liquidLevel; // coast sea center
    // Wide enough for product structure cliffs (~sea±0.2…0.4 at edges)
    f32[31] = 0.36;
    f32[32] = params.atmTint.r;
    f32[33] = params.atmTint.g;
    f32[34] = params.atmTint.b;
    u32[35] = (extras.workOffset ?? 0) >>> 0;
    // poleIceScale from absolute poleSize (ice control; product side is res-only)
    f32[36] = poleIceExtentScale(params.poleSize);
    f32[37] = 0;
    f32[38] = 0;
    f32[39] = 0;
    packPalette(paletteForParams(params), f32, 40);
    device.queue.writeBuffer(uniformBuf, 0, ab);
}
/** WebGPU maxComputeWorkgroupsPerDimension (spec minimum / common limit). */
const MAX_WORKGROUPS_PER_DIM = 65535;
function unpackRgba8(u32src, nPix) {
    const out = new Uint8ClampedArray(nPix * 4);
    for (let i = 0; i < nPix; i++) {
        const v = u32src[i];
        const o = i * 4;
        out[o] = v & 0xff;
        out[o + 1] = (v >>> 8) & 0xff;
        out[o + 2] = (v >>> 16) & 0xff;
        out[o + 3] = (v >>> 24) & 0xff;
    }
    return out;
}
function albedoVariance(rgba) {
    let n = 0;
    let sum = 0;
    let sum2 = 0;
    for (let i = 0; i < rgba.length; i += 4) {
        const lum = (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3;
        sum += lum;
        sum2 += lum * lum;
        n++;
    }
    if (n < 2)
        return 0;
    const mean = sum / n;
    return Math.max(0, sum2 / n - mean * mean);
}
function heightStats(data) {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
        const h = data[i];
        if (h < min)
            min = h;
        if (h > max)
            max = h;
        sum += h;
    }
    return { min, max, mean: sum / data.length };
}
/**
 * GPU base height = full sampleHeightAtDir + first normalize + soft contrast + softCoast.
 * Kept for tests; full bake uses gpuBakeFull without intermediate readback.
 */
export async function gpuGenerateBaseHeight(device, input, onProgress) {
    const params = clampParams(input);
    const W = params.resolution;
    const H = Math.max(1, Math.floor(W / 2));
    const nPix = W * H;
    const report = onProgress ?? (() => { });
    const byteF32 = nPix * 4;
    if (byteF32 > device.limits.maxStorageBufferBindingSize) {
        throw new Error(`Height buffer ${byteF32} exceeds maxStorageBufferBindingSize ${device.limits.maxStorageBufferBindingSize}`);
    }
    report("gpu height setup", 0.05);
    device.pushErrorScope("validation");
    const module = device.createShaderModule({
        label: "planet-full-height",
        code: PLANET_FULL_HEIGHT_WGSL,
    });
    const layout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: "uniform" },
            },
            {
                binding: 1,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: "read-only-storage" },
            },
            {
                binding: 2,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: "storage" },
            },
            {
                binding: 3,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: "storage" },
            },
        ],
    });
    const pipeLayout = device.createPipelineLayout({
        bindGroupLayouts: [layout],
    });
    const mk = (entryPoint) => device.createComputePipeline({
        layout: pipeLayout,
        compute: { module, entryPoint },
    });
    const pipeHeight = mk("cs_height");
    const pipeReduce = mk("cs_reduce_minmax");
    const pipeFinalize = mk("cs_finalize_minmax");
    const pipeNorm = mk("cs_normalize");
    const { cosLon, sinLon, cosLat, sinLat } = buildSphereLuts(W, H);
    const lutData = new Float32Array(W * 2 + H * 2);
    lutData.set(cosLon, 0);
    lutData.set(sinLon, W);
    lutData.set(cosLat, W * 2);
    lutData.set(sinLat, W * 2 + H);
    const uniformData = new ArrayBuffer(48);
    const u32 = new Uint32Array(uniformData);
    const i32 = new Int32Array(uniformData);
    const f32v = new Float32Array(uniformData);
    u32[0] = W;
    u32[1] = H;
    i32[2] = params.seed | 0;
    i32[3] = classToId(params.planetClass);
    i32[4] = params.heightOctaves | 0;
    i32[5] = 0;
    f32v[6] = params.heightFreq;
    f32v[7] = params.warp;
    f32v[8] = params.continentScale;
    f32v[9] = params.mountainScale;
    const uniformBuf = makeBuf(device, 48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, "full-h-params");
    device.queue.writeBuffer(uniformBuf, 0, uniformData);
    const lutBuf = makeBuf(device, lutData.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, "sphere-luts");
    device.queue.writeBuffer(lutBuf, 0, lutData);
    const heightBuf = makeBuf(device, byteF32, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, "height");
    const reduceThreads = Math.ceil(nPix / 256);
    const reduceBuf = makeBuf(device, (2 + reduceThreads * 2) * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, "reduce");
    const bindGroup = device.createBindGroup({
        layout,
        entries: [
            { binding: 0, resource: { buffer: uniformBuf } },
            { binding: 1, resource: { buffer: lutBuf } },
            { binding: 2, resource: { buffer: heightBuf } },
            { binding: 3, resource: { buffer: reduceBuf } },
        ],
    });
    const gx = Math.ceil(W / 8);
    const gy = Math.ceil(H / 8);
    report("gpu sampleHeightAtDir", 0.12);
    {
        const enc = device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(pipeHeight);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(gx, gy, 1);
        pass.end();
        device.queue.submit([enc.finish()]);
    }
    report("gpu reduce minmax", 0.14);
    {
        const enc = device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(pipeReduce);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(Math.ceil(reduceThreads / 256), 1, 1);
        pass.end();
        const pass2 = enc.beginComputePass();
        pass2.setPipeline(pipeFinalize);
        pass2.setBindGroup(0, bindGroup);
        pass2.dispatchWorkgroups(1, 1, 1);
        pass2.end();
        device.queue.submit([enc.finish()]);
    }
    report("gpu normalize", 0.15);
    {
        const enc = device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(pipeNorm);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(gx, gy, 1);
        pass.end();
        device.queue.submit([enc.finish()]);
    }
    await device.queue.onSubmittedWorkDone();
    const err = await device.popErrorScope();
    if (err)
        throw new Error(`GPU height validation: ${err.message}`);
    report("gpu height readback", 0.17);
    const raw = await readGpuBuffer(device, heightBuf, 0, byteF32);
    const data = new Float32Array(raw);
    for (const b of [uniformBuf, lutBuf, heightBuf, reduceBuf])
        b.destroy();
    // Match generateBaseHeight post: soft contrast + re-normalize + softCoast (CPU for this export)
    report("cpu soft-contrast + coast", 0.18);
    for (let i = 0; i < data.length; i++) {
        const t = data[i];
        const c = t * t * (3 - 2 * t);
        data[i] = t * 0.72 + c * 0.28;
    }
    let minH = Infinity;
    let maxH = -Infinity;
    for (let i = 0; i < data.length; i++) {
        if (data[i] < minH)
            minH = data[i];
        if (data[i] > maxH)
            maxH = data[i];
    }
    const sp = Math.max(1e-8, maxH - minH);
    for (let i = 0; i < data.length; i++) {
        data[i] = (data[i] - minH) / sp;
    }
    const map = allocateHeightMap(W, H);
    map.data.set(data);
    // Mild soft-coast for GPU height export parity with generateBaseHeight
    // (no landMask here — wide band only; full path uses pull+soft+enforce)
    softCoastFilter(map, params.liquidLevel, 3, 0.28, 0.42);
    return map;
}
function mkPipes(device, module, layout, names) {
    const m = new Map();
    for (const name of names) {
        m.set(name, device.createComputePipeline({
            layout,
            compute: { module, entryPoint: name },
        }));
    }
    return m;
}
function dispatch2d(device, pipe, bg0, gx, gy) {
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg0);
    pass.dispatchWorkgroups(gx, gy, 1);
    pass.end();
    device.queue.submit([enc.finish()]);
}
/**
 * 1D compute over `n` items. Chunks when workgroup count would exceed
 * maxComputeWorkgroupsPerDimension (65535) — required at ~4K–8K equirect.
 * `setOffset(base)` must write P.workOffset before each chunk (uniforms).
 */
function dispatch1d(device, pipe, bg0, n, setOffset, wg = 256) {
    if (n <= 0)
        return;
    // Max items per dispatch while staying within one workgroup dimension
    const maxItems = MAX_WORKGROUPS_PER_DIM * wg;
    for (let offset = 0; offset < n; offset += maxItems) {
        const count = Math.min(maxItems, n - offset);
        setOffset(offset);
        const groups = Math.ceil(count / wg);
        if (groups > MAX_WORKGROUPS_PER_DIM) {
            throw new Error(`dispatch1d: workgroups ${groups} still exceeds ${MAX_WORKGROUPS_PER_DIM}`);
        }
        const enc = device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(pipe);
        pass.setBindGroup(0, bg0);
        pass.dispatchWorkgroups(groups, 1, 1);
        pass.end();
        device.queue.submit([enc.finish()]);
    }
}
function reduceNormalize(device, pipes, bg0, nPix, gx, gy) {
    const reduceThreads = Math.ceil(nPix / 256);
    {
        const enc = device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(pipes.get("cs_reduce_minmax"));
        pass.setBindGroup(0, bg0);
        pass.dispatchWorkgroups(Math.ceil(reduceThreads / 256), 1, 1);
        pass.end();
        const pass2 = enc.beginComputePass();
        pass2.setPipeline(pipes.get("cs_finalize_minmax"));
        pass2.setBindGroup(0, bg0);
        pass2.dispatchWorkgroups(1, 1, 1);
        pass2.end();
        device.queue.submit([enc.finish()]);
    }
    dispatch2d(device, pipes.get("cs_normalize"), bg0, gx, gy);
}
/** Round ms for stable UI / metrics. */
function roundMs(ms) {
    return Math.round(ms * 10) / 10;
}
/**
 * Fence GPU work after a stage so progress/metrics attribute cost correctly
 * (without this, the last label eats the whole queue drain).
 */
function createStageMeter(device, report, signal) {
    const stageMs = {};
    let t0 = performance.now();
    const record = (name, frac) => {
        throwIfBakeAborted(signal);
        const ms = roundMs(performance.now() - t0);
        stageMs[name] = ms;
        report(`${name} ${ms}ms`, frac);
        t0 = performance.now();
    };
    return {
        stageMs,
        wall(name, frac) {
            record(name, frac);
        },
        async fence(name, frac) {
            throwIfBakeAborted(signal);
            await device.queue.onSubmittedWorkDone();
            record(name, frac);
        },
        total() {
            let s = 0;
            for (const v of Object.values(stageMs))
                s += v;
            return roundMs(s);
        },
    };
}
/** Preferred pipeline order for multi-line stage reports. */
const STAGE_REPORT_ORDER = [
    "setup",
    "structure-host",
    "structure",
    "height",
    "soft-contrast",
    "soft-coast",
    "thermal",
    "stream-power",
    "drainage",
    "hydraulic",
    "reinject",
    "paint",
    "normals",
    "clouds",
    "readback",
    "unpack",
    "soft-ocean",
    "poles",
    "stats",
    "bake",
    "ai-patches",
    "hybrid", // legacy alias for ai-patches in older status dumps
    "preview",
];
/** Compact one-line summary (top-N by cost). */
export function formatStageMs(stageMs, topN = 6) {
    if (!stageMs)
        return "";
    const entries = Object.entries(stageMs).sort((a, b) => b[1] - a[1]);
    return entries
        .slice(0, topN)
        .map(([k, v]) => `${k}=${v}ms`)
        .join(" · ");
}
/**
 * Multi-line stage breakdown for UI status (one stage per line).
 * Uses pipeline order; includes ms and share of total.
 */
export function formatStageReport(stageMs, totalMs) {
    if (!stageMs || Object.keys(stageMs).length === 0)
        return "";
    const keys = [
        ...STAGE_REPORT_ORDER.filter((k) => stageMs[k] != null),
        ...Object.keys(stageMs)
            .filter((k) => !STAGE_REPORT_ORDER.includes(k))
            .sort(),
    ];
    let sum = 0;
    for (const k of keys)
        sum += Number(stageMs[k]) || 0;
    const tot = typeof totalMs === "number" && totalMs > 0 ? totalMs : sum || 1;
    const nameW = Math.max(12, ...keys.map((k) => k.length), "TOTAL".length);
    const lines = [];
    for (const k of keys) {
        const ms = Number(stageMs[k]) || 0;
        const pct = (100 * ms) / tot;
        lines.push(`  ${k.padEnd(nameW)}  ${ms.toFixed(0).padStart(5)} ms  ${pct.toFixed(1).padStart(5)}%`);
    }
    lines.push(`  ${"TOTAL".padEnd(nameW)}  ${tot.toFixed(0).padStart(5)} ms  100.0%`);
    return lines.join("\n");
}
/**
 * Full multi-pass GPU bake for non-gas planets. No intermediate height readback.
 */
export async function gpuBakeFull(device, input, onProgress, signal) {
    const params = clampParams(input);
    if (params.planetClass === "gas") {
        throw new Error("gpuBakeFull is for non-gas; use gas CPU path");
    }
    const W = params.resolution;
    const H = Math.max(1, Math.floor(W / 2));
    const nPix = W * H;
    const report = onProgress ?? (() => { });
    const byteF32 = nPix * 4;
    const byteU32 = nPix * 4;
    if (byteF32 > device.limits.maxStorageBufferBindingSize) {
        throw new Error(`Buffer ${byteF32} exceeds maxStorageBufferBindingSize`);
    }
    throwIfBakeAborted(signal);
    const drops = scaledHydraulicDrops(params, W, H);
    const maxSteps = W >= 4096 ? 12 : W >= 2048 ? 16 : 20;
    const thermalN = Math.min(params.thermalIters, 8);
    const talus = 0.014 + 3 / W;
    const spIters = W >= 2048 ? 2 : 3;
    const blendCols = Math.max(2, Math.floor(W / 128));
    const meter = createStageMeter(device, report, signal);
    report("gpu full setup", 0.02);
    device.pushErrorScope("validation");
    // Three modules → three layouts, each ≤8 storage (WebGPU per-stage limit).
    const modTerrain = device.createShaderModule({
        label: "planet-full-bake-terrain",
        code: PLANET_FULL_BAKE_TERRAIN_WGSL,
    });
    const modProduct = device.createShaderModule({
        label: "planet-full-bake-product",
        code: PLANET_FULL_BAKE_PRODUCT_WGSL,
    });
    const modHydro = device.createShaderModule({
        label: "planet-full-bake-hydro",
        code: PLANET_FULL_BAKE_HYDRO_WGSL,
    });
    const storage = (binding, readOnly = false) => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
            type: readOnly ? "read-only-storage" : "storage",
        },
    });
    const uniform = {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "uniform" },
    };
    const terrainLayout = device.createBindGroupLayout({
        label: "full-bake-terrain",
        entries: [
            uniform,
            storage(1, true),
            storage(2),
            storage(3),
            storage(4),
            storage(5),
            storage(6),
            storage(7),
        ],
    });
    // product: uniform + luts + height + 5 RGBA maps = 7 storage
    const productLayout = device.createBindGroupLayout({
        label: "full-bake-product",
        entries: [
            uniform,
            storage(1, true),
            storage(2, true),
            storage(3),
            storage(4),
            storage(5),
            storage(6),
            storage(7),
        ],
    });
    // hydro: uniform + height + drops + atomics = 3 storage
    const hydroLayout = device.createBindGroupLayout({
        label: "full-bake-hydro",
        entries: [uniform, storage(1), storage(2), storage(3)],
    });
    const pipeLayoutTerrain = device.createPipelineLayout({
        bindGroupLayouts: [terrainLayout],
    });
    const pipeLayoutProduct = device.createPipelineLayout({
        bindGroupLayouts: [productLayout],
    });
    const pipeLayoutHydro = device.createPipelineLayout({
        bindGroupLayouts: [hydroLayout],
    });
    const pipesT = mkPipes(device, modTerrain, pipeLayoutTerrain, [
        "cs_height",
        "cs_structure_compose",
        "cs_enforce_mask",
        "cs_enforce_mask_hard",
        "cs_reduce_minmax",
        "cs_finalize_minmax",
        "cs_normalize",
        "cs_soft_contrast",
        "cs_soft_coast",
        "cs_copy_b_to_a",
        "cs_thermal",
        "cs_uplift",
        "cs_stream_flow_init",
        "cs_stream_flow_sweep",
        "cs_stream_flow_merge",
        "cs_stream_erode",
        "cs_reinject_peaks",
        "cs_seal_seam",
    ]);
    const pipesP = mkPipes(device, modProduct, pipeLayoutProduct, [
        "cs_paint",
        "cs_normal",
        "cs_flatten_liquid_normals",
        "cs_height_gray",
        "cs_clouds",
    ]);
    const pipesH = mkPipes(device, modHydro, pipeLayoutHydro, [
        "cs_hydro_init_drops",
        "cs_hydro_clear_delta",
        "cs_hydro_step",
        "cs_hydro_apply_delta",
    ]);
    const { cosLon, sinLon, cosLat, sinLat } = buildSphereLuts(W, H);
    const lutData = new Float32Array(W * 2 + H * 2);
    lutData.set(cosLon, 0);
    lutData.set(sinLon, W);
    lutData.set(cosLat, W * 2);
    lutData.set(sinLat, W * 2 + H);
    /** Live GPU buffers — destroyed as phases finish to cap peak VRAM. */
    const live = new Set();
    const track = (b) => {
        live.add(b);
        return b;
    };
    const freeBuf = (b) => {
        if (!b)
            return;
        try {
            b.destroy();
        }
        catch {
            /* */
        }
        live.delete(b);
    };
    const freeAll = () => {
        for (const b of [...live])
            freeBuf(b);
    };
    const alloc = (size, usage, label) => track(makeBuf(device, size, usage, label));
    // Tiny placeholders so terrain bind group stays valid when stream scratch is free
    const tinyUsage = GPUBufferUsage.STORAGE;
    let upliftBuf = alloc(4, tinyUsage, "uplift-tiny");
    let flowBuf = alloc(4, tinyUsage, "flow-tiny");
    let flowAdd = alloc(4, tinyUsage, "flowAdd-tiny");
    const uniformBuf = alloc(UNIFORM_BYTES, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, "full-bake-params");
    const lutBuf = alloc(lutData.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, "sphere-luts");
    device.queue.writeBuffer(lutBuf, 0, lutData);
    // Core height + mask ping-pong: both need COPY_DST — host uploads
    // elevation prior → heightA and land mask → heightB (structure path).
    const heightUsage = GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST;
    let heightA = alloc(byteF32, heightUsage, "heightA");
    let heightB = alloc(byteF32, heightUsage, "heightB");
    const reduceThreads = Math.ceil(nPix / 256);
    let reduceBuf = alloc(Math.max(16, (2 + reduceThreads * 2) * 4), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, "reduce");
    const writeU = (stepIdx = 0, workOffset = 0) => writeParams(device, uniformBuf, params, W, H, {
        talus,
        hydroDrops: drops,
        hydroMaxSteps: maxSteps,
        blendCols,
        hydroStepIdx: stepIdx,
        normalStrength: 14,
        workOffset,
    });
    writeU(0, 0);
    const makeTerrainBg = () => device.createBindGroup({
        layout: terrainLayout,
        entries: [
            { binding: 0, resource: { buffer: uniformBuf } },
            { binding: 1, resource: { buffer: lutBuf } },
            { binding: 2, resource: { buffer: heightA } },
            { binding: 3, resource: { buffer: heightB } },
            { binding: 4, resource: { buffer: reduceBuf } },
            { binding: 5, resource: { buffer: upliftBuf } },
            { binding: 6, resource: { buffer: flowBuf } },
            { binding: 7, resource: { buffer: flowAdd } },
        ],
    });
    let bgTerrain = makeTerrainBg();
    const gx = Math.ceil(W / 8);
    const gy = Math.ceil(H / 8);
    // Host-side pipeline/buffer setup (no GPU fence yet)
    meter.wall("setup", 0.05);
    try {
        // ── Phase 1: full-res host topology + GPU structure-first height ──
        // Continents/mask/prior at bake resolution (incl. 8K). Micro height +
        // soft-coast + drainage stay GPU (not full generateBaseHeight FBM stack).
        report("structure", 0.04);
        const structMaps = buildStructureMapsForBake(params, W, H);
        const priorUpload = new Float32Array(nPix);
        const maskUpload = new Float32Array(nPix);
        priorUpload.set(structMaps.elevationPrior);
        for (let i = 0; i < nPix; i++) {
            maskUpload[i] = structMaps.landMask[i] ? 1 : 0;
        }
        // heightA = elevation prior; heightB = land mask (for compose + enforce)
        device.queue.writeBuffer(heightA, 0, priorUpload);
        device.queue.writeBuffer(heightB, 0, maskUpload);
        meter.wall("structure-host", 0.08);
        report("structure", 0.09);
        writeU(0, 0);
        bgTerrain = makeTerrainBg();
        dispatch2d(device, pipesT.get("cs_structure_compose"), bgTerrain, gx, gy);
        // Mild soft-coast (wide band + several Jacobi) then soft re-lock silhouette
        for (let sc = 0; sc < 4; sc++) {
            dispatch2d(device, pipesT.get("cs_soft_coast"), bgTerrain, gx, gy);
            dispatch2d(device, pipesT.get("cs_copy_b_to_a"), bgTerrain, gx, gy);
        }
        device.queue.writeBuffer(heightB, 0, maskUpload);
        dispatch2d(device, pipesT.get("cs_enforce_mask"), bgTerrain, gx, gy);
        await meter.fence("structure", 0.2);
        // ── Phase 2: GPU thermal ──
        report("thermal", 0.22);
        for (let t = 0; t < thermalN; t++) {
            dispatch2d(device, pipesT.get("cs_thermal"), bgTerrain, gx, gy);
            dispatch2d(device, pipesT.get("cs_copy_b_to_a"), bgTerrain, gx, gy);
        }
        // Preserve silhouettes after thermal
        device.queue.writeBuffer(heightB, 0, maskUpload);
        dispatch2d(device, pipesT.get("cs_enforce_mask"), bgTerrain, gx, gy);
        await meter.fence("thermal", 0.28);
        // ── Phase 3: GPU stream-power drainage (multi-pass; no host priority-flood) ──
        report("drainage", 0.3);
        freeBuf(upliftBuf);
        freeBuf(flowBuf);
        freeBuf(flowAdd);
        upliftBuf = alloc(byteF32, GPUBufferUsage.STORAGE, "uplift");
        flowBuf = alloc(byteF32, GPUBufferUsage.STORAGE, "flow");
        flowAdd = alloc(byteF32, GPUBufferUsage.STORAGE, "flowAdd");
        bgTerrain = makeTerrainBg();
        writeU(0, 0);
        dispatch2d(device, pipesT.get("cs_uplift"), bgTerrain, gx, gy);
        const drainIters = W >= 4096 ? 3 : W >= 2048 ? 4 : 5;
        const flowSweeps = W >= 4096 ? 5 : 6;
        for (let s = 0; s < drainIters; s++) {
            dispatch2d(device, pipesT.get("cs_stream_flow_init"), bgTerrain, gx, gy);
            for (let sweep = 0; sweep < flowSweeps; sweep++) {
                dispatch2d(device, pipesT.get("cs_stream_flow_sweep"), bgTerrain, gx, gy);
                dispatch2d(device, pipesT.get("cs_stream_flow_merge"), bgTerrain, gx, gy);
            }
            dispatch2d(device, pipesT.get("cs_stream_erode"), bgTerrain, gx, gy);
            dispatch2d(device, pipesT.get("cs_copy_b_to_a"), bgTerrain, gx, gy);
        }
        device.queue.writeBuffer(heightB, 0, maskUpload);
        dispatch2d(device, pipesT.get("cs_enforce_mask"), bgTerrain, gx, gy);
        await meter.fence("drainage", 0.4);
        // Drop stream scratch before hydraulic (VRAM)
        freeBuf(upliftBuf);
        freeBuf(flowBuf);
        freeBuf(flowAdd);
        upliftBuf = alloc(4, tinyUsage, "uplift-tiny");
        flowBuf = alloc(4, tinyUsage, "flow-tiny");
        flowAdd = alloc(4, tinyUsage, "flowAdd-tiny");
        bgTerrain = makeTerrainBg();
        // ── Phase 4: hydraulic (drop + delta only while needed) ──
        report("hydraulic", 0.42);
        let dropState = null;
        let deltaAtomic = null;
        if (drops > 0) {
            const dropBytes = Math.max(32, drops * 8 * 4);
            dropState = alloc(dropBytes, GPUBufferUsage.STORAGE, "dropState");
            deltaAtomic = alloc(byteU32, GPUBufferUsage.STORAGE, "deltaAtomic");
            const bgHydro = device.createBindGroup({
                layout: hydroLayout,
                entries: [
                    { binding: 0, resource: { buffer: uniformBuf } },
                    { binding: 1, resource: { buffer: heightA } },
                    { binding: 2, resource: { buffer: dropState } },
                    { binding: 3, resource: { buffer: deltaAtomic } },
                ],
            });
            // Chunked 1D: workgroup count must stay ≤ 65535 (fails at 8K nPix without this)
            const setOff = (off) => writeU(0, off);
            dispatch1d(device, pipesH.get("cs_hydro_init_drops"), bgHydro, drops, setOff);
            for (let step = 0; step < maxSteps; step++) {
                dispatch1d(device, pipesH.get("cs_hydro_clear_delta"), bgHydro, nPix, (off) => writeU(step, off));
                dispatch1d(device, pipesH.get("cs_hydro_step"), bgHydro, drops, (off) => writeU(step, off));
                dispatch2d(device, pipesH.get("cs_hydro_apply_delta"), bgHydro, gx, gy);
            }
            // Do NOT min-max renorm after structure height — keeps liquidLevel band
        }
        await meter.fence("hydraulic", 0.52);
        freeBuf(dropState);
        freeBuf(deltaAtomic);
        dropState = null;
        deltaAtomic = null;
        // ── Phase 4: reinject + mild soft-coast + seal; free ping-pong B + reduce ──
        report("reinject", 0.54);
        dispatch2d(device, pipesT.get("cs_reinject_peaks"), bgTerrain, gx, gy);
        // Mild soft-coast after reinject (wide band), then re-lock silhouette
        for (let sc = 0; sc < 4; sc++) {
            dispatch2d(device, pipesT.get("cs_soft_coast"), bgTerrain, gx, gy);
            dispatch2d(device, pipesT.get("cs_copy_b_to_a"), bgTerrain, gx, gy);
        }
        dispatch2d(device, pipesT.get("cs_seal_seam"), bgTerrain, gx, gy);
        dispatch2d(device, pipesT.get("cs_copy_b_to_a"), bgTerrain, gx, gy);
        device.queue.writeBuffer(heightB, 0, maskUpload);
        dispatch2d(device, pipesT.get("cs_enforce_mask"), bgTerrain, gx, gy);
        // Soft re-lock (not razor hard) so mild coast band survives paint
        await meter.fence("reinject", 0.58);
        freeBuf(heightB);
        heightB = alloc(4, tinyUsage, "heightB-tiny");
        freeBuf(reduceBuf);
        reduceBuf = alloc(4, tinyUsage, "reduce-tiny");
        bgTerrain = makeTerrainBg();
        // ── Phase 5: product maps (only after terrain scratch is gone) ──
        const albedoBuf = alloc(byteU32, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, "albedo");
        const normalBuf = alloc(byteU32, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, "normal");
        const liquidBuf = alloc(byteU32, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, "liquid");
        const heightRgbaBuf = alloc(byteU32, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, "heightRgba");
        const cloudBuf = alloc(byteU32, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, "cloud");
        const bgProduct = device.createBindGroup({
            layout: productLayout,
            entries: [
                { binding: 0, resource: { buffer: uniformBuf } },
                { binding: 1, resource: { buffer: lutBuf } },
                { binding: 2, resource: { buffer: heightA } },
                { binding: 3, resource: { buffer: albedoBuf } },
                { binding: 4, resource: { buffer: normalBuf } },
                { binding: 5, resource: { buffer: liquidBuf } },
                { binding: 6, resource: { buffer: heightRgbaBuf } },
                { binding: 7, resource: { buffer: cloudBuf } },
            ],
        });
        report("paint", 0.6);
        dispatch2d(device, pipesP.get("cs_paint"), bgProduct, gx, gy);
        await meter.fence("paint", 0.7);
        report("normals", 0.72);
        dispatch2d(device, pipesP.get("cs_normal"), bgProduct, gx, gy);
        // Flatten open water only — lava rivers keep height relief for normal correlation
        if (params.liquidKind !== "none" && params.liquidKind !== "lava") {
            dispatch2d(device, pipesP.get("cs_flatten_liquid_normals"), bgProduct, gx, gy);
        }
        dispatch2d(device, pipesP.get("cs_height_gray"), bgProduct, gx, gy);
        await meter.fence("normals", 0.78);
        report("clouds", 0.8);
        dispatch2d(device, pipesP.get("cs_clouds"), bgProduct, gx, gy);
        await meter.fence("clouds", 0.84);
        const err = await device.popErrorScope();
        if (err)
            throw new Error(`GPU full bake validation: ${err.message}`);
        // ── Sequential readback: one map at a time, free GPU buffer after each ──
        report("readback", 0.86);
        const heightRaw = await readGpuBuffer(device, heightA, 0, byteF32);
        freeBuf(heightA);
        const albedoRaw = await readGpuBuffer(device, albedoBuf, 0, byteU32);
        freeBuf(albedoBuf);
        const normalRaw = await readGpuBuffer(device, normalBuf, 0, byteU32);
        freeBuf(normalBuf);
        const liquidRaw = await readGpuBuffer(device, liquidBuf, 0, byteU32);
        freeBuf(liquidBuf);
        const heightRgbaRaw = await readGpuBuffer(device, heightRgbaBuf, 0, byteU32);
        freeBuf(heightRgbaBuf);
        const cloudRaw = await readGpuBuffer(device, cloudBuf, 0, byteU32);
        freeBuf(cloudBuf);
        // Remaining host/uniform scratch
        freeAll();
        meter.wall("readback", 0.9);
        // Host post: previously lumped into "poles" and looked like 30s+ poles —
        // soft-ocean alone can dominate at 4K/8K if mis-attributed.
        const heightData = new Float32Array(heightRaw);
        const albedo = unpackRgba8(new Uint32Array(albedoRaw), nPix);
        const normalRgba = unpackRgba8(new Uint32Array(normalRaw), nPix);
        const liquidMask = unpackRgba8(new Uint32Array(liquidRaw), nPix);
        const heightRgba = unpackRgba8(new Uint32Array(heightRgbaRaw), nPix);
        const cloudRgba = unpackRgba8(new Uint32Array(cloudRaw), nPix);
        meter.wall("unpack", 0.91);
        // Match CPU paint finish: liquid-only blur (skip lava — keep bright channels)
        if (params.liquidKind !== "lava") {
            softOceanAlbedo(albedo, liquidMask, W, H);
        }
        meter.wall("soft-ocean", 0.93);
        const heightMap = {
            width: W,
            height: H,
            data: heightData,
        };
        // Lava: host re-paint with drainage flow (GPU ridged flecks discarded)
        let normalOut = normalRgba;
        let heightRgbaOut = heightRgba;
        let liquidCount = 0;
        let albedoOut = albedo;
        let liquidOut = liquidMask;
        if (params.liquidKind === "lava") {
            const mats = paintSurface(heightMap, params);
            albedoOut = mats.albedo;
            liquidOut = mats.liquidMask;
            liquidCount = Math.round(mats.liquidFraction * nPix);
            carveLavaRiverHeight(heightMap, liquidOut, 0.05);
            normalOut = heightToNormalMap(heightMap, 14);
            heightRgbaOut = heightToGrayRgba(heightMap);
        }
        else {
            for (let i = 0; i < nPix; i++) {
                if (liquidMask[i * 4] > 127)
                    liquidCount++;
            }
        }
        const hasClouds = params.cloudCover > 0.01;
        // Pole product side scales with equirect res (poleProductSide inside rasterize)
        const poleNorth = rasterizePoleCap(albedoOut, W, H, params.poleSize, true);
        const poleSouth = rasterizePoleCap(albedoOut, W, H, params.poleSize, false);
        const cloudsBuf = hasClouds
            ? { width: W, height: H, rgba: cloudRgba }
            : null;
        const cloudPoles = rasterizeCloudPoleCaps(cloudsBuf, params.poleSize);
        meter.wall("poles", 0.96);
        const hs = heightStats(heightData);
        const landPeaks = countLandLocalMaxima(heightMap, params.liquidLevel);
        const layers = effectiveLayerTally(params);
        meter.wall("stats", 0.99);
        const totalMs = meter.total();
        const set = {
            params,
            albedo: { width: W, height: H, rgba: albedoOut },
            height: { width: W, height: H, rgba: heightRgbaOut },
            normal: { width: W, height: H, rgba: normalOut },
            liquidMask: { width: W, height: H, rgba: liquidOut },
            clouds: cloudsBuf,
            poleNorth,
            poleSouth,
            cloudsPoleNorth: cloudPoles.poleNorth,
            cloudsPoleSouth: cloudPoles.poleSouth,
            stats: {
                liquidFraction: liquidCount / nPix,
                albedoVariance: albedoVariance(albedoOut),
                heightMin: hs.min,
                heightMax: hs.max,
                heightMean: hs.mean,
                landLocalMaxima: landPeaks,
                effectiveLayers: layers,
                stageMs: { ...meter.stageMs },
                totalMs,
            },
        };
        report(`done ${totalMs}ms · ${formatStageMs(meter.stageMs, 4)}`, 1);
        return set;
    }
    catch (e) {
        freeAll();
        throw e;
    }
}
/**
 * Full-fidelity bake: GPU multi-pass when device provided (non-gas).
 * No silent product CPU fallback — pass `device: null` only for Node
 * gpu-cpu-ref / smoke (sequential pure-JS bake).
 */
export async function bakePlanetTexturesGpu(device, input, onProgress) {
    const opts = typeof onProgress === "function" || onProgress == null
        ? { onProgress: onProgress }
        : onProgress;
    const report = opts.onProgress ?? (() => { });
    const signal = opts.signal ?? null;
    const params = clampParams(input);
    throwIfBakeAborted(signal);
    if (!device) {
        // Explicit Node/test path only — not the browser product default
        return bakePlanetTexturesGpuCpuRef(params, report);
    }
    // Gas: sequential gas field (no dual GPU gas solver)
    if (params.planetClass === "gas") {
        throwIfBakeAborted(signal);
        report("gas field", 0.05);
        const W = params.resolution;
        const H = Math.max(1, Math.floor(W / 2));
        const gas = generateGasField(params.seed, W, H, params.bandStrength, params.stormDensity, params.warp);
        sealEquirectSeam(gas.flow, 2);
        if (gas.storms)
            sealEquirectSeam(gas.storms, 2);
        throwIfBakeAborted(signal);
        return completeBakeFromHeight(gas.flow, params, gas.storms, report, true);
    }
    return gpuBakeFull(device, params, report, signal);
}
/** True when stageMs came from fenced GPU multi-pass. */
export function isGpuStageTiming(stats) {
    if (!stats?.stageMs)
        return false;
    return (typeof stats.stageMs.setup === "number" ||
        typeof stats.stageMs.readback === "number");
}
/**
 * Product bake entry: WebGPU full multi-pass when available.
 * `device === null` → Node/test sequential path (gpu-cpu-ref).
 * Missing WebGPU without explicit null throws (no silent CPU product path).
 */
export async function bakePlanetTexturesAuto(input, onProgress, device) {
    const opts = typeof onProgress === "function" || onProgress == null
        ? { onProgress: onProgress }
        : onProgress;
    const report = opts.onProgress;
    const signal = opts.signal ?? null;
    throwIfBakeAborted(signal);
    if (device === null) {
        const set = bakePlanetTexturesGpuCpuRef(input, report);
        return { set, backend: "gpu-cpu-ref" };
    }
    if (device || isWebGpuBakeAvailable()) {
        throwIfBakeAborted(signal);
        const dev = device ?? (await requestPlanetBakeDevice());
        try {
            throwIfBakeAborted(signal);
            const set = await bakePlanetTexturesGpu(dev, input, {
                onProgress: report,
                signal,
                skipReadback: opts.skipReadback,
            });
            return { set, backend: "webgpu-full" };
        }
        finally {
            if (!device) {
                try {
                    dev.destroy();
                }
                catch {
                    /* */
                }
            }
        }
    }
    throw new Error("WebGPU required for planet bake (no CPU product fallback). " +
        "Use Chromium with WebGPU, or pass device:null for Node gpu-cpu-ref tests.");
}
export function hashAlbedo(set) {
    const r = set.albedo.rgba;
    let h = 2166136261 >>> 0;
    for (let i = 0; i < r.length; i++) {
        h ^= r[i];
        h = Math.imul(h, 16777619) >>> 0;
    }
    return (h >>> 0).toString(16).padStart(8, "0");
}
//# sourceMappingURL=bake-gpu.js.map