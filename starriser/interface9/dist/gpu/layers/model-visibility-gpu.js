import { readGpuBuffer } from '../buffer-readback.js';
import { writeModelFrustumPlanes } from '../../lib/fleet-sim/visual/model-visibility.js';
import { buildModelVisibilityWgsl, MODEL_VISIBILITY_GROUP_SIZE, MODEL_VISIBILITY_UNIFORM_BYTES } from '../../lib/fleet-sim/gpu/model-visibility.wgsl.js';
function createBuffers(device, capacity, outputBytes) {
    const uniform = device.createBuffer({ label: 'model-visibility-uniform', size: MODEL_VISIBILITY_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    let workspace = null, output = null;
    try {
        workspace = device.createBuffer({ label: 'model-visibility-workspace', size: (capacity + Math.ceil(capacity / MODEL_VISIBILITY_GROUP_SIZE)) * 4, usage: GPUBufferUsage.STORAGE });
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
function createPipelines(device, layout, capacity, indirectWords) {
    const module = device.createShaderModule({ label: 'model-visibility', code: buildModelVisibilityWgsl(capacity, indirectWords) });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const pipeline = (entryPoint) => device.createComputePipeline({ label: `model-visibility-${entryPoint}`, layout: pipelineLayout, compute: { module, entryPoint } });
    return { classify: pipeline('classify'), scan: pipeline('scanGroups'), scatter: pipeline('scatter') };
}
export class ModelVisibilityGpu {
    constructor(bootstrap, capacity) {
        this.uniformData = new ArrayBuffer(MODEL_VISIBILITY_UNIFORM_BYTES);
        this.floats = new Float32Array(this.uniformData);
        this.words = new Uint32Array(this.uniformData);
        this.shipBuffer = null;
        this.fleetBuffer = null;
        this.candidateBuffer = null;
        this.bindGroup = null;
        this.candidateCount = 0;
        this.disposed = false;
        this.bootstrap = bootstrap;
        this.capacity = capacity;
        this.indirectOffset = Math.ceil(capacity * 4 / 256) * 256;
        this.layout = createLayout(bootstrap.device);
        this.pipelines = createPipelines(bootstrap.device, this.layout, capacity, this.indirectOffset / 4);
        this.buffers = createBuffers(bootstrap.device, capacity, this.indirectOffset + 20);
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
    encode(encoder, viewProj, origin, modelScale, meshRadius, count, indexCount) {
        this.assertAvailable();
        this.candidateCount = Math.min(count, this.capacity);
        if (!this.bindGroup || this.candidateCount === 0)
            return;
        this.writeUniforms(viewProj, origin, modelScale, meshRadius, indexCount);
        const groups = Math.ceil(this.candidateCount / MODEL_VISIBILITY_GROUP_SIZE);
        this.dispatch(encoder, this.pipelines.classify, groups, 'model-visibility-classify');
        this.dispatch(encoder, this.pipelines.scan, 1, 'model-visibility-prefix');
        this.dispatch(encoder, this.pipelines.scatter, groups, 'model-visibility-scatter');
    }
    writeUniforms(viewProj, origin, modelScale, meshRadius, indexCount) {
        writeModelFrustumPlanes(this.floats, 0, viewProj);
        this.floats[24] = origin.x;
        this.floats[25] = origin.y;
        this.floats[26] = origin.z;
        this.floats[27] = modelScale;
        this.floats[28] = meshRadius;
        this.words[29] = this.candidateCount;
        this.words[30] = indexCount;
        this.words[31] = Math.ceil(this.candidateCount / MODEL_VISIBILITY_GROUP_SIZE);
        this.bootstrap.device.queue.writeBuffer(this.buffers.uniform, 0, this.uniformData);
    }
    dispatch(encoder, pipeline, groups, label) {
        const pass = encoder.beginComputePass({ label });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.dispatchWorkgroups(groups);
        pass.end();
    }
    async readback() {
        this.assertAvailable();
        const candidateCount = this.candidateCount;
        if (candidateCount === 0)
            return { candidateCount: 0, visibleCount: 0, indices: new Uint32Array(0) };
        // One copy includes both the complete list and args, even if the live loop advances later.
        const bytes = await readGpuBuffer(this.bootstrap.device, this.outputBuffer, 0, this.indirectOffset + 20);
        this.assertAvailable();
        const count = new DataView(bytes).getUint32(this.indirectOffset + 4, true);
        if (count > candidateCount)
            throw new Error('Model visibility count exceeds selected candidates');
        return { candidateCount, visibleCount: count, indices: new Uint32Array(bytes, 0, count).slice() };
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