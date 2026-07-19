/**
 * L2 draw + R2 dual compute integrate + L5b trail age/append/expand/draw.
 *
 * - CPU packs formation once (spawn/rebuild); R2 compute overwrites base.xyz
 *   + rotation every frame from ShipSim continuous agent (JUMP/SETTLE/ORBIT).
 * - Dual dispatch same encoder: cs_fleets (ease center) then cs_ships (1 thread/ship).
 * - FleetGpu storage: one row per fleet slot (stable free-list index).
 * - ShipSim storage: one row per visual ship (index = draw instance index).
 * - Trail sample + fixed-slot expand; fat Line2-style ribbon draw (wide head / thin tail).
 * - Draw instance buffer: vertex|storage|copy_dst so compute can scatter bases.
 * - Main does **not** walk ship bases every frame (L3 exit).
 */
import { MAP_MSAA_SAMPLES } from "../map-msaa.js";
import { FLEET_SHIPS_WGSL, FLEET_SHIP_DRAW_STRIDE, } from "../shaders/fleet-ships.wgsl.js";
import { buildFleetIntegrateWgsl, buildFleetIntegrateFastWgsl, FLEET_INTEGRATE_UNIFORM_SIZE, FLEET_INTEGRATE_WORKGROUP, FLEET_INTEGRATE_SHIP_SIM_STRIDE, } from "../shaders/fleet-integrate.wgsl.js";
import { FLEET_TRAILS_WGSL, TRAIL_TEMPLATE_INDEX_COUNT, TRAIL_TEMPLATE_INDICES, TRAIL_TEMPLATE_STRIDE, TRAIL_UNIFORM_FLOATS, TRAIL_UNIFORM_SIZE, TRAIL_WIDTH_HEAD_PX, TRAIL_WIDTH_TAIL_PX, buildTrailTemplateInterleaved, writeTrailUniforms, } from "../shaders/fleet-trails.wgsl.js";
import { TRAIL_SAMPLE_FLOATS, resolveTrailLayout, } from "../fleet-trail-ref.js";
import { FLEET_GPU_STRIDE, TRAIL_SAMPLE_STRIDE } from "../fleet-layout.js";
import { readGpuBuffer } from "../buffer-readback.js";
import { GLOBAL_MAX_INSTANCES, GPU_FLEET_CAPACITY_MIN, GPU_SHIP_CAPACITY_MIN, LOD_FAR_Y, LOD_MID_DIST, LOD_NEAR_DIST, LOD_NEAR_Y, nextGrowCapacity, } from "../fleet-lod.js";
import { ShipSimFields } from "../ship-sim-layout.js";
import { FLEET_TRIANGLE_VERTICES } from "../fleet-mesh.js";
const RENDER_UNIFORM_SIZE = 80; // mat4 + opacity + cameraY + viewportH + tanHalfFov
const MESH_FLOATS = 9; // 3 verts × xyz
export class FleetInstanceGpuLayer {
    constructor(bootstrap, options) {
        this.name = "fleet-ships";
        this.pipeline = null;
        this.trailPipeline = null;
        /** R2 Pass A: ease FleetGpu.pos (cs_fleets). */
        this.computeFleetPipeline = null;
        /** R2 Pass B: agent integrate + draw + trails (cs_ships). */
        this.computeShipPipeline = null;
        /**
         * Scale path: cs_ships_fast (agent+append, no LOD/instance/expand).
         * Only created when forceLodNear (tests); map never uses it.
         */
        this.computeShipFastPipeline = null;
        this.computeShipFastBindGroup = null;
        this.uniformHandle = null;
        this.trailUniformHandle = null;
        /** Shared Line2-style ribbon template (static). */
        this.trailTemplateVertHandle = null;
        this.trailTemplateIndexHandle = null;
        this.trailTemplateVertBuffer = null;
        this.trailTemplateIndexBuffer = null;
        this.meshHandle = null;
        this.instanceHandle = null;
        this.fleetHandle = null;
        this.shipSimHandle = null;
        this.trailSampleHandle = null;
        this.trailLineHandle = null;
        /** atomic dense trail expand count (1×u32). */
        this.trailDrawMetaHandle = null;
        /** DrawIndexedIndirectArgs for trails (5×u32). */
        this.trailIndirectHandle = null;
        this.trailDrawMetaBuffer = null;
        this.trailIndirectBuffer = null;
        this.computeTrailIndirectPipeline = null;
        this.computeTrailIndirectBindGroup = null;
        this.integrateUniformHandle = null;
        this.uniformBuffer = null;
        this.trailUniformBuffer = null;
        this.meshBuffer = null;
        this.instanceBuffer = null;
        this.fleetBuffer = null;
        this.shipSimBuffer = null;
        this.trailSampleBuffer = null;
        this.trailLineBuffer = null;
        this.integrateUniformBuffer = null;
        this.instanceCapacity = 0;
        this.instanceCount = 0;
        this.fleetCapacity = 0;
        this.fleetCount = 0;
        this.shipSimCapacity = 0;
        /** Ships covered by trail sample + line buffers. */
        this.trailShipCapacity = 0;
        /** Live ships that contribute trail line verts this frame. */
        this.trailShipCount = 0;
        this.bindGroup = null;
        this.trailBindGroup = null;
        /** Bind group for cs_fleets (uniforms + fleets only under auto layout). */
        this.computeFleetBindGroup = null;
        /** Bind group for cs_ships (full resource set). */
        this.computeShipBindGroup = null;
        this.uniformData = new Float32Array(RENDER_UNIFORM_SIZE / 4);
        this.trailUniformData = new Float32Array(TRAIL_UNIFORM_FLOATS);
        this.integrateUniformBytes = new ArrayBuffer(FLEET_INTEGRATE_UNIFORM_SIZE);
        this.integrateUniformF32 = new Float32Array(this.integrateUniformBytes);
        this.integrateUniformU32 = new Uint32Array(this.integrateUniformBytes);
        /** Scratch for dead-sample fill (age01 = 1). Grown as needed. */
        this.deadTrailScratch = new Float32Array(0);
        this.bootstrap = bootstrap;
        this.trailLayout = resolveTrailLayout(options?.trail ?? null);
        this.integrateWgsl = buildFleetIntegrateWgsl(this.trailLayout);
        this.forceLodNear = options?.forceLodNear === true;
        this.maxShips = Math.max(1, (options?.maxShips ?? GLOBAL_MAX_INSTANCES) | 0);
    }
    /** Capacity ceiling for ship/instance/ShipSim/trail grow (game: 500k). */
    getMaxShips() {
        return this.maxShips;
    }
    /**
     * Compile draw/compute pipelines.
     * @param options.sampleCount Must match the map color pass (default {@link MAP_MSAA_SAMPLES}).
     *   Fleet sim tests pass `1` for a single-sample offscreen/swapchain pass.
     */
    init(options) {
        const { device, format, gpu } = this.bootstrap;
        const sampleCount = options?.sampleCount ?? MAP_MSAA_SAMPLES;
        const module = device.createShaderModule({
            label: "fleet-ships",
            code: FLEET_SHIPS_WGSL,
        });
        this.pipeline = device.createRenderPipeline({
            label: "fleet-ships-pipeline",
            layout: "auto",
            vertex: {
                module,
                entryPoint: "vs_main",
                buffers: [
                    {
                        arrayStride: 12,
                        stepMode: "vertex",
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: "float32x3" },
                        ],
                    },
                    {
                        arrayStride: FLEET_SHIP_DRAW_STRIDE,
                        stepMode: "instance",
                        attributes: [
                            { shaderLocation: 1, offset: 0, format: "float32x3" }, // base
                            { shaderLocation: 2, offset: 12, format: "float32x3" }, // center
                            { shaderLocation: 3, offset: 24, format: "float32" }, // rotation
                            { shaderLocation: 4, offset: 28, format: "float32" }, // size
                            { shaderLocation: 5, offset: 32, format: "float32x3" }, // color
                            { shaderLocation: 6, offset: 44, format: "float32" }, // screenSpace pad
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
        // Fat Line2-style trail ribbons: template (per-vertex) + expand segs (per-instance).
        // Alpha-to-coverage when MSAA for long-edge AA (same as map topology Line2).
        const trailModule = device.createShaderModule({
            label: "fleet-trails",
            code: FLEET_TRAILS_WGSL,
        });
        const trailSegStride = this.trailLayout.lineStride * 2; // two verts → one segment
        this.trailPipeline = device.createRenderPipeline({
            label: "fleet-trails-pipeline",
            layout: "auto",
            vertex: {
                module: trailModule,
                entryPoint: "vs_main",
                buffers: [
                    {
                        arrayStride: TRAIL_TEMPLATE_STRIDE,
                        stepMode: "vertex",
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: "float32x3" }, // template pos
                            { shaderLocation: 1, offset: 12, format: "float32x2" }, // uv
                        ],
                    },
                    {
                        // GPU expand buffer: start(pos3+col3+a) + end(pos3+col3+a)
                        arrayStride: trailSegStride,
                        stepMode: "instance",
                        attributes: [
                            { shaderLocation: 2, offset: 0, format: "float32x3" }, // start pos
                            { shaderLocation: 3, offset: 12, format: "float32x3" }, // start color
                            { shaderLocation: 4, offset: 24, format: "float32" }, // start alpha
                            { shaderLocation: 5, offset: 28, format: "float32x3" }, // end pos
                            { shaderLocation: 6, offset: 40, format: "float32x3" }, // end color
                            { shaderLocation: 7, offset: 52, format: "float32" }, // end alpha
                        ],
                    },
                ],
            },
            fragment: {
                module: trailModule,
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
            primitive: {
                topology: "triangle-list",
                cullMode: "none",
            },
            multisample: {
                count: sampleCount,
                alphaToCoverageEnabled: sampleCount > 1,
            },
        });
        const computeModule = device.createShaderModule({
            label: "fleet-integrate",
            code: this.integrateWgsl,
        });
        // R2: two entry points, same module. Auto layouts differ (fleets-only vs full).
        this.computeFleetPipeline = device.createComputePipeline({
            label: "fleet-integrate-fleets",
            layout: "auto",
            compute: {
                module: computeModule,
                entryPoint: "cs_fleets",
            },
        });
        this.computeShipPipeline = device.createComputePipeline({
            label: "fleet-integrate-ships",
            layout: "auto",
            compute: {
                module: computeModule,
                entryPoint: "cs_ships",
            },
        });
        this.computeTrailIndirectPipeline = device.createComputePipeline({
            label: "fleet-trail-indirect",
            layout: "auto",
            compute: {
                module: computeModule,
                entryPoint: "cs_trail_indirect",
            },
        });
        // Perf / forceLodNear only — separate slim CIRCULATE+append module (no SEEK).
        if (this.forceLodNear) {
            const fastModule = device.createShaderModule({
                label: "fleet-integrate-fast",
                code: buildFleetIntegrateFastWgsl(this.trailLayout),
            });
            this.computeShipFastPipeline = device.createComputePipeline({
                label: "fleet-integrate-ships-fast",
                layout: "auto",
                compute: {
                    module: fastModule,
                    entryPoint: "cs_ships_fast",
                },
            });
        }
        this.uniformHandle = gpu.createBuffer({
            label: "fleet-ships-uniforms",
            size: RENDER_UNIFORM_SIZE,
            usage: "uniform|copy_dst",
        });
        this.uniformBuffer = gpu.getBuffer(this.uniformHandle);
        this.trailUniformHandle = gpu.createBuffer({
            label: "fleet-trails-uniforms",
            size: TRAIL_UNIFORM_SIZE,
            usage: "uniform|copy_dst",
        });
        this.trailUniformBuffer = gpu.getBuffer(this.trailUniformHandle);
        const templateVerts = buildTrailTemplateInterleaved();
        this.trailTemplateVertHandle = gpu.createBuffer({
            label: "fleet-trails-template-verts",
            size: templateVerts.byteLength,
            usage: "vertex|copy_dst",
        });
        this.trailTemplateVertBuffer = gpu.getBuffer(this.trailTemplateVertHandle);
        gpu.writeBuffer(this.trailTemplateVertHandle, 0, templateVerts, 0, templateVerts.byteLength);
        this.trailTemplateIndexHandle = gpu.createBuffer({
            label: "fleet-trails-template-indices",
            size: TRAIL_TEMPLATE_INDICES.byteLength,
            usage: "index|copy_dst",
        });
        this.trailTemplateIndexBuffer = gpu.getBuffer(this.trailTemplateIndexHandle);
        gpu.writeBuffer(this.trailTemplateIndexHandle, 0, TRAIL_TEMPLATE_INDICES, 0, TRAIL_TEMPLATE_INDICES.byteLength);
        this.integrateUniformHandle = gpu.createBuffer({
            label: "fleet-integrate-uniforms",
            size: FLEET_INTEGRATE_UNIFORM_SIZE,
            usage: "uniform|copy_dst",
        });
        this.integrateUniformBuffer = gpu.getBuffer(this.integrateUniformHandle);
        // Dense trail expand counter + indirect draw args (GPU-only, no host readback).
        this.trailDrawMetaHandle = gpu.createBuffer({
            label: "fleet-trail-draw-meta",
            size: 4,
            usage: "storage|copy_dst",
        });
        this.trailDrawMetaBuffer = gpu.getBuffer(this.trailDrawMetaHandle);
        this.trailIndirectHandle = gpu.createBuffer({
            label: "fleet-trail-draw-indirect",
            size: 20,
            usage: "storage|indirect|copy_dst",
        });
        this.trailIndirectBuffer = gpu.getBuffer(this.trailIndirectHandle);
        gpu.writeBuffer(this.trailDrawMetaHandle, 0, new Uint32Array([0]), 0, 4);
        gpu.writeBuffer(this.trailIndirectHandle, 0, new Uint32Array([18, 0, 0, 0, 0]), 0, 20);
        this.meshHandle = gpu.createBuffer({
            label: "fleet-ships-mesh",
            size: MESH_FLOATS * 4,
            usage: "vertex|copy_dst",
        });
        this.meshBuffer = gpu.getBuffer(this.meshHandle);
        gpu.writeBuffer(this.meshHandle, 0, FLEET_TRIANGLE_VERTICES, 0, MESH_FLOATS * 4);
        this.bindGroup = device.createBindGroup({
            label: "fleet-ships-bind",
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.uniformBuffer },
                },
            ],
        });
        this.trailBindGroup = device.createBindGroup({
            label: "fleet-trails-bind",
            layout: this.trailPipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.trailUniformBuffer },
                },
            ],
        });
    }
    destroyInstances() {
        if (this.instanceHandle) {
            this.bootstrap.gpu.destroyBuffer(this.instanceHandle);
            this.instanceHandle = null;
        }
        this.instanceBuffer = null;
        this.instanceCapacity = 0;
        this.instanceCount = 0;
        this.computeFleetBindGroup = null;
        this.computeShipBindGroup = null;
    }
    destroyFleets() {
        if (this.fleetHandle) {
            this.bootstrap.gpu.destroyBuffer(this.fleetHandle);
            this.fleetHandle = null;
        }
        this.fleetBuffer = null;
        this.fleetCapacity = 0;
        this.fleetCount = 0;
        this.computeFleetBindGroup = null;
        this.computeShipBindGroup = null;
    }
    destroyShipSims() {
        if (this.shipSimHandle) {
            this.bootstrap.gpu.destroyBuffer(this.shipSimHandle);
            this.shipSimHandle = null;
        }
        this.shipSimBuffer = null;
        this.shipSimCapacity = 0;
        this.computeShipBindGroup = null;
    }
    destroyTrails() {
        if (this.trailSampleHandle) {
            this.bootstrap.gpu.destroyBuffer(this.trailSampleHandle);
            this.trailSampleHandle = null;
        }
        if (this.trailLineHandle) {
            this.bootstrap.gpu.destroyBuffer(this.trailLineHandle);
            this.trailLineHandle = null;
        }
        this.trailSampleBuffer = null;
        this.trailLineBuffer = null;
        this.trailShipCapacity = 0;
        this.trailShipCount = 0;
        this.computeShipBindGroup = null;
    }
    rebuildComputeBindGroups() {
        this.computeFleetBindGroup = null;
        this.computeShipBindGroup = null;
        this.computeShipFastBindGroup = null;
        if (this.computeFleetPipeline &&
            this.integrateUniformBuffer &&
            this.fleetBuffer &&
            this.instanceBuffer) {
            // cs_fleets auto layout: 0 uniform, 1 fleets, 2 instances (R3 impostor ease draw).
            this.computeFleetBindGroup = this.bootstrap.device.createBindGroup({
                label: "fleet-integrate-fleets-bind",
                layout: this.computeFleetPipeline.getBindGroupLayout(0),
                entries: [
                    {
                        binding: 0,
                        resource: { buffer: this.integrateUniformBuffer },
                    },
                    {
                        binding: 1,
                        resource: { buffer: this.fleetBuffer },
                    },
                    {
                        binding: 2,
                        resource: { buffer: this.instanceBuffer },
                    },
                ],
            });
        }
        // cs_ships auto layout: bindings 0–6 only (trailIndirect is unused there).
        if (this.computeShipPipeline &&
            this.integrateUniformBuffer &&
            this.fleetBuffer &&
            this.instanceBuffer &&
            this.shipSimBuffer &&
            this.trailSampleBuffer &&
            this.trailLineBuffer &&
            this.trailDrawMetaBuffer) {
            this.computeShipBindGroup = this.bootstrap.device.createBindGroup({
                label: "fleet-integrate-ships-bind",
                layout: this.computeShipPipeline.getBindGroupLayout(0),
                entries: [
                    {
                        binding: 0,
                        resource: { buffer: this.integrateUniformBuffer },
                    },
                    {
                        binding: 1,
                        resource: { buffer: this.fleetBuffer },
                    },
                    {
                        binding: 2,
                        resource: { buffer: this.instanceBuffer },
                    },
                    {
                        binding: 3,
                        resource: { buffer: this.shipSimBuffer },
                    },
                    {
                        binding: 4,
                        resource: { buffer: this.trailSampleBuffer },
                    },
                    {
                        binding: 5,
                        resource: { buffer: this.trailLineBuffer },
                    },
                    {
                        binding: 6,
                        resource: { buffer: this.trailDrawMetaBuffer },
                    },
                ],
            });
        }
        // cs_trail_indirect only touches meta + indirect; auto layout keeps @binding 6/7.
        if (this.computeTrailIndirectPipeline &&
            this.trailDrawMetaBuffer &&
            this.trailIndirectBuffer) {
            const layout = this.computeTrailIndirectPipeline.getBindGroupLayout(0);
            this.computeTrailIndirectBindGroup = this.bootstrap.device.createBindGroup({
                label: "fleet-trail-indirect-bind",
                layout,
                entries: [
                    {
                        binding: 6,
                        resource: { buffer: this.trailDrawMetaBuffer },
                    },
                    {
                        binding: 7,
                        resource: { buffer: this.trailIndirectBuffer },
                    },
                ],
            });
        }
        // cs_ships_fast may have a different auto layout; always bind from its pipeline.
        if (this.computeShipFastPipeline &&
            this.integrateUniformBuffer &&
            this.fleetBuffer &&
            this.instanceBuffer &&
            this.shipSimBuffer &&
            this.trailSampleBuffer &&
            this.trailLineBuffer) {
            this.computeShipFastBindGroup = this.bootstrap.device.createBindGroup({
                label: "fleet-integrate-ships-fast-bind",
                layout: this.computeShipFastPipeline.getBindGroupLayout(0),
                entries: [
                    {
                        binding: 0,
                        resource: { buffer: this.integrateUniformBuffer },
                    },
                    {
                        binding: 1,
                        resource: { buffer: this.fleetBuffer },
                    },
                    {
                        binding: 2,
                        resource: { buffer: this.instanceBuffer },
                    },
                    {
                        binding: 3,
                        resource: { buffer: this.shipSimBuffer },
                    },
                    {
                        binding: 4,
                        resource: { buffer: this.trailSampleBuffer },
                    },
                    {
                        binding: 5,
                        resource: { buffer: this.trailLineBuffer },
                    },
                ],
            });
        }
    }
    /**
     * Fill trail sample buffer [0, shipCount) with dead samples (age01 = 1).
     * Prevents ghost lines after capacity grow / structure rebuild.
     * Scratch keeps a permanent dead pattern (grow-only fill of new region).
     */
    uploadDeadTrailSamples(shipCount) {
        this.uploadDeadTrailSamplesRange(0, shipCount);
    }
    /** Dead-init trail sample rings for ships [shipStart, shipStart+count). */
    uploadDeadTrailSamplesRange(shipStart, count) {
        if (!this.trailSampleHandle || count <= 0 || shipStart < 0)
            return;
        const end = shipStart + count;
        if (end > this.trailShipCapacity) {
            throw new Error(`[fleets] trail sample write [${shipStart}, ${end}) exceeds capacity ${this.trailShipCapacity} — grow trails with ship high-water`);
        }
        const ring = this.trailLayout.ringSize;
        const floatsPerShip = ring * TRAIL_SAMPLE_FLOATS;
        // Chunked like trail lines — a 480k-ship one-shot scratch (~60MB+) OOM-kills
        // soft GPUs / headless SwiftShader and loses the device.
        const shipsPerChunk = Math.max(1, Math.floor(16384 / floatsPerShip));
        this.ensureDeadTrailScratch(shipsPerChunk * floatsPerShip);
        let done = 0;
        while (done < count) {
            const nShips = Math.min(shipsPerChunk, count - done);
            const floats = nShips * floatsPerShip;
            const byteOffset = (shipStart + done) * ring * TRAIL_SAMPLE_STRIDE;
            this.bootstrap.gpu.writeBuffer(this.trailSampleHandle, byteOffset, this.deadTrailScratch, 0, floats * 4);
            done += nShips;
        }
    }
    ensureDeadTrailScratch(floats) {
        if (this.deadTrailScratch.length >= floats)
            return;
        // Cap scratch — callers chunk large ranges; never allocate multi-100MB.
        const want = Math.min(floats, 16384);
        const next = new Float32Array(want);
        // Pattern: posX=0, posZ=0, birth=-1 (dead), pad=0.
        // birth<0 ⇒ sampleAge01 = 1 (dead); live appends store nowRel as birth.
        for (let i = 0; i < want; i += TRAIL_SAMPLE_FLOATS) {
            next[i] = 0;
            next[i + 1] = 0;
            next[i + 2] = -1;
            next[i + 3] = 0;
        }
        this.deadTrailScratch = next;
    }
    /**
     * Zero trail line verts [0, shipCount) so unused slots draw invisible.
     * Chunked upload reuses a small zero scratch (avoids multi-MB allocs).
     */
    uploadZeroTrailLines(shipCount) {
        this.uploadZeroTrailLinesRange(0, shipCount);
    }
    /** Zero trail line verts for ships [shipStart, shipStart+count). */
    uploadZeroTrailLinesRange(shipStart, count) {
        if (!this.trailLineHandle || count <= 0 || shipStart < 0)
            return;
        const end = shipStart + count;
        if (end > this.trailShipCapacity) {
            throw new Error(`[fleets] trail line write [${shipStart}, ${end}) exceeds capacity ${this.trailShipCapacity} — grow trails with ship high-water`);
        }
        const lineFloats = this.trailLayout.lineFloatsPerShip;
        const totalBytes = count * lineFloats * 4;
        const baseOffset = shipStart * lineFloats * 4;
        // 64 KiB zero chunks — enough for ~2.3k verts without a full-buffer alloc.
        const chunkFloats = 16384;
        const chunk = new Float32Array(chunkFloats);
        const chunkBytes = chunkFloats * 4;
        let offset = 0;
        while (offset < totalBytes) {
            const n = Math.min(chunkBytes, totalBytes - offset);
            this.bootstrap.gpu.writeBuffer(this.trailLineHandle, baseOffset + offset, chunk, 0, n);
            offset += n;
        }
    }
    /**
     * Kill trail samples + line verts for ships [shipStart, shipStart+count).
     * Indices are the same ship slot indices as draw/ShipSim — trail capacity
     * must already cover the range (see {@link ensureTrailCapacity} / host
     * {@code ensureGpuShipCapacity}). Grows if short so remove is always safe.
     */
    killTrailRange(shipStart, count) {
        if (count <= 0 || shipStart < 0)
            return;
        const end = shipStart + count;
        this.ensureTrailCapacity(end);
        if (end > this.trailShipCapacity) {
            throw new Error(`[fleets] killTrailRange [${shipStart}, ${end}) past trail capacity ${this.trailShipCapacity} (device storage limit?)`);
        }
        this.uploadDeadTrailSamplesRange(shipStart, count);
        this.uploadZeroTrailLinesRange(shipStart, count);
    }
    /** Physical trail ship capacity (same index space as instances / ShipSim). */
    getTrailShipCapacity() {
        return this.trailSampleHandle ? this.trailShipCapacity : 0;
    }
    /**
     * Ensure GPU buffer can hold `needed` instances (grow-only capacity).
     * Does not upload data. Returns true if the GPU buffer was reallocated
     * (caller must re-upload all live instances).
     *
     * **Destroys the previous buffer without copying.** Prefer
     * {@link growInstancesPreserving} for free-list spawn grows.
     */
    ensureInstanceCapacity(needed) {
        if (!this.pipeline)
            throw new Error("FleetInstanceGpuLayer.init() required");
        if (needed <= 0) {
            this.destroyInstances();
            return false;
        }
        if (needed <= this.instanceCapacity && this.instanceHandle) {
            return false;
        }
        const oldCap = this.instanceCapacity;
        const oldHandle = this.instanceHandle;
        const cap = nextGrowCapacity(needed, oldCap, GPU_SHIP_CAPACITY_MIN, this.maxShips);
        // L3: storage so compute can scatter base.xyz; copy_src for grow-preserve.
        this.instanceHandle = this.bootstrap.gpu.createBuffer({
            label: "fleet-ships-instances",
            size: cap * FLEET_SHIP_DRAW_STRIDE,
            usage: "vertex|storage|copy_dst|copy_src",
        });
        this.instanceBuffer = this.bootstrap.gpu.getBuffer(this.instanceHandle);
        this.instanceCapacity = cap;
        if (oldHandle) {
            this.bootstrap.gpu.destroyBuffer(oldHandle);
        }
        this.rebuildComputeBindGroups();
        return true;
    }
    /**
     * Ensure FleetGpu storage can hold `needed` fleets. Returns true if reallocated
     * (caller must re-upload all live fleet rows).
     */
    ensureFleetCapacity(needed) {
        if (!this.computeFleetPipeline || !this.computeShipPipeline) {
            throw new Error("FleetInstanceGpuLayer.init() required");
        }
        if (needed <= 0) {
            this.destroyFleets();
            return false;
        }
        if (needed <= this.fleetCapacity && this.fleetHandle) {
            return false;
        }
        const oldCap = this.fleetCapacity;
        const oldHandle = this.fleetHandle;
        // Fleet slot ceiling tracks maxShips so scale tests with 1-ship fleets
        // can still grow; production maxShips == GLOBAL_MAX_INSTANCES.
        const cap = nextGrowCapacity(needed, oldCap, GPU_FLEET_CAPACITY_MIN, this.maxShips);
        this.fleetHandle = this.bootstrap.gpu.createBuffer({
            label: "fleet-gpu-storage",
            size: cap * FLEET_GPU_STRIDE,
            usage: "storage|copy_dst|copy_src",
        });
        this.fleetBuffer = this.bootstrap.gpu.getBuffer(this.fleetHandle);
        this.fleetCapacity = cap;
        if (oldHandle) {
            this.bootstrap.gpu.destroyBuffer(oldHandle);
        }
        this.rebuildComputeBindGroups();
        return true;
    }
    /**
     * Ensure ShipSim storage can hold `needed` ships (grow-only). Returns true if
     * reallocated (caller must re-upload all live ShipSim rows).
     *
     * **Destroys the previous buffer without copying.** Do not call this before
     * {@link setShipSimDataPreserving} / {@link growShipSimPreserving} — those
     * paths need the old buffer to keep mid-flight poses.
     */
    ensureShipSimCapacity(needed) {
        if (!this.computeFleetPipeline || !this.computeShipPipeline) {
            throw new Error("FleetInstanceGpuLayer.init() required");
        }
        if (needed <= 0) {
            this.destroyShipSims();
            return false;
        }
        if (needed <= this.shipSimCapacity && this.shipSimHandle) {
            return false;
        }
        const oldCap = this.shipSimCapacity;
        const oldHandle = this.shipSimHandle;
        const cap = nextGrowCapacity(needed, oldCap, GPU_SHIP_CAPACITY_MIN, this.maxShips);
        this.shipSimHandle = this.bootstrap.gpu.createBuffer({
            label: "fleet-ship-sim-storage",
            size: cap * FLEET_INTEGRATE_SHIP_SIM_STRIDE,
            usage: "storage|copy_dst|copy_src",
        });
        this.shipSimBuffer = this.bootstrap.gpu.getBuffer(this.shipSimHandle);
        this.shipSimCapacity = cap;
        if (oldHandle) {
            this.bootstrap.gpu.destroyBuffer(oldHandle);
        }
        this.rebuildComputeBindGroups();
        return true;
    }
    /**
     * Free-list spawn grow: allocate a larger ShipSim buffer, GPU-copy live rows
     * `[0, preserveCount)`, then CPU-upload only `[uploadStart, uploadStart+uploadCount)`.
     * Amortized O(new ships) host traffic — not O(high-water) full mirror writes.
     */
    growShipSimPreserving(shipCount, preserveCount, data, uploadStart, uploadCount) {
        if (shipCount <= 0) {
            this.destroyShipSims();
            return;
        }
        const stride = FLEET_INTEGRATE_SHIP_SIM_STRIDE;
        const oldHandle = this.shipSimHandle;
        const oldBuffer = this.shipSimBuffer;
        const oldCap = this.shipSimCapacity;
        const preserve = Math.max(0, Math.min(preserveCount | 0, oldCap, shipCount | 0));
        // Detach so ensure allocates a fresh dst (no alias with src).
        if (oldHandle) {
            this.shipSimHandle = null;
            this.shipSimBuffer = null;
            this.shipSimCapacity = 0;
            this.computeFleetBindGroup = null;
            this.computeShipBindGroup = null;
        }
        this.ensureShipSimCapacity(shipCount);
        if (!this.shipSimHandle || !this.shipSimBuffer) {
            if (oldHandle)
                this.bootstrap.gpu.destroyBuffer(oldHandle);
            return;
        }
        // Live poses: GPU copy before any CPU write overwrites that range.
        if (preserve > 0 && oldHandle && oldBuffer) {
            try {
                const byteLength = preserve * stride;
                if (byteLength <= oldHandle.byteLength &&
                    byteLength <= this.shipSimHandle.byteLength) {
                    const encoder = this.bootstrap.device.createCommandEncoder({
                        label: "ship-sim-grow-preserve",
                    });
                    encoder.copyBufferToBuffer(oldBuffer, 0, this.shipSimBuffer, 0, byteLength);
                    this.bootstrap.device.queue.submit([encoder.finish()]);
                }
            }
            catch (err) {
                console.warn("[fleets] ShipSim grow preserve failed; new range only", err);
            }
        }
        if (oldHandle)
            this.bootstrap.gpu.destroyBuffer(oldHandle);
        // Only the newly packed ships need a CPU write (formation init).
        if (uploadCount > 0 && uploadStart >= 0) {
            this.uploadShipSimRange(data, uploadStart, uploadCount);
        }
    }
    /**
     * Free-list spawn grow for draw instances: GPU-copy `[0, preserveCount)`,
     * CPU-upload only the new range. Buffer must support copy_src (see ensure).
     */
    growInstancesPreserving(instanceCount, preserveCount, data, uploadStart, uploadCount) {
        if (instanceCount <= 0) {
            this.destroyInstances();
            return;
        }
        const stride = FLEET_SHIP_DRAW_STRIDE;
        const oldHandle = this.instanceHandle;
        const oldBuffer = this.instanceBuffer;
        const oldCap = this.instanceCapacity;
        const preserve = Math.max(0, Math.min(preserveCount | 0, oldCap, instanceCount | 0));
        if (oldHandle) {
            this.instanceHandle = null;
            this.instanceBuffer = null;
            this.instanceCapacity = 0;
            this.computeFleetBindGroup = null;
            this.computeShipBindGroup = null;
        }
        this.ensureInstanceCapacity(instanceCount);
        if (!this.instanceHandle || !this.instanceBuffer) {
            if (oldHandle)
                this.bootstrap.gpu.destroyBuffer(oldHandle);
            return;
        }
        if (preserve > 0 && oldHandle && oldBuffer) {
            try {
                const byteLength = preserve * stride;
                if (byteLength <= oldHandle.byteLength &&
                    byteLength <= this.instanceHandle.byteLength) {
                    const encoder = this.bootstrap.device.createCommandEncoder({
                        label: "instances-grow-preserve",
                    });
                    encoder.copyBufferToBuffer(oldBuffer, 0, this.instanceBuffer, 0, byteLength);
                    this.bootstrap.device.queue.submit([encoder.finish()]);
                }
            }
            catch (err) {
                console.warn("[fleets] instance grow preserve failed; new range only", err);
            }
        }
        if (oldHandle)
            this.bootstrap.gpu.destroyBuffer(oldHandle);
        if (uploadCount > 0 && uploadStart >= 0) {
            this.uploadInstancesRange(data, uploadStart, uploadCount);
        }
        this.instanceCount = instanceCount;
        this.trailShipCount = instanceCount;
    }
    /**
     * Ensure trail sample + line buffers can hold `needed` ships (grow-only).
     * Same ship index space as instances / ShipSim — must stay ≥ ship high-water
     * whenever slots are allocated (not only on flush).
     * On reallocate: GPU-copy live rings, dead-init only the new tail.
     * Does **not** change {@link trailShipCount} (draw count); callers set that via
     * {@link setInstances} / {@link setLiveInstanceCount}.
     * Returns true if buffers were reallocated.
     */
    ensureTrailCapacity(needed, resetDead = false) {
        if (!this.computeFleetPipeline ||
            !this.computeShipPipeline ||
            !this.trailPipeline) {
            throw new Error("FleetInstanceGpuLayer.init() required");
        }
        if (needed <= 0) {
            this.destroyTrails();
            return false;
        }
        let grew = false;
        if (needed > this.trailShipCapacity || !this.trailSampleHandle) {
            const oldCap = this.trailShipCapacity;
            const oldSample = this.trailSampleHandle;
            const oldSampleBuf = this.trailSampleBuffer;
            const oldLine = this.trailLineHandle;
            const oldLineBuf = this.trailLineBuffer;
            // Hard ceiling: global ship budget + device storage-binding limit (trail
            // lines are the largest storage buffer). Prefer same geometric grow as
            // instances so capacity stays lockstep with ship high-water.
            const sampleBytesPerShip = this.trailLayout.ringSize * TRAIL_SAMPLE_STRIDE;
            const lineBytesPerShip = this.trailLayout.lineFloatsPerShip * 4;
            const maxBind = this.bootstrap.limits?.maxStorageBufferBindingSize ??
                134217728;
            const maxByLines = Math.floor(maxBind / Math.max(1, lineBytesPerShip));
            const maxBySamples = Math.floor(maxBind / Math.max(1, sampleBytesPerShip));
            const deviceMax = Math.min(this.maxShips, maxByLines, maxBySamples);
            if (needed > deviceMax) {
                throw new Error(`[fleets] trail capacity cannot hold ${needed} ships ` +
                    `(device max ${deviceMax}; storage bind limit ${maxBind} B). ` +
                    `Ship high-water and trails must share the same index space.`);
            }
            const cap = nextGrowCapacity(needed, oldCap, GPU_SHIP_CAPACITY_MIN, deviceMax);
            this.trailSampleHandle = this.bootstrap.gpu.createBuffer({
                label: "fleet-trail-samples",
                size: cap * sampleBytesPerShip,
                // copy_src: structure rebuild preserves live rings via GPU copy.
                usage: "storage|copy_dst|copy_src",
            });
            this.trailSampleBuffer = this.bootstrap.gpu.getBuffer(this.trailSampleHandle);
            this.trailLineHandle = this.bootstrap.gpu.createBuffer({
                label: "fleet-trail-lines",
                size: cap * lineBytesPerShip,
                usage: "vertex|storage|copy_dst|copy_src",
            });
            this.trailLineBuffer = this.bootstrap.gpu.getBuffer(this.trailLineHandle);
            this.trailShipCapacity = cap;
            this.rebuildComputeBindGroups();
            grew = true;
            // Preserve live rings/lines then only init the new tail (not full O(cap)).
            const preserve = Math.min(oldCap, cap);
            if (preserve > 0 && oldSample && oldSampleBuf && oldLine && oldLineBuf) {
                try {
                    const encoder = this.bootstrap.device.createCommandEncoder({
                        label: "trail-grow-preserve",
                    });
                    encoder.copyBufferToBuffer(oldSampleBuf, 0, this.trailSampleBuffer, 0, preserve * sampleBytesPerShip);
                    encoder.copyBufferToBuffer(oldLineBuf, 0, this.trailLineBuffer, 0, preserve * lineBytesPerShip);
                    this.bootstrap.device.queue.submit([encoder.finish()]);
                }
                catch (err) {
                    console.warn("[fleets] trail grow preserve failed; dead-init full cap", err);
                    this.uploadDeadTrailSamples(cap);
                    this.uploadZeroTrailLines(cap);
                    if (oldSample)
                        this.bootstrap.gpu.destroyBuffer(oldSample);
                    if (oldLine)
                        this.bootstrap.gpu.destroyBuffer(oldLine);
                    return grew;
                }
                // New slots only
                if (cap > preserve) {
                    this.uploadDeadTrailSamplesRange(preserve, cap - preserve);
                    this.uploadZeroTrailLinesRange(preserve, cap - preserve);
                }
            }
            else {
                this.uploadDeadTrailSamples(cap);
                this.uploadZeroTrailLines(cap);
            }
            if (oldSample)
                this.bootstrap.gpu.destroyBuffer(oldSample);
            if (oldLine)
                this.bootstrap.gpu.destroyBuffer(oldLine);
        }
        else if (resetDead) {
            this.uploadDeadTrailSamples(this.trailShipCapacity);
            this.uploadZeroTrailLines(this.trailShipCapacity);
        }
        return grew;
    }
    /**
     * Structure rebuild: preserve trail sample rings for ships that remain visual.
     * Mirrors {@link setShipSimDataPreserving}.
     *
     * `copies` map old ship indices → new. When capacity already fits, keep the
     * sample buffer: stage → dead-init live range → scatter (no full realloc).
     * Lines are zeroed; integrate re-expands next frame.
     *
     * When `copies` is empty (or no prior buffer): full dead reset via
     * {@link ensureTrailCapacity}.
     */
    setTrailDataPreserving(shipCount, copies) {
        if (shipCount <= 0) {
            this.destroyTrails();
            return;
        }
        // Keep ≥1 ship of trail storage so integrate bind group stays valid when
        // LOD culls all visual ships but fleets still exist (caller passes that).
        const needed = Math.max(1, shipCount);
        const oldSampleHandle = this.trailSampleHandle;
        const wantCopy = copies.length > 0 && oldSampleHandle != null;
        const ringBytes = this.trailLayout.ringSize * TRAIL_SAMPLE_STRIDE;
        const capacityFits = oldSampleHandle != null &&
            this.trailShipCapacity >= needed &&
            this.trailSampleBuffer != null;
        // Fast path: every copy is identity (src==dst) and capacity already holds
        // live ships — ranges did not move. Skip stage/dead-init/scatter (was ~70%
        // of structure rebuild time after bulk spawn warm-end repacks).
        if (wantCopy && capacityFits) {
            let identity = true;
            let covered = 0;
            for (let i = 0; i < copies.length; i++) {
                const c = copies[i];
                if (c.count <= 0)
                    continue;
                if (c.srcStart !== c.dstStart) {
                    identity = false;
                    break;
                }
                covered += c.count;
            }
            if (identity && covered >= needed) {
                return;
            }
            // Partial identity: still need preserve for moved ranges below.
        }
        // --- Capacity enough: stage → dead live range → scatter (no realloc) ---
        if (wantCopy && capacityFits) {
            try {
                const packs = [];
                let stageBytes = 0;
                const dstByteLength = oldSampleHandle.byteLength;
                for (let i = 0; i < copies.length; i++) {
                    const c = copies[i];
                    if (c.count <= 0)
                        continue;
                    const byteLength = c.count * ringBytes;
                    const srcOff = c.srcStart * ringBytes;
                    const dstOff = c.dstStart * ringBytes;
                    if (srcOff < 0 || dstOff < 0)
                        continue;
                    if (srcOff + byteLength > oldSampleHandle.byteLength)
                        continue;
                    if (dstOff + byteLength > dstByteLength)
                        continue;
                    packs.push({ srcOff, dstOff, byteLength, stageOff: stageBytes });
                    stageBytes += byteLength;
                }
                if (packs.length > 0) {
                    const stageHandle = this.bootstrap.gpu.createBuffer({
                        label: "trail-sample-preserve-stage",
                        size: stageBytes,
                        usage: "storage|copy_dst|copy_src",
                    });
                    const stage = this.bootstrap.gpu.getBuffer(stageHandle);
                    const src = this.trailSampleBuffer;
                    const encIn = this.bootstrap.device.createCommandEncoder({
                        label: "trail-sample-preserve-pack",
                    });
                    for (let i = 0; i < packs.length; i++) {
                        const p = packs[i];
                        encIn.copyBufferToBuffer(src, p.srcOff, stage, p.stageOff, p.byteLength);
                    }
                    this.bootstrap.device.queue.submit([encIn.finish()]);
                    // Kill ghosts on reassigned indices; preserved rows restored below.
                    this.uploadDeadTrailSamples(needed);
                    this.uploadZeroTrailLines(needed);
                    const encOut = this.bootstrap.device.createCommandEncoder({
                        label: "trail-sample-preserve-scatter",
                    });
                    for (let i = 0; i < packs.length; i++) {
                        const p = packs[i];
                        encOut.copyBufferToBuffer(stage, p.stageOff, this.trailSampleBuffer, p.dstOff, p.byteLength);
                    }
                    this.bootstrap.device.queue.submit([encOut.finish()]);
                    this.bootstrap.gpu.destroyBuffer(stageHandle);
                }
                else {
                    this.uploadDeadTrailSamples(needed);
                    this.uploadZeroTrailLines(needed);
                }
            }
            catch (err) {
                console.warn("[fleets] trail in-place preserve failed; rings re-seed empty", err);
                this.uploadDeadTrailSamples(needed);
                this.uploadZeroTrailLines(needed);
            }
            return;
        }
        // --- Grow or no-preserve ---
        if (wantCopy && oldSampleHandle) {
            this.trailSampleHandle = null;
            this.trailSampleBuffer = null;
            if (this.trailLineHandle) {
                this.bootstrap.gpu.destroyBuffer(this.trailLineHandle);
                this.trailLineHandle = null;
            }
            this.trailLineBuffer = null;
            this.trailShipCapacity = 0;
            this.computeFleetBindGroup = null;
            this.computeShipBindGroup = null;
        }
        // wantCopy grow: dead-init whole new buffer. !wantCopy: full dead reset.
        this.ensureTrailCapacity(needed, !wantCopy);
        if (!this.trailSampleHandle || !this.trailSampleBuffer) {
            if (wantCopy && oldSampleHandle) {
                this.bootstrap.gpu.destroyBuffer(oldSampleHandle);
            }
            return;
        }
        if (wantCopy && oldSampleHandle) {
            try {
                const src = this.bootstrap.gpu.getBuffer(oldSampleHandle);
                const dst = this.trailSampleBuffer;
                const dstByteLength = this.trailSampleHandle.byteLength;
                const encoder = this.bootstrap.device.createCommandEncoder({
                    label: "trail-sample-preserve-grow",
                });
                let anyCopy = false;
                for (let i = 0; i < copies.length; i++) {
                    const c = copies[i];
                    if (c.count <= 0)
                        continue;
                    const byteLength = c.count * ringBytes;
                    const srcOff = c.srcStart * ringBytes;
                    const dstOff = c.dstStart * ringBytes;
                    if (srcOff < 0 || dstOff < 0)
                        continue;
                    if (srcOff + byteLength > oldSampleHandle.byteLength)
                        continue;
                    if (dstOff + byteLength > dstByteLength)
                        continue;
                    encoder.copyBufferToBuffer(src, srcOff, dst, dstOff, byteLength);
                    anyCopy = true;
                }
                if (anyCopy) {
                    this.bootstrap.device.queue.submit([encoder.finish()]);
                }
            }
            catch (err) {
                console.warn("[fleets] trail sample preserve copy failed; rings re-seed empty", err);
            }
            this.bootstrap.gpu.destroyBuffer(oldSampleHandle);
        }
    }
    /**
     * Mark all trail samples dead and zero line verts (structure rebuild / clear).
     * Keeps capacity; no-op if no trail buffers.
     */
    clearTrailSamples() {
        if (this.trailShipCapacity <= 0)
            return;
        this.uploadDeadTrailSamples(this.trailShipCapacity);
        this.uploadZeroTrailLines(this.trailShipCapacity);
    }
    /** How many instances the next draw will issue. */
    setLiveInstanceCount(count) {
        this.instanceCount = Math.max(0, count);
        this.trailShipCount = this.instanceCount;
    }
    getFleetCount() {
        return this.fleetCount;
    }
    getInstanceCount() {
        return this.instanceCount;
    }
    /** Native fleet storage GPUBuffer (or null). Includes COPY_SRC. */
    getFleetGpuBuffer() {
        return this.fleetBuffer;
    }
    /** Native ShipSim storage GPUBuffer (or null). Includes COPY_SRC. */
    getShipSimBuffer() {
        return this.shipSimBuffer;
    }
    /** Native draw-instance GPUBuffer (or null). Includes COPY_SRC. */
    getInstanceBuffer() {
        return this.instanceBuffer;
    }
    /**
     * Physical ShipSim row capacity on the GPU (0 if no buffer).
     * Used by host free-list spawn to decide sparse upload vs preserve-grow
     * without calling {@link ensureShipSimCapacity} first (that would destroy
     * live poses before a preserve copy can run).
     */
    getShipSimCapacity() {
        return this.shipSimHandle ? this.shipSimCapacity : 0;
    }
    /** Physical draw-instance capacity on the GPU (0 if no buffer). */
    getInstanceCapacity() {
        return this.instanceHandle ? this.instanceCapacity : 0;
    }
    /**
     * One integrate step: encode {@link dispatchIntegrate} + submit + wait for GPU.
     * For tests / deterministic stepping outside the rAF render loop.
     * Does not change shader or integrate semantics.
     *
     * @param options.expandTrails default true — false skips ribbon expand.
     * @param options.appendTrails default true — false = agent-only (cost probe).
     *   Map view always leaves both true.
     */
    async stepIntegrate(nowRel, dtMs, fleetCount, shipCount, camera, options) {
        const ships = shipCount !== undefined ? shipCount : this.instanceCount;
        const encoder = this.bootstrap.device.createCommandEncoder({
            label: "fleet-step-integrate",
        });
        this.dispatchIntegrate(encoder, nowRel, dtMs, fleetCount, ships, camera, options);
        this.bootstrap.device.queue.submit([encoder.finish()]);
        await this.bootstrap.device.queue.onSubmittedWorkDone();
    }
    /**
     * Read back fleet rows [0, fleetCount) as ArrayBuffer
     * (`fleetCount * FLEET_GPU_STRIDE`). Defaults to last uploaded fleetCount.
     */
    async readbackFleetGpu(fleetCount) {
        if (!this.fleetBuffer) {
            throw new Error("readbackFleetGpu: fleet buffer missing (ensureFleetCapacity / setFleetGpuData first)");
        }
        const count = fleetCount !== undefined ? fleetCount | 0 : this.fleetCount;
        if (count < 0 || count > this.fleetCapacity) {
            throw new Error(`readbackFleetGpu: fleetCount ${count} out of range [0, ${this.fleetCapacity}]`);
        }
        return readGpuBuffer(this.bootstrap.device, this.fleetBuffer, 0, count * FLEET_GPU_STRIDE);
    }
    /**
     * Read back ShipSim rows [0, shipCount) as ArrayBuffer
     * (`shipCount * SHIP_SIM_STRIDE`).
     */
    async readbackShipSim(shipCount) {
        if (!this.shipSimBuffer) {
            throw new Error("readbackShipSim: ShipSim buffer missing (ensureShipSimCapacity / setShipSimData first)");
        }
        const count = shipCount | 0;
        if (count < 0 || count > this.shipSimCapacity) {
            throw new Error(`readbackShipSim: shipCount ${count} out of range [0, ${this.shipSimCapacity}]`);
        }
        return readGpuBuffer(this.bootstrap.device, this.shipSimBuffer, 0, count * FLEET_INTEGRATE_SHIP_SIM_STRIDE);
    }
    /**
     * Read back draw instances [0, instanceCount) as ArrayBuffer
     * (`instanceCount * FLEET_SHIP_DRAW_STRIDE`). Defaults to live instanceCount.
     */
    async readbackInstances(instanceCount) {
        if (!this.instanceBuffer) {
            throw new Error("readbackInstances: instance buffer missing (ensureInstanceCapacity / setInstances first)");
        }
        const count = instanceCount !== undefined ? instanceCount | 0 : this.instanceCount;
        if (count < 0 || count > this.instanceCapacity) {
            throw new Error(`readbackInstances: instanceCount ${count} out of range [0, ${this.instanceCapacity}]`);
        }
        return readGpuBuffer(this.bootstrap.device, this.instanceBuffer, 0, count * FLEET_SHIP_DRAW_STRIDE);
    }
    /**
     * Read back trail sample buffer for ships [0, shipCount).
     * Layout: ship * ringSize * 4 floats (posX, posZ, age01, pad).
     * Tests use this to catch multi-M hop chords left in the short ring.
     */
    async readbackTrailSamples(shipCount) {
        if (!this.trailSampleBuffer) {
            throw new Error("readbackTrailSamples: trail sample buffer missing (ensureTrailCapacity first)");
        }
        const count = shipCount | 0;
        if (count < 0 || count > this.trailShipCapacity) {
            throw new Error(`readbackTrailSamples: shipCount ${count} out of range [0, ${this.trailShipCapacity}]`);
        }
        const ring = this.trailLayout.ringSize;
        const floatsPerShip = ring * 4; // TRAIL_SAMPLE_FLOATS
        const bytes = count * floatsPerShip * 4;
        const ab = await readGpuBuffer(this.bootstrap.device, this.trailSampleBuffer, 0, bytes);
        return new Float32Array(ab);
    }
    /**
     * Full upload of live instances [0, instanceCount).
     */
    setInstances(data, instanceCount) {
        if (instanceCount <= 0) {
            this.destroyInstances();
            this.trailShipCount = 0;
            return;
        }
        this.ensureInstanceCapacity(instanceCount);
        const bytes = instanceCount * FLEET_SHIP_DRAW_STRIDE;
        this.bootstrap.gpu.writeBuffer(this.instanceHandle, 0, data, 0, bytes);
        this.instanceCount = instanceCount;
        this.trailShipCount = instanceCount;
    }
    /**
     * Full or replace FleetGpu storage [0, fleetCount).
     * `data` is raw bytes (ArrayBuffer / Uint8Array / DataView-backed).
     */
    setFleetGpuData(data, fleetCount) {
        if (fleetCount <= 0) {
            this.destroyFleets();
            return;
        }
        this.ensureFleetCapacity(fleetCount);
        const bytes = fleetCount * FLEET_GPU_STRIDE;
        this.bootstrap.gpu.writeBuffer(this.fleetHandle, 0, data, 0, bytes);
        this.fleetCount = fleetCount;
    }
    /**
     * Full upload of ShipSim rows [0, shipCount).
     * `data` is raw bytes (ArrayBuffer / Uint8Array / DataView-backed).
     */
    setShipSimData(data, shipCount) {
        if (shipCount <= 0) {
            this.destroyShipSims();
            return;
        }
        this.ensureShipSimCapacity(shipCount);
        const bytes = shipCount * FLEET_INTEGRATE_SHIP_SIM_STRIDE;
        this.bootstrap.gpu.writeBuffer(this.shipSimHandle, 0, data, 0, bytes);
    }
    /**
     * Structure rebuild: upload CPU ShipSim (always valid formation fallback),
     * then GPU-copy live rows so mid-flight poses survive add/remove/LOD.
     *
     * `copies` map old ship indices → new. When capacity already fits, we keep
     * the live buffer and stage preserves through a short-lived temp (no permanent
     * realloc thrash). When capacity must grow, allocate a new buffer, copy from
     * the old one, then destroy the old. On copy failure, CPU formation remains.
     */
    setShipSimDataPreserving(data, shipCount, copies) {
        if (shipCount <= 0) {
            this.destroyShipSims();
            return;
        }
        const stride = FLEET_INTEGRATE_SHIP_SIM_STRIDE;
        const bytes = shipCount * stride;
        if (data.byteLength < bytes) {
            console.error(`[fleets] ShipSim CPU mirror too small: have ${data.byteLength}, need ${bytes}`);
            this.setShipSimData(data, Math.floor(data.byteLength / stride));
            return;
        }
        const oldHandle = this.shipSimHandle;
        const wantCopy = copies.length > 0 && oldHandle != null;
        const capacityFits = oldHandle != null &&
            this.shipSimCapacity >= shipCount &&
            this.shipSimBuffer != null;
        // --- Capacity already enough: keep buffer, stage preserves via temp ---
        if (wantCopy && capacityFits) {
            try {
                const src = this.shipSimBuffer;
                const packs = [];
                let stageBytes = 0;
                for (let i = 0; i < copies.length; i++) {
                    const c = copies[i];
                    if (c.count <= 0)
                        continue;
                    const byteLength = c.count * stride;
                    const srcOff = c.srcStart * stride;
                    const dstOff = c.dstStart * stride;
                    if (srcOff < 0 || dstOff < 0)
                        continue;
                    if (srcOff + byteLength > oldHandle.byteLength)
                        continue;
                    if (dstOff + byteLength > this.shipSimHandle.byteLength)
                        continue;
                    packs.push({ srcOff, dstOff, byteLength, stageOff: stageBytes });
                    stageBytes += byteLength;
                }
                if (packs.length === 0) {
                    this.bootstrap.gpu.writeBuffer(this.shipSimHandle, 0, data, 0, bytes);
                    return;
                }
                const stageHandle = this.bootstrap.gpu.createBuffer({
                    label: "ship-sim-preserve-stage",
                    size: stageBytes,
                    usage: "storage|copy_dst|copy_src",
                });
                const stage = this.bootstrap.gpu.getBuffer(stageHandle);
                const encIn = this.bootstrap.device.createCommandEncoder({
                    label: "ship-sim-preserve-pack",
                });
                for (let i = 0; i < packs.length; i++) {
                    const p = packs[i];
                    encIn.copyBufferToBuffer(src, p.srcOff, stage, p.stageOff, p.byteLength);
                }
                this.bootstrap.device.queue.submit([encIn.finish()]);
                // Formation fallback covers every live slot (incl. brand-new fleets).
                this.bootstrap.gpu.writeBuffer(this.shipSimHandle, 0, data, 0, bytes);
                const encOut = this.bootstrap.device.createCommandEncoder({
                    label: "ship-sim-preserve-scatter",
                });
                for (let i = 0; i < packs.length; i++) {
                    const p = packs[i];
                    encOut.copyBufferToBuffer(stage, p.stageOff, this.shipSimBuffer, p.dstOff, p.byteLength);
                }
                this.bootstrap.device.queue.submit([encOut.finish()]);
                this.bootstrap.gpu.destroyBuffer(stageHandle);
            }
            catch (err) {
                console.warn("[fleets] ShipSim in-place preserve failed; formation re-seed", err);
                this.bootstrap.gpu.writeBuffer(this.shipSimHandle, 0, data, 0, bytes);
            }
            return;
        }
        // --- Grow or no-preserve: allocate if needed, optional copy from old ---
        if (wantCopy && oldHandle) {
            // Detach so ensureShipSimCapacity allocates a fresh dst (no alias with src).
            this.shipSimHandle = null;
            this.shipSimBuffer = null;
            this.shipSimCapacity = 0;
            this.computeFleetBindGroup = null;
            this.computeShipBindGroup = null;
        }
        this.ensureShipSimCapacity(shipCount);
        if (!this.shipSimHandle || !this.shipSimBuffer) {
            if (wantCopy && oldHandle)
                this.bootstrap.gpu.destroyBuffer(oldHandle);
            return;
        }
        this.bootstrap.gpu.writeBuffer(this.shipSimHandle, 0, data, 0, bytes);
        if (wantCopy && oldHandle) {
            try {
                const src = this.bootstrap.gpu.getBuffer(oldHandle);
                const dst = this.shipSimBuffer;
                const encoder = this.bootstrap.device.createCommandEncoder({
                    label: "ship-sim-preserve-grow",
                });
                let anyCopy = false;
                for (let i = 0; i < copies.length; i++) {
                    const c = copies[i];
                    if (c.count <= 0)
                        continue;
                    const byteLength = c.count * stride;
                    const srcOff = c.srcStart * stride;
                    const dstOff = c.dstStart * stride;
                    if (srcOff < 0 || dstOff < 0)
                        continue;
                    if (srcOff + byteLength > oldHandle.byteLength)
                        continue;
                    if (dstOff + byteLength > this.shipSimHandle.byteLength)
                        continue;
                    encoder.copyBufferToBuffer(src, srcOff, dst, dstOff, byteLength);
                    anyCopy = true;
                }
                if (anyCopy) {
                    this.bootstrap.device.queue.submit([encoder.finish()]);
                }
            }
            catch (err) {
                console.warn("[fleets] ShipSim preserve copy failed; using formation re-seed", err);
            }
            this.bootstrap.gpu.destroyBuffer(oldHandle);
        }
    }
    /**
     * Partial draw-instance upload [instanceStart, instanceStart + count).
     * `data` is the full CPU instance Float32Array (same layout as setInstances).
     */
    uploadInstancesRange(data, instanceStart, count) {
        if (!this.instanceHandle || count <= 0 || instanceStart < 0)
            return;
        const end = instanceStart + count;
        if (end > this.instanceCapacity)
            return;
        const byteOffset = instanceStart * FLEET_SHIP_DRAW_STRIDE;
        const bytes = count * FLEET_SHIP_DRAW_STRIDE;
        if (byteOffset + bytes > this.instanceHandle.byteLength)
            return;
        if (byteOffset + bytes > data.byteLength)
            return;
        this.bootstrap.gpu.writeBuffer(this.instanceHandle, byteOffset, data, byteOffset, bytes);
    }
    /**
     * Upload only draw **size** (float index 7) for each instance in range.
     * Used when WARM ends: restore pack sizes without clobbering GPU poses that
     * compute already advanced (full instance re-upload snapped fleets back to
     * the initial formation square).
     */
    uploadInstanceSizeRange(data, instanceStart, count) {
        if (!this.instanceHandle || count <= 0 || instanceStart < 0)
            return;
        const floatsPer = FLEET_SHIP_DRAW_STRIDE / 4;
        const sizeFloat = 7; // base.xyz + center.xyz + rot + **size**
        for (let i = 0; i < count; i++) {
            const inst = instanceStart + i;
            if (inst >= this.instanceCapacity)
                break;
            const floatOff = inst * floatsPer + sizeFloat;
            const byteOff = floatOff * 4;
            if (byteOff + 4 > this.instanceHandle.byteLength)
                break;
            if (byteOff + 4 > data.byteLength)
                break;
            this.bootstrap.gpu.writeBuffer(this.instanceHandle, byteOff, data, byteOff, 4);
        }
    }
    /**
     * Partial FleetGpu upload [fleetStart, fleetStart + count).
     * `data` is the full CPU FleetGpu mirror; offsets are in fleet rows.
     * May extend logical `fleetCount` up to physical capacity (free-list high-water
     * grow) so sparse spawn does not need a full re-upload of [0, hw).
     * No-op if the range is past physical capacity or buffer missing.
     */
    uploadFleetGpuRange(data, fleetStart, count) {
        if (!this.fleetHandle || count <= 0 || fleetStart < 0)
            return;
        const end = fleetStart + count;
        if (end > this.fleetCapacity)
            return;
        const byteOffset = fleetStart * FLEET_GPU_STRIDE;
        const bytes = count * FLEET_GPU_STRIDE;
        const dataByteOffset = fleetStart * FLEET_GPU_STRIDE;
        if (byteOffset + bytes > this.fleetHandle.byteLength)
            return;
        if (dataByteOffset + bytes > data.byteLength)
            return;
        this.bootstrap.gpu.writeBuffer(this.fleetHandle, byteOffset, data, dataByteOffset, bytes);
        // Free-list high-water: sparse write may introduce a new tip row.
        if (end > this.fleetCount)
            this.fleetCount = end;
    }
    /**
     * Partial ShipSim upload [shipStart, shipStart + count).
     * `data` is the full CPU ShipSim mirror; offsets are in ship rows.
     */
    uploadShipSimRange(data, shipStart, count) {
        if (!this.shipSimHandle || count <= 0)
            return;
        const byteOffset = shipStart * FLEET_INTEGRATE_SHIP_SIM_STRIDE;
        const bytes = count * FLEET_INTEGRATE_SHIP_SIM_STRIDE;
        const dataByteOffset = shipStart * FLEET_INTEGRATE_SHIP_SIM_STRIDE;
        this.bootstrap.gpu.writeBuffer(this.shipSimHandle, byteOffset, data, dataByteOffset, bytes);
    }
    /**
     * Upload only ShipSim.fleetIndex (u32) for [shipStart, shipStart+count).
     * Leaves pose/trail/mode intact — required after {@link setShipSimDataPreserving}
     * so GPU-copied rows pick up the current fleetOrder index without clobbering
     * mid-flight poses (full-row {@link uploadShipSimRange} would re-seed formation).
     */
    uploadShipSimFleetIndexRange(data, shipStart, count) {
        if (!this.shipSimHandle || count <= 0)
            return;
        const stride = FLEET_INTEGRATE_SHIP_SIM_STRIDE;
        const field = ShipSimFields.fleetIndex;
        const start = Math.max(0, shipStart | 0);
        for (let i = 0; i < count; i++) {
            const off = (start + i) * stride + field;
            this.bootstrap.gpu.writeBuffer(this.shipSimHandle, off, data, off, 4);
        }
    }
    /**
     * Patch ShipSim motion knobs for a ship range (pose/mode untouched).
     * Used when a hop is re-targeted with a new arrival-time budget and/or
     * a new personal orbit radius at the destination.
     */
    uploadShipSimMotionParams(shipStart, count, accel, cruiseV, orbitR) {
        if (!this.shipSimHandle || count <= 0)
            return;
        const stride = FLEET_INTEGRATE_SHIP_SIM_STRIDE;
        const start = Math.max(0, shipStart | 0);
        const n = Math.max(0, count | 0);
        const scratch = new Float32Array(1);
        const writeR = orbitR !== undefined && orbitR > 0;
        for (let i = 0; i < n; i++) {
            const base = (start + i) * stride;
            scratch[0] = accel;
            this.bootstrap.gpu.writeBuffer(this.shipSimHandle, base + ShipSimFields.accel, scratch, 0, 4);
            scratch[0] = cruiseV;
            this.bootstrap.gpu.writeBuffer(this.shipSimHandle, base + ShipSimFields.cruiseV, scratch, 0, 4);
            if (writeR) {
                scratch[0] = orbitR;
                this.bootstrap.gpu.writeBuffer(this.shipSimHandle, base + ShipSimFields.orbitR, scratch, 0, 4);
            }
        }
    }
    /**
     * Partial upload of instance range [instanceStart, instanceStart + count).
     * `data` is the full CPU instance array; offsets are in instances.
     * Does not change draw count — call {@link setLiveInstanceCount} after appends.
     */
    uploadInstanceRange(data, instanceStart, count) {
        if (!this.instanceHandle || count <= 0)
            return;
        const byteOffset = instanceStart * FLEET_SHIP_DRAW_STRIDE;
        const bytes = count * FLEET_SHIP_DRAW_STRIDE;
        const dataByteOffset = instanceStart * FLEET_SHIP_DRAW_STRIDE;
        this.bootstrap.gpu.writeBuffer(this.instanceHandle, byteOffset, data, dataByteOffset, bytes);
    }
    /**
     * R2 + GPU LOD: dual dispatch — cs_fleets (ease + MID/FAR proxy) then
     * cs_ships (NEAR agent + trails). Same encoder; storage barrier automatic.
     * No-op if no fleets.
     *
     * @param nowRel GPU-relative ms (`wallMs - timeOriginMs`); must fit f32.
     * @param dtMs frame delta ms (clamped in shader / host to [0, 50]).
     * @param fleetCount desired rows (e.g. fleetOrder.length). **Clamped** to the
     *   last full upload (`this.fleetCount`) and physical capacity — never bumps
     *   logical count past what setFleetGpuData wrote (sparse uploads / warm ticks
     *   used to OOB writeBuffer when order grew before the next structure rebuild).
     * @param shipCount live visual ships (instanceLiveCount); 0 skips ship pass.
     * @param camera cameraY / look-at XZ / viewport / FOV for GPU LOD + icon.
     * @param options.expandTrails default true (game). false = skip ribbon expand.
     * @param options.appendTrails default true (game). false = agent-only probe.
     */
    dispatchIntegrate(encoder, nowRel, dtMs, fleetCount, shipCount = 0, camera, options) {
        // Only integrate fleets that exist on the GPU buffer (last setFleetGpuData).
        // Do NOT assign this.fleetCount = fleetOrder.length here — that desynced
        // getFleetCount() from buffer size during bulk spawn (10k crash).
        const nFleets = Math.min(Math.max(0, fleetCount | 0), this.fleetCount, this.fleetCapacity);
        if (nFleets <= 0 ||
            !this.computeFleetPipeline ||
            !this.integrateUniformHandle ||
            !this.fleetBuffer) {
            return;
        }
        if (!this.computeFleetBindGroup || !this.computeShipBindGroup) {
            this.rebuildComputeBindGroups();
        }
        if (!this.computeFleetBindGroup)
            return;
        const liveShips = Math.max(0, shipCount | 0);
        // Uniform layout (64 B):
        //   [0] nowRel f32  [1] fleetCount u32  [2] dtMs f32  [3] shipCount u32
        //   [4] cameraY     [5] targetX         [6] targetZ   [7] viewportH
        //   [8] tanHalfFov  [9] lodNearY        [10] lodFarY  [11] lodMidDist
        //   [12] expandTrails u32  [13] appendTrails u32
        //   [14] lodNearDist f32   [15] viewCullScale f32
        this.integrateUniformF32[0] = nowRel;
        this.integrateUniformU32[1] = nFleets >>> 0;
        this.integrateUniformF32[2] = dtMs;
        this.integrateUniformU32[3] = liveShips >>> 0;
        this.integrateUniformF32[4] = camera?.cameraY ?? 0;
        this.integrateUniformF32[5] = camera?.targetX ?? 0;
        this.integrateUniformF32[6] = camera?.targetZ ?? 0;
        this.integrateUniformF32[7] = camera?.viewportH ?? 1;
        this.integrateUniformF32[8] = camera?.tanHalfFov ?? Math.tan(Math.PI / 6);
        // Production: normal LOD thresholds. Tests may pass forceLodNear so multi-ship
        // agent+draw always run (does not change game map construction).
        if (this.forceLodNear) {
            this.integrateUniformF32[9] = 1e20;
            this.integrateUniformF32[10] = 1e21;
            this.integrateUniformF32[11] = 1e20;
            this.integrateUniformF32[14] = 1e20; // no nearDist demote
            this.integrateUniformF32[15] = 1e6; // essentially no view cull
        }
        else {
            this.integrateUniformF32[9] = LOD_NEAR_Y;
            this.integrateUniformF32[10] = LOD_FAR_Y;
            this.integrateUniformF32[11] = LOD_MID_DIST;
            this.integrateUniformF32[14] = LOD_NEAR_DIST;
            // ~1.15× half-angle ground radius — formation agent for on-screen fleets.
            this.integrateUniformF32[15] = 1.15;
        }
        // Default ON — map view never passes false. Scale tests may disable expand
        // (and optionally append) to isolate agent cost; features stay default-on.
        const expandTrails = options?.expandTrails !== false;
        const appendTrails = options?.appendTrails !== false;
        this.integrateUniformU32[12] = expandTrails ? 1 : 0;
        this.integrateUniformU32[13] = appendTrails ? 1 : 0;
        this.bootstrap.gpu.writeBuffer(this.integrateUniformHandle, 0, this.integrateUniformF32, 0, FLEET_INTEGRATE_UNIFORM_SIZE);
        // Reset dense trail expand counter for this frame.
        if (this.trailDrawMetaHandle) {
            this.bootstrap.gpu.writeBuffer(this.trailDrawMetaHandle, 0, new Uint32Array([0]), 0, 4);
        }
        // forceLodNear + no ribbon expand → cs_ships_fast (no LOD/instance work).
        // Map never has forceLodNear; full cs_ships always for production.
        const useFast = this.forceLodNear &&
            !expandTrails &&
            this.computeShipFastPipeline != null &&
            this.computeShipFastBindGroup != null;
        // Pass A — fleet centers. Fast path reads pathEnd (not eased pos) and can
        // skip this pass entirely for pure-orbit benches (no JUMPING fleets).
        if (!useFast) {
            const pass = encoder.beginComputePass({ label: "fleet-integrate-fleets" });
            pass.setPipeline(this.computeFleetPipeline);
            pass.setBindGroup(0, this.computeFleetBindGroup);
            const groups = Math.ceil(nFleets / FLEET_INTEGRATE_WORKGROUP);
            pass.dispatchWorkgroups(groups);
            pass.end();
        }
        // Pass B — per-ship agent + trails.
        // LOD 1 (NEAR): sim + multi-ship draw + trails.
        // LOD 2 (MID): same sim, single icon draw (cs_fleets), lead-ship trail.
        // LOD 3 (FAR): no agent — skip whole pass when camera is high enough that
        // every fleet is FAR (height ≥ FAR_Y).
        const cameraY = camera?.cameraY ?? 0;
        const shipsNeedAgent = useFast || cameraY < LOD_FAR_Y;
        if (shipsNeedAgent &&
            liveShips > 0 &&
            this.computeShipPipeline &&
            this.computeShipBindGroup &&
            this.instanceBuffer &&
            this.shipSimBuffer &&
            this.trailSampleBuffer &&
            this.trailLineBuffer) {
            const pass = encoder.beginComputePass({
                label: useFast ? "fleet-integrate-ships-fast" : "fleet-integrate-ships",
            });
            pass.setPipeline(useFast ? this.computeShipFastPipeline : this.computeShipPipeline);
            pass.setBindGroup(0, useFast ? this.computeShipFastBindGroup : this.computeShipBindGroup);
            const wg = useFast ? 256 : FLEET_INTEGRATE_WORKGROUP;
            const groups = Math.ceil(liveShips / wg);
            pass.dispatchWorkgroups(groups);
            pass.end();
            // Pack DrawIndexedIndirectArgs from dense expand count (no host readback).
            if (!useFast &&
                expandTrails &&
                this.computeTrailIndirectPipeline &&
                this.computeTrailIndirectBindGroup) {
                const p2 = encoder.beginComputePass({ label: "fleet-trail-indirect" });
                p2.setPipeline(this.computeTrailIndirectPipeline);
                p2.setBindGroup(0, this.computeTrailIndirectBindGroup);
                p2.dispatchWorkgroups(1);
                p2.end();
            }
        }
    }
    /**
     * L5b fat trail ribbons (Line2-style expand, GPU expand buffer, no host pack).
     * Width: wide at head (fresh α), thin at tail. Call after connections, before ships.
     * Instance count = trailShipCount * segsPerShip (fixed slots; dead α=0 discarded in FS).
     * NEAR: formation trails; MID: lead-ship trail under icon; FAR: none.
     *
     * Needs separate view + projection (screen-space expand) and drawing-buffer
     * resolution for correct pixel width.
     */
    encodeTrails(pass, view, projection, resolutionW, resolutionH, cameraY) {
        if (!this.trailPipeline ||
            !this.trailBindGroup ||
            !this.trailUniformHandle ||
            !this.trailLineBuffer ||
            !this.trailTemplateVertBuffer ||
            !this.trailTemplateIndexBuffer) {
            return;
        }
        // FAR band: no trails (icon only).
        if (cameraY !== undefined && cameraY >= LOD_FAR_Y)
            return;
        const shipCount = this.trailShipCount;
        if (shipCount <= 0)
            return;
        writeTrailUniforms(this.trailUniformData, view, projection, resolutionW, resolutionH, TRAIL_WIDTH_HEAD_PX, TRAIL_WIDTH_TAIL_PX, true);
        this.bootstrap.gpu.writeBuffer(this.trailUniformHandle, 0, this.trailUniformData, 0, TRAIL_UNIFORM_SIZE);
        // Dense expand this frame → DrawIndexedIndirect (instanceCount = nShips×segs).
        // No low-index window: any NEAR/MID-lead ship that expanded is drawn.
        pass.setPipeline(this.trailPipeline);
        pass.setBindGroup(0, this.trailBindGroup);
        pass.setVertexBuffer(0, this.trailTemplateVertBuffer);
        pass.setVertexBuffer(1, this.trailLineBuffer);
        pass.setIndexBuffer(this.trailTemplateIndexBuffer, "uint16");
        if (this.trailIndirectBuffer) {
            pass.drawIndexedIndirect(this.trailIndirectBuffer, 0);
        }
        else {
            const segs = this.trailLayout.segsPerShip;
            pass.drawIndexed(TRAIL_TEMPLATE_INDEX_COUNT, shipCount * segs, 0, 0, 0);
        }
    }
    encode(pass, viewProj, opacity = 0.95, camera) {
        if (!this.pipeline || !this.bindGroup || !this.uniformHandle)
            return;
        if (this.instanceCount <= 0 || !this.instanceBuffer || !this.meshBuffer) {
            return;
        }
        this.uniformData.set(viewProj, 0);
        this.uniformData[16] = opacity;
        // W4: camera params for screen-space icon world-size conversion
        this.uniformData[17] = camera ? camera.cameraY : 0;
        this.uniformData[18] = camera ? camera.viewportH : 1;
        this.uniformData[19] = camera ? camera.tanHalfFov : 0;
        this.bootstrap.gpu.writeBuffer(this.uniformHandle, 0, this.uniformData, 0, RENDER_UNIFORM_SIZE);
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.setVertexBuffer(0, this.meshBuffer);
        pass.setVertexBuffer(1, this.instanceBuffer);
        // Full free-list high-water — size≤0 slots early-out in ship VS (no index window).
        pass.draw(3, this.instanceCount, 0, 0);
    }
    dispose() {
        this.destroyInstances();
        this.destroyFleets();
        this.destroyShipSims();
        this.destroyTrails();
        if (this.meshHandle) {
            this.bootstrap.gpu.destroyBuffer(this.meshHandle);
            this.meshHandle = null;
        }
        if (this.uniformHandle) {
            this.bootstrap.gpu.destroyBuffer(this.uniformHandle);
            this.uniformHandle = null;
        }
        if (this.trailUniformHandle) {
            this.bootstrap.gpu.destroyBuffer(this.trailUniformHandle);
            this.trailUniformHandle = null;
        }
        if (this.trailTemplateVertHandle) {
            this.bootstrap.gpu.destroyBuffer(this.trailTemplateVertHandle);
            this.trailTemplateVertHandle = null;
        }
        if (this.trailTemplateIndexHandle) {
            this.bootstrap.gpu.destroyBuffer(this.trailTemplateIndexHandle);
            this.trailTemplateIndexHandle = null;
        }
        this.trailTemplateVertBuffer = null;
        this.trailTemplateIndexBuffer = null;
        if (this.integrateUniformHandle) {
            this.bootstrap.gpu.destroyBuffer(this.integrateUniformHandle);
            this.integrateUniformHandle = null;
        }
        this.meshBuffer = null;
        this.uniformBuffer = null;
        this.trailUniformBuffer = null;
        this.integrateUniformBuffer = null;
        this.pipeline = null;
        this.trailPipeline = null;
        this.computeFleetPipeline = null;
        this.computeShipPipeline = null;
        this.bindGroup = null;
        this.trailBindGroup = null;
        this.computeFleetBindGroup = null;
        this.computeShipBindGroup = null;
    }
}
//# sourceMappingURL=fleet-instance-gpu-layer.js.map