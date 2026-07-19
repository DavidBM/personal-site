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
/** mat4 (64) + 4 f32 (16) + cameraRight vec3+pad (16) + cameraUp vec3+pad (16) */
const UNIFORM_SIZE = 112;
const FLOATS_PER_INSTANCE = 6; // pos.xyz + color.rgb
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;
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
    /**
     * Sync store → instance buffer (interleaved).
     * Full rewrite only when capacity grows or store marks dirty.
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
        if (capacityChanged) {
            if (this.instanceHandle) {
                this.bootstrap.gpu.destroyBuffer(this.instanceHandle);
                this.instanceHandle = null;
                this.instanceBuffer = null;
            }
            else if (this.instanceBuffer) {
                this.instanceBuffer.destroy();
                this.instanceBuffer = null;
            }
            const cap = Math.max(count, this.instanceCapacity * 2 || 16);
            this.instanceCapacity = cap;
            this.instanceHandle = this.bootstrap.gpu.createBuffer({
                label: "solar-points-instances",
                size: cap * BYTES_PER_INSTANCE,
                usage: "vertex|copy_dst",
            });
            this.instanceBuffer = this.bootstrap.gpu.getBuffer(this.instanceHandle);
            this.interleave = new Float32Array(cap * FLOATS_PER_INSTANCE);
        }
        const dst = this.interleave;
        const pos = store.positions;
        const col = store.colors;
        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            const o = i * FLOATS_PER_INSTANCE;
            dst[o] = pos[i3];
            dst[o + 1] = pos[i3 + 1];
            dst[o + 2] = pos[i3 + 2];
            dst[o + 3] = col[i3];
            dst[o + 4] = col[i3 + 1];
            dst[o + 5] = col[i3 + 2];
        }
        if (!this.instanceHandle) {
            throw new Error("SolarPointGpuLayer: missing instance buffer handle");
        }
        this.bootstrap.gpu.writeBuffer(this.instanceHandle, 0, dst, 0, count * BYTES_PER_INSTANCE);
        store.clearDirty();
    }
    /**
     * Encode draw into an open render pass (does not begin/end pass).
     *
     * @param worldScale half-extent of billboard in world units (CPU LOD size)
     * @param cameraRight world-space unit right (from view matrix row 0)
     * @param cameraUp world-space unit up (from view matrix row 1)
     */
    encode(pass, viewProj, worldScale, instanceCount, cameraRight, cameraUp) {
        if (!this.pipeline || !this.bindGroup || !this.uniformBuffer)
            return;
        if (instanceCount <= 0 || !this.instanceBuffer)
            return;
        this.uniformData.set(viewProj, 0);
        this.uniformData[16] = worldScale;
        this.uniformData[17] = 0;
        this.uniformData[18] = 0;
        this.uniformData[19] = 0;
        // cameraRight at float offset 20 (byte 80)
        const rx = cameraRight?.[0] ?? 1;
        const ry = cameraRight?.[1] ?? 0;
        const rz = cameraRight?.[2] ?? 0;
        this.uniformData[20] = rx;
        this.uniformData[21] = ry;
        this.uniformData[22] = rz;
        this.uniformData[23] = 0;
        // cameraUp at float offset 24 (byte 96)
        const ux = cameraUp?.[0] ?? 0;
        const uy = cameraUp?.[1] ?? 1;
        const uz = cameraUp?.[2] ?? 0;
        this.uniformData[24] = ux;
        this.uniformData[25] = uy;
        this.uniformData[26] = uz;
        this.uniformData[27] = 0;
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