import { ConnectionLineStore } from '../connection-line-store.js';
import { MAP_MSAA_SAMPLES } from '../map-msaa.js';
const CODE = /* wgsl */ `
struct U{vp:mat4x4<f32>,origin:vec4<f32>,low:vec4<f32>,screen:vec4<f32>}
@group(0) @binding(0) var<uniform> u:U;
struct V{@builtin(position) p:vec4<f32>,@location(0) q:vec2<f32>}
@vertex fn vs(@builtin(vertex_index) i:u32,@location(0) ah:vec3<f32>,@location(1) al:vec3<f32>,@location(2) bh:vec3<f32>,@location(3) bl:vec3<f32>)->V{
 var a=u.vp*vec4((ah-u.origin.xyz)+(al-u.low.xyz),1.);var b=u.vp*vec4((bh-u.origin.xyz)+(bl-u.low.xyz),1.);
 var o:V;o.p=vec4(2.,2.,2.,1.);o.q=vec2(0.);if(a.w<=0.00001&&b.w<=0.00001){return o;}
 if(a.w<0.00001){a=mix(a,b,(0.00001-a.w)/(b.w-a.w));}
 if(b.w<0.00001){b=mix(b,a,(0.00001-b.w)/(a.w-b.w));}
 let pa=a.xy/a.w*u.screen.xy*.5;let pb=b.xy/b.w*u.screen.xy*.5;
 let d=pb-pa;let len=length(d);if(len<.01){return o;}let n=vec2(-d.y,d.x)/len;
 let corners=array<vec2<f32>,6>(vec2(0.,-1.),vec2(1.,-1.),vec2(1.,1.),vec2(0.,-1.),vec2(1.,1.),vec2(0.,1.));
 let c=corners[i];let p=mix(a,b,c.x);o.p=vec4(p.xy+n*c.y*3.5/u.screen.xy*2.*p.w,p.zw);o.q=vec2(c.x*len,c.y*3.5);return o;
}
@fragment fn fs(v:V)->@location(0) vec4<f32>{
 let edge=1.-smoothstep(2.8,3.5,abs(v.q.y));let core=1.-smoothstep(1.1,1.8,abs(v.q.y));
 let dash=1.-smoothstep(9.,13.,abs(fract((v.q.x-u.screen.z*35.)/38.)*38.-19.));
 let bright=mix(vec3(.12,.65,.8),vec3(.85,1.,1.),dash);
 return vec4(mix(vec3(.005,.015,.03),bright,core),edge*.95);
}`;
/** Persistent route geometry; only camera/time uniforms change during animation. */
export class TravelRoutes {
    constructor(bootstrap) {
        this.store = new ConnectionLineStore();
        this.capacity = 0;
        this.data = new Float32Array(0);
        this.values = new Float32Array(28);
        this.bootstrap = bootstrap;
        const d = bootstrap.device, module = d.createShaderModule({ label: 'animated-fleet-routes', code: CODE });
        this.pipeline = d.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 48, stepMode: 'instance', attributes: [0, 1, 2, 3].map(i => ({ shaderLocation: i, offset: i * 12, format: 'float32x3' })) }] }, fragment: { module, entryPoint: 'fs', targets: [{ format: bootstrap.format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] }, primitive: { topology: 'triangle-list' }, multisample: { count: MAP_MSAA_SAMPLES } });
        this.uniform = d.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.bind = d.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.uniform } }] });
    }
    sync() {
        const s = this.store;
        if (s.positionDirty.kind === 'clean' && this.capacity >= s.count)
            return;
        if (this.capacity < s.count) {
            this.buffer?.destroy();
            this.capacity = Math.max(s.count, this.capacity * 2, 32);
            this.data = new Float32Array(this.capacity * 12);
            this.buffer = this.bootstrap.device.createBuffer({ size: this.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        }
        for (let i = 0; i < s.count; i++)
            for (let endpoint = 0; endpoint < 2; endpoint++)
                for (let j = 0; j < 3; j++) {
                    const p = s.positions[i * 6 + endpoint * 3 + j], at = i * 12 + endpoint * 6 + j;
                    this.data[at] = p;
                    this.data[at + 3] = p - this.data[at];
                }
        if (s.count)
            this.bootstrap.device.queue.writeBuffer(this.buffer, 0, this.data, 0, s.count * 12);
        s.clearDirty();
    }
    encode(pass, vp, origin, width, height, time) {
        this.sync();
        if (!this.store.count || !this.buffer)
            return;
        const u = this.values;
        u.set(vp, 0);
        u[16] = origin.x;
        u[17] = origin.y;
        u[18] = origin.z;
        u[20] = origin.x - u[16];
        u[21] = origin.y - u[17];
        u[22] = origin.z - u[18];
        u[24] = width;
        u[25] = height;
        u[26] = time;
        this.bootstrap.device.queue.writeBuffer(this.uniform, 0, u);
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bind);
        pass.setVertexBuffer(0, this.buffer);
        pass.draw(6, this.store.count);
    }
    dispose() { this.buffer?.destroy(); this.uniform.destroy(); }
}
export function isTravelRoute(key) { return key.startsWith('travel:') || key.includes(':travel:'); }
//# sourceMappingURL=travel-routes.js.map