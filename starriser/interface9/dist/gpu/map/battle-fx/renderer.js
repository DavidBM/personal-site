import { FX_COMPUTE } from './compute.wgsl.js';
import { FX_DRAW } from './draw.wgsl.js';
import { FX_FLEETS, FX_SOURCE_WORDS, FX_RECORD_BYTES, fxBudget, fxLayout } from './config.js';
import { fxTuningState, FX_PROFILE_FLOATS } from '../../../features/battles/fx-tuning.js';
import { sceneCameraBuffer } from '../../scene-camera.js';
import { MAP_MSAA_SAMPLES } from '../../map-msaa.js';
/** Owns only cosmetic resources; ship positions are immutable inputs. */
export class BattleFxRenderer {
    constructor(device, format) {
        this.pending = null;
        this.disposed = false;
        this.ready = false;
        this.compute = [];
        this.render = [];
        this.records = null;
        this.computeGroup = null;
        this.drawGroup = null;
        this.depth = null;
        this.sims = null;
        this.quality = -1;
        this.tuningVersion = -1;
        this.budget = fxBudget();
        this.layout = fxLayout(this.budget);
        this.maxMembers = 0;
        this.inputVersion = -1;
        this.generation = -1;
        this.active = 0;
        this.previousTime = NaN;
        this.dispatches = new Uint32Array(4);
        this.words = new Uint32Array(20 + 6 * FX_PROFILE_FLOATS);
        this.floats = new Float32Array(this.words.buffer);
        this.sourceWords = new Uint32Array(128 + FX_FLEETS * FX_SOURCE_WORDS);
        this.clearRecords = false;
        this.running = false;
        this.lastActiveMs = -Infinity;
        this.failure = null;
        this.device = device;
        this.format = format;
        this.uniform = device.createBuffer({ label: 'battle-fx-frame', size: this.words.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.sources = device.createBuffer({ label: 'battle-fx-fleet-orders', size: this.sourceWords.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.args = device.createBuffer({ label: 'battle-fx-indirect', size: 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    }
    async initialize() {
        const d = this.device, visibility = GPUShaderStage.COMPUTE;
        this.computeLayout = d.createBindGroupLayout({ entries: [{ binding: 0, visibility, buffer: { type: 'uniform' } },
                ...Array.from({ length: 6 }, (_, i) => ({ binding: i + 1, visibility, buffer: { type: (i < 2 ? 'read-only-storage' : 'storage') } }))] });
        this.drawLayout = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
                ...[1, 2, 3].map(binding => ({ binding, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } })),
                { binding: 4, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } }] });
        const cameraLayout = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: visibility | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }] });
        const empty = d.createBindGroupLayout({ entries: [] });
        this.empty = d.createBindGroup({ layout: empty, entries: [] });
        this.camera = d.createBindGroup({ layout: cameraLayout, entries: [{ binding: 0, resource: { buffer: sceneCameraBuffer(d) } }] });
        const cp = d.createPipelineLayout({ bindGroupLayouts: [this.computeLayout, empty, cameraLayout] });
        const rp = d.createPipelineLayout({ bindGroupLayouts: [this.drawLayout, empty, cameraLayout] });
        const c = d.createShaderModule({ label: 'battle-fx-compute', code: FX_COMPUTE }), r = d.createShaderModule({ label: 'battle-fx-draw', code: FX_DRAW });
        await validateModules([c, r]);
        for (const entryPoint of ['emit', 'advance', 'prepare', 'bursts']) {
            if (this.disposed)
                return;
            this.compute.push(await d.createComputePipelineAsync({ label: `battle-fx-${entryPoint}`, layout: cp, compute: { module: c, entryPoint } }));
        }
        for (const [vertex, fragment, format] of [['core', 'fs', this.format], ['glow', 'fsGlow', 'rgba16float'], ['lens', 'fs', this.format]]) {
            if (this.disposed)
                return;
            this.render.push(await d.createRenderPipelineAsync({ label: `battle-fx-${vertex}`, layout: rp, vertex: { module: r, entryPoint: vertex },
                fragment: { module: r, entryPoint: fragment, targets: [{ format, blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }] },
                primitive: { topology: 'triangle-list' }, ...(vertex === 'core' ? { depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'greater-equal' } } : {}) }));
        }
        if (!this.disposed)
            this.ready = true;
    }
    allocate(high, low) {
        const key = Number(high) + Number(low) * 2;
        if (this.records && this.quality === key)
            return;
        this.releasePool();
        this.quality = key;
        this.budget = fxBudget(high, low);
        this.layout = fxLayout(this.budget);
        const d = this.device, l = this.layout, b = this.budget;
        this.words.set([b.emitters, b.tracers, b.torpedoes, b.beams], 4);
        this.words.set([l.torpedoes, l.beams, l.explosions, l.count], 8);
        this.words.set([0, b.explosions, l.draws, 0], 12);
        this.words[18] = b.lenses;
        this.dispatches.set([b.emitters, Math.max(b.torpedoes, b.beams), l.explosions, b.explosions].map(n => Math.ceil(n / 64)));
        this.records = d.createBuffer({ label: 'battle-fx-records', size: (l.count + this.budget.explosions) * FX_RECORD_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
        this.list = d.createBuffer({ label: 'battle-fx-visible', size: (l.draws + this.budget.lenses) * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        this.history = d.createBuffer({ label: 'battle-fx-torpedo-history', size: this.budget.torpedoes * 4 * 16, usage: GPUBufferUsage.STORAGE });
        this.computeGroup = null;
        this.drawGroup = null;
        this.previousTime = NaN;
    }
    uploadSources(input) {
        if (input.version === this.inputVersion && input.generation === this.generation)
            return;
        this.inputVersion = input.version;
        this.generation = input.generation;
        const data = this.sourceWords;
        data.fill(0);
        this.active = 0;
        this.maxMembers = 0;
        for (let slot = 0; slot < input.orders.length / 48; slot++) {
            const start = slot * 48, range = input.ranges.get(slot);
            if (!range)
                continue;
            data.set(input.orders.subarray(start, start + 48), 128 + slot * FX_SOURCE_WORDS);
            let members = 0;
            for (let k = 0; k < 6; k++)
                members += input.orders[start + 25 + k * 4];
            data.set([range.start, Math.min(range.cap, members), 0, 0], 128 + slot * FX_SOURCE_WORDS + 48);
            if (members > 0 && input.orders[start + 1] && input.orders[start + 22] === 1 && input.orders[start + 4] < 128) {
                data[this.active++] = slot;
                this.maxMembers = Math.max(this.maxMembers, Math.min(range.cap, members));
            }
        }
        this.device.queue.writeBuffer(this.sources, 0, data);
    }
    releasePool() {
        this.records?.destroy();
        this.list?.destroy();
        this.history?.destroy();
        this.records = null;
        this.computeGroup = null;
        this.drawGroup = null;
        this.previousTime = NaN;
    }
    updateClock(time) {
        const elapsed = time - this.previousTime;
        this.clearRecords = Number.isFinite(elapsed) && (elapsed < 0 || elapsed > 16);
        const dt = Number.isFinite(elapsed) && !this.clearRecords ? Math.max(0, Math.min(.1, elapsed)) : 0;
        this.previousTime = time;
        this.floats[0] = ((time % 4096) + 4096) % 4096;
        this.floats[1] = dt;
    }
    idle(nowMs) {
        this.previousTime = NaN;
        if (this.records && nowMs - this.lastActiveMs >= 1000)
            this.releasePool();
        return false;
    }
    select(input) {
        if (input.selected === 0xffffffff)
            return;
        for (const [slot, range] of input.ranges) {
            if (input.selected < range.start || input.selected >= range.start + range.cap)
                continue;
            this.words[16] = slot;
            this.words[17] = input.orders[slot * 48] + input.selected - range.start;
            return;
        }
    }
    accepts(frame, input) {
        return frame.sceneOpen && !!input && input.active > 0 && MAP_MSAA_SAMPLES === 1 && fxTuningState().enabled;
    }
    /** Called after ship presentation and camera correction; no CPU ship reads. */
    prepare(frame, input, projectionY) {
        this.running = false;
        if (!this.accepts(frame, input))
            return this.idle(frame.nowMs);
        this.uploadSources(input);
        if (this.active === 0)
            return this.idle(frame.nowMs);
        this.lastActiveMs = frame.nowMs;
        if (!this.pending)
            this.pending = this.initialize().catch(error => { if (this.disposed)
                return; this.failure = error; console.error('[battle-fx]', error); });
        if (!this.ready)
            return false;
        this.allocate(frame.highFx, input.orders.length / 48 <= 32);
        // Small fights get multiple mounts per ship instead of thousands of invalid
        // emitter rows. Dense fights retain a fixed sampled population and slot budget.
        this.words[4] = Math.min(this.budget.emitters, this.maxMembers * this.active);
        this.dispatches[0] = Math.ceil(this.words[4] / 64);
        if (this.sims !== input.sims) {
            this.sims = input.sims;
            this.computeGroup = null;
        }
        this.updateClock(input.time);
        this.words[12] = this.active;
        this.words[16] = 0xffffffff;
        this.words[17] = 0;
        this.floats[19] = projectionY;
        this.select(input);
        const tuning = fxTuningState();
        if (tuning.version !== this.tuningVersion) {
            this.tuningVersion = tuning.version;
            this.device.queue.writeBuffer(this.uniform, 80, tuning.data);
        }
        this.running = true;
        return true;
    }
    encode(encoder, width, height) {
        if (!this.running)
            return;
        this.floats[2] = width;
        this.floats[3] = height;
        this.device.queue.writeBuffer(this.uniform, 0, this.words, 0, 20);
        if (!this.computeGroup)
            this.computeGroup = this.device.createBindGroup({ layout: this.computeLayout, entries: [this.uniform, this.sources, this.sims, this.records, this.args, this.list, this.history].map((buffer, binding) => ({ binding, resource: { buffer } })) });
        if (this.clearRecords)
            encoder.clearBuffer(this.records);
        // Keep the impact ring cursor at word 13; clear only per-frame counters.
        encoder.clearBuffer(this.args, 0, 52);
        const p = encoder.beginComputePass({ label: 'battle-fx-update' });
        p.setBindGroup(0, this.computeGroup);
        p.setBindGroup(1, this.empty);
        p.setBindGroup(2, this.camera);
        for (let i = 0; i < 4; i++) {
            p.setPipeline(this.compute[i]);
            p.dispatchWorkgroups(this.dispatches[i]);
        }
        p.end();
    }
    draw(pass, depth, kind) {
        if (!this.running)
            return;
        if (this.depth !== depth || !this.drawGroup) {
            this.depth = depth;
            this.drawGroup = this.device.createBindGroup({ layout: this.drawLayout, entries: [
                    ...[this.uniform, this.records, this.list, this.history].map((buffer, binding) => ({ binding, resource: { buffer } })), { binding: 4, resource: depth }
                ] });
        }
        pass.setPipeline(this.render[kind]);
        pass.setBindGroup(0, this.drawGroup);
        pass.setBindGroup(1, this.empty);
        pass.setBindGroup(2, this.camera);
        pass.drawIndirect(this.args, kind === 2 ? 16 : 0);
    }
    get activeFrame() { return this.running; }
    diagnostics() { return { ready: this.ready, error: this.failure ? String(this.failure) : null, budget: this.budget, activeFleets: this.active, recordBytes: this.records?.size ?? 0, shaderBytes: FX_COMPUTE.length + FX_DRAW.length }; }
    dispose() { this.disposed = true; this.releasePool(); this.uniform.destroy(); this.sources.destroy(); this.args.destroy(); }
}
async function validateModules(modules) {
    for (const module of modules) {
        const info = await module.getCompilationInfo?.();
        const errors = (info?.messages ?? []).filter(m => m.type === 'error');
        if (errors.length)
            throw Error(errors.map(e => `${e.lineNum}: ${e.message}`).join('\n'));
    }
}
//# sourceMappingURL=renderer.js.map