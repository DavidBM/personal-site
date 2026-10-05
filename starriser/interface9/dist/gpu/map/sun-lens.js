import { bindSceneCamera } from '../scene-camera.js';
import { SUN_LENS_WGSL } from './sun-lens.wgsl.js';
/** One small uniform and four quads, independent of ships, bloom and battle FX. */
export class SunLens {
    constructor(bootstrap, coordinates) {
        this.pipeline = null;
        this.uniform = null;
        this.bind = null;
        this.depth = null;
        this.pending = null;
        this.disposed = false;
        this.data = new Float32Array(24);
        this.bootstrap = bootstrap;
        this.coordinates = coordinates;
    }
    warm() {
        return this.pending ?? (this.pending = this.initialize());
    }
    async initialize() {
        const device = this.bootstrap.device, module = device.createShaderModule({ label: 'sun-lens', code: SUN_LENS_WGSL });
        const pipeline = await device.createRenderPipelineAsync({ label: 'sun-lens', layout: 'auto',
            vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: this.bootstrap.format,
                        blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }] } });
        if (this.disposed)
            return;
        this.pipeline = pipeline;
        this.uniform = device.createBuffer({ label: 'sun-lens-view', size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    }
    encode(encoder, target, depth, frame, width, height, radius) {
        if (!this.pipeline || !this.uniform)
            return;
        const device = this.bootstrap.device, eye = this.coordinates.system.eye, data = this.data;
        data.set(this.coordinates.system.viewProj);
        data[16] = width;
        data[17] = height;
        data[18] = radius;
        data[19] = 1 / frame.tanHalfFov;
        data[20] = eye.x;
        data[21] = eye.y;
        data[22] = eye.z;
        device.queue.writeBuffer(this.uniform, 0, data);
        if (!this.bind || this.depth !== depth) {
            this.depth = depth;
            this.bind = device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
                    { binding: 0, resource: { buffer: this.uniform } }, { binding: 1, resource: depth }
                ] });
        }
        const pass = encoder.beginRenderPass({ label: 'sun-lens', colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }] });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bind);
        bindSceneCamera(device, pass, this.pipeline);
        pass.draw(6, 4);
        pass.end();
    }
    dispose() { this.disposed = true; this.uniform?.destroy(); this.uniform = null; this.pipeline = null; this.bind = null; this.depth = null; }
}
//# sourceMappingURL=sun-lens.js.map