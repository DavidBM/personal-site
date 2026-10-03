import {SHIP_WGSL} from '../../../lib/ship-runtime/ship-layout.mjs';

/** Translation only, during retained warp. No motor, route solver or population
 * readback. Integer cells and sub-cell residuals are translated separately. */
export const SCENE_REFRAME_WGSL=/* wgsl */`
${SHIP_WGSL}
struct Input { range:vec4<u32>, high:vec4<f32>, low:vec4<f32> }
@group(0) @binding(0) var<uniform> u:Input;
@group(0) @binding(1) var<storage,read_write> a:array<Ship>;
@group(0) @binding(2) var<storage,read_write> b:array<Ship>;
@group(0) @binding(3) var<storage,read_write> sims:array<u32>;
@group(0) @binding(4) var<storage,read_write> history:array<vec4<f32>>;
fn translated(initial:Ship)->Ship {
  var s=initializeShipPosition(initial);
  s.positionAnchor=vec4<f32>(s.positionAnchor.xyz+u.high.xyz,s.positionAnchor.w);
  s=moveShipPosition(s,u.low.xyz);
  if(s.flight.w>=2.0){s.origin=vec4<f32>(s.origin.xyz+u.high.xyz+u.low.xyz,s.origin.w);}
  return s;
}
fn read(at:u32)->f32{return bitcast<f32>(sims[at]);}
fn write(at:u32,v:f32){sims[at]=bitcast<u32>(v);}
@compute @workgroup_size(64) fn reframe(@builtin(global_invocation_id) gid:vec3<u32>){
  if(gid.x>=u.range.y){return;}
  let i=u.range.x+gid.x;if(i>=arrayLength(&a)){return;}
  if(a[i].identity.y!=u.range.z||a[i].identity.z==0u){return;}
  a[i]=translated(a[i]);b[i]=translated(b[i]);
  let at=i*88u;
  if(at+87u<arrayLength(&sims)){
    let low=vec3<f32>(read(at+18u),read(at+19u),read(at+20u))+u.low.xyz;
    let carry=floor(low);let rest=low-carry;
    let anchor=vec3<f32>(read(at+17u),read(at+21u),read(at+22u))+u.high.xyz+carry;
    write(at+17u,anchor.x);write(at+21u,anchor.y);write(at+22u,anchor.z);
    write(at+18u,rest.x);write(at+19u,rest.y);write(at+20u,rest.z);
    let p=(anchor+rest)/560.0;write(at,p.x);write(at+1u,p.y);write(at+2u,p.z);
    for(var k=0u;k<8u;k++){
      let knot=at+24u+k*4u;let origin=at+56u+k*4u;
      let v=vec3<f32>(read(knot),read(knot+3u),read(knot+1u))+u.low.xyz;
      let cell=floor(v);let l=v-cell;
      for(var axis=0u;axis<3u;axis++){write(origin+axis,read(origin+axis)+u.high[axis]+cell[axis]);}
      write(knot,l.x);write(knot+3u,l.y);write(knot+1u,l.z);
    }
  }
  for(var k=0u;k<48u;k++){
    let at=i*48u+k;if(at<arrayLength(&history)&&history[at].w>=0.0){
      history[at]=vec4<f32>(history[at].xyz+u.high.xyz+u.low.xyz,history[at].w);
    }
  }
}
`;
export async function createSceneReframe(device) {
  const module=device.createShaderModule({label:'retained-fleet-reframe',code:SCENE_REFRAME_WGSL});
  const pipeline=await device.createComputePipelineAsync({label:'retained-fleet-reframe',layout:'auto',compute:{module,entryPoint:'reframe'}});
  const input=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const data=new Float32Array(12),words=new Uint32Array(data.buffer);
  return {encode(encoder,runtime,sims,start,count,slot,delta){
    words.set([start,count,slot,0]);
    for(let axis=0;axis<3;axis++){data[4+axis]=Math.floor(delta[axis]);data[8+axis]=delta[axis]-data[4+axis];}
    device.queue.writeBuffer(input,0,data);
    const buffers=[input,runtime.state,runtime.pendingPoseBuffer(),sims,runtime.history];
    const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:buffers.map((buffer,binding)=>({binding,resource:{buffer}}))});
    const pass=encoder.beginComputePass({label:'retained-fleet-reframe'});
    pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();
  },destroy(){input.destroy();}};
}
