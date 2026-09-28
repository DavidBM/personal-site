import { sceneCameraBuffer } from '../../scene-camera.js';
import { mat4Identity, mat4Invert } from '../../math/mat4.js';
import { MODEL_SHIP_TYPES_WGSL } from '../../../lib/fleet-sim/gpu/model-ship-pose.wgsl.js';
export const SCENE_CAMERA_COMPUTE_WGSL = /* wgsl */ `
${MODEL_SHIP_TYPES_WGSL}
struct Input { projection:mat4x4<f32>, inverseProjection:mat4x4<f32>, view:mat4x4<f32>,
  targetHigh:vec4<f32>, targetLow:vec4<f32>, attitude:vec4<f32>, boom:vec4<f32>, owner:vec4<u32>, detail:vec4<f32> }
struct Output { clip:mat4x4<f32>, world:mat4x4<f32>, relativeViewProj:mat4x4<f32>, cameraHigh:vec4<f32>, cameraLow:vec4<f32> }
@group(0) @binding(0) var<uniform> u:Input;
@group(0) @binding(1) var<storage,read_write> ships:array<ShipSim>;
@group(0) @binding(2) var<storage,read_write> frame:Output;
@group(0) @binding(3) var<storage,read> controls:array<vec4<u32>>;
fn rotate(q:vec4<f32>,v:vec3<f32>)->vec3<f32>{return v+2.0*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
fn mul(a:vec4<f32>,b:vec4<f32>)->vec4<f32>{return vec4<f32>(a.w*b.xyz+b.w*a.xyz+cross(a.xyz,b.xyz),a.w*b.w-dot(a.xyz,b.xyz));}
@compute @workgroup_size(1) fn updateCamera(){
  let identity=mat4x4<f32>(vec4<f32>(1,0,0,0),vec4<f32>(0,1,0,0),vec4<f32>(0,0,1,0),vec4<f32>(0,0,0,1));
  frame.clip=identity;frame.world=identity;frame.relativeViewProj=identity;frame.cameraHigh=vec4<f32>(0.0);frame.cameraLow=vec4<f32>(0.0);
  if(u.owner.z==0u || u.owner.x>=arrayLength(&ships)){return;}
  let s=ships[u.owner.x];if(s.trailOwner!=u.owner.y || s.mode==0u || (s.targetKind & 4096u)==0u){return;}
  let actualQ=normalize(vec4<f32>(s.qx,s.qy,s.qz,s.qw));
  // Inverse rotation of the change from the CPU-observed hull to the displayed hull.
  let inverseDelta=normalize(mul(u.attitude,vec4<f32>(-actualQ.xyz,actualQ.w)));
  let d=mat3x3<f32>(rotate(inverseDelta,vec3<f32>(1,0,0)),rotate(inverseDelta,vec3<f32>(0,1,0)),rotate(inverseDelta,vec3<f32>(0,0,1)));
  let r=mat3x3<f32>(u.view[0].xyz,u.view[1].xyz,u.view[2].xyz);
  let delta=(vec3<f32>(s.orbitPhase,s.orbitOmega,s.omegaMax)-u.targetHigh.xyz)/560.0
    +(vec3<f32>(s.accel,s.cruiseV,s.orbitR)/560.0-u.targetLow.xyz);
  let c=r*d*transpose(r);
  let b=r*u.boom.xyz;
  let t=b-c*(b+r*delta);
  let correction=mat4x4<f32>(vec4<f32>(c[0],0),vec4<f32>(c[1],0),vec4<f32>(c[2],0),vec4<f32>(t,1));
  frame.clip=u.projection*correction*u.inverseProjection;
  let actualView=r*d;
  frame.relativeViewProj=u.projection*mat4x4<f32>(vec4<f32>(actualView[0],0),vec4<f32>(actualView[1],0),vec4<f32>(actualView[2],0),vec4<f32>(0,0,0,1));
  frame.cameraHigh=vec4<f32>(s.orbitPhase,s.orbitOmega,s.omegaMax,1.0);
  frame.cameraLow=vec4<f32>(vec3<f32>(s.accel,s.cruiseV,s.orbitR)/560.0-transpose(d)*u.boom.xyz,0.0);
  // Same rigid correction for CPU-extracted visibility planes.
  frame.world=mat4x4<f32>(vec4<f32>(d[0],0),vec4<f32>(d[1],0),vec4<f32>(d[2],0),vec4<f32>(transpose(r)*t,1));
}
// Runs after updateCamera, before trail expansion and hull visibility. Only
// detail bits change; the authoritative presented pose stays untouched.
@compute @workgroup_size(64) fn updateDetail(@builtin(global_invocation_id) gid:vec3<u32>){
  let i=gid.x;if(i>=u32(u.detail.w) || i>=arrayLength(&ships)){return;}
  let s=ships[i];if(s.mode==0u){return;}
  var clip=u.projection*u.view*vec4<f32>(s.posX,s.posY,s.posZ,1.0);
  if(frame.cameraHigh.w>0.0 && (s.targetKind&4096u)!=0u){
    let center=(vec3<f32>(s.orbitPhase,s.orbitOmega,s.omegaMax)-frame.cameraHigh.xyz)/560.0
      +(vec3<f32>(s.accel,s.cruiseV,s.orbitR)/560.0-frame.cameraLow.xyz);
    clip=frame.relativeViewProj*vec4<f32>(center,1.0);
  }
  let scale=f32(s.targetKind>>16u)*0.1;
  let pixels=u.detail.x*scale/max(abs(clip.w),1e-9);
  var high=pixels>=select(u.detail.y,u.detail.z,(s.targetKind&1024u)!=0u);
  var tiny=pixels<select(3.0,3.5,(s.targetKind&8192u)!=0u);
  let control=controls[i];
  if(control.x==s.trailOwner && control.y!=0u){high=control.y==2u;tiny=false;}
  ships[i].targetKind=(s.targetKind&~9728u)|select(select(512u,1024u,high),8192u,tiny);
}

`;
/** No pose readback or per-ship CPU loop. The exact displayed pose owns framing. */
export class SceneCameraGpu {
    static async create(device) {
        const module = device.createShaderModule({ label: 'scene-camera', code: SCENE_CAMERA_COMPUTE_WGSL });
        const pipeline = await device.createComputePipelineAsync({ label: 'scene-camera', layout: 'auto', compute: { module, entryPoint: 'updateCamera' } });
        const detailPipeline = await device.createComputePipelineAsync({ label: "scene-follow-detail", layout: "auto", compute: { module, entryPoint: "updateDetail" } });
        return new SceneCameraGpu(device, pipeline, detailPipeline);
    }
    constructor(device, pipeline, detailPipeline) {
        this.data = new Float32Array(72);
        this.detailGroup = null;
        this.detailControls = null;
        this.words = new Uint32Array(this.data.buffer);
        this.inverse = mat4Identity();
        this.source = null;
        this.group = null;
        this.observed = null;
        this.detailPipeline = detailPipeline;
        this.device = device;
        this.input = device.createBuffer({ label: 'scene-camera-input', size: 288, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.pipeline = pipeline;
    }
    observe(pose) { this.observed = pose; }
    encode(encoder, source, follow, view, projection, eye, detail) {
        if (this.source !== source) {
            this.detailGroup = null;
            this.source = source;
            this.group = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
                    { binding: 0, resource: { buffer: this.input } }, { binding: 1, resource: { buffer: source } }, { binding: 2, resource: { buffer: sceneCameraBuffer(this.device) } }
                ] });
        }
        const f = this.data, w = this.words, o = this.observed;
        w[66] = 0;
        if (o && follow?.handle.id === o.id && mat4Invert(this.inverse, projection)) {
            f.set(projection, 0);
            f.set(this.inverse, 16);
            f.set(view, 32);
            const p = o.position;
            f[48] = Math.floor(p.x * 560);
            f[49] = Math.floor(p.y * 560);
            f[50] = Math.floor(p.z * 560);
            f[52] = p.x - f[48] / 560;
            f[53] = p.y - f[49] / 560;
            f[54] = p.z - f[50] / 560;
            f[56] = o.attitude.qx;
            f[57] = o.attitude.qy;
            f[58] = o.attitude.qz;
            f[59] = o.attitude.qw;
            // Target relative to eye, kept small in JS double before conversion.
            f[60] = p.x - eye.x;
            f[61] = p.y - eye.y;
            f[62] = p.z - eye.z;
            w[64] = follow.kernelIndex;
            w[65] = o.id;
            w[66] = 1;
        }
        if (detail) {
            f.set([detail.pixelGain, detail.enter, detail.exit, detail.count], 68);
            if (!this.detailGroup || this.detailControls !== detail.controls) {
                this.detailControls = detail.controls;
                this.detailGroup = this.device.createBindGroup({ layout: this.detailPipeline.getBindGroupLayout(0), entries: [
                        { binding: 0, resource: { buffer: this.input } }, { binding: 1, resource: { buffer: source } },
                        { binding: 2, resource: { buffer: sceneCameraBuffer(this.device) } }, { binding: 3, resource: { buffer: detail.controls } }
                    ] });
            }
        }
        this.device.queue.writeBuffer(this.input, 0, f);
        const pass = encoder.beginComputePass({ label: 'scene-camera-from-presented-pose' });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.group);
        pass.dispatchWorkgroups(1);
        if (detail && detail.count > 0) {
            pass.setPipeline(this.detailPipeline);
            pass.setBindGroup(0, this.detailGroup);
            pass.dispatchWorkgroups(Math.ceil(detail.count / 64));
        }
        pass.end();
    }
    destroy() { this.input.destroy(); this.group = null; this.source = null; this.detailGroup = null; this.detailControls = null; }
}
//# sourceMappingURL=scene-camera-gpu.js.map