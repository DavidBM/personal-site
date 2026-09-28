import { SHIP_SPEED_MULTIPLIER } from './scene-scale.mjs';
// Fixture units; these parameters generate both host metadata and WGSL constants.
export const LARGE_SHIP_SCALE=5;
/** Settled ring/escort spin, relative to its moving planet or anchor. */
export const ORBIT_SPEED_FRACTION=0.2;
// Jewel panel defaults. Jerk and weight stay on the hull.
// Authored table stays readable here. Only cruise speed receives the scene multiplier.
export const CLASSES=Object.freeze([
  {name:'Interceptor',extent:[.10,.045,.21],speed:20,acceleration:3,jerk:120,turn:0.25,weight:1,cap:256},
  {name:'Fighter',extent:[.17,.08,.34],speed:25,acceleration:1.5,jerk:100,turn:0.25,weight:1.5,cap:256},
  {name:'Bomber',extent:[.32,.13,.45],speed:30,acceleration:1,jerk:65,turn:0.25,weight:3,cap:128},
  {name:'Frigate',extent:[.6,.25,1.2],speed:15,acceleration:1,jerk:32,turn:0.25,weight:8,cap:12},
  {name:'Battleship',extent:[1.3,.65,2.8],speed:12,acceleration:1,jerk:16,turn:0.25,weight:24,cap:4},
  {name:'Colossus',extent:[3,1.4,6],speed:8,acceleration:1,jerk:11,turn:0.25,weight:96,cap:1},
].map((kind,index)=>{
  const extent=kind.extent.map(x=>x*(index>=4?LARGE_SHIP_SCALE:1));
  // One mass unit per cubic world unit for capitals: a fully occupied 4-unit
  // pressure cell receives about 64 mass, directly in the red display range.
  const volume=8*extent[0]*extent[1]*extent[2];
  return {...kind,speed:kind.speed*SHIP_SPEED_MULTIPLIER,extent,weight:Math.max(kind.weight,index>=4?volume:0)};
}));
export const TYPES=32;
export const CLASS_BY_TYPE=Object.freeze([...Array(12).fill(0),...Array(10).fill(1),...Array(5).fill(2),3,3,3,4,5]);
export const classOf=type=>CLASSES[CLASS_BY_TYPE[type]];
export const radiusOf=type=>Math.hypot(...classOf(type).extent);
/** Hull draw scale on the normalized mesh. The number is the size, not a factor on the class extent. */
export const CLASS_VISUAL_SCALE=Object.freeze([1,1.3,2,9,20,20]);
export const visualScaleOf=type=>CLASS_VISUAL_SCALE[CLASS_BY_TYPE[type]??0]??1;
/** Repulsion radius in sim units. The number is the bubble, not a factor on the hull. */
export const CLASS_REPEL_SCALE=Object.freeze([0.015,0.02,0.03,0.04,0.125,0.3]);
export const classMask=kind=>CLASS_BY_TYPE.reduce((mask,c,t)=>c===kind?(mask|(1<<t))>>>0:mask,0);
export function cohortSizes(fleetCount) {
  const counts=new Uint32Array(TYPES).fill(1);let remaining=fleetCount-TYPES;
  while(remaining>0) {
    let added=0;
    for(let type=0;type<TYPES&&remaining>0;type++) {
      if(counts[type]>=classOf(type).cap)continue;
      counts[type]++;remaining--;added++;
    }
    if(added===0)throw new Error('Population exceeds class cohort capacities');
  }
  return counts;
}
const vec=values=>`vec4<f32>(${values.map(x=>Number.isInteger(x)?`${x}.0`:String(x)).join(',')})`;
const CLASS_INDEX=`fn classIndex(typeId:u32)->u32 {let kinds=array<u32,32>(${CLASS_BY_TYPE.map(x=>`${x}u`).join(',')});return kinds[typeId];}`;
const CLASS_TAIL=`fn dimensions(typeId:u32)->vec4<f32> {let values=array<vec4<f32>,6>(${CLASSES.map(c=>vec([...c.extent,Math.hypot(...c.extent)])).join(',')});return values[classIndex(typeId)];}
fn shipType(s:Ship)->u32 {return (s.identity.x>>8u)&31u;}
fn sceneOrdinal(id:u32)->u32 {return (id&255u)|(((id>>13u)&31u)<<8u);}
fn groupOf(s:Ship)->u32 {return s.identity.x>>18u;}`;
/** Const tables for shaders that are not on the live class-tuning buffer. */
export const CLASS_WGSL=`
${CLASS_INDEX}
${CLASS_TAIL}
fn dynamics(typeId:u32)->vec4<f32> {let values=array<vec4<f32>,6>(${CLASSES.map(c=>vec([c.speed,c.acceleration,c.jerk,c.turn])).join(',')});return values[classIndex(typeId)];}
fn densityWeight(typeId:u32)->f32 {let values=array<f32,6>(${CLASSES.map(c=>Number.isInteger(c.weight)?`${c.weight}.0`:String(c.weight)).join(',')});return values[classIndex(typeId)];}
fn repelScale(typeId:u32)->f32 {let values=array<f32,6>(${CLASS_REPEL_SCALE.map(x=>Number.isInteger(x)?`${x}.0`:String(x)).join(',')});return values[classIndex(typeId)];}
`;
/** Simulation reads the buffer written once per edit, at frame start.
 *  Uniform, not storage: the compute stage is already at the default limit of 8 storage buffers. */
export const CLASS_TUNED_WGSL=`
struct ClassTuning { rows: array<vec4<f32>, 12> }
@group(0) @binding(9) var<uniform> classTuning: ClassTuning;
${CLASS_INDEX}
${CLASS_TAIL}
fn dynamics(typeId:u32)->vec4<f32> {return classTuning.rows[classIndex(typeId)*2u];}
fn densityWeight(typeId:u32)->f32 {return classTuning.rows[classIndex(typeId)*2u+1u].z;}
fn repelScale(typeId:u32)->f32 {return classTuning.rows[classIndex(typeId)*2u+1u].x;}
fn classVisual(typeId:u32)->f32 {return max(0.05,classTuning.rows[classIndex(typeId)*2u+1u].y);}
`;
