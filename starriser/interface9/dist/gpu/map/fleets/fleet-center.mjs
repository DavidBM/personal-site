// Arithmetic fleet center, including average height. One GPU workgroup per fleet.
// The logical population has no poses; this reads the drawn kernel rows.

export const FLEET_CENTER_WGSL = /* wgsl */ `
struct CenterU { spanCount: u32, poseScale: f32, pad: vec2<u32> }
struct Span { start: u32, count: u32, slot: u32, color: u32 }
// Same 32-byte observation: center/count, a real heavy ship, packed badge RGB.
struct Mark { pos: vec4<f32>, anchor: vec3<f32>, color: u32 }
// Compact presentation poses, stride 352. State.z is the live mode.
struct Ship { p: vec4<f32>, q: vec4<f32>, tint: vec4<f32>, state: vec4<u32>, rest: array<vec4<f32>, 18> }
@group(0) @binding(0) var<uniform> u: CenterU;
@group(0) @binding(1) var<storage, read> spans: array<Span>;
@group(0) @binding(2) var<storage, read> ships: array<Ship>;
@group(0) @binding(3) var<storage, read_write> marks: array<Mark>;

var<workgroup> redP: array<vec3<f32>, 32>;
var<workgroup> redN: array<u32, 32>;
var<workgroup> redAnchor: array<u32, 32>;
@compute @workgroup_size(32)
fn fleetCenter(@builtin(workgroup_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  let lane = lid.x;
  if (gid.x >= u.spanCount) { return; }
  let span = spans[gid.x];
  var sum = vec3<f32>(0.0);
  var n = 0u;
  var anchor = 0xffffffffu;
  for (var i = lane; i < span.count; i += 32u) {
    let s = ships[span.start + i];
    if (s.state.z == 0u) { continue; }
    sum += s.p.xyz;
    let kind = min(bitcast<u32>(s.rest[0].x) & 255u, 5u);
    anchor = min(anchor, ((5u - kind) << 16u) | i);
    n++;
  }
  redP[lane] = sum;
  redN[lane] = n;
  redAnchor[lane] = anchor;
  workgroupBarrier();
  for (var stride = 16u; stride > 0u; stride >>= 1u) {
    if (lane < stride) { redP[lane] += redP[lane + stride]; redN[lane] += redN[lane + stride]; redAnchor[lane] = min(redAnchor[lane], redAnchor[lane + stride]); }
    workgroupBarrier();
  }
  if (lane == 0u && span.slot < 128u) {
    let count = redN[0];
    marks[span.slot].pos = vec4<f32>(redP[0] / f32(max(count, 1u)) * u.poseScale, f32(count));
    marks[span.slot].color = span.color;
    marks[span.slot].anchor = vec3<f32>(0.0);
    if (count > 0u) { marks[span.slot].anchor = ships[span.start + (redAnchor[0] & 65535u)].p.xyz * u.poseScale; }
  }
}
`;
