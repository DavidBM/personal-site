/**
 * Mipmapped RGBA8 textures from decoded images: level 0 is copied, each further
 * level is a linear 2x2 downsample rendered from the level above. Hull textures
 * are sampled at many screen sizes; without mips a distant ship aliases into
 * shimmering noise. One pipeline per device, built on first use.
 */
const pipelines = new WeakMap();
const BLIT_WGSL = /* wgsl */ `
struct VsOut { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  var out: VsOut;
  out.position = vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2<f32>(p.x, 1.0 - p.y);
  return out;
}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@fragment fn fs(in: VsOut) -> @location(0) vec4<f32> { return textureSampleLevel(src, smp, in.uv, 0.0); }
`;
function blitPipeline(device) {
    let entry = pipelines.get(device);
    if (!entry) {
        const module = device.createShaderModule({ label: 'texture-mips', code: BLIT_WGSL });
        entry = {
            pipeline: device.createRenderPipeline({
                label: 'texture-mips', layout: 'auto',
                vertex: { module, entryPoint: 'vs' },
                fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
                primitive: { topology: 'triangle-list' },
            }),
            sampler: device.createSampler({ label: 'texture-mips', minFilter: 'linear', magFilter: 'linear' }),
        };
        pipelines.set(device, entry);
    }
    return entry;
}
export function mipLevelCount(width, height) {
    return Math.floor(Math.log2(Math.max(1, width, height))) + 1;
}
/** Upload `bitmap` with a full mip chain (level 0 exact, the rest box-filtered). */
export function createMipmappedTexture(device, bitmap, label = 'mipmapped-image') {
    const levels = mipLevelCount(bitmap.width, bitmap.height);
    const texture = device.createTexture({
        label, size: [bitmap.width, bitmap.height], format: 'rgba8unorm', mipLevelCount: levels,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    try {
        device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height]);
        if (levels > 1)
            encodeMips(device, texture, levels);
        return texture;
    }
    catch (error) {
        texture.destroy();
        throw error;
    }
}
/** Box-filter levels 1… of every array layer from level 0 (rgba8unorm, render-attachment usage). */
export function encodeMips(device, texture, levels, layers = 1) {
    const { pipeline, sampler } = blitPipeline(device);
    const encoder = device.createCommandEncoder({ label: 'texture-mips' });
    const view = (mip, layer) => texture.createView({ dimension: '2d', baseMipLevel: mip, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 });
    for (let layer = 0; layer < layers; layer++)
        for (let level = 1; level < levels; level++) {
            const source = view(level - 1, layer);
            const target = view(level, layer);
            const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
                    { binding: 0, resource: source }, { binding: 1, resource: sampler },
                ] }));
            pass.draw(3);
            pass.end();
        }
    device.queue.submit([encoder.finish()]);
}
//# sourceMappingURL=texture-mips.js.map