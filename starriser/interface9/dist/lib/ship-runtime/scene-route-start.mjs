const BODY_LIMIT=16;
const CLEARANCE=1e-7; // Compact units; keeps the merge point strictly outside a shell.
const validPoint=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
function validBody(body) {
  return body&&[body.x,body.y,body.z,body.radius].every(Number.isFinite)&&body.radius>=0;
}
function direction(center,destination) {
  const delta=destination.map((value,i)=>value-center[i]),length=Math.hypot(...delta);
  return length>0?delta.map(value=>value/length):[1,0,0];
}
function rayInterval(center,axis,body,padding) {
  const relative=[body.x-center[0],body.y-center[1],body.z-center[2]];
  const projection=relative.reduce((sum,value,i)=>sum+value*axis[i],0);
  const perpendicular=Math.hypot(...relative.map((value,i)=>value-projection*axis[i]));
  const radius=body.radius+padding+CLEARANCE;
  if(perpendicular>radius)return null;
  const half=Math.sqrt(Math.max(0,(radius-perpendicular)*(radius+perpendicular)));
  return [projection-half,projection+half];
}
function clear(point,bodies,padding) {
  return validPoint(point)&&bodies.every(body=>Math.hypot(point[0]-body.x,point[1]-body.y,point[2]-body.z)>body.radius+padding);
}
function validInput(center,destination,bodies,padding) {
  return validPoint(center)&&validPoint(destination)&&Array.isArray(bodies)&&bodies.length<=BODY_LIMIT
    &&bodies.every(validBody)&&Number.isFinite(padding)&&padding>=0;
}
/** Current-snapshot corridor merge point. This never moves a ship or certifies
 * ingress from every member of a fleet. Future swept obstacles can still deny
 * the subsequent shared route request. Bodies/padding use compact units. */
export function sceneRouteStart(center,destination,bodies,padding=0) {
  if(!validInput(center,destination,bodies,padding))return null;
  if(clear(center,bodies,padding))return center.slice();
  const axis=direction(center,destination);
  const intervals=bodies.map(body=>rayInterval(center,axis,body,padding)).filter(Boolean).sort((a,b)=>a[0]-b[0]);
  let distance=0;
  for(const [enter,exit] of intervals) {
    if(enter>distance)break;
    if(exit>=distance)distance=exit+CLEARANCE;
  }
  const point=center.map((value,i)=>value+axis[i]*distance);
  return clear(point,bodies,padding)?point:null;
}

/** Prove the small escape from a conservatively inflated shell. Never aim
 * through the containing body just because the destination is on its far side.
 * Other shells may not be crossed. Failure is explicit and leaves GPU safety
 * in charge until a later representative observation permits planning. */
export function sceneRouteIngress(center,destination,bodies,padding=0) {
  if(!validInput(center,destination,bodies,padding))return null;
  if(clear(center,bodies,padding))return center.slice();
  const inside=bodies.filter(body=>Math.hypot(center[0]-body.x,center[1]-body.y,center[2]-body.z)<=body.radius+padding+CLEARANCE);
  const away=[0,0,0];
  for(const body of inside){
    const delta=[center[0]-body.x,center[1]-body.y,center[2]-body.z],n=Math.hypot(...delta);
    if(n<CLEARANCE)return null;
    for(let i=0;i<3;i++)away[i]+=delta[i]/n;
  }
  const n=Math.hypot(...away);if(n<CLEARANCE)return null;
  const axis=away.map(v=>v/n);
  // Distance to every containing center must increase along the escape ray.
  if(inside.some(body=>axis[0]*(center[0]-body.x)+axis[1]*(center[1]-body.y)+axis[2]*(center[2]-body.z)<0))return null;
  let distance=0;
  for(const body of inside)distance=Math.max(distance,rayInterval(center,axis,body,padding)?.[1]??0);
  distance+=CLEARANCE;
  for(const body of bodies){
    if(inside.includes(body))continue;
    const hit=rayInterval(center,axis,body,padding);
    if(hit&&hit[1]>=0&&hit[0]<=distance)return null;
  }
  const point=center.map((v,i)=>v+axis[i]*distance);
  return clear(point,bodies,padding)?point:null;
}
