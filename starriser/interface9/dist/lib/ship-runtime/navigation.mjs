import {ROUTE_GUIDANCE_WGSL} from './local-routes.mjs';
import {bodyAt} from './solar-layout.mjs';
import {orbitRadius,orbitTilt} from './flight-layout.mjs';
// Only the pure ring parameter functions are shared; the standalone flight
// fixture's hull/contact helpers are not part of director navigation.
import {ORBIT_WGSL} from './flight-layout.mjs';

export function seedNavigation(data,director,scenario,sampleBody=bodyAt) {
  const f=new Float32Array(data),w=new Uint32Array(data),planet=sampleBody(1,0,1800);
  for(let i=0;i<f.length/48;i++) {
    const at=i*48,type=(w[at+20]>>8)&255,phase=(i*2.39996323)%(Math.PI*2),r=orbitRadius(type,planet[3]),tilt=orbitTilt(type);
    let point=[planet[0]+r*Math.cos(phase),planet[1]+r*Math.sin(phase)*Math.sin(tilt),planet[2]+r*Math.sin(phase)*Math.cos(tilt)];
    if(scenario!==0) {
      const spread=Math.sqrt((i*.61803398875)%1)*Math.max(8,Math.sqrt(f.length/48/1000)*8);
      point=[scenario===3?-80:-20,Math.sin(phase)*spread,Math.cos(phase)*spread];
      if(type>=30)point=[point[0],(w[at+21]*2-1)*40,(type===31?-1:1)*(80+(w[at+20]&255)*35)];
    }
    f.set([...point,phase],at);f.fill(0,at+4,at+7);f.fill(0,at+8,at+12);
  }
}

export const navigationWgsl=(routes=false)=>/* wgsl */`
${routes?ROUTE_GUIDANCE_WGSL:''}
${ORBIT_WGSL}
fn ringVelocity(s:Ship,planetId:u32,now:f32,planeShift:f32)->vec3<f32> {
  let planet=body(planetId,now,u.control.x);let typeId=shipType(s);let limits=sceneLimits(typeId,planet.w);
  let radius=max(orbitRadius(typeId,planet.w),planet.w+sceneHull(typeId,planet.w));let tilt=orbitTilt(typeId)+planeShift;
  let delta=s.p.xyz-planet.xyz;let phase=atan2(dot(delta,vec3<f32>(0.0,sin(tilt),cos(tilt))),delta.x);
  let radial=vec3<f32>(cos(phase),sin(phase)*sin(tilt),sin(phase)*cos(tilt));
  let tangent=vec3<f32>(-sin(phase),cos(phase)*sin(tilt),cos(phase)*cos(tilt));
  let rate=min(.38/PLANET_SCALE,limits.x*.6/radius);
  return bodyVelocity(planetId,now,u.control.x)+tangent*radius*rate+capped((planet.xyz+radius*radial-s.p.xyz)*1.4,limits.x);
}
struct NavigationResult {ship:Ship,velocity:vec3<f32>}
fn navigationStep(initial:Ship,journey:Journey,now:f32)->NavigationResult {
  var s=initial;
  if(s.flight.w==-2.0){
    let typeId=shipType(s);
    let planetR=select(0.02,body(u32(journey.range.z)-1u,now,u.control.x).w,journey.range.z>0.0);
    let limits=sceneLimits(typeId,planetR);
    let delta=journey.exit.xyz-s.p.xyz;return NavigationResult(s,unit(delta)*min(limits.x,sqrt(max(0.0,length(delta)-1.0)*limits.y)));
  }
  let planetId=u32(journey.range.z)-1u;let planet=body(planetId,now,u.control.x);
  var velocity=ringVelocity(s,planetId,now,journey.range.w);
  ${routes?'if(s.flight.w==1.0){return routeStep(s,journey,now,velocity);}':''}
  return NavigationResult(s,velocity);
}
`;
