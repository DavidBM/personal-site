export const SELECTIVE_COPY_WGSL = /* wgsl */ `
@group(0) @binding(0) var source:texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4<f32>{
  return vec4<f32>(array<vec2<f32>,3>(vec2(-1.0,-1.0),vec2(3.0,-1.0),vec2(-1.0,3.0))[i],0.0,1.0);
}
@fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{return textureLoad(source,vec2<i32>(p.xy),0);}
`;
export const SELECTIVE_DEPTH_WGSL = /* wgsl */ `
@group(0) @binding(0) var source:texture_depth_multisampled_2d;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4<f32>{
  return vec4<f32>(array<vec2<f32>,3>(vec2(-1.0,-1.0),vec2(3.0,-1.0),vec2(-1.0,3.0))[i],0.0,1.0);
}
@fragment fn fs(@builtin(position) p:vec4<f32>)->@builtin(frag_depth) f32 {
  var z=0.0;
  for(var s=0;s<4;s++){z=max(z,textureLoad(source,vec2<i32>(p.xy),s));}
  return z; // Reversed Z: retain the nearest opaque sample at silhouettes.
}
`;
/** Owns only the experimental pass bridge. No allocations when disabled. */
export class SelectiveMsaa {
    constructor(bootstrap) {
        this.color = null;
        this.depth = null;
        this.w = 0;
        this.h = 0;
        this.bootstrap = bootstrap;
        const device = bootstrap.device;
        const color = device.createShaderModule({ label: 'selective-color-copy', code: SELECTIVE_COPY_WGSL });
        this.copy = device.createRenderPipeline({ label: 'selective-color-copy', layout: 'auto',
            vertex: { module: color, entryPoint: 'vs' }, fragment: { module: color, entryPoint: 'fs', targets: [{ format: bootstrap.format }] },
            multisample: { count: 4 } });
        const depth = device.createShaderModule({ label: 'selective-depth-resolve', code: SELECTIVE_DEPTH_WGSL });
        this.resolveDepth = device.createRenderPipeline({ label: 'selective-depth-resolve', layout: 'auto',
            vertex: { module: depth, entryPoint: 'vs' }, fragment: { module: depth, entryPoint: 'fs', targets: [] },
            depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'always' } });
    }
    ensure(w, h, sourceDepth) {
        if (w === this.w && h === this.h)
            return;
        this.disposeTargets();
        this.w = w;
        this.h = h;
        const device = this.bootstrap.device;
        this.color = device.createTexture({ label: 'selective-body-color', size: [w, h], format: this.bootstrap.format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
        this.depth = device.createTexture({ label: 'selective-opaque-depth', size: [w, h], format: 'depth32float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
        this.colorView = this.color.createView();
        this.depthView = this.depth.createView();
        this.copyGroup = device.createBindGroup({ layout: this.copy.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.colorView }] });
        this.depthGroup = device.createBindGroup({ layout: this.resolveDepth.getBindGroupLayout(0), entries: [{ binding: 0, resource: sourceDepth }] });
    }
    seedColor(encoder, target) {
        const pass = encoder.beginRenderPass({ label: 'selective-seed-msaa', colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
        pass.setPipeline(this.copy);
        pass.setBindGroup(0, this.copyGroup);
        pass.draw(3);
        pass.end();
    }
    resolveOpaqueDepth(encoder) {
        const pass = encoder.beginRenderPass({ label: 'selective-resolve-depth', colorAttachments: [], depthStencilAttachment: { view: this.depthView, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 0 } });
        pass.setPipeline(this.resolveDepth);
        pass.setBindGroup(0, this.depthGroup);
        pass.draw(3);
        pass.end();
    }
    disposeTargets() { this.color?.destroy(); this.depth?.destroy(); this.color = null; this.depth = null; }
    dispose() { this.disposeTargets(); this.w = 0; this.h = 0; }
}
//# sourceMappingURL=selective-msaa.js.map