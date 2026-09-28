import { MAP_MSAA_SAMPLES } from '../map-msaa.js';
import { writeWarpView } from './warp-view.js';
import { warpEffectWgsl } from './warp-effect.wgsl.js';
/** Optional one-pass optical effect. Owns no ship state, history or readbacks. */
export class WarpEffect {
    constructor(bootstrap, coordinates) {
        this.pipeline = null;
        this.uniform = null;
        this.sampler = null;
        this.color = null;
        this.colorView = null;
        this.bind = null;
        this.depth = null;
        this.width = 0;
        this.height = 0;
        this.strength = 0;
        this.data = new Float32Array(16);
        this.bootstrap = bootstrap;
        this.coordinates = coordinates;
    }
    prepare(frame, width, height, depth) {
        // Compile when the quality setting is enabled, before the first warp begins.
        this.warm(frame.highFx);
        if (!frame.highFx || !frame.sceneOpen || !frame.warp || !depth) {
            this.strength = 0;
            if (!frame.highFx)
                this.releaseTarget();
            return null;
        }
        const requested = Math.min(1, Math.max(0, frame.warp.strength));
        this.strength += (requested - this.strength) * (1 - Math.exp(-Math.min(50, Math.max(0, frame.dtMs)) / 110));
        if (this.strength < .002 || !writeWarpView(this.data, frame.warp, this.coordinates, width, height, this.strength, frame.timeSec))
            return null;
        this.ensurePipeline();
        this.ensureTarget(width, height, depth);
        this.bootstrap.device.queue.writeBuffer(this.uniform, 0, this.data);
        return this.colorView;
    }
    warm(enabled) { if (enabled)
        this.ensurePipeline(); }
    encode(encoder, target) {
        const pass = encoder.beginRenderPass({ label: 'map-warp-refraction', colorAttachments: [{
                    view: target, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 },
                }] });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bind);
        pass.draw(3);
        pass.end();
    }
    ensurePipeline() {
        if (this.pipeline)
            return;
        const device = this.bootstrap.device, module = device.createShaderModule({ label: 'warp-refraction', code: warpEffectWgsl(MAP_MSAA_SAMPLES) });
        const layout = device.createBindGroupLayout({ entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', multisampled: MAP_MSAA_SAMPLES > 1 } },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            ] });
        this.pipeline = device.createRenderPipeline({ label: 'warp-refraction', layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
            vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: this.bootstrap.format }] }, primitive: { topology: 'triangle-list' } });
        this.uniform = device.createBuffer({ label: 'warp-view', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    }
    ensureTarget(width, height, depth) {
        if (!this.color || this.width !== width || this.height !== height) {
            this.releaseTarget();
            this.width = width;
            this.height = height;
            this.color = this.bootstrap.device.createTexture({ label: 'warp-scene-color', size: { width, height }, format: this.bootstrap.format,
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
            this.colorView = this.color.createView();
        }
        if (this.bind && this.depth === depth)
            return;
        this.depth = depth;
        this.bind = this.bootstrap.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
                { binding: 0, resource: this.colorView }, { binding: 1, resource: this.sampler },
                { binding: 2, resource: depth }, { binding: 3, resource: { buffer: this.uniform } },
            ] });
    }
    releaseTarget() { this.color?.destroy(); this.color = null; this.colorView = null; this.bind = null; this.depth = null; }
    dispose() { this.releaseTarget(); this.uniform?.destroy(); this.uniform = null; this.pipeline = null; this.sampler = null; }
}
//# sourceMappingURL=warp-effect.js.map