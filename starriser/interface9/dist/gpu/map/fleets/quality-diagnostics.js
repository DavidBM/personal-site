// @ts-ignore Native shared ABI module.
import { SHIP_WGSL } from '../../../lib/ship-runtime/ship-layout.mjs';
// @ts-ignore Native scene capacity contract.
import { PILOT_ADVICE_BYTES } from '../../../lib/ship-runtime/pilot-advice-layout.mjs';
import { MAX_SHIP_CAPACITY } from '../../../lib/ship-runtime/ship-capacity.mjs';
/** Separate, opt-in reduction. No diagnostic work is embedded in physics. */
export const QUALITY_SUMMARY_WGSL = /* wgsl */ `
${SHIP_WGSL}
struct U { vp:mat4x4<f32>, origin:vec4<f32>, info:vec4<u32> }
@group(0) @binding(0) var<uniform> u:U;
@group(0) @binding(1) var<storage,read> ships:array<Ship>;
@group(0) @binding(2) var<storage,read> control:array<u32>;
@group(0) @binding(3) var<storage,read> sims:array<u32>;
@group(0) @binding(4) var<storage,read> orders:array<vec4<u32>>;
@group(0) @binding(5) var<storage,read_write> totals:array<atomic<u32>,24>;
@group(0) @binding(6) var<storage,read_write> previous:array<vec4<u32>>;
var<workgroup> sums:array<atomic<u32>,24>;
fn bump(i:u32){atomicAdd(&sums[i],1u);}
fn inspect(i:u32){
  if(i>=u.info.x){return;}
  let s=ships[i];if(s.identity.z==0u||s.identity.w==0u){previous[i]=vec4<u32>(0u);return;}
  bump(0u);
  let flags=sims[i*88u+16u];
  let tier=select(select(1u,2u,(flags&1024u)!=0u),0u,(flags&8192u)!=0u);
  bump(1u+tier);
  let p=vec3<f32>(bitcast<f32>(sims[i*88u]),bitcast<f32>(sims[i*88u+1u]),bitcast<f32>(sims[i*88u+2u]));
  let clip=u.vp*vec4<f32>(p-u.origin.xyz,1.0);
  if(clip.w>0.0&&all(abs(clip.xy)<=vec2<f32>(clip.w))&&clip.z>=0.0&&clip.z<=clip.w){bump(4u+tier);}
  let a=u.info.y+i*${PILOT_ADVICE_BYTES / 4}u;let serial=control[a];let tick=control[a+2u];let period=control[a+3u];
  let old=previous[i];
  if(old.x==s.identity.w){
    if(old.y!=tier){bump(7u);}
    if(old.z!=period){bump(8u);}
    if(old.w!=tick){bump(9u);}
  }
  previous[i]=vec4<u32>(s.identity.w,tier,period,tick);
  let mode=s.flight.w;
  let order=orders[(s.identity.x>>18u)*2u];
  let guide=u.info.z+s.identity.y*64u;
  let guideActive=s.identity.y<u.info.w&&bitcast<f32>(control[guide+62u])>0.0&&bitcast<f32>(control[guide+31u])==mode;
  if(mode>=2.0){bump(14u);return;}
  if(order.w==1u&&order.y<2u){bump(15u);return;}
  if(mode>=0.0){bump(16u);return;}
  if(mode< -3.0||!guideActive){bump(17u);return;}
  bump(10u);
  if(serial!=s.identity.w||control[a+1u]!=bitcast<u32>(s.flight.x)){bump(18u);return;}
  if(period==8u){bump(11u);}else if(period==2u){bump(12u);}else if(period==1u){bump(13u);}else{bump(18u);}
}
@compute @workgroup_size(128)
fn summary(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(local_invocation_index) lane:u32){
  if(lane<24u){atomicStore(&sums[lane],0u);}workgroupBarrier();
  inspect(gid.x);workgroupBarrier();
  if(lane<24u){atomicAdd(&totals[lane],atomicLoad(&sums[lane]));}
}
`;
export class QualityDiagnostics {
    constructor(device) {
        this.busy = false;
        this.closed = false;
        this.words = new Uint32Array(24);
        this.floats = new Float32Array(this.words.buffer);
        this.device = device;
        const make = (size, usage, label) => device.createBuffer({ size, usage, label });
        this.uniform = make(96, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'quality-summary-input');
        this.totals = make(96, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, 'quality-summary');
        this.previous = make(MAX_SHIP_CAPACITY * 16, GPUBufferUsage.STORAGE, 'quality-previous-sample');
        this.staging = make(96, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, 'quality-readback');
        this.pipeline = device.createComputePipeline({ label: 'quality-summary', layout: 'auto', compute: { module: device.createShaderModule({ code: QUALITY_SUMMARY_WGSL }), entryPoint: 'summary' } });
    }
    async sample(source) {
        if (this.busy || this.closed)
            return null;
        this.busy = true;
        try {
            this.floats.set(source.projection.subarray(8, 24));
            this.floats.set(source.projection.subarray(24, 27), 16);
            this.words.set([source.count, source.adviceBase / 4, source.guideBase / 4, source.fleetCount], 20);
            this.device.queue.writeBuffer(this.uniform, 0, this.words);
            const buffers = [this.uniform, source.state, source.control, source.sims, source.orders, this.totals, this.previous];
            const group = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })) });
            const encoder = this.device.createCommandEncoder({ label: 'optional-quality-sample' });
            encoder.clearBuffer(this.totals);
            const pass = encoder.beginComputePass({ label: 'optional-quality-summary' });
            pass.setPipeline(this.pipeline);
            pass.setBindGroup(0, group);
            pass.dispatchWorkgroups(Math.ceil(source.count / 128));
            pass.end();
            encoder.copyBufferToBuffer(this.totals, 0, this.staging, 0, 96);
            this.device.queue.submit([encoder.finish()]);
            await this.staging.mapAsync(GPUMapMode.READ);
            const result = this.closed ? null : Array.from(new Uint32Array(this.staging.getMappedRange()));
            this.staging.unmap();
            return result;
        }
        catch (error) {
            if (!this.closed)
                throw error;
            return null;
        }
        finally {
            this.busy = false;
            if (this.closed)
                this.release();
        }
    }
    dispose() { this.closed = true; if (!this.busy)
        this.release(); }
    release() { for (const b of [this.uniform, this.totals, this.previous, this.staging])
        b.destroy(); }
}
//# sourceMappingURL=quality-diagnostics.js.map