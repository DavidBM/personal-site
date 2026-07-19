/**
 * WebGPU device bootstrap (F2).
 *
 * Chromium-first. Fail loud when adapter/device cannot be created.
 * Does not construct Three; map/fleet layers will bind to this later.
 */
const DEFAULT_CLEAR = { r: 0, g: 0, b: 21 / 255, a: 1 }; // 0x000015
/** Parse pipe-separated usage hints into GPUBufferUsage bits. */
export function parseGpuBufferUsage(usage) {
    if (usage == null || usage.trim() === "") {
        return GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX;
    }
    let bits = 0;
    for (const raw of usage.split("|")) {
        const key = raw.trim().toLowerCase().replace(/-/g, "_");
        if (!key)
            continue;
        switch (key) {
            case "vertex":
                bits |= GPUBufferUsage.VERTEX;
                break;
            case "index":
                bits |= GPUBufferUsage.INDEX;
                break;
            case "uniform":
                bits |= GPUBufferUsage.UNIFORM;
                break;
            case "storage":
                bits |= GPUBufferUsage.STORAGE;
                break;
            case "copy_src":
                bits |= GPUBufferUsage.COPY_SRC;
                break;
            case "copy_dst":
                bits |= GPUBufferUsage.COPY_DST;
                break;
            case "map_read":
                bits |= GPUBufferUsage.MAP_READ;
                break;
            case "map_write":
                bits |= GPUBufferUsage.MAP_WRITE;
                break;
            case "indirect":
                bits |= GPUBufferUsage.INDIRECT;
                break;
            case "query_resolve":
                bits |= GPUBufferUsage.QUERY_RESOLVE;
                break;
            default:
                throw new Error(`Unknown GPU buffer usage flag: "${raw.trim()}"`);
        }
    }
    if (bits === 0) {
        return GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX;
    }
    return bits;
}
/**
 * Feature-detect WebGPU in this environment (sync).
 * Does not request an adapter (that is async).
 */
export function isWebGpuAvailable() {
    return typeof navigator !== "undefined" && !!navigator.gpu;
}
/**
 * Request adapter + device + canvas context. Throws on any failure.
 */
