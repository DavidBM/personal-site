/** FX-only ABI: no pilot, ship integrator, route or celestial-body imports. */
export const FX_SHARED = /*wgsl*/ `
struct Frame { clock:vec4<f32>, counts:vec4<u32>, offsets:vec4<u32>, limits:vec4<u32>, selected:vec4<u32>, profiles:array<vec4<f32>,48> }
struct Effect { anchor:vec4<f32>, head:vec4<f32>, motion:vec4<f32>, color:vec4<f32>, owner:vec4<u32>, extra:vec4<f32> }
@group(0) @binding(0) var<uniform> u:Frame;
fn hash(v:u32)->u32{var x=v;x=(x^(x>>16u))*0x7feb352du;x=(x^(x>>15u))*0x846ca68bu;return x^(x>>16u);}
fn random(v:u32)->f32{return f32(hash(v)&65535u)/65535.0;}
fn direction(v:u32)->vec3<f32>{let h=hash(v);return normalize(vec3<f32>(f32(h&1023u),f32((h>>10u)&1023u),f32((h>>20u)&1023u))-vec3<f32>(511.4));}
fn age(birth:f32)->f32{let a=u.clock.x-birth;return select(a,a+4096.0,a<0.0);}
`;
//# sourceMappingURL=shared.wgsl.js.map