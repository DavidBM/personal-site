import { MAP_MSAA_SAMPLES } from '../../map-msaa.js';
export const STAR_COUNT = 5000;
/** Normalized world positions and stable photometry, generated/uploaded once. */
export function makeStarField(count = STAR_COUNT) {
    let seed = 0x47a1a9;
    const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
    const data = new Float32Array(count * 8);
    for (let i = 0; i < count; i++) {
        const angle = random() * Math.PI * 2, r = Math.sqrt(random()) * 1.4;
        const o = i * 8, bright = random();
        data[o] = Math.cos(angle) * r;
        data[o + 1] = -(0.08 + random() * 1.0);
        data[o + 2] = Math.sin(angle) * r;
        data[o + 3] = 0.65 + bright * bright * 1.7;
        const warm = random() > 0.8;
        data[o + 4] = warm ? 0.95 : 0.65;
        data[o + 5] = warm ? 0.79 : 0.8;
        data[o + 6] = warm ? 0.65 : 1;
        data[o + 7] = 0.15 + bright * bright * 0.5;
    }
    return data;
}
const SHADER = /* wgsl */ `
struct U { vp:mat4x4<f32>, center:vec4<f32>, screen:vec4<f32> };
@group(0) @binding(0) var<uniform> u:U;
struct Out { @builtin(position) p:vec4<f32>, @location(0) uv:vec2<f32>, @location(1) color:vec4<f32> };
@vertex fn vs(@builtin(vertex_index) v:u32,@location(0) point:vec4<f32>,@location(1) color:vec4<f32>)->Out {
  let corners=array<vec2<f32>,6>(vec2(-1.,-1.),vec2(1.,-1.),vec2(1.,1.),vec2(-1.,-1.),vec2(1.,1.),vec2(-1.,1.));
  let q=corners[v]; var o:Out;
  o.p=u.vp*vec4(u.center.xyz+point.xyz*u.center.w,1.);
  // Fixed CSS size; real world position gives translation parallax. No twinkle.
  o.p.x+=q.x*point.w/u.screen.x*o.p.w;
  o.p.y+=q.y*point.w/u.screen.y*o.p.w;
  o.uv=q;o.color=vec4(color.rgb,color.a*u.screen.z);return o;
}
@fragment fn fs(o:Out)->@location(0) vec4<f32>{
  let r=length(o.uv);let aa=max(fwidth(r),0.15);
  return vec4(o.color.rgb,o.color.a*(1.-smoothstep(1.-aa,1.,r)));
}`;
export class GalaxyStarField {
    constructor(bootstrap) {
        this.enabled = true;
        this.data = new Float32Array(24);
        this.bootstrap = bootstrap;
        const { device, format } = bootstrap;
        const module = device.createShaderModule({ label: 'galaxy-star-field', code: SHADER });
        this.pipeline = device.createRenderPipeline({ label: 'galaxy-star-field', layout: 'auto',
            vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 32, stepMode: 'instance', attributes: [
                            { shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }
                        ] }] },
            fragment: { module, entryPoint: 'fs', targets: [{ format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } } }] },
            primitive: { topology: 'triangle-list' }, multisample: { count: MAP_MSAA_SAMPLES } });
        const stars = makeStarField();
        this.vertices = device.createBuffer({ label: 'galaxy-stars-static', size: stars.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(this.vertices, 0, stars);
        this.uniform = device.createBuffer({ label: 'galaxy-star-uniform', size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.bind = device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.uniform } }] });
    }
    encode(pass, frame, coordinates, bounds) {
        if (!this.enabled || frame.galaxyFade < 0.02)
            return;
        const { galaxy } = coordinates, d = this.data;
        d.set(galaxy.viewProj);
        d[16] = bounds.x - galaxy.origin.x;
        d[17] = -galaxy.origin.y;
        d[18] = bounds.z - galaxy.origin.z;
        d[19] = bounds.extent;
        d[20] = frame.cssWidth;
        d[21] = frame.cssHeight;
        d[22] = frame.galaxyFade;
        this.bootstrap.device.queue.writeBuffer(this.uniform, 0, d);
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bind);
        pass.setVertexBuffer(0, this.vertices);
        pass.draw(6, STAR_COUNT);
    }
    dispose() { this.vertices.destroy(); this.uniform.destroy(); }
}
//# sourceMappingURL=star-field.js.map