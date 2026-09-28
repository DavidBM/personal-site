export const SURVEY_WGSL = /* wgsl */ `
struct U { screen:vec4<f32> };
@group(0) @binding(0) var<uniform> u:U;
@group(0) @binding(1) var atlas:texture_2d<f32>;
@group(0) @binding(2) var atlasSampler:sampler;
struct Out {
 @builtin(position) p:vec4<f32>, @location(0) uv:vec2<f32>,
 @location(1) color:vec4<f32>, @location(2) @interpolate(flat) extra:vec4<f32>,
 @location(3) @interpolate(flat) size:vec2<f32>,
 @location(4) @interpolate(flat) mix:vec4<f32>
};
@vertex fn vs(@builtin(vertex_index) v:u32,@location(0) rect:vec4<f32>,@location(1) color:vec4<f32>,@location(2) extra:vec4<f32>,@location(3) mix:vec4<f32>)->Out{
 let corners=array<vec2<f32>,6>(vec2(0.,0.),vec2(1.,0.),vec2(1.,1.),vec2(0.,0.),vec2(1.,1.),vec2(0.,1.));
 var o:Out;let q=corners[v];let ratio=max(u.screen.w,0.01);
 // Snap panel and glyph edges to physical pixels before projection.
 let p=round((rect.xy+q*rect.zw)*ratio)/ratio;
 o.p=vec4(p.x/u.screen.x*2.-1.,1.-p.y/u.screen.y*2.,0.,1.);
 o.uv=q;o.color=vec4(color.rgb,color.a*u.screen.z);o.extra=extra;o.size=rect.zw;o.mix=mix;return o;
}
@fragment fn fs(o:Out)->@location(0) vec4<f32>{
 let p=(o.uv-0.5)*o.size;
 // Derivatives stay outside per-instance branches; only rings need trigonometry.
 let aa=max(length(fwidth(p))*0.5,0.5);
 var a=1.;var color=o.color.rgb;
 if(o.extra.x < -2.5){
   a=1.;
 }else if(o.extra.x < -1.5){
   let edge=min(min(o.uv.x*o.size.x,(1.-o.uv.x)*o.size.x),min(o.uv.y*o.size.y,(1.-o.uv.y)*o.size.y));
   color=select(vec3(0.018),o.color.rgb*0.45,edge<0.75);a=0.94;
 }else if(o.extra.x < -0.5){
   let step=6.28318530718/max(1.,o.extra.y);
   let ordinal=floor((atan2(p.y,p.x)+1.57079632679)/step+0.5);
   let index=ordinal-floor(ordinal/o.extra.y)*o.extra.y;
   let theta=ordinal*step-1.57079632679;
   let dir=vec2(cos(theta),sin(theta));
   let radius=o.extra.w;
   // One longer tick per present fleet, capped to the available ring ticks.
   let occupied=index<o.extra.z;
   let extension=select(0.,min(2.5,radius*0.35),occupied);
   let distance=length(p-dir*clamp(dot(p,dir),radius-extension,radius));
   a=(1.-smoothstep(0.9-aa*0.5,0.9+aa*0.5,distance))*select(0.65,1.,occupied);
   color=vec3(1.);
   if(occupied){
     let rank=(index+0.5)/max(1.,o.extra.z)*dot(o.mix,vec4(1.));
     if(rank<o.mix.x){color=vec3(1.,0.22,0.25);}
     else if(rank<o.mix.x+o.mix.y){color=vec3(1.);}
     else if(rank<o.mix.x+o.mix.y+o.mix.z){color=vec3(0.25,0.9,0.45);}
     else{color=vec3(0.25,0.6,1.);}
   }
   let center=1.-smoothstep(1.,1.8,length(p));
   if(center>a){a=center;color=o.color.rgb;}
 }else{
   a=textureSampleLevel(atlas,atlasSampler,(o.extra.zw+o.uv*vec2(8.,16.))/vec2(256.,64.),0.).a;
 }
 return vec4(color,o.color.a*a);
}`;
//# sourceMappingURL=survey.wgsl.js.map