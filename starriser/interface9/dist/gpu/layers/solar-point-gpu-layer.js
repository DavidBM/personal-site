/**
 * M1 — WebGPU solar-system point draw (billboard quads from SolarPointStore).
 *
 * CPU packing lives in SolarPointStore; this layer only uploads + encodes draws.
 * Buffers are created via bootstrap.gpu (usage hints + getBuffer) so destroy is
 * consistent with the device façade.
 *
 * Point size: CPU passes `worldScale` (half-extent for ~constant screen px).
 */
import { MAP_MSAA_SAMPLES } from "../map-msaa.js";
import { SOLAR_POINTS_BILLBOARD_WGSL } from "../shaders/solar-points.wgsl.js";
import { SOLAR_POINT_UNIFORM_BYTES as UNIFORM_SIZE, SOLAR_POINT_INSTANCE_FLOATS as FLOATS_PER_INSTANCE, packSolarPointInstanceRange, packSolarPointUniforms, } from "../solar-point-pack.js";
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;
function dirtyInstanceRange(state, count) {
    if (state.kind === "clean")
        return [count, 0];
    if (state.kind === "full")
        return [0, count];
    return [
        Math.floor(state.start / 3),
        Math.min(count, Math.ceil((state.start + state.count) / 3)),
    ];
}
function pendingInstanceRange(store, count, capacityChanged) {
    if (capacityChanged)
        return [0, count];
    const positionRange = dirtyInstanceRange(store.positionDirty, count);
    const colorRange = dirtyInstanceRange(store.colorDirty, count);
    const start = Math.min(positionRange[0], colorRange[0]);
    const end = Math.max(positionRange[1], colorRange[1]);
    return end > start ? [start, end - start] : null;
}
export class SolarPointGpuLayer {
    constructor(bootstrap) {
        this.name = "solar-points";
        this.pipeline = null;
        this.uniformHandle = null;
        this.instanceHandle = null;
        this.uniformBuffer = null;
        this.instanceBuffer = null;
        this.instanceCapacity = 0;
        this.bindGroup = null;
        this.uniformData = new Float32Array(UNIFORM_SIZE / 4);
        this.interleave = new Float32Array(0);
        this.bootstrap = bootstrap;
    }
    /**
     * Compile pipeline (call once after device ready).
     * @param options.sampleCount Must match the map color pass (default {@link MAP_MSAA_SAMPLES}).
     */
    init(options) {
        const { device, format, gpu } = this.bootstrap;
        const sampleCount = options?.sampleCount ?? MAP_MSAA_SAMPLES;
        const module = device.createShaderModule({
            label: "solar-points-billboard",
            code: SOLAR_POINTS_BILLBOARD_WGSL,
        });
        this.pipeline = device.createRenderPipeline({
            label: "solar-points-pipeline",
            layout: "auto",
            vertex: {
                module,
                entryPoint: "vs_main",
                buffers: [
                    {
                        arrayStride: BYTES_PER_INSTANCE,
                        stepMode: "instance",
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: "float32x3" },
                            { shaderLocation: 1, offset: 12, format: "float32x3" },
                            { shaderLocation: 2, offset: 24, format: "float32x3" },
                        ],
                    },
                ],
            },
            fragment: {
                module,
                entryPoint: "fs_main",
                targets: [
                    {
                        format,
                        blend: {
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
                        },
                    },
                ],
            },
            primitive: { topology: "triangle-list" },
            multisample: { count: sampleCount },
        });
        this.uniformHandle = gpu.createBuffer({
            label: "solar-points-uniforms",
            size: UNIFORM_SIZE,
            usage: "uniform|copy_dst",
        });
        this.uniformBuffer = gpu.getBuffer(this.uniformHandle);
        this.bindGroup = device.createBindGroup({
            label: "solar-points-bind-group",
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.uniformBuffer },
                },
            ],
        });
    }
    destroyInstanceBuffer() {
        if (this.instanceHandle) {
            this.bootstrap.gpu.destroyBuffer(this.instanceHandle);
            this.instanceHandle = null;
        }
        else if (this.instanceBuffer) {
            this.instanceBuffer.destroy();
        }
        this.instanceBuffer = null;
        this.instanceCapacity = 0;
        this.interleave = new Float32Array(0);
    }
    growInstances(count) {
        const cap = Math.max(count, this.instanceCapacity * 2 || 16);
        this.destroyInstanceBuffer();
        this.instanceCapacity = cap;
        this.instanceHandle = this.bootstrap.gpu.createBuffer({
            label: "solar-points-instances", size: cap * BYTES_PER_INSTANCE,
            usage: "vertex|copy_dst",
        });
        this.instanceBuffer = this.bootstrap.gpu.getBuffer(this.instanceHandle);
        this.interleave = new Float32Array(cap * FLOATS_PER_INSTANCE);
    }
    /**
     * Sync store → instance buffer (interleaved).
     * Pack/upload dirty instances; repopulate the full buffer after capacity growth.
     */
    syncFromStore(store) {
        if (!this.pipeline || !this.uniformBuffer) {
            throw new Error("SolarPointGpuLayer.init() required before sync");
        }
        const count = store.currentCount;
        if (count === 0) {
            this.destroyInstanceBuffer();
            store.clearDirty();
            return;
        }
        const capacityChanged = count > this.instanceCapacity || !this.instanceBuffer;
        const dirty = store.positionDirty.kind !== "clean" ||
            store.colorDirty.kind !== "clean";
        if (!capacityChanged && !dirty) {
            return;
        }
        if (capacityChanged)
            this.growInstances(count);
        const dst = this.interleave;
        const range = pendingInstanceRange(store, count, capacityChanged);
        if (!range) {
            store.clearDirty();
            return;
        }
        const [startIndex, uploadCount] = range;
        packSolarPointInstanceRange(store, dst, startIndex, uploadCount);
        this.bootstrap.gpu.writeBuffer(this.instanceHandle, startIndex * BYTES_PER_INSTANCE, dst, startIndex * BYTES_PER_INSTANCE, uploadCount * BYTES_PER_INSTANCE);
        store.clearDirty();
    }
    /**
     * Encode draw into an open render pass (does not begin/end pass).
     *
     * @param worldScale half-extent of billboard in world units (CPU LOD size)
     * @param cameraRight world-space unit right (from view matrix row 0)
     * @param cameraUp world-space unit up (from view matrix row 1)
     */
    encode(pass, viewProj, worldScale, instanceCount, cameraRight, cameraUp, origin, galaxyFade = 1) {
        if (!this.pipeline || !this.bindGroup || !this.uniformBuffer)
            return;
        if (instanceCount <= 0 || !this.instanceBuffer)
            return;
        packSolarPointUniforms(this.uniformData, viewProj, worldScale, cameraRight, cameraUp, origin, galaxyFade);
        if (!this.uniformHandle) {
            throw new Error("SolarPointGpuLayer: missing uniform buffer handle");
        }
        this.bootstrap.gpu.writeBuffer(this.uniformHandle, 0, this.uniformData, 0, UNIFORM_SIZE);
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.setVertexBuffer(0, this.instanceBuffer);
        pass.draw(6, instanceCount, 0, 0);
    }
    dispose() {
        this.destroyInstanceBuffer();
        if (this.uniformHandle) {
            this.bootstrap.gpu.destroyBuffer(this.uniformHandle);
            this.uniformHandle = null;
        }
        this.uniformBuffer = null;
        this.pipeline = null;
        this.bindGroup = null;
    }
}
//# sourceMappingURL=solar-point-gpu-layer.js.map