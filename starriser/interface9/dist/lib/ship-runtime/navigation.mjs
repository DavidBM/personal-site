import {SHIP_WORDS} from './ship-layout.mjs';
import {ROUTE_GUIDANCE_WGSL} from './local-routes.mjs';
import {SCENE_ROUTE_WGSL} from './scene-route.mjs';
import {bodyAt,PLANET_SCALE} from './solar-layout.mjs';
import {orbitRadius,orbitTilt} from './flight-layout.mjs';
// Only the pure ring parameter functions are shared; the standalone flight
// fixture's hull/contact helpers are not part of director navigation.
import {ORBIT_WGSL} from './flight-layout.mjs';

export function seedNavigation(data,director,scenario,sampleBody=bodyAt) {
  const f=new Float32Array(data),w=new Uint32Array(data),planet=sampleBody(1,0,1800);
  for(let i=0;i<f.length/SHIP_WORDS;i++) {
    const at=i*SHIP_WORDS,type=(w[at+20]>>8)&255,phase=(i*2.39996323)%(Math.PI*2),r=orbitRadius(type,planet[3]),tilt=orbitTilt(type);
    let point=[planet[0]+r*Math.cos(phase),planet[1]+r*Math.sin(phase)*Math.sin(tilt),planet[2]+r*Math.sin(phase)*Math.cos(tilt)];
    if(scenario!==0) {
      const spread=Math.sqrt((i*.61803398875)%1)*Math.max(8,Math.sqrt(f.length/SHIP_WORDS/1000)*8);
      point=[scenario===3?-80:-20,Math.sin(phase)*spread,Math.cos(phase)*spread];
      if(type>=30)point=[point[0],(w[at+21]*2-1)*40,(type===31?-1:1)*(80+(w[at+20]&255)*35)];
    }
    f.set([...point,phase],at);f.fill(0,at+4,at+7);f.fill(0,at+8,at+12);
  }
}

export const navigationWgsl=(routes=false,fleetPilot=false)=>/* wgsl */`
${routes?ROUTE_GUIDANCE_WGSL:''}
${ORBIT_WGSL}
${routes?SCENE_ROUTE_WGSL:''}
fn destinationRing(typeId:u32,bodyRadius:f32)->f32 {
  return max(orbitRadius(typeId,bodyRadius),bodyRadius+sceneHull(typeId,bodyRadius));
}
fn ringGuidance(s:Ship,planetId:u32,now:f32,planeShift:f32)->vec4<f32> {
  let planet=body(planetId,now,u.control.x);let typeId=shipType(s);let limits=sceneLimits(typeId,planet.w);
  let baseRadius=destinationRing(typeId,planet.w);let tilt=orbitTilt(typeId)+planeShift;
  ${routes?`let form=director.forms[s.identity.y];
  let assignment=warpOffset(s)-form.origin.xyz;
  let spread=max(0.0,form.origin.w);
  let radius=baseRadius+clamp((assignment.z+spread)*.5,0.0,spread);
  let ringCenter=planet.xyz+vec3<f32>(0.0,cos(tilt),-sin(tilt))*clamp(assignment.y,-spread,spread);`:
  'let radius=baseRadius;let ringCenter=planet.xyz;'}
  let delta=s.p.xyz-ringCenter;let phase=atan2(dot(delta,vec3<f32>(0.0,sin(tilt),cos(tilt))),delta.x);
  let radial=vec3<f32>(cos(phase),sin(phase)*sin(tilt),sin(phase)*cos(tilt));
  // Ring guidance must be flyable by the hull, not merely a fast moving target
  // that the attitude controller can never catch. Leave maneuvering headroom.
  let turn=dynamics(typeId).w*.65;
  let curvature=sqrt(max(0.0,limits.y*.65/max(radius,.001)));
  let rate=min(min(.38/PLANET_SCALE,limits.x*.6/radius),min(turn,curvature));
  let toRing=ringCenter+radius*radial-s.p.xyz;
  let dist=length(toRing);
  // Shared jerk/turn-aware braking envelope into the moving ring.
  let closing=min(limits.x,brakingSpeedAt(s,limits,dist,radius*rate));
  // Look ahead on the moving ring. A tangent plus a radial velocity spring
  // changes heading after overshooting; this target describes the arc before it.
  let ahead=phase+.5;
  let aim=ringCenter+radius*vec3<f32>(cos(ahead),sin(ahead)*sin(tilt),sin(ahead)*cos(tilt))-s.p.xyz;
  let velocity=bodyVelocity(planetId,now,u.control.x)+unit(aim)*closing;
  return vec4<f32>(velocity,length(aim));
}
fn ringVelocity(s:Ship,planetId:u32,now:f32,planeShift:f32)->vec3<f32>{return ringGuidance(s,planetId,now,planeShift).xyz;}
struct NavigationResult {ship:Ship,velocity:vec3<f32>,reach:f32}
fn navigationStep(initial:Ship,journey:Journey,now:f32)->NavigationResult {
  var s=initial;
  ${routes&&fleetPilot?'if(fleetPilotActive(s)){return fleetPilotGuidance(s,sceneLimits(shipType(s),journeyBodyRadius(s)));}':''}
  ${routes?'if(s.flight.w==-3.0){let guide=sceneRouteGuidance(s,sceneLimits(shipType(s),journeyBodyRadius(s)));s.memory.x=guide.arc;s.memory.y=director.sceneRoutes[s.identity.y].info.w;s.memory.z=-1.0;return NavigationResult(s,guide.velocity,guide.reach);}':''}
  if(s.flight.w==-2.0){
    let typeId=shipType(s);
    let planetR=select(0.02,body(u32(journey.range.z)-1u,now,u.control.x).w,journey.range.z>0.0);
    let limits=sceneLimits(typeId,planetR);
    let delta=journey.exit.xyz-s.p.xyz;return NavigationResult(s,unit(delta)*min(limits.x,brakingSpeedAt(s,limits,max(0.0,length(delta)-1.0),0.0)),length(delta));
  }
  let planetId=u32(journey.range.z)-1u;let planet=body(planetId,now,u.control.x);
  let guide=ringGuidance(s,planetId,now,journey.range.w);
  ${routes?'if(s.flight.w==1.0){return routeStep(s,journey,now,guide);}':''}
  return NavigationResult(s,guide.xyz,guide.w);
}
`;
