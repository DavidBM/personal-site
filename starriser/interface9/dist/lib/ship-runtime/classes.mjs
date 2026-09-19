// Fixture units; these parameters generate both host metadata and WGSL constants.
export const LARGE_SHIP_SCALE=5;
export const CLASSES=Object.freeze([
  {name:'Interceptor',extent:[.10,.045,.21],speed:9,acceleration:12,jerk:60,turn:4.5,weight:1,cap:256},
  {name:'Fighter',extent:[.17,.08,.34],speed:6.5,acceleration:8,jerk:40,turn:3.2,weight:1.5,cap:256},
  {name:'Bomber',extent:[.32,.13,.45],speed:4,acceleration:4,jerk:18,turn:1.8,weight:3,cap:128},
  {name:'Frigate',extent:[.6,.25,1.2],speed:2.4,acceleration:1.8,jerk:6,turn:.9,weight:8,cap:12},
  {name:'Battleship',extent:[1.3,.65,2.8],speed:1.3,acceleration:.65,jerk:2,turn:.35,weight:24,cap:4},
  {name:'Colossus',extent:[3,1.4,6],speed:.65,acceleration:.25,jerk:.8,turn:.15,weight:96,cap:1},
].map((kind,index)=>{
  const extent=kind.extent.map(x=>x*(index>=4?LARGE_SHIP_SCALE:1));
  // One mass unit per cubic world unit for capitals: a fully occupied 4-unit
  // pressure cell receives about 64 mass, directly in the red display range.
  const volume=8*extent[0]*extent[1]*extent[2];
  return {...kind,extent,weight:Math.max(kind.weight,index>=4?volume:0)};
}));
export const TYPES=32;
export const CLASS_BY_TYPE=Object.freeze([...Array(12).fill(0),...Array(10).fill(1),...Array(5).fill(2),3,3,3,4,5]);
export const classOf=type=>CLASSES[CLASS_BY_TYPE[type]];
export const radiusOf=type=>Math.hypot(...classOf(type).extent);
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
export const CLASS_WGSL=`
fn classIndex(typeId:u32)->u32 {let kinds=array<u32,32>(${CLASS_BY_TYPE.map(x=>`${x}u`).join(',')});return kinds[typeId];}
fn dimensions(typeId:u32)->vec4<f32> {let values=array<vec4<f32>,6>(${CLASSES.map(c=>vec([...c.extent,Math.hypot(...c.extent)])).join(',')});return values[classIndex(typeId)];}
fn dynamics(typeId:u32)->vec4<f32> {let values=array<vec4<f32>,6>(${CLASSES.map(c=>vec([c.speed,c.acceleration,c.jerk,c.turn])).join(',')});return values[classIndex(typeId)];}
fn densityWeight(typeId:u32)->f32 {let values=array<f32,6>(${CLASSES.map(c=>Number.isInteger(c.weight)?`${c.weight}.0`:String(c.weight)).join(',')});return values[classIndex(typeId)];}
fn shipType(s:Ship)->u32 {return (s.identity.x>>8u)&255u;}
fn groupOf(s:Ship)->u32 {return s.identity.x>>18u;}
`;
