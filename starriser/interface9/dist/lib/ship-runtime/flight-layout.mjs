import {CLASS_BY_TYPE,CLASSES} from './classes.mjs';
export const FLIGHT_GRID_SIDE=64;
export const FLIGHT_CELL_SIZE=8;
export const FLIGHT_GRID_CELLS=FLIGHT_GRID_SIDE**3;
export const ORBIT_MULTIPLIERS=Object.freeze([4,5,10,20,35,50]);
export const ORBIT_TILTS=Object.freeze([.2,.5,.85,1.15,-.45,-.85]);
export const POC_PLANET_RADIUS=45;
export function planetOrbitAdapt(planetRadius) {
  const r=Math.max(0,planetRadius);
  if(!(r>0))return 0.02;
  return Math.min(1,Math.max(0.02,r/POC_PLANET_RADIUS));
}
/** Kepler class rings sit at least this many body radii from the center. PoC keeps R+pad. */
export const SCENE_ORBIT_CORE_MUL=3;
export const orbitRadius=(type,planetRadius)=>{
  const adapt=planetOrbitAdapt(planetRadius);
  const pad=2.4*ORBIT_MULTIPLIERS[CLASS_BY_TYPE[type]]*adapt;
  const core=adapt<0.99?planetRadius*SCENE_ORBIT_CORE_MUL:planetRadius;
  return core+pad;
};
export const orbitTilt=type=>ORBIT_TILTS[CLASS_BY_TYPE[type]];
// Two capital representatives; all other classes are interleaved through the
// approach instead of creating long blocks of identical ships.
export function flightType(index,count) {
  if(count>=6&&index>=count-2)return 30+index-(count-2);
  if(index<4)return [0,12,22,27][index];
  return [0,12,0,12,22,27][index%6];
}
/** Interceptor, fighter, bomber, battleship — 4 rungs, 128 slots × 4 = 512 groups. */
export const SCENE_CLASS_TYPES=Object.freeze([0,12,22,30]);
/** Compact field diameter (world). Same as SYSTEM_LOCAL_SPAN / COMPACT_SYSTEM_SPAN. */
export const SCENE_SPAN=0.1;
/** Compact → lab. Same as SCENE_LAB_SCALE. */
export const SCENE_LAB=56/SCENE_SPAN;
/** Interceptor crosses {@link SCENE_SPAN} in this many seconds. */
export const SCENE_CROSS_SEC=60;
/** sceneLimits xyz scale on Kepler worlds. PoC (adapt≥0.99) keeps class speed. */
export const SCENE_TRAVEL_ADAPT=(SCENE_SPAN/SCENE_CROSS_SEC)*SCENE_LAB/CLASSES[0].speed;
/** Compact turn scale so trails do not whip. PoC (adapt≥0.99) keeps class turn. */
export const SCENE_TURN_ADAPT=0.22;
function classDistance(type,other) {
  return Math.abs((CLASS_BY_TYPE[type]??0)-(CLASS_BY_TYPE[other]??0));
}
function indexOfFlightType(type,types) {
  const exact=types.indexOf(type);
  if(exact>=0)return exact;
  let best=0,bestD=99;
  for(let i=0;i<types.length;i++) {
    const d=classDistance(type,types[i]);
    if(d<bestD){bestD=d;best=i;}
  }
  return best;
}
function sceneFlightType(index,count) {
  if(count>=6&&index>=count-1)return 30;
  if(index<4)return SCENE_CLASS_TYPES[index];
  return [0,12,0,12,22,30][index%6];
}
function pickerFor(types) {
  if(types.length===4&&types[0]===0&&types[1]===12&&types[2]===22&&types[3]===30)return sceneFlightType;
  return flightType;
}
/** Split `total` visuals across occupied type codes using PoC `flightType` mix. */
export function distributeFlightTypes(total,types) {
  const n=types.length,counts=new Array(n).fill(0);
  if(n===0||total<=0)return counts;
  if(n===1){counts[0]=total|0;return counts;}
  const pick=pickerFor(types);
  for(let i=0;i<(total|0);i++)counts[indexOfFlightType(pick(i,total|0),types)]++;
  return counts;
}
export function flightLane(index,count,type) {
  if(type>=30)return [0,type===30?60:-75];
  const phase=index*2.39996323,spread=Math.sqrt((index*.61803398875)%1)*Math.max(8,Math.sqrt(count/1000)*8);
  return [Math.sin(phase)*spread,Math.cos(phase)*spread];
}
export const SCENE_ADAPT_WGSL=`
fn sceneAdapt(bodyRadius:f32)->f32 {return clamp(bodyRadius/${POC_PLANET_RADIUS}.0,0.02,1.0);}
fn sceneHull(typeId:u32,bodyRadius:f32)->f32 {return dimensions(typeId).w*sceneAdapt(bodyRadius);}
`;
export const ORBIT_WGSL=`
fn sceneLimits(typeId:u32,bodyRadius:f32)->vec4<f32> {
  let limits=dynamics(typeId);let a=sceneAdapt(bodyRadius);
  let travel=select(${SCENE_TRAVEL_ADAPT},a,a>=0.99);
  let turn=select(${SCENE_TURN_ADAPT},1.0,a>=0.99);
  return vec4<f32>(limits.xyz*travel,limits.w*turn);
}
fn orbitRadius(typeId:u32,bodyRadius:f32)->f32 {
  let scale=array<f32,6>(${ORBIT_MULTIPLIERS.map(x=>x+'.0').join(',')});
  let adapt=sceneAdapt(bodyRadius);
  let pad=2.4*scale[classIndex(typeId)]*adapt+sceneHull(typeId,bodyRadius)*2.0;
  let core=select(bodyRadius,bodyRadius*${SCENE_ORBIT_CORE_MUL}.0,adapt<0.99);
  return core+pad;
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
