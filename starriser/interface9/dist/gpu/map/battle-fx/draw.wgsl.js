import { FX_SHARED } from './shared.wgsl.js';
import { SCENE_CAMERA_WGSL } from '../../scene-camera.js';
export const FX_DRAW = /*wgsl*/ `${FX_SHARED}${SCENE_CAMERA_WGSL}
@group(0) @binding(1) var<storage,read> fx:array<Effect>;
@group(0) @binding(2) var<storage,read> visible:array<vec2<u32>>;
@group(0) @binding(3) var<storage,read> history:array<vec4<f32>>;
@group(0) @binding(4) var depth:texture_depth_2d;
struct V { @builtin(position) clip:vec4<f32>, @location(0) uv:vec2<f32>, @location(1) color:vec4<f32>, @location(2) round:f32 }
fn clip(p:vec3<f32>,anchor:vec3<f32>)->vec4<f32>{return sceneCamera.relativeViewProj*vec4<f32>((anchor-sceneCamera.cameraHigh.xyz)/560.0+(p/560.0-sceneCamera.cameraLow.xyz),1);}
fn corner(v:u32)->vec2<f32>{return array<vec2<f32>,6>(vec2(-1,-1),vec2(1,-1),vec2(1,1),vec2(-1,-1),vec2(1,1),vec2(-1,1))[v];}
fn hidden()->V{var o:V;o.clip=vec4<f32>(2,2,2,1);return o;}
fn geometry(v:u32,i:u32,glow:bool)->V{
 let item=visible[i];let e=fx[item.x];var t=age(e.anchor.w);var head=e.head.xyz;var tail=head;
 var width=e.motion.w;var opacity=clamp((e.head.w-t)*8.0,0.0,1.0);var round=0.0;var color=e.color.xyz;
 let kind=u32(e.color.w);let part=item.y;
 if(kind==0u){
   if(part==0u){head+=e.motion.xyz*t;tail=head-e.motion.xyz*min(t,.008);}
   else{round=1.0;width=max(e.extra.y*.18,.001)/560.0;opacity*=max(0.0,1.0-t/.04);color=vec3<f32>(1,.85,.55)*max(color.x,max(color.y,color.z));}
 }
 if(kind==1u){
   let h=(item.x-u.offsets.x)*4u;if(part==0u){tail=head-e.motion.xyz*.012;width*=1.8;}
   else{head=history[h+part-1u].xyz;tail=e.head.xyz;
    if(part>1u){tail=history[h+part-2u].xyz;}width*=1.0-f32(part)*.13;opacity*=1.0-f32(part)*.19;}
 }
 if(kind==2u){tail=head+e.motion.xyz;opacity*=min(1.0,t*15.0);color*=.8+.2*random(e.owner.x+u32(t*12.0));}
 if(kind==3u){
   t*=1.8/e.head.w;
   let seed=e.owner.x+item.x*31u;let radius=e.extra.y;
   if(part<5u){round=1.0;let size=radius*(1.0+t*9.0);if(part>0u){head+=direction(seed+part)*size*.6;}
     width=size/560.0;opacity*=max(0.0,1.0-t/select(.7,.15,part==0u));
     color=mix(vec3<f32>(1,.22,.04),vec3<f32>(1,.95,.82),max(0.0,1.0-t*5.0))*e.color.x;
   }else{let vel=direction(seed+part)*radius*(2.0+random(seed+part)*8.0);head+=vel*t;tail=head-vel*.018;width=radius*.012;opacity*=.6;}
 }
 var a=clip(head,e.anchor.xyz);var b=clip(tail,e.anchor.xyz);let q=corner(v);var o=hidden();
 if(round>0.0){if(a.w<=0.0){return o;}width=width*bitcast<f32>(u.selected.w)*u.clock.w/max(a.w,1e-6);
   opacity*=min(1.0,width*width*.25);width=clamp(width,2.0,220.0);
   if(glow){width*=1.5;}a=vec4<f32>(a.xy+q*width/u.clock.zw*a.w,a.zw);o.clip=a;
 }else{
   // Clip before expanding in pixels; endpoints can cross the near plane.
   let da=a.w-a.z;let db=b.w-b.z;if(da<0.0&&db<0.0){return o;}
   if(da<0.0){a=mix(a,b,da/(da-db));}else if(db<0.0){b=mix(b,a,db/(db-da));}
   if(a.w<=1e-8||b.w<=1e-8){return o;}
   let delta=(b.xy/b.w-a.xy/a.w)*u.clock.zw;let inv=inverseSqrt(max(dot(delta,delta),.01));let normal=vec2<f32>(-delta.y,delta.x)*inv;
   o.clip=select(a,b,q.x>0.0);
   // World-sized ribbon with subpixel coverage: retain raster stability while
   // energy fades with distance, instead of a permanently bright 1px line.
   width*=bitcast<f32>(u.selected.w)*u.clock.w/(560.0*max(o.clip.w,1e-6));
   opacity*=min(1.0,width*.5);width=max(2.0,width)*select(1.0,3.5,glow);o.clip=vec4<f32>(o.clip.xy+normal*q.y*width/u.clock.zw*o.clip.w,o.clip.zw);
 }
 o.uv=q;o.color=vec4<f32>(color,opacity*select(1.0,.16,glow));o.round=round;return o;
}
@vertex fn core(@builtin(vertex_index) v:u32,@builtin(instance_index) i:u32)->V{return geometry(v,i,false);}
@vertex fn glow(@builtin(vertex_index) v:u32,@builtin(instance_index) i:u32)->V{return geometry(v,i,true);}
fn shade(input:V)->vec4<f32>{
 let dist=mix(abs(input.uv.y),dot(input.uv,input.uv),input.round);
 let edge=1.0-smoothstep(.45,1.0,dist);let value=input.color.a*edge;
 return vec4<f32>(input.color.xyz*value,0);
}
@fragment fn fs(input:V)->@location(0) vec4<f32>{return shade(input);}
@fragment fn fsGlow(input:V)->@location(0) vec4<f32>{
 let xy=clamp(vec2<i32>(input.clip.xy*2.0),vec2<i32>(0),vec2<i32>(textureDimensions(depth))-1);
 if(input.clip.z+1e-7<textureLoad(depth,xy,0)){discard;}return shade(input);
}
@vertex fn lens(@builtin(vertex_index) v:u32,@builtin(instance_index) i:u32)->V{
 let item=visible[u.limits.z+i/3u];if(item.x==0xffffffffu){return hidden();}
 let e=fx[item.x];let c=clip(e.head.xyz,e.anchor.xyz);if(c.w<=0.0){return hidden();}
 let ndc=c.xy/c.w;let xy=vec2<i32>((ndc*vec2<f32>(.5,-.5)+.5)*u.clock.zw);var visibility=0.0;
 for(var j=0u;j<4u;j++){let d=vec2<i32>(i32(j&1u)*4-2,i32(j>>1u)*4-2);let p=clamp(xy+d,vec2<i32>(0),vec2<i32>(textureDimensions(depth))-1);
  visibility+=select(0.0,.25,c.z/c.w+1e-7>=textureLoad(depth,p,0));}
 let part=i%3u;let factor=array<f32,3>(1.0,-.25,-.65)[part];let size=array<f32,3>(32,9,17)[part];
 let q=corner(v);var o:V;o.clip=vec4<f32>(ndc*factor+q*size/u.clock.zw,0,1);o.uv=q;o.round=1.0;
 let edge=clamp((1.0-max(abs(ndc.x),abs(ndc.y)))*8.0,0.0,1.0);
 o.color=vec4<f32>(1,.78,.48,visibility*edge*e.extra.w*max(0.0,1.0-age(e.anchor.w)*1.8/(e.head.w*.8))*select(.06,.2,part==0u));return o;
}
`;
//# sourceMappingURL=draw.wgsl.js.map