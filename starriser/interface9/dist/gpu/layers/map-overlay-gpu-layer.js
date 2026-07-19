/**
 * M4 — WebGPU overlay draw for map fills (+ optional thin line-list).
 * Live map path uses fat Line2 (`WebGpuMapView.overlayLines`) for rings/axes;
 * this layer owns triangle-list plane fills (and keeps a line-list path for
 * tests / fallback). Grow-only vertex buffers; separate streams.
 */
import { MAP_MSAA_SAMPLES } from "../map-msaa.js";
import { MAP_OVERLAY_BYTES_PER_VERT, MAP_OVERLAY_UNIFORM_SIZE, MAP_OVERLAY_WGSL, } from "../shaders/map-overlay.wgsl.js";
const UNIFORM_SIZE = MAP_OVERLAY_UNIFORM_SIZE;
const BYTES_PER_VERT = MAP_OVERLAY_BYTES_PER_VERT;
export class MapOverlayGpuLayer {
    constructor(bootstrap) {
        this.name = "map-overlay";
        this.linePipeline = null;
        this.fillPipeline = null;
        this.uniformHandle = null;
        this.uniformBuffer = null;
        this.lineBindGroup = null;
        this.fillBindGroup = null;
        this.lineHandle = null;
        this.lineBuffer = null;
        this.lineCapacity = 0;
        this.lineCount = 0;
        this.fillHandle = null;
        this.fillBuffer = null;
        this.fillCapacity = 0;
        this.fillCount = 0;
        this.uniformData = new Float32Array(UNIFORM_SIZE / 4);
        this.bootstrap = bootstrap;
    }
    /**
     * Compile pipelines.
     * @param options.sampleCount Must match the map color pass (default {@link MAP_MSAA_SAMPLES}).
     */
    init(options) {
        const { device, format, gpu } = this.bootstrap;
        const sampleCount = options?.sampleCount ?? MAP_MSAA_SAMPLES;
        const module = device.createShaderModule({
            label: "map-overlay",
            code: MAP_OVERLAY_WGSL,
        });
        const vertexBuffers = [
            {
                arrayStride: BYTES_PER_VERT,
                stepMode: "vertex",
                attributes: [
                    { shaderLocation: 0, offset: 0, format: "float32x3" },
                    { shaderLocation: 1, offset: 12, format: "float32x4" },
                ],
            },
        ];
        const blend = {
            color: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
            },
            alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
            },
        };
        const fragment = {
            module,
            entryPoint: "fs_main",
            targets: [{ format, blend }],
        };
        this.linePipeline = device.createRenderPipeline({
            label: "map-overlay-lines",
            layout: "auto",
            vertex: {
                module,
                entryPoint: "vs_main",
                buffers: vertexBuffers,
            },
            fragment,
            primitive: { topology: "line-list" },
            multisample: { count: sampleCount },
        });
        this.fillPipeline = device.createRenderPipeline({
            label: "map-overlay-fills",
            layout: "auto",
            vertex: {
                module,
                entryPoint: "vs_main",
                buffers: vertexBuffers,
            },
            fragment,
            primitive: { topology: "triangle-list" },
            multisample: { count: sampleCount },
        });
        this.uniformHandle = gpu.createBuffer({
            label: "map-overlay-uniforms",
            size: UNIFORM_SIZE,
            usage: "uniform|copy_dst",
        });
        this.uniformBuffer = gpu.getBuffer(this.uniformHandle);
        // Separate auto-layout bind groups (one buffer; both pipelines use same WGSL uniforms).
        this.lineBindGroup = device.createBindGroup({
            label: "map-overlay-line-bind",
            layout: this.linePipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
        });
        this.fillBindGroup = device.createBindGroup({
            label: "map-overlay-fill-bind",
            layout: this.fillPipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
        });
    }
    destroyLineBuffer() {
        if (this.lineHandle) {
            this.bootstrap.gpu.destroyBuffer(this.lineHandle);
            this.lineHandle = null;
        }
        this.lineBuffer = null;
        this.lineCapacity = 0;
        this.lineCount = 0;
    }
    destroyFillBuffer() {
        if (this.fillHandle) {
            this.bootstrap.gpu.destroyBuffer(this.fillHandle);
            this.fillHandle = null;
        }
        this.fillBuffer = null;
        this.fillCapacity = 0;
        this.fillCount = 0;
    }
    /**
     * Upload line-list vertices (grow-only capacity).
     * `count` is vertex count (must be even for line pairs).
     */
    setLineVertices(data, count) {
        if (!this.linePipeline || !this.uniformHandle) {
            throw new Error("MapOverlayGpuLayer.init() required");
        }
        if (count <= 0) {
            this.destroyLineBuffer();
            return;
        }
        if (count > this.lineCapacity || !this.lineHandle) {
            const oldCap = this.lineCapacity;
            if (this.lineHandle) {
                this.bootstrap.gpu.destroyBuffer(this.lineHandle);
                this.lineHandle = null;
                this.lineBuffer = null;
            }
            const cap = Math.max(count, oldCap * 2 || 32);
            this.lineCapacity = cap;
            this.lineHandle = this.bootstrap.gpu.createBuffer({
                label: "map-overlay-lines",
                size: cap * BYTES_PER_VERT,
                usage: "vertex|copy_dst",
            });
            this.lineBuffer = this.bootstrap.gpu.getBuffer(this.lineHandle);
        }
        const bytes = count * BYTES_PER_VERT;
        this.bootstrap.gpu.writeBuffer(this.lineHandle, 0, data, 0, bytes);
        this.lineCount = count;
    }
    /**
     * Upload triangle-list vertices (grow-only capacity).
     * `count` is vertex count (multiple of 3).
     */
    setFillVertices(data, count) {
        if (!this.fillPipeline || !this.uniformHandle) {
            throw new Error("MapOverlayGpuLayer.init() required");
        }
        if (count <= 0) {
            this.destroyFillBuffer();
            return;
        }
        if (count > this.fillCapacity || !this.fillHandle) {
            const oldCap = this.fillCapacity;
            if (this.fillHandle) {
                this.bootstrap.gpu.destroyBuffer(this.fillHandle);
                this.fillHandle = null;
                this.fillBuffer = null;
            }
            const cap = Math.max(count, oldCap * 2 || 32);
            this.fillCapacity = cap;
            this.fillHandle = this.bootstrap.gpu.createBuffer({
                label: "map-overlay-fills",
                size: cap * BYTES_PER_VERT,
                usage: "vertex|copy_dst",
            });
            this.fillBuffer = this.bootstrap.gpu.getBuffer(this.fillHandle);
        }
        const bytes = count * BYTES_PER_VERT;
        this.bootstrap.gpu.writeBuffer(this.fillHandle, 0, data, 0, bytes);
        this.fillCount = count;
    }
    getLineVertexCount() {
        return this.lineCount;
    }
    getFillVertexCount() {
        return this.fillCount;
    }
    /** Clear both streams without disposing pipelines. */
    clear() {
        this.destroyLineBuffer();
        this.destroyFillBuffer();
    }
    /**
     * Encode line then fill draws into an open pass.
     * Fills first (under), then lines (on top) when both present.
     */
    encode(pass, viewProj, opacity = 1) {
        if (!this.uniformHandle)
            return;
        const hasLines = this.lineCount > 0 &&
            this.lineBuffer &&
            this.linePipeline &&
            this.lineBindGroup;
        const hasFills = this.fillCount > 0 &&
            this.fillBuffer &&
            this.fillPipeline &&
            this.fillBindGroup;
        if (!hasLines && !hasFills)
            return;
        this.uniformData.set(viewProj, 0);
        this.uniformData[16] = opacity;
        this.uniformData[17] = 0;
        this.uniformData[18] = 0;
        this.uniformData[19] = 0;
        this.bootstrap.gpu.writeBuffer(this.uniformHandle, 0, this.uniformData, 0, UNIFORM_SIZE);
        if (hasFills) {
            pass.setPipeline(this.fillPipeline);
            pass.setBindGroup(0, this.fillBindGroup);
            pass.setVertexBuffer(0, this.fillBuffer);
            pass.draw(this.fillCount, 1, 0, 0);
        }
        if (hasLines) {
            pass.setPipeline(this.linePipeline);
            pass.setBindGroup(0, this.lineBindGroup);
            pass.setVertexBuffer(0, this.lineBuffer);
            pass.draw(this.lineCount, 1, 0, 0);
        }
    }
    dispose() {
        this.destroyLineBuffer();
        this.destroyFillBuffer();
        if (this.uniformHandle) {
            this.bootstrap.gpu.destroyBuffer(this.uniformHandle);
            this.uniformHandle = null;
        }
        this.uniformBuffer = null;
        this.linePipeline = null;
        this.fillPipeline = null;
        this.lineBindGroup = null;
        this.fillBindGroup = null;
    }
}
/** Re-export stride for callers that only import the layer. */
export { MAP_OVERLAY_BYTES_PER_VERT, MAP_OVERLAY_FLOATS_PER_VERT, } from "../shaders/map-overlay.wgsl.js";
//# sourceMappingURL=map-overlay-gpu-layer.js.map