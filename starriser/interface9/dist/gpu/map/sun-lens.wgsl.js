import { SCENE_CAMERA_WGSL } from '../scene-camera.js';
/** Four bounded optical sprites; only the sun's visibility samples depth. */
export const SUN_LENS_WGSL = SCENE_CAMERA_WGSL + /* wgsl */ `
struct U { vp:mat4x4<f32>, screen:vec4<f32>, eye:vec4<f32> }
@group(0) @binding(0) var<uniform> u:U;
@group(0) @binding(1) var depth:texture_depth_2d;
struct V { @builtin(position) clip:vec4<f32>, @location(0) uv:vec2<f32>, @location(1) color:vec4<f32> }
@vertex fn vs(@builtin(vertex_index) vertex:u32,@builtin(instance_index) part:u32)->V {
  var o:V;o.clip=vec4<f32>(2,2,0,1);o.uv=vec2<f32>(0);o.color=vec4<f32>(0);
  let center=sceneCamera.clip*u.vp*vec4<f32>(0,0,0,1);
  if(center.w<=0.0){return o;}
  let ndc=center.xy/center.w;
  let edge=clamp((1.0-max(abs(ndc.x),abs(ndc.y)))*6.0,0.0,1.0);
  if(edge==0.0){return o;}
  let eye=sceneCameraEye(u.eye.xyz);
  // Compare the near photosphere, not its center: opaque sun depth must not
  // occlude its own flare. Production reversed Z makes greater values nearer.
  let front=eye*(u.screen.z/max(length(eye),1e-9));
  let surface=sceneCamera.clip*u.vp*vec4<f32>(front,1);
  let radius=u.screen.z*u.screen.w*u.screen.y/(2.0*center.w);
  let pixel=(ndc*vec2<f32>(.5,-.5)+.5)*u.screen.xy;
  var visibility=0.0;
  // Fixed five-tap visibility approximation, independent of scene population.
  for(var i=0u;i<5u;i++){
    let offset=array<vec2<f32>,5>(vec2<f32>(0),vec2<f32>(1,0),vec2<f32>(-1,0),vec2<f32>(0,1),vec2<f32>(0,-1))[i];
    let p=clamp(vec2<i32>(pixel+offset*radius*.4),vec2<i32>(0),vec2<i32>(textureDimensions(depth))-1);
    visibility+=select(0.0,.2,surface.z/surface.w+1e-7>=textureLoad(depth,p,0));
  }
  let q=array<vec2<f32>,6>(vec2<f32>(-1,-1),vec2<f32>(1,-1),vec2<f32>(-1,1),vec2<f32>(-1,1),vec2<f32>(1,-1),vec2<f32>(1,1))[vertex];
  let factor=array<f32,4>(1.0,1.0,-.3,-.75)[part];
  let scale=clamp(radius*.25,4.0,28.0);
  let size=array<vec2<f32>,4>(vec2<f32>(8,.16),vec2<f32>(1.3),vec2<f32>(.7),vec2<f32>(1.2))[part]*scale;
  let gain=array<f32,4>(.3,.12,.045,.03)[part];
  o.clip=vec4<f32>(ndc*factor+q*size*2.0/u.screen.xy,0,1);o.uv=q;
  o.color=vec4<f32>(1,.8,.5,visibility*edge*edge*clamp(radius*.12,0.0,1.0)*gain);
  return o;
}
@fragment fn fs(i:V)->@location(0) vec4<f32>{
  let falloff=max(0.0,1.0-dot(i.uv,i.uv));
  return vec4<f32>(i.color.rgb*i.color.a*falloff*falloff,0);
}
`;
//# sourceMappingURL=sun-lens.wgsl.js.map