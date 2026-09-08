const MAX_PASSES = 64;
const QUERY_COUNT = MAX_PASSES * 2;
const BUFFER_BYTES = QUERY_COUNT * 8;
function allocateResources(device) {
    const queries = device.createQuerySet({ label: 'frame-profile-queries', type: 'timestamp', count: QUERY_COUNT });
    let resolveBuffer = null;
    let readBuffer = null;
    try {
        resolveBuffer = device.createBuffer({
            label: 'frame-profile-resolve', size: BUFFER_BYTES,
            usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        });
        readBuffer = device.createBuffer({
            label: 'frame-profile-readback', size: BUFFER_BYTES,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        return { queries, resolveBuffer, readBuffer };
    }
    catch (error) {
        readBuffer?.destroy();
        resolveBuffer?.destroy();
        queries.destroy();
        throw error;
    }
}
export function createFrameGpuProfiler(device) {
    return device.features.has('timestamp-query') && device.createQuerySet ? new FrameGpuProfiler(device) : null;
}
/** One measured frame, including any follow-shadow split encoders. */
export class FrameGpuProfiler {
    constructor(device) {
        this.recorded = [];
        this.device = device;
        const resources = allocateResources(device);
        this.queries = resources.queries;
        this.resolveBuffer = resources.resolveBuffer;
        this.readBuffer = resources.readBuffer;
    }
    timestampWrites(kind, label) {
        if (this.recorded.length >= MAX_PASSES)
            throw new Error(`Frame profiler exceeds ${MAX_PASSES} passes`);
        const beginningOfPassWriteIndex = this.recorded.length * 2;
        this.recorded.push({ label: label ?? `${kind}-${this.recorded.length}`, kind });
        return { querySet: this.queries, beginningOfPassWriteIndex, endOfPassWriteIndex: beginningOfPassWriteIndex + 1 };
    }
    createEncoder(device, descriptor = {}) {
        if (device !== this.device)
            throw new Error('Frame profiler cannot mix GPU devices');
        const encoder = device.createCommandEncoder(descriptor);
        const beginCompute = encoder.beginComputePass;
        const beginRender = encoder.beginRenderPass;
        encoder.beginComputePass = (options = {}) => {
            if ('timestampWrites' in options && options.timestampWrites)
                throw new Error('Frame profiler cannot replace existing compute timestamps');
            return beginCompute.call(encoder, { ...options, timestampWrites: this.timestampWrites('compute', options.label) });
        };
        encoder.beginRenderPass = (options) => {
            if (options.timestampWrites)
                throw new Error('Frame profiler cannot replace existing render timestamps');
            return beginRender.call(encoder, { ...options, timestampWrites: this.timestampWrites('render', options.label) });
        };
        return encoder;
    }
    /** Resolve before each split submission; the last encoder contains all samples. */
    finish(encoder) {
        const count = this.recorded.length * 2;
        if (count > 0) {
            encoder.resolveQuerySet(this.queries, 0, count, this.resolveBuffer, 0);
            encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.readBuffer, 0, count * 8);
        }
        return encoder.finish();
    }
    /** Call after all measured submissions, outside the render CPU measurement. */
    async complete() {
        if (this.recorded.length === 0)
            return null;
        const bytes = this.recorded.length * 16;
        await this.readBuffer.mapAsync(GPUMapMode.READ, 0, bytes);
        try {
            const values = new BigUint64Array(this.readBuffer.getMappedRange(0, bytes));
            const passes = this.recorded.map((pass, index) => ({
                ...pass, ms: Number(values[index * 2 + 1] - values[index * 2]) / 1e6,
            }));
            return {
                gpuMs: passes.reduce((sum, pass) => sum + pass.ms, 0),
                gpuElapsedMs: Number(values[values.length - 1] - values[0]) / 1e6,
                passes,
            };
        }
        finally {
            this.readBuffer.unmap();
        }
    }
    dispose() {
        this.queries.destroy();
        this.resolveBuffer.destroy();
        this.readBuffer.destroy();
    }
}
//# sourceMappingURL=gpu-frame-profiler.js.map