/**
 * WebGPU device bootstrap (F2).
 *
 * Chromium-first. Fail loud when adapter/device cannot be created.
 * Does not construct Three; map/fleet layers will bind to this later.
 */
import { createGpuBufferDevice } from "./device-buffers.js";
import { buildRequiredLimits, requestDeviceWithFallback } from "./device-request.js";
export { parseGpuBufferUsage } from "./device-buffers.js";
const DEFAULT_CLEAR = { r: 0, g: 0, b: 21 / 255, a: 1 }; // 0x000015
function initialSurfaceSize(canvas) {
    return {
        width: ("clientWidth" in canvas ? canvas.clientWidth : 0) || canvas.width || 1,
        height: ("clientHeight" in canvas ? canvas.clientHeight : 0) || canvas.height || 1,
    };
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
    const requiredLimits = buildRequiredLimits(adapter);
    const device = await requestDeviceWithFallback(adapter, options.label ?? "galaxy-webgpu");
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
    const gpu = createGpuBufferDevice(device, context, bootstrapState);
    const configureContext = (cssWidth, cssHeight, pixelRatio) => {
        if (bootstrapState.isLost)
            return;
        const browserDpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
        const dpr = pixelRatio ?? options.pixelRatio ?? browserDpr;
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
    const initialSize = initialSurfaceSize(options.canvas);
    configureContext(initialSize.width, initialSize.height);
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