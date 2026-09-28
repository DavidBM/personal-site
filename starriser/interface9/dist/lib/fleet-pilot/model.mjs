/** Experimental GPU pilot fixture data. Production admission remains unchanged. */
import {SHIP_BYTES,SHIP_WORDS} from '../ship-runtime/ship-layout.mjs';
export {SHIP_BYTES};
export const INTENT_BYTES=64;
export const FLEET_BYTES=112;
export const GRID_BUCKETS=16384;
export const CELL_SLOTS=32;
export const CELL_SIZE=2;
export const CLASS_LIMITS=[
  [2,.3,1,.25],[2.5,.15,1,.2],[3,.05,1,.1],
  [1,.05,1,.05],[.7,.05,1,.03],[.3,.05,1,.01],
];
export const RADII=[.05,.07,.1,.16,.24,.36];
export function random(id){let x=Math.imul(id+1,1664525)+1013904223;x^=x>>>16;x=Math.imul(x,2246822519);return (x>>>0)/4294967296;}
function offset(i,n){
  // Setup-only jittered cells give the experiment a non-overlapping baseline.
  // This is a fixture, not a proposed production formation generator.
  const side=Math.ceil(Math.cbrt(n));
  return [i%side,Math.floor(i/side)%side,Math.floor(i/(side*side))]
    .map((v,a)=>(v-(side-1)/2+(random(i*3+a)-.5)*.3)*1.15);
}
/** Setup-only work. No CPU per-ship update in the running model. */
export function seedPilotModel({count=10000,fleetCount=Math.min(64,Math.ceil(count/800)),kind='mixed',cruise=.8}={}){
  validate(count,fleetCount,cruise);
  const ships=new ArrayBuffer(count*SHIP_BYTES),fleets=new ArrayBuffer(fleetCount*FLEET_BYTES);
  const offsets=new Float32Array(count*4),side=Math.ceil(Math.sqrt(fleetCount));
  const data={count,fleetCount,ships,fleets,offsets,cruise};let start=0;
  for(let fleet=0;fleet<fleetCount;fleet++){
    const n=Math.floor(count/fleetCount)+Number(fleet<count%fleetCount);
    seedFleet(data,{fleet,n,start,side,kind});start+=n;
  }
  return data;
}
function validate(count,fleetCount,cruise){
  if(!Number.isInteger(count)||count<1||count>50000)throw Error('Pilot population must be 1–50000');
  if(!Number.isInteger(fleetCount)||fleetCount<1||fleetCount>128||fleetCount>count)throw Error('Invalid pilot fleet count');
  if(!(cruise>0&&cruise<=1))throw Error('Cruise reserve must be explicit in (0,1]');
}
function kindAt(kind,local){if(kind==='mono')return 5;if(kind==='light')return local%2;return local%6;}
function seedFleet(data,{fleet,n,start,side,kind}){
    const {ships,fleets,offsets,cruise}=data;
    const s=new Float32Array(ships),ids=new Uint32Array(ships),f=new Float32Array(fleets),fi=new Uint32Array(fleets),base=fleet*28;
    const center=[(fleet%side-(side-1)/2)*125,0,(Math.floor(fleet/side)-(side-1)/2)*125];
    const radius=42,phase=(fleet%4)*Math.PI/2,heavy=kind==='light'?1:5;
    const speed=CLASS_LIMITS[kind==='light'?0:heavy][0]*cruise,theta=phase+Math.PI/2;
    const position=[center[0]+Math.cos(phase)*radius,0,center[2]+Math.sin(phase)*radius];
    const direction=[-Math.sin(phase),0,Math.cos(phase)];
    f.set([...position,Math.cbrt(n)*.65],base);f.set([...direction.map(v=>v*speed),phase],base+4);
    f.set([...center,radius],base+8);f.set([speed,CLASS_LIMITS[heavy][3],CLASS_LIMITS[heavy][1],cruise],base+12);
    fi.set([start,n,1,1],base+16);f.set([...position,0],base+20);f.set([...direction,theta],base+24);
    for(let local=0;local<n;local++){
      const i=start+local,at=i*SHIP_WORDS,kindIndex=kindAt(kind,local);
      const home=offset(local,n);offsets.set([...home,kindIndex],i*4);
      s.set(position.map((v,a)=>v+home[a]),at);s[at+3]=RADII[kindIndex];
      s.set([...direction.map(v=>v*speed),CLASS_LIMITS[kindIndex][0]],at+4);
      const yaw=Math.atan2(direction[0],direction[2]);s.set([0,Math.sin(yaw/2),0,Math.cos(yaw/2)],at+12);
      ids.set([kindIndex,fleet,1,100001+i],at+20);s[at+31]=-1;
    }
}
