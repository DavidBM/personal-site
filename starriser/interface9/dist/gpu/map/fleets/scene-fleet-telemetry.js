import { SHIP_BYTES, SHIP_WORDS } from '../../../lib/ship-runtime/ship-layout.mjs';
export class SceneFleetTelemetry {
    constructor(device, source) {
        this.pipeline = null;
        this.pending = false;
        this.submittedRead = false;
        this.closed = false;
        this.nextAt = 0;
        this.fence = '';
        this.debugOwner = null;
        this.sampledOwner = null;
        this.sampleCount = 0;
        this.debugRevision = 0;
        this.sampledRevision = 0;
        this.time = 0;
        this.sampleWallMs = 0;
        this.shipsWallMs = -Infinity;
        this.indices = new Uint32Array(12 * SHIP_WORDS);
        this.travel = new Map();
        this.ships = [];
        this.stats = { samples: 0, inspections: 0, maxRepresentatives: 0, readbackBytes: 0 };
        this.device = device;
        this.source = source;
        this.travelBytes = source.fleetCount * 64;
        this.staging = device.createBuffer({ label: 'fleet-telemetry-readback', size: this.travelBytes + 12 * SHIP_BYTES, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        this.output = device.createBuffer({ label: 'selected-fleet-navigation-inspection', size: 12 * SHIP_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    }
    select(owner) {
        if (owner === this.debugOwner)
            return;
        this.debugOwner = owner;
        this.ships = [];
        this.debugRevision++;
    }
    freshShips(nowMs = performance.now()) {
        return observationFresh(this.shipsWallMs, nowMs) ? this.ships : [];
    }
    freshTravel(slot, nowMs = performance.now()) {
        const sample = this.travel.get(slot);
        return sample && observationFresh(sample.observedWallMs, nowMs) ? sample : undefined;
    }
    inspectionPipeline() {
        if (this.pipeline)
            return this.pipeline;
        const entries = [0, 1, 2, 4, 8, 9].map(binding => ({ binding, visibility: GPUShaderStage.COMPUTE,
            buffer: { type: binding === 0 || binding === 9 ? 'uniform' : binding === 1 || binding === 4 ? 'read-only-storage' : 'storage' } }));
        const layout = this.device.createBindGroupLayout({ entries });
        this.pipeline = this.device.createComputePipeline({ layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
            compute: { module: this.source.module, entryPoint: 'inspectNavigation' } });
        return this.pipeline;
    }
    encode(encoder, poses, tuning, nowMs, fence, representatives) {
        if (this.closed || this.pending || nowMs < this.nextAt)
            return;
        this.nextAt = nowMs + 200;
        this.pending = true;
        this.submittedRead = true;
        this.fence = fence;
        this.time = nowMs;
        this.sampleWallMs = performance.now();
        this.sampledRevision = this.debugRevision;
        this.sampledOwner = this.debugOwner;
        this.sampleCount = this.debugOwner ? Math.min(12, representatives.length) : 0;
        this.stats.samples++;
        this.stats.readbackBytes += this.travelBytes + this.sampleCount * SHIP_BYTES;
        this.stats.inspections += Number(this.sampleCount > 0);
        this.stats.maxRepresentatives = Math.max(this.stats.maxRepresentatives, this.sampleCount);
        encoder.copyBufferToBuffer(this.source.control, this.source.travelOffset, this.staging, 0, this.travelBytes);
        if (!this.sampleCount)
            return;
        this.indices.fill(0);
        for (let i = 0; i < this.sampleCount; i++)
            this.indices[i * SHIP_WORDS + 23] = representatives[i];
        this.device.queue.writeBuffer(this.output, 0, this.indices);
        const pipeline = this.inspectionPipeline();
        const buffers = [this.source.uniform, poses, this.output, this.source.orders, this.source.control, tuning];
        const bind = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [0, 1, 2, 4, 8, 9].map((binding, i) => ({ binding, resource: { buffer: buffers[i] } })) });
        const pass = encoder.beginComputePass({ label: 'selected-fleet-navigation-debug' });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bind);
        pass.dispatchWorkgroups(this.sampleCount);
        pass.end();
        encoder.copyBufferToBuffer(this.output, 0, this.staging, this.travelBytes, this.sampleCount * SHIP_BYTES);
    }
    submitted(currentFence) {
        if (!this.submittedRead)
            return;
        this.submittedRead = false;
        void this.read(currentFence);
    }
    async read(currentFence) {
        try {
            await this.staging.mapAsync(GPUMapMode.READ);
            if (this.closed || currentFence() !== this.fence)
                return;
            const bytes = this.staging.getMappedRange();
            this.acceptTravel(new Float32Array(bytes, 0, this.travelBytes / 4));
            if (this.sampledOwner === this.debugOwner && this.sampledRevision === this.debugRevision) {
                this.ships = decodeDebugShips(bytes, this.travelBytes, this.sampleCount);
                this.shipsWallMs = this.sampleWallMs;
            }
        }
        catch { /* Device loss or teardown cancels only telemetry. */ }
        finally {
            if (!this.closed && this.staging.mapState === 'mapped')
                this.staging.unmap();
            this.pending = false;
        }
    }
    acceptTravel(f) {
        this.travel.clear();
        for (let slot = 0; slot < this.source.fleetCount; slot++) {
            const at = slot * 16;
            if (!(f[at + 3] > 0))
                continue;
            this.travel.set(slot, { center: Array.from(f.subarray(at, at + 3)), count: f[at + 3], speed: f[at + 7],
                progress: Array.from(f.subarray(at + 8, at + 10)), quorum: f[at + 11], token: f[at + 12], departure: f[at + 13], turboCount: f[at + 14],
                arrivalRemaining: f[at + 13] === 3 || f[at + 13] === 4 ? f[at + 15] : undefined, observedMs: this.time, observedWallMs: this.sampleWallMs });
        }
    }
    invalidate() { this.travel.clear(); this.ships = []; this.nextAt = 0; this.debugRevision++; }
    destroy() { this.closed = true; this.travel.clear(); this.ships = []; this.staging.destroy(); this.output.destroy(); }
}
export function decodeDebugShips(bytes, offset, count) {
    const result = [];
    for (let i = 0; i < count; i++) {
        const f = new Float32Array(bytes, offset + i * SHIP_BYTES, SHIP_WORDS), w = new Uint32Array(bytes, offset + i * SHIP_BYTES, SHIP_WORDS);
        if (!w[22] || !Number.isFinite(f[0]))
            continue;
        const vector = (at) => Array.from(f.subarray(at, at + 3));
        result.push({ id: w[23], type: (w[20] >>> 8) & 31, position: vector(0), velocity: vector(4), navigation: vector(8), reach: f[11],
            formation: vector(28), phase: f[31], avoidance: vector(32), repelRadius: f[35], limits: Array.from(f.subarray(16, 20)) });
    }
    return result;
}
/** Observation age uses wall time so a paused scene cannot make stale data fresh. */
export function observationFresh(observedWallMs, nowMs) {
    return nowMs >= observedWallMs && nowMs - observedWallMs <= 1000;
}
//# sourceMappingURL=scene-fleet-telemetry.js.map