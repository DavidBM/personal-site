/** Bounded depth-aware disk gather. The selected planet's visible surface stays
 * inside the focus band; out-of-plane foreground and background get a soft lens. */
export function planetDepthOfFieldWgsl(samples, reverse) {
    const load = samples === 1 ? 'textureLoad(depth,pixel,0)' : `${reverse ? 'max' : 'min'}(${reverse ? 'max' : 'min'}(textureLoad(depth,pixel,0),textureLoad(depth,pixel,1)),${reverse ? 'max' : 'min'}(textureLoad(depth,pixel,2),textureLoad(depth,pixel,3)))`;
    // Bake the fixed disk once when creating the pipeline, not 24 trig/sqrt
    // evaluations per fragment. Only its radius changes with depth each frame.
    const disk = Array.from({ length: 24 }, (_, i) => {
        const angle = (i + .5) * 2.39996323, radius = Math.sqrt((i + .5) / 24);
        return `vec2<f32>(${(Math.cos(angle) * radius).toFixed(9)},${(Math.sin(angle) * radius).toFixed(9)})`;
    }).join(',');
    return /* wgsl */ `
struct Lens {viewport:vec4<f32>,focus:vec4<f32>,clip:vec4<f32>}
const disk=array<vec2<f32>,24>(${disk});
@group(0) @binding(0) var scene:texture_2d<f32>;
@group(0) @binding(1) var linearClamp:sampler;
@group(0) @binding(2) var depth:${samples === 1 ? 'texture_depth_2d' : 'texture_depth_multisampled_2d'};
@group(0) @binding(3) var<uniform> u:Lens;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4<f32>{
 return vec4<f32>(array<vec2<f32>,3>(vec2(-1.0,-1.0),vec2(3.0,-1.0),vec2(-1.0,3.0))[i],0.0,1.0);
}
fn distanceAt(uv:vec2<f32>)->f32 {
 let pixel=clamp(vec2<i32>(uv*u.viewport.xy),vec2<i32>(0),vec2<i32>(u.viewport.xy)-vec2<i32>(1));
 let z=${load};let denominator=z+u.clip.x;
 if(abs(denominator)<1e-12){return 1e12;}
 return max(0.0,u.clip.y/denominator);
}
fn circle(d:f32)->f32 {
 let outside=max(0.0,abs(d-u.focus.x)-u.focus.y*.7);
 return smoothstep(0.0,max(u.focus.y*1.7,.000001),outside)*u.focus.z*u.focus.w;
}
@fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{
 let uv=p.xy*u.viewport.zw;let original=textureSampleLevel(scene,linearClamp,uv,0.0);
 let d=distanceAt(uv);let radius=circle(d);
 if(radius<.35){return original;}
 var sum=original.rgb;var weight=1.0;
 for(var i=0u;i<24u;i++){
  let offset=disk[i]*radius;
  let at=clamp(uv+offset*u.viewport.zw,u.viewport.zw*.5,vec2(1.0)-u.viewport.zw*.5);
  let sd=distanceAt(at);
  // Reject sharp samples, not depth discontinuities: an unfocused sun must
  // gather the surrounding sky on BOTH sides of its silhouette. A nearest-
  // depth test here preserves a hard disc even when its surface is blurred.
  // Focused destinations return above, so a sharp planet still occludes it.
  let compatible=select(0.0,1.0,circle(sd)>=length(offset)*.8);
  sum+=textureSampleLevel(scene,linearClamp,at,0.0).rgb*compatible;weight+=compatible;
 }
 return vec4<f32>(sum/weight,original.a);
}`;
}
//# sourceMappingURL=planet-depth-of-field.wgsl.js.map