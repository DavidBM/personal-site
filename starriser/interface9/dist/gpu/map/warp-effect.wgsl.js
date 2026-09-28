/** Screen-space refraction of the actual scene; nearby opaque hulls remain crisp. */
export const WARP_EFFECT_WGSL = /* wgsl */ `
struct WarpView {
  viewport: vec4<f32>,
  lens: vec4<f32>,
  ship: vec4<f32>,
  clip: vec4<f32>,
}
@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var linearClamp: sampler;
@group(0) @binding(2) var depth: texture_depth_multisampled_2d;
@group(0) @binding(3) var<uniform> u: WarpView;
struct Vertex { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vs(@builtin(vertex_index) i:u32)->Vertex {
  let xy=vec2<f32>(f32((i<<1u)&2u),f32(i&2u));
  var out:Vertex;out.position=vec4<f32>(xy*2.0-1.0,0.0,1.0);out.uv=vec2<f32>(xy.x,1.0-xy.y);return out;
}
fn hash(n:f32)->f32{return fract(sin(n*127.1+311.7)*43758.5453);}
fn source(uv:vec2<f32>)->vec3<f32>{
  return textureSampleLevel(scene,linearClamp,clamp(uv,u.viewport.zw*.5,vec2<f32>(1.0)-u.viewport.zw*.5),0.0).rgb;
}
fn refractedSource(uv:vec2<f32>)->vec3<f32>{
  // The blur must not sample the followed hull and leave a second stretched
  // silhouette outside the depth-protected foreground.
  let aspect=vec2<f32>(u.clip.z,1.0);let p=(uv-u.ship.xy)*aspect;
  let radius=max(length(p),.00001);
  return source(u.ship.xy+p*max(1.0,u.ship.z*1.3/radius)/aspect);
}
fn protection(uv:vec2<f32>)->f32 {
  let pixel=clamp(vec2<i32>(uv*u.viewport.xy),vec2<i32>(0),vec2<i32>(u.viewport.xy)-vec2<i32>(1));
  // Reversed depth: choose the closest covered MSAA sample at silhouette edges.
  let z=max(max(textureLoad(depth,pixel,0),textureLoad(depth,pixel,1)),
    max(textureLoad(depth,pixel,2),textureLoad(depth,pixel,3)));
  let distance=u.clip.y/max(1e-12,z+u.clip.x);
  let distant=smoothstep(u.ship.w,u.ship.w*1.5,distance);
  let p=(uv-u.ship.xy)*vec2<f32>(u.clip.z,1.0);
  let clearHull=smoothstep(u.ship.z*1.4,u.ship.z*2.6,length(p));
  return distant*clearHull;
}
fn streaks(p:vec2<f32>,radius:f32,time:f32)->vec3<f32> {
  // Sparse angular filaments flow away from the vanishing point. Broad, dim
  // wavefronts supply refraction cues in empty space without a flashing overlay.
  let angle=atan2(p.y,p.x);let sector=floor((angle+3.14159265)*150.0);
  let local=fract((angle+3.14159265)*150.0);
  let seed=hash(sector);let line=pow(max(0.0,1.0-abs(local-.5)*2.0),18.0);
  let phase=fract(radius*.9-time*(.35+seed*.25)+seed*9.0);
  let trail=pow(max(0.0,1.0-abs(phase-.5)*2.0),10.0);
  let sparse=smoothstep(.82,.99,seed)*line*trail;
  let sheet=pow(max(0.0,sin(radius*16.0-time*2.0+.22*sin(angle*3.0))),24.0);
  let edge=smoothstep(.12,.75,radius);
  return (vec3<f32>(.28,.56,.8)*sparse*.22+vec3<f32>(.09,.2,.3)*sheet*.045)*edge;
}
@fragment fn fs(in:Vertex)->@location(0) vec4<f32> {
  let uv=in.uv;let original=source(uv);let amount=u.lens.z*protection(uv);
  if(amount<.0001){return vec4<f32>(original,1.0);}
  let aspect=vec2<f32>(u.clip.z,1.0);let p=(uv-u.lens.xy)*aspect;
  let radius=length(p);let direction=p/max(radius,.00001);let time=u.lens.w;
  let edge=smoothstep(.07,.85,radius);
  let wave=sin(radius*21.0-time*3.2+sin(atan2(p.y,p.x)*3.0)*.25);
  let lens=1.0-amount*edge*(.13+.028*wave);
  let bent=u.lens.xy+p*lens/aspect;
  let spread=direction/aspect*amount*edge*.0035;
  var color=vec3<f32>(refractedSource(bent+spread).r,refractedSource(bent).g,refractedSource(bent-spread).b)*.4;
  // Blur actual world features radially, with normalized energy. Preserve dark
  // space rather than replacing the scene with a bright procedural tunnel.
  for(var i=1u;i<=6u;i++) {
    let stretch=1.0-f32(i)*.035*amount*edge;
    color+=refractedSource(u.lens.xy+(bent-u.lens.xy)*stretch)*.1;
  }
  color+=streaks(p,radius,time)*amount;
  let vignette=1.0-.14*amount*smoothstep(.45,1.15,radius);
  return vec4<f32>(mix(original,color*vignette,amount),1.0);
}
`;
/** Single-sample depth uses a mip level, not a multisample index. */
export function warpEffectWgsl(samples) {
    if (samples === 4)
        return WARP_EFFECT_WGSL;
    return WARP_EFFECT_WGSL.replace('texture_depth_multisampled_2d', 'texture_depth_2d')
        .replace(/let z=max\(max\(textureLoad\(depth,pixel,0\),textureLoad\(depth,pixel,1\)\),\s*max\(textureLoad\(depth,pixel,2\),textureLoad\(depth,pixel,3\)\)\);/, 'let z=textureLoad(depth,pixel,0);');
}
//# sourceMappingURL=warp-effect.wgsl.js.map