export async function createWebGpuBootstrap(options) {
    if (!navigator.gpu) {
        throw new Error("Galaxy requires WebGPU. This browser has no navigator.gpu (Chromium-class browser required).");
    }
    const adapter = await navigator.gpu.requestAdapter({
        powerPreference: options.powerPreference ?? "high-performance",
    });
    if (!adapter) {
        throw new Error("Galaxy requires WebGPU. requestAdapter() returned null (GPU blocked or unsupported).");
    }
    // Default maxStorageBufferBindingSize is often 128 MiB; trail line buffers at
    // high ship caps exceed that. Request the adapter's full limits when larger.
    const label = options.label ?? "galaxy-webgpu";
    const requiredLimits = buildRequiredLimits(adapter);
    let device;
    try {
        device = await adapter.requestDevice({
            label,
            requiredLimits,
        });
    }
    catch (err) {
        // Some stacks reject partial limit bags — fall back to defaults, then clamp allocs.
        console.warn("[WebGPU] requestDevice with raised limits failed; retrying defaults.", err);
        try {
            device = await adapter.requestDevice({ label });
        }
        catch (err2) {
            const msg = err2 instanceof Error ? err2.message : String(err2);
            throw new Error(`Galaxy requires WebGPU. requestDevice() failed: ${msg}`);
        }
    }
    const limits = {
        maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
        maxBufferSize: device.limits.maxBufferSize,
    };
    if (requiredLimits.maxStorageBufferBindingSize != null) {
        console.info(`[WebGPU] maxStorageBufferBindingSize=${limits.maxStorageBufferBindingSize} ` +
            `(adapter max ${adapter.limits.maxStorageBufferBindingSize})`);
    }
    const bootstrapState = {
        isLost: false,
    };
    device.lost.then((info) => {
        bootstrapState.isLost = true;
        console.error(`[WebGPU] device lost (${info.reason}): ${info.message}. Reload required.`);
        options.onDeviceLost?.({ reason: info.reason, message: info.message });
    });
    const context = options.canvas.getContext("webgpu");
    if (!context) {
        device.destroy();
        throw new Error('Galaxy requires WebGPU. canvas.getContext("webgpu") returned null.');
    }
    const format = navigator.gpu.getPreferredCanvasFormat();
    const clearColor = options.clearColor ?? DEFAULT_CLEAR;
    let nextBufferId = 1;
    const buffers = new Map();
    const gpu = {
        createBuffer(params) {
            if (bootstrapState.isLost) {
                throw new Error("createBuffer: device is lost");
            }
            const usage = parseGpuBufferUsage(params.usage);
            let buffer;
            try {
                buffer = device.createBuffer({
                    label: params.label,
                    size: params.size,
                    usage,
                });
            }
            catch (err) {
                // OOM / invalid size often surfaces as device loss shortly after.
                bootstrapState.isLost = true;
                throw err;
            }
            const id = nextBufferId++;
            buffers.set(id, buffer);
            return { id, byteLength: params.size };
        },
        getBuffer(handle) {
            const buffer = buffers.get(handle.id);
            if (!buffer) {
                throw new Error(`getBuffer: unknown buffer id ${handle.id}`);
            }
            return buffer;
        },
        writeBuffer(handle, bufferOffsetBytes, data, dataOffsetBytes = 0, sizeBytes) {
            if (bootstrapState.isLost) {
                // Soft no-op: bulk reserve / trail dead-init must not throw through
                // App handlers and abort the whole generateFleetsBulk turn.
                return;
            }
            const buffer = buffers.get(handle.id);
            if (!buffer) {
                throw new Error(`writeBuffer: unknown buffer id ${handle.id}`);
            }
            const byteLength = sizeBytes ?? data.byteLength - dataOffsetBytes;
            if (bufferOffsetBytes < 0 || dataOffsetBytes < 0 || byteLength < 0) {
                throw new Error("writeBuffer: negative offset or size");
            }
            if (bufferOffsetBytes % 4 !== 0 ||
                dataOffsetBytes % 4 !== 0 ||
                byteLength % 4 !== 0) {
                throw new Error(`writeBuffer: offsets/size must be multiples of 4 (offset=${bufferOffsetBytes}, dataOffset=${dataOffsetBytes}, size=${byteLength})`);
            }
            if (bufferOffsetBytes + byteLength > handle.byteLength) {
                throw new Error(`writeBuffer: range [${bufferOffsetBytes}, ${bufferOffsetBytes + byteLength}) exceeds buffer size ${handle.byteLength}`);
            }
            if (dataOffsetBytes + byteLength > data.byteLength) {
                throw new Error(`writeBuffer: range exceeds data view (dataOffset=${dataOffsetBytes}, size=${byteLength}, data.byteLength=${data.byteLength})`);
            }
            device.queue.writeBuffer(buffer, bufferOffsetBytes, data.buffer, data.byteOffset + dataOffsetBytes, byteLength);
        },
        destroyBuffer(handle) {
            const buffer = buffers.get(handle.id);
            if (!buffer)
                return;
            buffer.destroy();
            buffers.delete(handle.id);
        },
        destroy() {
            for (const buffer of buffers.values())
                buffer.destroy();
            buffers.clear();
            // Context must be unconfigured before device.destroy per WebGPU rules.
            try {
                context.unconfigure();
            }
            catch {
                /* ignore if already unconfigured */
            }
            bootstrapState.isLost = true;
            device.destroy();
        },
    };
    const configureContext = (cssWidth, cssHeight) => {
        if (bootstrapState.isLost)
            return;
        const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        const w = Math.max(1, Math.floor(cssWidth * dpr));
        const h = Math.max(1, Math.floor(cssHeight * dpr));
        options.canvas.width = w;
        options.canvas.height = h;
        context.configure({
            device,
            format,
            alphaMode: "opaque",
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
    };
    configureContext(options.canvas.clientWidth || options.canvas.width || 1, options.canvas.clientHeight || options.canvas.height || 1);
    const destroy = () => {
        gpu.destroy();
    };
    const bootstrap = {
        adapter,
        device,
        context,
        format,
        clearColor,
        gpu,
        limits,
        get isLost() {
            return bootstrapState.isLost;
        },
        configureContext,
        destroy,
    };
    return bootstrap;
}
/**
 * Raise storage/buffer limits to what this adapter allows so large trail/ship
 * storage buffers can bind. Never request above adapter.limits.
 */
function buildRequiredLimits(adapter) {
    const out = {};
    const a = adapter.limits;
    // Chromium default storage binding is 128 MiB (134217728).
    const DEFAULT_STORAGE = 134217728;
    const DEFAULT_BUFFER = 268435456;
    if (a.maxStorageBufferBindingSize > DEFAULT_STORAGE) {
        out.maxStorageBufferBindingSize = a.maxStorageBufferBindingSize;
    }
    if (a.maxBufferSize > DEFAULT_BUFFER) {
        out.maxBufferSize = a.maxBufferSize;
    }
    return out;
}
/**
 * Encode a single clear pass to the current canvas texture (smoke / idle frame).
 */
export function clearWebGpuFrame(bootstrap) {
    if (bootstrap.isLost)
        return;
    const texture = bootstrap.context.getCurrentTexture();
    const view = texture.createView();
    const encoder = bootstrap.device.createCommandEncoder({
        label: "galaxy-clear",
    });
    const pass = encoder.beginRenderPass({
        colorAttachments: [
            {
                view,
                clearValue: bootstrap.clearColor,
                loadOp: "clear",
                storeOp: "store",
            },
        ],
    });
    pass.end();
    bootstrap.device.queue.submit([encoder.finish()]);
}
//# sourceMappingURL=device.js.map