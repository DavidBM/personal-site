/**
 * Textured / low-poly ship instancing for the model LOD band.
 *
 * - Shared mesh VBO/IBO (low-poly default; optional glTF)
 * - Per-instance pose from ShipSim via compact shipIndices list
 * - Cheap cool-space FS; no shadows
 * - Cap: {@link MODEL_LOD_MAX_INSTANCES}. Zero work when inactive.
 */
import { MAP_MSAA_SAMPLES } from "../map-msaa.js";
import { FLEET_MODEL_SHIPS_WGSL, FLEET_MODEL_UNIFORM_SIZE, FLEET_MODEL_U_THRUSTER_PULSE, FLEET_MODEL_VERTEX_STRIDE, } from "../shaders/fleet-model-ships.wgsl.js";
import { MODEL_LOD_DEFAULT_SCALE, MODEL_LOD_MAX_INSTANCES, modelLodInstanceCount, } from "../fleet-lod.js";
import { gltfHasColorAndNormal, parseGlb, } from "../../lib/fleet-sim/visual/gltf-static-mesh.js";
import { createLowPolyShipMesh } from "../../lib/fleet-sim/visual/lowpoly-ship-mesh.js";
import { GLB_MESH_YAW_HALF, LOWPOLY_MESH_YAW_HALF, } from "../../lib/fleet-sim/visual/mesh-yaw-facing.js";
import { thrusterPulse } from "../../lib/fleet-sim/gpu/model-aft-light.js";
export class FleetModelGpuLayer {
    constructor(bootstrap, options) {
        this.name = "fleet-model-ships";
        this.pipeline = null;
        this.bindGroup = null;
        this.uniformHandle = null;
        this.uniformBuffer = null;
        this.vertexHandle = null;
        this.indexHandle = null;
        this.shipIndexHandle = null;
        this.vertexBuffer = null;
        this.indexBuffer = null;
        this.shipIndexBuffer = null;
        this.baseColorView = null;
        this.normalView = null;
        this.specularView = null;
        this.sampler = null;
        this.textures = [];
        this.indexCount = 0;
        this.indexFormat = "uint32";
        this.shipSimBuffer = null;
        /** FleetGpu storage for pathEnd point light (binding 7). */
        this.fleetGpuBuffer = null;
        this.mesh = null;
        this.ready = false;
        this.active = false;
        this.lastInstanceCount = 0;
        this.shipIndexCapacity = 0;
        this.lastShipIndices = new Uint32Array(0);
        this.uniformData = new Float32Array(FLEET_MODEL_UNIFORM_SIZE / 4);
        this.bootstrap = bootstrap;
        this.maxInstances = Math.max(1, (options?.maxInstances ?? MODEL_LOD_MAX_INSTANCES) | 0);
        this.modelScale = options?.modelScale ?? MODEL_LOD_DEFAULT_SCALE;
        this.meshYawHalf = options?.meshYawHalf ?? 0;
        this.sampleCount = options?.sampleCount ?? MAP_MSAA_SAMPLES;
    }
    isReady() {
        return this.ready;
    }
    getMesh() {
        return this.mesh;
    }
    getLastInstanceCount() {
        return this.lastInstanceCount;
    }
    getMaxInstances() {
        return this.maxInstances;
    }
    getModelScale() {
        return this.modelScale;
    }
    setModelScale(scale) {
        this.modelScale = Math.max(1e-6, scale);
    }
    setMeshYawHalf(halfRad) {
        this.meshYawHalf = halfRad;
    }
    getMeshYawHalf() {
        return this.meshYawHalf;
    }
    setActive(active) {
        this.active = active === true;
    }
    isActive() {
        return this.active;
    }
    /** Last compact ship index list uploaded for model draw. */
    getLastShipIndices() {
        return this.lastShipIndices;
    }
    setShipSimBuffer(buffer) {
        this.shipSimBuffer = buffer;
        this.rebuildBindGroup();
    }
    /**
     * FleetGpu storage (pathEnd = per-fleet point light for model FS).
     * Required for destination/orbit lighting; bind with ShipSim each frame.
     */
    setFleetGpuBuffer(buffer) {
        this.fleetGpuBuffer = buffer;
        this.rebuildBindGroup();
    }
    init(options) {
        if (options?.sampleCount != null) {
            this.sampleCount = options.sampleCount;
        }
        const { device, format, gpu } = this.bootstrap;
        const module = device.createShaderModule({
            label: "fleet-model-ships",
            code: FLEET_MODEL_SHIPS_WGSL,
        });
        this.pipeline = device.createRenderPipeline({
            label: "fleet-model-ships-pipeline",
            layout: "auto",
            vertex: {
                module,
                entryPoint: "vs_main",
                buffers: [
                    {
                        arrayStride: FLEET_MODEL_VERTEX_STRIDE,
                        stepMode: "vertex",
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: "float32x3" },
                            { shaderLocation: 1, offset: 12, format: "float32x3" },
                            { shaderLocation: 2, offset: 24, format: "float32x2" },
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
            primitive: {
                topology: "triangle-list",
                // Exterior hull only — without depth, dual-sided overdraw looked like
                // a hollow/inverted "mask" under roof-cam (orbit-direction dependent).
                cullMode: "back",
                frontFace: "ccw",
            },
            // Map pass attaches MSAA depth24plus; write so nearer exterior wins.
            depthStencil: {
                format: "depth24plus",
                depthWriteEnabled: true,
                depthCompare: "less",
            },
            multisample: { count: this.sampleCount },
        });
        this.uniformHandle = gpu.createBuffer({
            label: "fleet-model-uniform",
            size: FLEET_MODEL_UNIFORM_SIZE,
            usage: "uniform|copy_dst",
        });
        this.uniformBuffer = gpu.getBuffer(this.uniformHandle);
        this.sampler = device.createSampler({
            label: "fleet-model-sampler",
            magFilter: "linear",
            minFilter: "linear",
            addressModeU: "repeat",
            addressModeV: "repeat",
        });
        // Default: cheap low-poly fighter — body forward = mesh +Z (ShipSim).
        // meshYawHalf is half-angle for Y-yaw; 0 keeps tip at +Z.
        this.loadMeshSync(createLowPolyShipMesh(), {
            meshYawHalf: LOWPOLY_MESH_YAW_HALF,
        });
    }
    async loadGlb(buffer) {
        const mesh = parseGlb(buffer);
        // Production Meshy fighter: pointed nose is −X (wings toward +X).
        // +90° Y-yaw (half-angle +π/4) maps −X → +Z so tip leads ShipSim forward.
        await this.loadMesh(mesh, { meshYawHalf: GLB_MESH_YAW_HALF });
        return mesh;
    }
    /** Sync path for procedural / already-decoded meshes (no ImageBitmap). */
    loadMeshSync(mesh, opts) {
        if (!this.pipeline || !this.uniformHandle || !this.sampler) {
            throw new Error("FleetModelGpuLayer.init() required before loadMesh");
        }
        if (opts?.meshYawHalf != null)
            this.meshYawHalf = opts.meshYawHalf;
        this.destroyMeshGpu();
        this.mesh = mesh;
        const { gpu } = this.bootstrap;
        this.vertexHandle = gpu.createBuffer({
            label: "fleet-model-verts",
            size: Math.max(4, mesh.interleaved.byteLength),
            usage: "vertex|copy_dst",
        });
        this.vertexBuffer = gpu.getBuffer(this.vertexHandle);
        if (mesh.interleaved.byteLength > 0) {
            gpu.writeBuffer(this.vertexHandle, 0, mesh.interleaved, 0, mesh.interleaved.byteLength);
        }
        this.indexHandle = gpu.createBuffer({
            label: "fleet-model-indices",
            size: Math.max(4, mesh.indices.byteLength),
            usage: "index|copy_dst",
        });
        this.indexBuffer = gpu.getBuffer(this.indexHandle);
        if (mesh.indices.byteLength > 0) {
            gpu.writeBuffer(this.indexHandle, 0, mesh.indices, 0, mesh.indices.byteLength);
        }
        this.indexCount = mesh.indexCount;
        this.indexFormat = "uint32";
        const white = this.createSolidTextureSync(90, 170, 220, 255);
        const flatN = this.createSolidTextureSync(128, 128, 255, 255);
        const cool = this.createSolidTextureSync(40, 90, 140, 255);
        this.baseColorView = cool.createView();
        this.normalView = flatN.createView();
        this.specularView = white.createView();
        this.ready = mesh.vertexCount > 0 && mesh.indexCount >= 3;
        this.ensureShipIndexCapacity(this.maxInstances);
        this.rebuildBindGroup();
    }
    async loadMesh(mesh, opts) {
        this.loadMeshSync(mesh, opts);
        // Upgrade solid defaults with embedded images when present.
        const baseImg = mesh.baseColorImage >= 0 ? mesh.images[mesh.baseColorImage] : null;
        const nrmImg = mesh.normalImage >= 0 ? mesh.images[mesh.normalImage] : null;
        const specImg = mesh.diffuseSpecularImage >= 0
            ? mesh.images[mesh.diffuseSpecularImage]
            : null;
        if (baseImg?.data.length) {
            this.baseColorView = (await this.createTextureFromImageBytes(baseImg)).createView();
        }
        if (nrmImg?.data.length) {
            this.normalView = (await this.createTextureFromImageBytes(nrmImg)).createView();
        }
        if (specImg?.data.length) {
            this.specularView = (await this.createTextureFromImageBytes(specImg)).createView();
        }
        if (mesh.images.length && !gltfHasColorAndNormal(mesh)) {
            console.warn("[fleet-model] glTF missing maps; using cool solid defaults");
        }
        this.rebuildBindGroup();
    }
    /**
     * Upload compact ShipSim indices for this frame's model draw.
     * Empty / inactive → encode draws nothing.
     */
    setShipIndices(indices) {
        const n = Math.min(indices.length, this.maxInstances);
        this.ensureShipIndexCapacity(Math.max(n, 1));
        if (!this.shipIndexHandle || n <= 0) {
            this.lastShipIndices = new Uint32Array(0);
            return;
        }
        const u32 = new Uint32Array(n);
        for (let i = 0; i < n; i++)
            u32[i] = indices[i] >>> 0;
        this.bootstrap.gpu.writeBuffer(this.shipIndexHandle, 0, u32, 0, n * 4);
        this.lastShipIndices = u32;
    }
    ensureShipIndexCapacity(needed) {
        const n = Math.max(1, needed | 0);
        if (this.shipIndexCapacity >= n && this.shipIndexBuffer)
            return;
        const { gpu } = this.bootstrap;
        if (this.shipIndexHandle)
            gpu.destroyBuffer(this.shipIndexHandle);
        const cap = Math.min(this.maxInstances, Math.max(n, 256));
        this.shipIndexHandle = gpu.createBuffer({
            label: "fleet-model-ship-indices",
            size: cap * 4,
            usage: "storage|copy_dst",
        });
        this.shipIndexBuffer = gpu.getBuffer(this.shipIndexHandle);
        this.shipIndexCapacity = cap;
        // Identity fill for tests that only pass a count.
        const id = new Uint32Array(cap);
        for (let i = 0; i < cap; i++)
            id[i] = i;
        gpu.writeBuffer(this.shipIndexHandle, 0, id, 0, cap * 4);
        this.rebuildBindGroup();
    }
    createSolidTextureSync(r, g, b, a) {
        const { device } = this.bootstrap;
        const tex = device.createTexture({
            label: "fleet-model-solid",
            size: [1, 1],
            format: "rgba8unorm",
            usage: GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT,
        });
        device.queue.writeTexture({ texture: tex }, new Uint8Array([r, g, b, a]), { bytesPerRow: 4 }, [1, 1]);
        this.textures.push(tex);
        return tex;
    }
    async createTextureFromImageBytes(img) {
        const { device } = this.bootstrap;
        const copy = new Uint8Array(img.data.byteLength);
        copy.set(img.data);
        const blob = new Blob([copy.buffer], {
            type: img.mimeType || "image/png",
        });
        const bitmap = await createImageBitmap(blob);
        const tex = device.createTexture({
            label: "fleet-model-image",
            size: [bitmap.width, bitmap.height],
            format: "rgba8unorm",
            usage: GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT,
        });
        device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: tex }, [bitmap.width, bitmap.height]);
        bitmap.close();
        this.textures.push(tex);
        return tex;
    }
    rebuildBindGroup() {
        if (!this.pipeline ||
            !this.uniformBuffer ||
            !this.shipSimBuffer ||
            !this.fleetGpuBuffer ||
            !this.shipIndexBuffer ||
            !this.baseColorView ||
            !this.normalView ||
            !this.specularView ||
            !this.sampler) {
            this.bindGroup = null;
            return;
        }
        this.bindGroup = this.bootstrap.device.createBindGroup({
            label: "fleet-model-bind",
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: { buffer: this.shipSimBuffer } },
                { binding: 2, resource: this.baseColorView },
                { binding: 3, resource: this.normalView },
                { binding: 4, resource: this.sampler },
                { binding: 5, resource: this.specularView },
                { binding: 6, resource: { buffer: this.shipIndexBuffer } },
                { binding: 7, resource: { buffer: this.fleetGpuBuffer } },
            ],
        });
    }
    /**
     * Draw models for previously set ship indices (or 0..shipCount-1 if none set).
     * `viewProj` must be origin-relative; pass the same frame `origin` used for
     * look-at / trail / triangle ship draws.
     * `eyeWorld` = camera eye in **world** (rim only); key light is fleet pathEnd.
     * `timeSec` drives aft thruster light pulse (synced with trail glow feel).
     */
    encode(pass, viewProj, shipCountOrIndices, origin, eyeWorld, timeSec) {
        this.lastInstanceCount = 0;
        if (!this.active || !this.ready)
            return 0;
        if (!this.pipeline ||
            !this.bindGroup ||
            !this.vertexBuffer ||
            !this.indexBuffer ||
            !this.uniformHandle) {
            return 0;
        }
        let n = 0;
        if (typeof shipCountOrIndices === "number") {
            n = modelLodInstanceCount(true, shipCountOrIndices, this.maxInstances);
            if (n > 0 && this.lastShipIndices.length !== n) {
                const id = new Uint32Array(n);
                for (let i = 0; i < n; i++)
                    id[i] = i;
                this.setShipIndices(id);
            }
        }
        else if (shipCountOrIndices != null) {
            this.setShipIndices(shipCountOrIndices);
            n = this.lastShipIndices.length;
        }
        else {
            n = this.lastShipIndices.length;
        }
        if (n <= 0)
            return 0;
        // Layout: viewProj[0..15], origin.xyz+modelScale[16..19],
        // fallbackLight.xyz+ambient[20..23], eyeWorld.xyz+meshYawHalf[24..27],
        // thrusterPulse[28] + WGSL pad → 144 B.
        // Primary diffuse = per-ship pathEnd; eyeWorld is rim only (not the key light).
        this.uniformData.set(viewProj, 0);
        this.uniformData[16] = origin?.x ?? 0;
        this.uniformData[17] = origin?.y ?? 0;
        this.uniformData[18] = origin?.z ?? 0;
        this.uniformData[19] = this.modelScale;
        this.uniformData[20] = 0.55; // fallbackLight.x
        this.uniformData[21] = 0.9;
        this.uniformData[22] = 0.4;
        this.uniformData[23] = 0.22; // ambient
        this.uniformData[24] = eyeWorld?.x ?? origin?.x ?? 0;
        this.uniformData[25] = eyeWorld?.y ?? origin?.y ?? 0;
        this.uniformData[26] = eyeWorld?.z ?? origin?.z ?? 0;
        this.uniformData[27] = this.meshYawHalf;
        const t = timeSec !== undefined && Number.isFinite(timeSec)
            ? timeSec
            : (typeof performance !== "undefined" ? performance.now() : Date.now()) /
                1000;
        this.uniformData[FLEET_MODEL_U_THRUSTER_PULSE] = thrusterPulse(t, 1);
        this.uniformData[29] = 0;
        this.uniformData[30] = 0;
        this.uniformData[31] = 0;
        this.bootstrap.gpu.writeBuffer(this.uniformHandle, 0, this.uniformData, 0, FLEET_MODEL_UNIFORM_SIZE);
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.setVertexBuffer(0, this.vertexBuffer);
        pass.setIndexBuffer(this.indexBuffer, this.indexFormat);
        pass.drawIndexed(this.indexCount, n, 0, 0, 0);
        this.lastInstanceCount = n;
        return n;
    }
    destroyMeshGpu() {
        if (this.vertexHandle) {
            this.bootstrap.gpu.destroyBuffer(this.vertexHandle);
            this.vertexHandle = null;
        }
        if (this.indexHandle) {
            this.bootstrap.gpu.destroyBuffer(this.indexHandle);
            this.indexHandle = null;
        }
        this.vertexBuffer = null;
        this.indexBuffer = null;
        for (const t of this.textures)
            t.destroy();
        this.textures = [];
        this.baseColorView = null;
        this.normalView = null;
        this.specularView = null;
        this.bindGroup = null;
        this.ready = false;
        this.indexCount = 0;
    }
    dispose() {
        this.destroyMeshGpu();
        if (this.shipIndexHandle) {
            this.bootstrap.gpu.destroyBuffer(this.shipIndexHandle);
            this.shipIndexHandle = null;
        }
        this.shipIndexBuffer = null;
        if (this.uniformHandle) {
            this.bootstrap.gpu.destroyBuffer(this.uniformHandle);
            this.uniformHandle = null;
        }
        this.uniformBuffer = null;
        this.pipeline = null;
        this.sampler = null;
        this.shipSimBuffer = null;
        this.mesh = null;
    }
}
//# sourceMappingURL=fleet-model-gpu-layer.js.map