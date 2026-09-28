/** Shared edge classification for full-resolution fallback and glow composite. */
export const GLOW_DEPTH_WGSL = /* wgsl */ `
@group(3) @binding(0) var opaqueDepth:texture_depth_2d;
fn blockRange(pixel:vec2<i32>)->vec2<f32>{
  let dims=vec2<i32>(textureDimensions(opaqueDepth));
  let base=(clamp(pixel,vec2<i32>(0),dims-1)/2)*2;
  var lo=1.0;var hi=0.0;
  for(var y=0;y<2;y++){for(var x=0;x<2;x++){
    let z=textureLoad(opaqueDepth,min(base+vec2(x,y),dims-1),0);lo=min(lo,z);hi=max(hi,z);
  }}return vec2(lo,hi);
}
fn blockEdge(range:vec2<f32>)->bool{return range.y-range.x>max(1e-7,range.y*.0001);}
`;
//# sourceMappingURL=glow-depth.wgsl.js.map