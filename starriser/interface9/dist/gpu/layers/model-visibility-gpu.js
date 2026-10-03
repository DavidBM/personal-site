import { sceneCameraShader, bindSceneCamera } from '../scene-camera.js';
import { readGpuBuffer } from '../buffer-readback.js';
import { writeModelFrustumPlanes } from '../../lib/fleet-sim/visual/model-visibility.js';
import { buildModelVisibilityWgsl, MODEL_VISIBILITY_GROUP_SIZE, MODEL_VISIBILITY_UNIFORM_BYTES, MODEL_VISIBILITY_MAX_BATCHES } from '../../lib/fleet-sim/gpu/model-visibility.wgsl.js';
function createBuffers(device, capacity, outputBytes, batchCount) {
    const uniform = device.createBuffer({ label: 'model-visibility-uniform', size: MODEL_VISIBILITY_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    let workspace = null, output = null;
    try {
        workspace = device.createBuffer({ label: 'model-visibility-workspace', size: (capacity + Math.ceil(capacity / MODEL_VISIBILITY_GROUP_SIZE) * batchCount) * 4, usage: GPUBufferUsage.STORAGE });
        output = device.createBuffer({ label: 'model-visible-indices-indirect', size: outputBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC });
        return { uniform, workspace, output };
    }
    catch (error) {
        output?.destroy();
        workspace?.destroy();
        uniform.destroy();
        throw error;
    }
}
function createLayout(device) {
    return device.createBindGroupLayout({ label: 'model-visibility-layout', entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        ] });
}
function createPipelines(device, layout, capacity, indirectWords, batchCount, partitions) {
    const module = device.createShaderModule({ label: 'model-visibility', code: sceneCameraShader(buildModelVisibilityWgsl(capacity, indirectWords, batchCount, partitions), []).replace('sphereVisible(pose.centerRel,', 'sphereVisible((sceneCamera.world * vec4<f32>(pose.centerRel,1.0)).xyz,') });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout, device.createBindGroupLayout({ entries: [] }), device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } }] })] });
    const pipeline = (entryPoint) => device.createComputePipeline({ label: `model-visibility-${entryPoint}`, layout: pipelineLayout, compute: { module, entryPoint } });
    return { classify: pipeline('classify'), scan: pipeline('scanGroups'), scatter: pipeline('scatter') };
}
export class ModelVisibilityGpu {
    constructor(bootstrap, capacity, ranges = [], partitions = false) {
        this.uniformData = new ArrayBuffer(MODEL_VISIBILITY_UNIFORM_BYTES);
        this.floats = new Float32Array(this.uniformData);
        this.words = new Uint32Array(this.uniformData);
        this.shipBuffer = null;
        this.fleetBuffer = null;
        this.candidateBuffer = null;
        this.bindGroup = null;
        this.candidateCount = 0;
        this.disposed = false;
        this.ranges = ranges;
        this.batchCount = Math.max(1, ranges.length);
        if (this.batchCount > MODEL_VISIBILITY_MAX_BATCHES)
            throw new Error("Too many model visibility bins");
        this.bootstrap = bootstrap;
        this.capacity = capacity;
        this.indirectOffset = Math.ceil(capacity * 4 / 256) * 256;
        this.compositeOffset = this.indirectOffset + this.batchCount * 32;
        this.outputBytes = this.compositeOffset + 16;
        this.layout = createLayout(bootstrap.device);
        this.pipelines = createPipelines(bootstrap.device, this.layout, capacity, this.indirectOffset / 4, this.batchCount, partitions);
        this.buffers = createBuffers(bootstrap.device, capacity, this.outputBytes, this.batchCount);
        this.outputBuffer = this.buffers.output;
    }
    setInputs(ship, fleet, candidates) {
        this.assertAvailable();
        if (ship === this.shipBuffer && fleet === this.fleetBuffer && candidates === this.candidateBuffer)
            return;
        const bindGroup = this.bootstrap.device.createBindGroup({ label: 'model-visibility-bind', layout: this.layout, entries: [
                { binding: 0, resource: { buffer: this.buffers.uniform } },
                { binding: 1, resource: { buffer: ship } }, { binding: 2, resource: { buffer: fleet } },
                { binding: 3, resource: { buffer: candidates } }, { binding: 4, resource: { buffer: this.buffers.workspace } },
                { binding: 5, resource: { buffer: this.buffers.output } },
            ] });
        this.bindGroup = bindGroup;
        this.shipBuffer = ship;
        this.fleetBuffer = fleet;
        this.candidateBuffer = candidates;
    }
    clearFrame() { this.candidateCount = 0; }
    encode(encoder, viewProj, origin, modelScale, meshRadius, count, indexCount, lodMask = 0, partitions) {
        this.assertAvailable();
        if (partitions && partitions.length > 3)
            throw new Error("Too many model visibility LOD partitions");
        this.candidateCount = Math.min(count, this.capacity);
        if (!this.bindGroup || this.candidateCount === 0)
            return;
        this.writeUniforms(viewProj, origin, modelScale, meshRadius, indexCount, lodMask, partitions);
        const groups = Math.ceil(this.candidateCount / MODEL_VISIBILITY_GROUP_SIZE);
        this.dispatch(encoder, this.pipelines.classify, groups, 'model-visibility-classify');
        this.dispatch(encoder, this.pipelines.scan, this.batchCount, 'model-visibility-prefix');
        this.dispatch(encoder, this.pipelines.scatter, groups, 'model-visibility-scatter');
    }
    writeUniforms(viewProj, origin, modelScale, meshRadius, indexCount, lodMask, partitions) {
        writeModelFrustumPlanes(this.floats, 0, viewProj);
        this.floats[24] = origin.x;
        this.floats[25] = origin.y;
        this.floats[26] = origin.z;
        this.floats[27] = modelScale;
        this.floats[28] = meshRadius;
        this.words[29] = this.candidateCount;
        this.words[30] = indexCount;
        this.words[31] = Math.ceil(this.candidateCount / MODEL_VISIBILITY_GROUP_SIZE);
        this.words[32] = lodMask >>> 0;
        for (let batch = 0; batch < this.ranges.length; batch++) {
            this.words[36 + batch * 4] = this.ranges[batch].indexCount;
            this.words[37 + batch * 4] = this.ranges[batch].firstIndex;
        }
        const partBase = 36 + MODEL_VISIBILITY_MAX_BATCHES * 4;
        this.words.fill(0, partBase);
        let first = 0;
        partitions?.forEach((part, index) => {
            const count = Math.max(1, part.ranges.length), at = partBase + index * 4;
            this.words.set([first, count, part.lodMask, 0], at);
            this.floats.set([part.modelScale, part.meshRadius, 0, 0], partBase + 12 + index * 4);
            first += count;
        });
        this.bootstrap.device.queue.writeBuffer(this.buffers.uniform, 0, this.uniformData);
    }
    dispatch(encoder, pipeline, groups, label) {
        if (groups <= 0)
            return;
        const pass = encoder.beginComputePass({ label });
        pass.setPipeline(pipeline);
        bindSceneCamera(this.bootstrap.device, pass, pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.dispatchWorkgroups(groups);
        pass.end();
    }
    /** Compact explicit diagnostic read; never copies the visible index list. */
    async readbackCount(firstBatch = 0, batchCount = this.batchCount) {
        this.assertAvailable();
        if (this.candidateCount === 0)
            return 0;
        const bytes = await readGpuBuffer(this.bootstrap.device, this.outputBuffer, this.indirectOffset, this.outputBytes - this.indirectOffset);
        const values = new Uint32Array(bytes);
        let count = 0;
        for (let batch = firstBatch; batch < firstBatch + batchCount; batch++)
            count += values[batch * 8 + 1] ?? 0;
        return count;
    }
    async readback(firstBatch = 0, batchCount = this.batchCount) {
        this.assertAvailable();
        const candidateCount = this.candidateCount;
        if (candidateCount === 0)
            return { candidateCount: 0, visibleCount: 0, indices: new Uint32Array(0) };
        // One copy includes both the complete list and args, even if the live loop advances later.
        const bytes = await readGpuBuffer(this.bootstrap.device, this.outputBuffer, 0, this.outputBytes);
        this.assertAvailable();
        const view = new DataView(bytes);
        let count = 0;
        for (let batch = firstBatch; batch < firstBatch + batchCount; batch++)
            count += view.getUint32(this.indirectOffset + batch * 32 + 4, true);
        if (count > candidateCount)
            throw new Error('Model visibility count exceeds selected candidates');
        return { candidateCount, visibleCount: count, indices: new Uint32Array(bytes, this.batchCount > 1 ? view.getUint32(this.indirectOffset + firstBatch * 32 + 20, true) * 4 : 0, count).slice() };
    }
    assertAvailable() {
        if (this.disposed || this.bootstrap.isLost)
            throw new Error("Model visibility is unavailable");
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.buffers.uniform.destroy();
        this.buffers.workspace.destroy();
        this.buffers.output.destroy();
        this.bindGroup = null;
        this.shipBuffer = null;
        this.fleetBuffer = null;
        this.candidateBuffer = null;
    }
}
//# sourceMappingURL=model-visibility-gpu.js.map