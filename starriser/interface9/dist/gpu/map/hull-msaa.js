export const HULL_COMPOSITE_WGSL = /* wgsl */ `
@group(0) @binding(0) var hull:texture_2d<f32>;
@group(0) @binding(1) var depth:texture_depth_multisampled_2d;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4<f32>{
  return vec4<f32>(array<vec2<f32>,3>(vec2(-1.0,-1.0),vec2(3.0,-1.0),vec2(-1.0,3.0))[i],0.0,1.0);
}
struct Pixel { @location(0) color:vec4<f32>, @builtin(frag_depth) depth:f32 }
@fragment fn fs(@builtin(position) p:vec4<f32>)->Pixel {
  let xy=vec2<i32>(p.xy);let color=textureLoad(hull,xy,0);
  if(color.a==0.0){discard;}
  var nearest=0.0;
  for(var sample=0;sample<4;sample++){nearest=max(nearest,textureLoad(depth,xy,sample));}
  return Pixel(color,nearest);
}
`;
/** Only high hulls touch these 4x attachments. The composite depth-tests against
 * the existing 1x scene and adds hull depth for trails/atmospheres/warp. No full
 * scene color broadcast, no depth seed, and no shader variants on other layers.
 * Resolved coverage is premultiplied; inter-layer occlusion stays 1x. */
export class HullMsaa {
    constructor(bootstrap) {
        this.color = null;
        this.resolved = null;
        this.depth = null;
        this.width = 0;
        this.height = 0;
        this.bootstrap = bootstrap;
        const module = bootstrap.device.createShaderModule({ label: 'high-hull-composite', code: HULL_COMPOSITE_WGSL });
        this.pipeline = bootstrap.device.createRenderPipeline({ label: 'high-hull-composite', layout: 'auto',
            vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: bootstrap.format,
                        blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] },
            depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' } });
    }
    ensure(w, h) {
        if (this.color && w === this.width && h === this.height)
            return;
        this.dispose();
        this.width = w;
        this.height = h;
        const device = this.bootstrap.device;
        this.color = device.createTexture({ label: 'high-hull-msaa-color', size: [w, h], sampleCount: 4, format: this.bootstrap.format, usage: GPUTextureUsage.RENDER_ATTACHMENT });
        this.resolved = device.createTexture({ label: 'high-hull-resolved', size: [w, h], format: this.bootstrap.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
        this.depth = device.createTexture({ label: 'high-hull-msaa-depth', size: [w, h], sampleCount: 4, format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
        this.colorView = this.color.createView();
        this.resolvedView = this.resolved.createView();
        this.depthView = this.depth.createView();
        this.group = device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.resolvedView }, { binding: 1, resource: this.depthView }] });
    }
    begin(encoder, w, h) {
        this.ensure(w, h);
        return encoder.beginRenderPass({ label: 'high-hulls-4x', colorAttachments: [{ view: this.colorView, resolveTarget: this.resolvedView,
                    loadOp: 'clear', storeOp: 'discard', clearValue: [0, 0, 0, 0] }],
            depthStencilAttachment: { view: this.depthView, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    }
    composite(encoder, target, sceneDepth, indirect) {
        const pass = encoder.beginRenderPass({ label: 'high-hulls-composite', colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }],
            depthStencilAttachment: { view: sceneDepth, depthLoadOp: 'load', depthStoreOp: 'store' } });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.group);
        if (indirect)
            pass.drawIndirect(indirect.buffer, indirect.offset);
        else
            pass.draw(3);
        pass.end();
    }
    dispose() { this.color?.destroy(); this.resolved?.destroy(); this.depth?.destroy(); this.color = null; this.resolved = null; this.depth = null; }
}
//# sourceMappingURL=hull-msaa.js.map