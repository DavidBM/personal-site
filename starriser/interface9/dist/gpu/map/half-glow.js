import { GLOW_DEPTH_WGSL } from '../../lib/fleet-sim/gpu/glow-depth.wgsl.js';
import { TRAIL_GLOW_INDIRECT_BYTE } from '../../lib/fleet-sim/visual/trail-indirect-table.js';
export const GLOW_COMPOSITE_WGSL = /* wgsl */ `
${GLOW_DEPTH_WGSL.replace('@group(3)', '@group(0)')}
@group(0) @binding(1) var glow:texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4<f32>{
return vec4<f32>(array<vec2<f32>,3>(vec2(-1.0,-1.0),vec2(3.0,-1.0),vec2(-1.0,3.0))[i],0.0,1.0);}
@fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{
  let size=vec2<i32>(textureDimensions(glow));
  let uv=p.xy*.5-.5;
  let base=vec2<i32>(floor(uv));let f=fract(uv);
  let hi=size-1;let lo=vec2<i32>(0);
  let values=array<vec3<f32>,4>(textureLoad(glow,clamp(base,lo,hi),0).rgb,
    textureLoad(glow,clamp(base+vec2(1,0),lo,hi),0).rgb,
    textureLoad(glow,clamp(base+vec2(0,1),lo,hi),0).rgb,
    textureLoad(glow,clamp(base+vec2(1,1),lo,hi),0).rgb);
  // Empty pixels need no depth neighborhood work. Keep zero neighbors in the
  // normalization below so sparse glow retains exactly the same falloff.
  if(all(values[0]+values[1]+values[2]+values[3]==vec3<f32>(0.0))){return vec4<f32>(0.0);}
  let depth=blockRange(vec2<i32>(p.xy));if(blockEdge(depth)){return vec4<f32>(0.0);}
  var sum=vec3<f32>(0.0);var weight=0.0;
  for(var y=0;y<2;y++){for(var x=0;x<2;x++){
    let q=clamp(base+vec2(x,y),vec2<i32>(0),size-1);
    let neighbor=blockRange(q*2);
    let w=select(1.0-f.x,f.x,x==1)*select(1.0-f.y,f.y,y==1);
    if(!blockEdge(neighbor)&&abs(neighbor.y-depth.y)<=max(1e-7,depth.y*.0001)){
      sum+=values[y*2+x]*w;weight+=w;
    }
  }}
  return vec4<f32>(sum/max(weight,1e-6),0.0);
}
`;
export class HalfGlow {
    constructor(bootstrap) {
        this.texture = null;
        this.width = 0;
        this.height = 0;
        this.depth = null;
        this.bootstrap = bootstrap;
        const module = bootstrap.device.createShaderModule({ label: 'glow-depth-aware-composite', code: GLOW_COMPOSITE_WGSL });
        this.pipeline = bootstrap.device.createRenderPipeline({ label: 'glow-depth-aware-composite', layout: 'auto', vertex: { module, entryPoint: 'vs' },
            fragment: { module, entryPoint: 'fs', targets: [{ format: bootstrap.format, blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }] } });
    }
    ensure(w, h, depth) {
        if (w === this.width && h === this.height && depth === this.depth)
            return;
        this.depth = depth;
        this.width = w;
        this.height = h;
        this.texture?.destroy();
        this.texture = this.bootstrap.device.createTexture({ label: 'half-resolution-trail-glow', size: [Math.ceil(w / 2), Math.ceil(h / 2)], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
        this.view = this.texture.createView();
        this.group = this.bootstrap.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: depth }, { binding: 1, resource: this.view }] });
    }
    composite(encoder, target, indirect) {
        const pass = encoder.beginRenderPass({ label: 'glow-upsample', colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }] });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.group);
        pass.drawIndirect(indirect, TRAIL_GLOW_INDIRECT_BYTE);
        pass.end();
    }
    dispose() { this.texture?.destroy(); this.texture = null; this.depth = null; this.width = 0; this.height = 0; }
}
//# sourceMappingURL=half-glow.js.map