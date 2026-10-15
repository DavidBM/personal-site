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
 let lo=round(rect.xy*ratio)/ratio;let hi=round((rect.xy+rect.zw)*ratio)/ratio;
 let outline=select(0.,1./ratio,extra.x < -8.5);
 let p=lo+q*(hi-lo)+(q*2.-1.)*outline;
 o.p=vec4(p.x/u.screen.x*2.-1.,1.-p.y/u.screen.y*2.,0.,1.);
 o.uv=q;o.color=vec4(color.rgb,color.a*u.screen.z);o.extra=extra;
 o.size=select(rect.zw,hi-lo+2.*outline,extra.x < -8.5);o.mix=mix;return o;
}
fn segment(p:vec2<f32>,a:vec2<f32>,b:vec2<f32>)->f32{
 let v=b-a;return length(p-a-v*clamp(dot(p-a,v)/dot(v,v),0.,1.));
}
fn symbolDistance(p:vec2<f32>,symbol:f32)->f32{
 if(symbol>8.5){return min(segment(p,vec2(-4.,-4.),vec2(4.,4.)),segment(p,vec2(4.,-4.),vec2(-4.,4.)))-0.85;}
 if(symbol>7.5){return min(abs(length(p)-4.5)-0.6,length(p-vec2(4.,-3.))-1.5);}
 if(symbol>6.5){return min(abs(length(p)-5.)-0.6,min(segment(p,vec2(0.,-3.),vec2(0.)),segment(p,vec2(0.),vec2(3.,1.)))-0.7);}
 if(symbol>4.5){
   let a=min(segment(p,vec2(-4.,-3.),vec2(0.,1.)),segment(p,vec2(0.,1.),vec2(4.,-3.)));
   let b=min(segment(p,vec2(-4.,1.),vec2(0.,5.)),segment(p,vec2(0.,5.),vec2(4.,1.)));
   return select(a,min(a,b),symbol>5.5)-0.9;
 }
 if(symbol>3.5){return min(segment(p,vec2(0.,-5.),vec2(0.,1.))-1.,length(p-vec2(0.,4.))-1.2);}
 if(symbol<1.5){let q=abs(p);return max(q.x,q.y)+min(q.x,q.y)*2.5-4.5;}
 if(symbol<2.5){
   let top=min(segment(p,vec2(-4.,2.),vec2(0.,-3.)),segment(p,vec2(0.,-3.),vec2(4.,2.)));
   return min(top,segment(p,vec2(-3.,4.),vec2(3.,4.)))-0.75;
 }
 let shaft=min(segment(p,vec2(-5.,-2.),vec2(4.,-2.)),segment(p,vec2(-4.,2.),vec2(5.,2.)));
 let arrows=min(segment(p,vec2(1.,-5.),vec2(4.,-2.)),segment(p,vec2(-4.,2.),vec2(-1.,5.)));
 return min(shaft,arrows)-0.75;
}
@fragment fn fs(o:Out)->@location(0) vec4<f32>{
 let p=(o.uv-0.5)*o.size;
 // Derivatives stay outside per-instance branches; only rings need trigonometry.
 let aa=max(length(fwidth(p))*0.5,0.5);
 let pixelWidth=abs(dpdx(p.x));
 var a=1.;var color=o.color.rgb;
 if(o.extra.x < -8.5){
   // Owned pin cells fully mask topology and other pins behind their backplate.
   // The outside outline remains exactly one opaque physical pixel wide.
   // Derivatives convert CSS distances at any DPR without softening the outline.
   let pixel=o.uv*o.size;
   let edge=min(min(pixel.x,o.size.x-pixel.x),min(pixel.y,o.size.y-pixel.y));
   let outline=pixelWidth;
   let border=1.-smoothstep(0.5,1.5,edge-outline);
   color=mix(vec3(0.016,0.042,0.064),o.color.rgb*0.52,border);
   a=1.;
   if(edge<outline){color=vec3(0.);a=1.;}
 }else if(o.extra.x < -7.5){
   // Base parallel to the face, 2 CSS px outside; tip 9 px outside.
   let normal=o.extra.zw;
   let q=vec2(dot(p,vec2(-normal.y,normal.x)),dot(p,normal)+5.5);
   let d=max(2.-q.y,(7.*abs(q.x)+4.*q.y-36.)/sqrt(65.));
   a=1.-smoothstep(1.5-aa,1.5+aa,d);
   color*=1.-smoothstep(-aa,aa,d);
 }else if(o.extra.x < -6.5){
   let d=segment(o.uv*o.size,o.mix.xy,o.mix.zw);
   a=1.-smoothstep(o.extra.y*0.5-aa,o.extra.y*0.5+aa,d);
 }else if(o.extra.x < -5.5){
   let pixel=o.uv*o.size;
   let cut=o.extra.z+o.extra.w*o.uv.y;
   let inner=select(o.size.x-pixel.x,pixel.x,o.extra.y>0.)-cut;
   let edge=min(min(pixel.x,o.size.x-pixel.x),min(pixel.y,o.size.y-pixel.y));
   let distance=select(min(edge,inner),edge,o.extra.y==0.);
   let border=1.-smoothstep(0.5,1.5,distance);
   color=mix(vec3(0.016,0.042,0.064),o.color.rgb*0.52,border);
   a=(0.84+border*0.12)*smoothstep(-aa,aa,distance);
 }else if(o.extra.x < -4.5){
   let d=length(p);let radius=o.extra.w;let outline=o.extra.y;
   a=1.-smoothstep(radius+outline-aa,radius+outline+aa,d);
   if(outline>0.){color*=1.-smoothstep(radius-aa,radius+aa,d);}
 }else if(o.extra.x < -3.5){
   let q=abs(p);
   let d=max(dot(q,vec2(0.8660254,0.5)),q.y)-o.extra.w*0.8660254;
   let border=1.-smoothstep(1.15-aa,1.15+aa,abs(d));
   let symbol=1.-smoothstep(-aa,aa,symbolDistance(p,o.extra.y));
   color=mix(vec3(0.018,0.035,0.06),o.color.rgb,border);
   color=mix(color,o.color.rgb*1.15,symbol);
   a=1.-smoothstep(-aa,aa,d);
 }else if(o.extra.x < -2.5){
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