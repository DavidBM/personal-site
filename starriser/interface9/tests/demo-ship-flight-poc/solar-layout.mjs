// Shared physical geometry for rendering, avoidance and host-side scene framing.
// Enlarge orbital distances with bodies, but preserve their previous linear speed.
export const PLANET_SCALE=50;
export const SOLAR_ORIGIN=[-325,-100,0];
export function bodyAt(i,time,period) {
  if(i===0)return [...SOLAR_ORIGIN,1.7*PLANET_SCALE];
  const radius=(i===2?12.5:6.5)*PLANET_SCALE;
  const angle=time*2*Math.PI/(period*PLANET_SCALE)*(i===2?.62:1)+(i===2?2.2:0);
  return [SOLAR_ORIGIN[0]+radius*Math.cos(angle),SOLAR_ORIGIN[1]+.22*radius*Math.sin(angle),radius*Math.sin(angle),(i===2?1.25:.9)*PLANET_SCALE];
}
export function encounterAt(time,period) {
  const p=bodyAt(1,time,period);return [p[0],p[1]-SOLAR_ORIGIN[1],p[2]];
}
export const SOLAR_WGSL=/* wgsl */`
const PLANET_SCALE:f32=${PLANET_SCALE.toFixed(1)};
const SOLAR_ORIGIN=vec3<f32>(${SOLAR_ORIGIN.map(x=>x.toFixed(1)).join(',')});
fn body(i:u32,t:f32,period:f32)->vec4<f32> {
  if(i==0u){return vec4<f32>(SOLAR_ORIGIN,1.7*PLANET_SCALE);}
  let radius=select(6.5,12.5,i==2u)*PLANET_SCALE;
  let angle=t*2.0*PI/(period*PLANET_SCALE)*select(1.0,.62,i==2u)+select(0.0,2.2,i==2u);
  return vec4<f32>(SOLAR_ORIGIN+radius*vec3<f32>(cos(angle),.22*sin(angle),sin(angle)),select(.9,1.25,i==2u)*PLANET_SCALE);
}
fn bodyVelocity(i:u32,t:f32,period:f32)->vec3<f32> {
  if(i==0u){return vec3<f32>(0.0);}
  let rate=2.0*PI/(period*PLANET_SCALE)*select(1.0,.62,i==2u);
  let angle=t*rate+select(0.0,2.2,i==2u);
  return select(6.5,12.5,i==2u)*PLANET_SCALE*rate*vec3<f32>(-sin(angle),.22*cos(angle),cos(angle));
}
fn encounter(t:f32,period:f32)->vec3<f32>{return body(1u,t,period).xyz-vec3<f32>(0.0,SOLAR_ORIGIN.y,0.0);}
`;
