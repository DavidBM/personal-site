import { SCENE_HULL_SIZE, SCENE_MODEL_SIZE_MUL } from './directed-present.wgsl.js';
import { FLEET_MARKER } from './fleet-marker.js';
const { stem, cellWidth, cellHeight, padding, glyphScale } = FLEET_MARKER;
// 3×6 CSS-pixel glyphs with 1px strokes. I/F/B/R/S/C identify the six class tiles;
// the context menu spells out each class and exposes its follow action.
const glyphs = ['111101101101101111', '010110010010010111', '111001001111100111', '111001111001001111',
    '101101101111001001', '111100100111001111', '111100111101101111', '111001001010010010',
    '111101111101101111', '111101101111001111', '111010010010010111', '111100110100100100',
    '110101110101101110', '110101110101101101', '111100100111001111', '111100100100100111'];
const common = /* wgsl */ `
struct U { vp: mat4x4<f32>, viewport: vec4<f32>, selected: u32, hovered: u32, pad: vec2<u32> }
@group(0) @binding(0) var<uniform> u: U;
const corners = array<vec2<f32>, 6>(vec2<f32>(-1,-1),vec2<f32>(1,-1),vec2<f32>(1,1),vec2<f32>(-1,-1),vec2<f32>(1,1),vec2<f32>(-1,1));
`;
export const FLEET_MARKER_WGSL = common + /* wgsl */ `
struct Mark { pos: vec4<f32>, anchor: vec3<f32>, color: u32 }
struct Types { a: vec4<u32>, b: vec4<u32> }
@group(0) @binding(1) var<storage, read> marks: array<Mark>;
@group(0) @binding(2) var<uniform> types: array<Types, 128>;
struct V {
  @builtin(position) clip: vec4<f32>, @location(0) xy: vec2<f32>,
  @location(1) @interpolate(flat) slot: u32, @location(2) @interpolate(flat) part: u32,
}
fn countAt(slot: u32, kind: u32) -> u32 { if(kind < 4u) { return types[slot].a[kind]; } return types[slot].b[kind-4u]; }
fn typeCount(slot: u32) -> u32 { return types[slot].b.z; }
fn sizeOf(slot: u32) -> vec2<f32> {
  let n = typeCount(slot);
  return vec2<f32>(f32(min(n,3u))*${cellWidth}.0+${padding * 2}.0, f32((n+2u)/3u)*${cellHeight}.0+${padding * 2}.0);
}
@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> V {
  var out: V;
  out.clip=vec4<f32>(2,2,2,1); out.xy=vec2<f32>(0); out.slot=i; out.part=v/6u;
  let p=marks[i].pos;
  let base=u.vp*vec4<f32>(p.xyz,1);
  if(p.w < 0.5 || base.w <= 0.0 || typeCount(i)==0u) { return out; }
  let size=sizeOf(i);
  let c=corners[v%6u];
  var offset=vec2<f32>(c.x*0.5, (c.y-1.0)*${stem / 2}.0);
  if(v>=6u) { offset=c*size*0.5-vec2<f32>(0,${stem}.0+size.y*0.5); }
  out.clip=base;
  out.clip.xy += offset*vec2<f32>(2.0,-2.0)/u.viewport.xy*base.w;
  out.xy=(c+1.0)*size*0.5;
  return out;
}
fn glyph(id:u32, p:vec2<f32>) -> bool {
  let xy=vec2<i32>(floor(p));
  if(any(xy<vec2<i32>(0)) || xy.x>=3 || xy.y>=6) { return false; }
  let masks=array<u32,16>(${glyphs.map(s => parseInt([...s].reverse().join(''), 2) + 'u').join(',')});
  return (masks[min(id,15u)] & (1u<<u32(xy.y*3+xy.x))) != 0u;
}
fn tileInk(slot:u32,p:vec2<f32>) -> bool {
  let cell=vec2<u32>(floor(p/vec2<f32>(${cellWidth},${cellHeight})));
  let ordinal=cell.y*3u+cell.x;
  if(ordinal>=typeCount(slot)) { return false; }
  var kind=0u; var seen=0u;
  for(var k=0u;k<6u;k++) { if(countAt(slot,k)>0u) { if(seen==ordinal) { kind=k; break; } seen++; } }
  let q=(p-vec2<f32>(cell)*vec2<f32>(${cellWidth},${cellHeight})-vec2<f32>(1,1))/${glyphScale};
  if(glyph(10u+kind,q)) { return true; }
  let n=countAt(slot,kind);
  let digit=i32(floor((q.x-7.0)/4.0));
  if(digit<0 || digit>3) { return false; }
  let divisor=array<u32,4>(1000u,100u,10u,1u)[u32(digit)];
  if(n<divisor && digit<3) { return false; }
  return glyph((n/divisor)%10u,vec2<f32>(q.x-7.0-f32(digit)*4.0,q.y));
}
@fragment fn fs(input: V) -> @location(0) vec4<f32> {
  let picked=input.slot==u.selected; let hovered=input.slot==u.hovered;
  let packed=marks[input.slot].color;
  let tint=vec3<f32>(f32((packed>>16u)&255u),f32((packed>>8u)&255u),f32(packed&255u))/255.0;
  let rgb=select(tint,vec3<f32>(0.25,0.92,1),picked);
  let color=select(rgb,vec3<f32>(0.9,0.97,1),hovered && !picked);
  if(input.part==0u) { return vec4<f32>(color,select(0.22,0.55,picked||hovered)); }
  let size=sizeOf(input.slot);
  let edge=min(min(input.xy.x,size.x-input.xy.x),min(input.xy.y,size.y-input.xy.y));
  if(edge<1.0) { return vec4<f32>(color,select(0.4,0.95,picked||hovered)); }
  let p=input.xy-vec2<f32>(${padding});
  if(all(p>=vec2<f32>(0)) && all(p<size-vec2<f32>(${padding * 2})) && tileInk(input.slot,p)) { return vec4<f32>(mix(color,vec3<f32>(1),0.3),0.95); }
  return vec4<f32>(0.012,0.025,0.045,0.82);
}
`;
export const SHIP_SELECTION_WGSL = common + /* wgsl */ `
struct Ship { p:vec4<f32>, q:vec4<f32>, tint:vec4<f32>, state:vec4<u32>, control:vec4<u32>, orbit:vec4<f32>, rest:array<vec4<f32>,16> }
@group(0) @binding(1) var<storage,read> ships:array<Ship>;
struct V { @builtin(position) clip:vec4<f32>, @location(0) p:vec2<f32>, @location(1) @interpolate(flat) selected:u32, @location(2) @interpolate(flat) radius:f32, @location(3) @interpolate(flat) alpha:f32 }
@vertex fn vs(@builtin(vertex_index) v:u32,@builtin(instance_index) i:u32)->V {
  var out:V; out.clip=vec4<f32>(2,2,2,1); out.p=vec2<f32>(0); out.selected=0u; out.radius=7.0; out.alpha=0.0;
  let s=ships[i]; let flags=s.control.x;
  if(s.state.z==0u || (flags&2304u)==0u) { return out; }
  let clip=u.vp*vec4<f32>(s.p.xyz,1);
  if(clip.w<=0.0) { return out; }
  let p=corners[v];
  let scale=f32(flags>>16u)*0.1;
  let hullRadius=u.viewport.z*${SCENE_HULL_SIZE * SCENE_MODEL_SIZE_MUL}*scale*u.viewport.y/(2.0*clip.w);
  let radius=max(7.0,hullRadius+3.0);
  out.radius=radius;
  out.alpha=select(0.4,0.75,(flags&256u)!=0u)*clamp(hullRadius/4.0,0.25,1.0);
  let offset=p*radius*vec2<f32>(2,-2)/u.viewport.xy*clip.w;
  out.clip=clip+vec4<f32>(offset,0.0,0.0);
  out.p=p*radius; out.selected=flags&256u;
  return out;
}
@fragment fn fs(v:V)->@location(0) vec4<f32> {
  let p=abs(v.p);
  if(max(p.x,p.y)<v.radius-1.0 || min(p.x,p.y)<v.radius-4.0) { discard; }
  return vec4<f32>(select(vec3<f32>(0.85,0.95,1),vec3<f32>(0.15,0.95,1),v.selected!=0u),v.alpha);
}
`;
//# sourceMappingURL=fleet-marker.wgsl.js.map