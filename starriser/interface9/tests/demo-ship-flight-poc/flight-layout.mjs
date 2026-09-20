import {CLASS_BY_TYPE} from '../demo-ship-battle-poc/classes.mjs';
export const FLIGHT_GRID_SIDE=64;
export const FLIGHT_CELL_SIZE=8;
export const FLIGHT_GRID_CELLS=FLIGHT_GRID_SIDE**3;
export const ORBIT_MULTIPLIERS=Object.freeze([4,5,10,20,35,50]);
export const ORBIT_TILTS=Object.freeze([.2,.5,.85,1.15,-.45,-.85]);
export const orbitRadius=(type,planetRadius)=>planetRadius+2.4*ORBIT_MULTIPLIERS[CLASS_BY_TYPE[type]];
export const orbitTilt=type=>ORBIT_TILTS[CLASS_BY_TYPE[type]];
// Two capital representatives; all other classes are interleaved through the
// approach instead of creating long blocks of identical ships.
export function flightType(index,count) {
  if(count>=6&&index>=count-2)return 30+index-(count-2);
  if(index<4)return [0,12,22,27][index];
  return [0,12,0,12,22,27][index%6];
}
export function flightLane(index,count,type) {
  if(type>=30)return [0,type===30?60:-75];
  const phase=index*2.39996323,spread=Math.sqrt((index*.61803398875)%1)*Math.max(8,Math.sqrt(count/1000)*8);
  return [Math.sin(phase)*spread,Math.cos(phase)*spread];
}
export const ORBIT_WGSL=`
fn orbitRadius(typeId:u32,bodyRadius:f32)->f32 {
  let scale=array<f32,6>(${ORBIT_MULTIPLIERS.map(x=>x+'.0').join(',')});return bodyRadius+2.4*scale[classIndex(typeId)];
}
fn orbitTilt(typeId:u32)->f32 {
  let tilts=array<f32,6>(${ORBIT_TILTS.join(',')});return tilts[classIndex(typeId)];
}
`;
export const FLIGHT_GUIDANCE_WGSL=`
${ORBIT_WGSL}
fn flightLane(s:Ship)->vec3<f32> {
  let i=s.identity.w-1u;let typeId=shipType(s);
  if(typeId>=30u){return vec3<f32>(0.0,0.0,select(60.0,-75.0,typeId==31u));}
  let phase=f32(i)*2.39996323;
  let spread=sqrt(fract(f32(i)*.61803398875))*max(8.0,sqrt(u.clock.z/1000.0)*8.0);
  return vec3<f32>(0.0,sin(phase)*spread,cos(phase)*spread);
}
fn hullSlot(slot:u32)->u32 {return u32(u.clock.z)-2u+slot;}
fn capitalAvoidance(s:Ship,i:u32)->vec3<f32> {
  if(u.clock.z<6.0||pressureEnabled()==0.0){return vec3<f32>(0.0);}
  var force=vec3<f32>(0.0);let limits=dynamics(shipType(s));
  for(var k=0u;k<2u;k++) {
    let other=hullSlot(k);if(other==i){continue;}
    let t=old[other];let delta=s.p.xyz-t.p.xyz;let velocity=s.v.xyz-t.v.xyz;
    let tau=clamp(-dot(delta,velocity)/max(dot(velocity,velocity),.01),0.0,clamp(length(velocity)/limits.y,1.2,6.0));
    let gap=length(delta+velocity*tau)-dimensions(shipType(t)).w-dimensions(shipType(s)).w;
    let normal=select(pairDirection(s.identity.w,t.identity.w),unit(delta),length(delta)>.00001);
    if(gap<1.0){force+=normal*(1.0-gap)*limits.y;}
  }
  return force;
}
`;
