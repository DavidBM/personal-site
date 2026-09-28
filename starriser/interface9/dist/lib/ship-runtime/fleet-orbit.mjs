import {orbitRadius,orbitTilt,planetOrbitAdapt} from './flight-layout.mjs';
import {radiusOf,ORBIT_SPEED_FRACTION} from './classes.mjs';

export const FLEET_RING_WIDTH=.4;
export const FLEET_RING_HEIGHT=.2;
export const FLEET_RING_BLEND_SECONDS=8;

/** Same destination shell as WGSL; the public orbitRadius omits hull padding. */
export function fleetRingGeometry(type,bodyRadius,spread,offset=[0,0,0],planeShift=0) {
  const hull=radiusOf(type)*planetOrbitAdapt(bodyRadius);
  const base=Math.max(orbitRadius(type,bodyRadius)+hull*2,bodyRadius+hull);
  const cloud=Math.max(0,spread),width=Math.min(cloud,base*FLEET_RING_WIDTH);
  const fraction=Math.max(0,Math.min(1,.5+.5*offset[2]/Math.max(cloud,.0001)));
  return {radius:base+width*fraction,height:Math.max(-cloud,Math.min(cloud,offset[1]))
    *Math.min(1,base*FLEET_RING_HEIGHT/Math.max(cloud,.0001)),tilt:orbitTilt(type)+planeShift};
}

export const FLEET_ORBIT_WGSL=/* wgsl */`
fn pilotRingParameters(s:Ship,planetRadius:f32)->vec4<f32>{
  let form=director.forms[s.identity.y];let offset=warpOffset(s)-form.origin.xyz;
  let base=destinationRing(shipType(s),planetRadius);let spread=max(0.0,form.origin.w);
  let width=min(spread,base*${FLEET_RING_WIDTH});
  let radius=base+width*clamp(.5+.5*offset.z/max(spread,.0001),0.0,1.0);
  let height=clamp(offset.y,-spread,spread)*min(1.0,base*${FLEET_RING_HEIGHT}/max(spread,.0001));
  return vec4<f32>(radius,height,orbitTilt(shipType(s))+journeyFor(s).range.w,-max(1.0,journeyFor(s).mode.y));
}
fn pilotRingCapture(s:Ship)->vec4<f32>{
  let token=-max(1.0,journeyFor(s).mode.y);let captured=director.warpOffsets[sceneTravelIndex(s)];
  if(captured.w==token){return captured;}
  return pilotRingParameters(s,journeyBodyRadius(s));
}
fn capturePilotRing(s:Ship){
  if(s.flight.w!=-1.0||director.fleetGuides[s.identity.y].ship.aux.z<=0.0){return;}
  let at=sceneTravelIndex(s);let token=-max(1.0,journeyFor(s).mode.y);
  if(director.warpOffsets[at].w!=token){director.warpOffsets[at]=pilotRingParameters(s,journeyBodyRadius(s));}
}
fn pilotOrbitFrame(s:Ship,now:f32)->Ship {
  var next=s;let journey=journeyFor(s);let planet=body(u32(journey.range.z)-1u,now,u.control.x);
  let form=director.forms[s.identity.y];let base=destinationRing(shipType(s),planet.w);
  let radius=base+min(max(0.0,form.origin.w),base*${FLEET_RING_WIDTH})*.5;
  let tilt=orbitTilt(shipType(s))+journey.range.w;
  let axis=vec3<f32>(0.0,sin(tilt),cos(tilt));let normal=vec3<f32>(0.0,cos(tilt),-sin(tilt));
  let delta=s.p.xyz-planet.xyz;let height=dot(delta,normal);
  let radial=vec2<f32>(delta.x,dot(delta,axis));
  let error=length(vec2<f32>(length(radial)-radius,height));
  // One shared, monotonic arrival decision. It never depends on a slow member,
  // quorum or CPU readback, and it cannot oscillate at the edge of the shell.
  let entering=error<max(.15,max(radius*.35,form.origin.w*.35));
  let started=s.aux.z>0.0||entering;
  next.aux=vec4<f32>(atan2(radial.y,radial.x),radius,
    select(0.0,min(1.0,s.aux.z+u.clock.y/${FLEET_RING_BLEND_SECONDS}.0),started),journey.mode.y);
  return next;
}
fn pilotOrbit(s:Ship,limits:vec4<f32>,now:f32)->vec4<f32>{
  let journey=journeyFor(s);let index=u32(journey.range.z)-1u;
  let planet=body(index,now,u.control.x);let tilt=orbitTilt(shipType(s))+journey.range.w;
  let axis=vec3<f32>(0.0,sin(tilt),cos(tilt));let radius=s.aux.y;
  let orbitalSpeed=min(limits.x*${ORBIT_SPEED_FRACTION},min(radius*limits.w*.65,sqrt(radius*limits.y*.65)));
  let ahead=s.aux.x+.35;
  let point=planet.xyz+radius*(vec3<f32>(cos(ahead),0.0,0.0)+axis*sin(ahead));
  let remaining=max(0.0,length(s.p.xyz-planet.xyz)-radius);
  var relative=s;relative.v=vec4<f32>(s.v.xyz-bodyVelocity(index,now,u.control.x),s.v.w);
  let closing=min(limits.x,brakingSpeedAt(relative,limits,remaining,orbitalSpeed));
  return vec4<f32>(bodyVelocity(index,now,u.control.x)+unit(point-s.p.xyz)*closing,length(point-s.p.xyz));
}
fn pilotIndividualOrbit(s:Ship,limits:vec4<f32>,blend:f32)->vec4<f32>{
  let journey=journeyFor(s);let index=u32(journey.range.z)-1u;
  let planet=body(index,u.clock.x,u.control.x);let ring=pilotRingCapture(s);
  let axis=vec3<f32>(0.0,sin(ring.z),cos(ring.z));let normal=vec3<f32>(0.0,cos(ring.z),-sin(ring.z));
  let relative=s.p.xyz-planet.xyz;let height=dot(relative,normal);
  let radial=vec2<f32>(relative.x,dot(relative,axis));
  // A ship joins ahead of its own bearing, never a hash-assigned seat behind
  // it. The persistent assignment is radius/height/plane, not a rigid phase.
  // Morph in body-relative cylindrical coordinates, not a chord through a body.
  let radius=mix(max(length(radial),ring.x),ring.x,blend);
  let level=mix(height,ring.y,blend);let phase=atan2(radial.y,radial.x)+.35;
  let point=planet.xyz+normal*level+radius*(vec3<f32>(cos(phase),0.0,0.0)+axis*sin(phase));
  let turn=dynamics(shipType(s)).w*.65;
  let speed=min(limits.x*${ORBIT_SPEED_FRACTION},min(ring.x*turn,sqrt(ring.x*limits.y*.65)));
  let error=length(vec2<f32>(length(radial)-ring.x,height-ring.y));
  // Inside the capture band, use the settled orbit pace. Retain recovery
  // speed for displaced members instead of throttling them before they arrive.
  let recovery=max(0.0,error-max(.02,ring.x*.05));
  let closing=min(limits.x,brakingSpeedAt(s,limits,recovery,speed));
  return vec4<f32>(bodyVelocity(index,u.clock.x,u.control.x)+unit(point-s.p.xyz)*closing,length(point-s.p.xyz));
}
`;
