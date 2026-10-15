import { MAP_MSAA_SAMPLES } from '../map-msaa.js';
import { planetDepthOfFieldWgsl } from './planet-depth-of-field.wgsl.js';
/** Camera-space distance, not galaxy coordinates or depth-buffer nonlinearity. */
export function writePlanetLens(out, sample, coordinates, width, height, cssWidth) {
    const v = coordinates.system.view, p = coordinates.sceneClip();
    const distance = -(v[2] * sample.x + v[6] * sample.y + v[10] * sample.z + v[14]), r = sample.radius;
    if (!(distance > r && r > 0 && width > 0 && height > 0))
        return false;
    const projected = r * Math.abs(p[5]) / distance * height * .5;
    const strength = Math.max(0, Math.min(1, (projected - 6) / 26));
    out.set([width, height, 1 / width, 1 / height, distance - r * .45, r, Math.min(24, 10 * width / Math.max(1, cssWidth)), strength, p[10], p[14], 0, 0]);
    return strength > 0 && out.every(Number.isFinite);
}
/** One optional full-resolution scene target + fixed 24-tap GPU pass. No history,
 * readback, CPU pixels, DOM filter, or allocation when planet development is closed. */
export class PlanetDepthOfField {
    constructor(bootstrap, coordinates) {
        this.pipeline = null;
        this.uniform = null;
        this.sampler = null;
        this.color = null;
        this.view = null;
        this.bind = null;
        this.depth = null;
        this.width = 0;
        this.height = 0;
        this.data = new Float32Array(12);
        this.bootstrap = bootstrap;
        this.coordinates = coordinates;
    }
    prepare(frame, width, height, depth) {
        if (!frame.sceneOpen || !frame.planetFocus || !depth || !writePlanetLens(this.data, frame.planetFocus, this.coordinates, width, height, frame.cssWidth)) {
            this.release();
            return null;
        }
        this.ensurePipeline();
        this.ensureTarget(width, height, depth);
        this.bootstrap.device.queue.writeBuffer(this.uniform, 0, this.data);
        return this.view;
    }
    encode(encoder, target) {
        const pass = encoder.beginRenderPass({ label: 'planet-depth-of-field', colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bind);
        pass.draw(3);
        pass.end();
    }
    ensurePipeline() {
        if (this.pipeline)
            return;
        const d = this.bootstrap.device, module = d.createShaderModule({ label: 'planet-depth-of-field', code: planetDepthOfFieldWgsl(MAP_MSAA_SAMPLES, this.coordinates.reverseDepth) });
        const layout = d.createBindGroupLayout({ entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', multisampled: MAP_MSAA_SAMPLES > 1 } },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            ] });
        this.pipeline = d.createRenderPipeline({ label: 'planet-depth-of-field', layout: d.createPipelineLayout({ bindGroupLayouts: [layout] }), vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: this.bootstrap.format }] } });
        this.uniform = d.createBuffer({ label: 'planet-lens', size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.sampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    }
    ensureTarget(width, height, depth) {
        if (!this.color || this.width !== width || this.height !== height) {
            this.release();
            this.width = width;
            this.height = height;
            this.color = this.bootstrap.device.createTexture({ label: 'planet-scene-color', size: [width, height], format: this.bootstrap.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
            this.view = this.color.createView();
        }
        if (this.bind && this.depth === depth)
            return;
        this.depth = depth;
        this.bind = this.bootstrap.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.view }, { binding: 1, resource: this.sampler }, { binding: 2, resource: depth }, { binding: 3, resource: { buffer: this.uniform } }] });
    }
    release() { this.color?.destroy(); this.color = null; this.view = null; this.bind = null; this.depth = null; }
    dispose() { this.release(); this.uniform?.destroy(); this.uniform = null; this.pipeline = null; this.sampler = null; }
}
//# sourceMappingURL=planet-depth-of-field.js.map