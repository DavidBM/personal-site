import {VISUAL_FLEET_WGSL,VISUAL_EVENT_INTEGRATION_WGSL} from './visual-fleet.mjs';
import {BRAKING_WGSL} from './braking.mjs';
import {SHIP_BYTES, SHIP_WGSL} from './ship-layout.mjs';
import {NAVIGATION_INSPECTION_WGSL} from './navigation-inspection.mjs';
import {ANGULAR_MOTION_WGSL} from './angular-motion.mjs';
import {FORWARD_MOTION_WGSL} from './forward-motion.mjs';
import {TRANSPORT_MOTION_WGSL} from './transport-motion.mjs';
import {FORWARD_INTEGRATION_WGSL} from './forward-integration.mjs';
import {OBSTACLE_PADDING,OBSTACLE_SOFT_REACH} from './force-clearance.mjs';
import {simulationSlots} from './slot-layout.mjs';
import {CORRECTION_WRITE,CORRECTION_READ} from './correction-gpu.mjs';
import {ARRIVAL_CORRECTION_WGSL} from './arrival-correction.mjs';
import {RECOVERY_WGSL} from './recovery-gpu.mjs';
import {runtimeSolarWgsl} from './solar-runtime.mjs';
import {eventField,eventPoseRead,spatialShaderSource} from './event-gpu.mjs';
import {eventMotionWgsl,splitAdvanceWgsl} from './event-motion.mjs';
import {fleetCapacity} from './runtime-capacity.mjs';
import {navigationWgsl} from './navigation.mjs';
import {CONTACT_QUERY_WGSL} from './contact-queries.mjs';
import {CONTACT_CACHE_WGSL,contactCacheWgsl} from './contact-cache.mjs';
import {scheduleWgsl} from './spatial-schedule.mjs';
import {SOLAR_WGSL} from './solar-layout.mjs';
import {EFFECTS_SIM,EFFECTS_DRAW} from './combat-effects.mjs';
import {tacticalMemoryWgsl} from './tactical-memory.mjs';
import {lifecycleWgsl} from './lifecycle.mjs';
import {subDirectorWgsl} from './sub-director.mjs';
import {controlWgsl} from './control.mjs';
import {ENGAGEMENT_WGSL} from './engagement.mjs';
import {CLASS_WGSL, CLASS_TUNED_WGSL} from './classes.mjs';
import {SCENE_ADAPT_WGSL} from './flight-layout.mjs';
import {FLEET_TRAVEL_WGSL} from './fleet-travel.mjs';
import {FLEET_PILOT_WGSL} from './fleet-pilot.mjs';
import {PILOT_PREDICTION_WGSL} from './pilot-prediction.mjs';
import {PILOT_RECOVERY_WGSL} from './pilot-recovery.mjs';
import {BOUNDED_PILOT_WGSL} from './bounded-pilot.mjs';
import {formationWgsl} from './formation.mjs';
import {densitySimulation,densityDrawing} from './density.mjs';
// Shared production/laboratory physical controller. One authoritative pose writer.
export const RING = 16;
export const STRIDE = SHIP_BYTES;
export {SHIP_WGSL} from './ship-layout.mjs';
const common = (solar=false, tuned=false,cached=false)=>/* wgsl */`
${SHIP_WGSL}
${tuned ? CLASS_TUNED_WGSL : CLASS_WGSL}
${SCENE_ADAPT_WGSL}
const PI: f32 = 3.14159265359;
const RING: u32 = 16u;
fn capped(v: vec3<f32>, maximum: f32) -> vec3<f32> { return v * min(1.0, maximum / max(length(v), 0.000001)); }
fn unit(v: vec3<f32>) -> vec3<f32> { return v / max(length(v), 0.000001); }
fn rotate(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
fn qmul(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(a.w*b.xyz + b.w*a.xyz + cross(a.xyz,b.xyz), a.w*b.w-dot(a.xyz,b.xyz));
}
${solar===false?SOLAR_WGSL:runtimeSolarWgsl(solar===true?undefined:solar,cached)}
fn emitter(s: Ship, e: u32) -> vec3<f32> {
  let size=dimensions(shipType(s)).xyz;
  let local=vec3<f32>((f32(e)-1.0)*0.5,select(-0.2,0.15,e==1u),-1.0)*size;
  return s.p.xyz + rotate(s.q,local);
}
`;

const simulationClock=(solar,pilot)=>/* wgsl */`
struct Input { clock: vec4<f32>, control: vec4<f32>, warp: vec4<f32> ${solar?',trail:vec4<f32>':''} ${pilot?',pilotMatrix:mat4x4<f32>,pilotOrigin:vec4<f32>,pilotView:vec4<f32>':''} }
fn selectionTick(now:f32)->u32{return ${solar?'u32(u.clock.w)+(u32(u.warp.w)<<16u)':'u32(now*30.0)'};}
fn redistributionPhase(now:f32)->u32{return ${solar?'u32(u.control.y)':'u32(now*8.0)%8u'};}
fn trailFirst(now:f32,dt:f32)->u32{return ${solar?'u32(u.trail.x)':'u32(floor(max(0.0,now-dt)*60.0))+1u'};}
fn trailLast(now:f32)->u32{return ${solar?'u32(u.trail.y)':'u32(floor(now*60.0))'};}
`;
const simulationSource = (cellSize=4,capacity=fleetCapacity(2),pressureScopes=null,solar=false,splitAdvance=false)=>common(solar, true,Boolean(solar&&capacity.occupancy)) + /* wgsl */`
${simulationClock(solar,solar&&capacity.occupancy)}
@group(0) @binding(0) var<uniform> u: Input;
@group(0) @binding(1) var<storage,read> old: array<Ship>;
@group(0) @binding(2) var<storage,read_write> next: array<Ship>;
@group(0) @binding(3) var<storage,read_write> history: array<vec4<f32>>;
struct Group { order:vec4<u32>, roster:vec4<u32> }
@group(0) @binding(4) var<storage,read> orders: array<Group>;


${controlWgsl(capacity,pressureScopes,solar,solar,solar)}
${solar?formationWgsl(capacity.fleetCount,true,Boolean(capacity.occupancy)):''}
${solar?(capacity.occupancy?PILOT_RECOVERY_WGSL+FLEET_PILOT_WGSL:FLEET_TRAVEL_WGSL):''}
${capacity.visualFormation?VISUAL_FLEET_WGSL:''}
${solar?subDirectorWgsl(Boolean(capacity.occupancy)):''}
${eventField('groupOrder','vec4<u32>','orders[group].order','order',solar)}
${simulationSlots(capacity,solar)}
fn attitude(q: vec4<f32>, velocity: vec3<f32>, dt: f32, rate:f32) -> vec4<f32> {
  if (length(velocity)<0.000001) { return q; }
  let forward = rotate(q,vec3<f32>(0.0,0.0,1.0));
  let desired = unit(velocity);
  let angle = min(acos(clamp(dot(forward,desired),-1.0,1.0)),rate*dt);
  var axis = cross(forward,desired);
  if (length(axis)<0.00001) { axis=cross(forward,vec3<f32>(0.0,1.0,0.0)); }
  if (length(axis)<0.00001) { axis=vec3<f32>(1.0,0.0,0.0); }
  return normalize(qmul(vec4<f32>(unit(axis)*sin(angle*0.5),cos(angle*0.5)),q));
}
${ANGULAR_MOTION_WGSL}
${FORWARD_INTEGRATION_WGSL}
${FORWARD_MOTION_WGSL}
${BRAKING_WGSL}
${TRANSPORT_MOTION_WGSL}

fn pressureMix()->f32{return u.warp.x;}
fn pressureEnabled()->f32{return u.warp.y;}
fn fieldOrigin()->vec3<f32>{return director.reserved.xyz;}
fn contributes(s:Ship)->bool{return s.identity.z!=0u&&admitted(s)&&!inWarp(s,u.clock.x);}
fn journeyBodyRadius(s:Ship)->f32 {
  let j=journeyFor(s);
  if(j.range.z==0.0){return 45.0;}
  ${solar?"let radius=director.solar.orbits[min(u32(j.range.z)-1u,SOLAR_CAPACITY-1u)].shape.y;return select(45.0,radius,radius>0.0);":"let planet=body(u32(j.range.z)-1u,u.clock.x,u.control.x);return select(45.0,planet.w,planet.w>0.0);"}
}
// PoC class metres. Compact visual hull in lab is BASE*VISUAL_MUL (0.8*0.05);
// AGENT*LAB_SCALE=1 so that is one triangle after present-copy.
fn sceneEmitter(s:Ship,e:u32)->vec3<f32> {
  let a=sceneAdapt(journeyBodyRadius(s));
  let poc=dimensions(shipType(s)).xyz;
  let hull=vec3<f32>(0.04,0.016,0.04);
  let size=select(hull,poc,a>=0.99);
  let local=vec3<f32>((f32(e)-1.0)*0.5,select(-0.2,0.15,e==1u),-1.0)*size;
  return s.p.xyz+rotate(s.q,local);
}
fn hullSlot(slot:u32)->u32 {
  var n=slot;
  ${capacity.occupancy?`for(var g=0u;g<${capacity.groups}u;g++) {
    let live=groupOrder(g).x;if(live==0u){continue;}
    let typeId=shipType(old[groupSlot(g,liveOrdinal(g,0u))]);
    if(classIndex(typeId)<4u){continue;}
    if(n<live){return groupSlot(g,liveOrdinal(g,n));}n-=live;
  }`:`for(var g=0u;g<${capacity.fleetCount*2}u;g++) {
    let cohort=orders[(g/2u)*32u+30u+g%2u];
    if(n<cohort.roster.y){return groupSlot((g/2u)*32u+30u+g%2u,n);}n-=cohort.roster.y;
  }`}
  return u32(u.clock.z);
}
${densitySimulation(64,cellSize,pressureScopes,Boolean(solar&&capacity.occupancy))}
${scheduleWgsl(Boolean(solar&&capacity.occupancy))}
fn clearSpatial(index:u32){clearTactical(index);clearSchedule(index);${solar&&capacity.occupancy?"if(index==0u){clearPilotWork();}":""}${solar?"if(index==0u){atomicStore(&heads[scheduleCounter()+1u],0u);}":""}}
fn insertContact(i:u32,s:Ship,bucket:u32){links[i]=atomicAdd(&heads[bucket],1u);registerTarget(s);}
${solar&&capacity.occupancy?contactCacheWgsl('',{typed:false,capitalWork:true}):CONTACT_CACHE_WGSL}
${solar&&capacity.occupancy?`fn neighborSeparation(s:Ship,i:u32)->vec4<f32>{
  let advice=director.pilotAdvice[i];
  return select(vec4<f32>(0.0),advice.spacing,advice.state.x==s.identity.w&&pressureEnabled()!=0.0);
}`:CONTACT_QUERY_WGSL}
${solar&&capacity.occupancy?BOUNDED_PILOT_WGSL+PILOT_PREDICTION_WGSL:''}
fn validTarget(contact:u32,s:Ship,order:vec4<u32>)->bool {
  if(contact>=u32(u.clock.z)){return false;}
  let t=old[contact];let g=groupOf(t);
  return groupOrder(g).w==1u && admitted(t) && !inWarp(t,u.clock.x) && permittedFleet(s.identity.y,t.identity.y) && (order.z&(1u<<shipType(t)))!=0u;
}
fn selectTarget(s:Ship,i:u32,order:vec4<u32>,now:f32)->u32 {
  let number=eligibleCount(s);
  if(number==0u){return 0u;}
  var selected=0u;var best=1e20;
  for(var k=0u;k<16u;k++) {
    let random=hash(i*43u+k*997u+selectionTick(now));let g=eligibleGroup(s,random%number);
    let contact=groupSlot(g,liveOrdinal(g,hash(random)%groupOrder(g).x));
    let t=old[contact];let delta=t.p.xyz-s.p.xyz;
    let score=length(delta)+0.25*length(t.v.xyz-s.v.xyz)+variation(i+contact)*1.5+log2(1.0+pursuers(contact))*2.0;
    if(score<best){selected=contact+1u;best=score;}
  }
  return selected;
}
fn sphereObstacleForce(s:Ship,center:vec3<f32>,velocity:vec3<f32>,radius:f32,hull:f32,a:f32)->vec3<f32> {
  let d=s.p.xyz-center;let v=s.v.xyz-velocity;
  let limits=vec4<f32>(dynamics(shipType(s)).xyz*a,dynamics(shipType(s)).w);
  // PoC: horizon = v/accel. Compact planets are smaller than that look-ahead,
  // so also start turning a sphere-radius out (orbit pad stays outside reach).
  let closing=max(length(v),limits.x*0.25);
  let around=select(0.0,(radius+radius+${OBSTACLE_PADDING}*a)/max(closing,0.01),a<0.99);
  let horizon=clamp(max(length(v)/max(limits.y,0.1),around),1.2,6.0);
  let tau=clamp(-dot(d,v)/max(dot(v,v),0.01),0.0,horizon);
  let padded=radius+hull+${OBSTACLE_PADDING}*a;
  let clearance=length(d+v*tau)-padded;
  let reach=${OBSTACLE_SOFT_REACH}*a;
  if(clearance>reach){return vec3<f32>(0.0);}
  let escape=unit(vec3<f32>(variation(s.identity.w+101u)-.5,variation(s.identity.w+102u)-.5,variation(s.identity.w+103u)-.5));
  let normal=select(escape,unit(d),length(d)>.00001);
  let lateral=unit(cross(normal,vec3<f32>(0.1,1.0,0.2)));
  // Reach stays scene-scaled (inside the orbit pad). The shove uses class
  // accel so compact spheres still turn a ship instead of swallowing it.
  let dodge=dynamics(shipType(s)).y;
  let buried=max(0.0,padded-length(d));
  return normal*(max(0.0,reach-clearance)+buried*4.0)*dodge + lateral*dodge*.3;
}
fn obstacleForce(s:Ship,center:vec3<f32>,velocity:vec3<f32>,radius:f32)->vec3<f32> {
  let a=sceneAdapt(max(radius,0.02));
  return sphereObstacleForce(s,center,velocity,radius,dimensions(shipType(s)).w*a,a);
}
fn capitalObstacleForce(s:Ship,capital:Ship,bodyRadius:f32)->vec3<f32> {
  let a=sceneAdapt(bodyRadius);
  if(a>=.99){return obstacleForce(s,capital.p.xyz,capital.v.xyz,dimensions(shipType(capital)).w);}
  // Compact ships use authored sim-unit contact bubbles. The laboratory's
  // unscaled colossus radius is ~34 units: using it here excludes a whole
  // compact system and makes the fleet's sub-unit formation goals impossible.
  return sphereObstacleForce(s,capital.p.xyz,capital.v.xyz,
    repelRadius(shipType(capital),bodyRadius),repelRadius(shipType(s),bodyRadius),a);
}
fn avoidCapitals(s:Ship,i:u32)->vec3<f32> {
  if(u.warp.y==0.0){return vec3<f32>(0.0);}
  let bodyRadius=journeyBodyRadius(s);
  var force=vec3<f32>(0.0);
  ${capacity.occupancy?`for(var g=0u;g<${capacity.groups}u;g++) {
    let live=groupOrder(g).x;if(live==0u){continue;}
    let typeId=shipType(old[groupSlot(g,liveOrdinal(g,0u))]);
    if(classIndex(typeId)<4u){continue;}
    for(var n=0u;n<live;n++) {
      let index=groupSlot(g,liveOrdinal(g,n));if(index==i){continue;}
      let capital=old[index];
      force+=capitalObstacleForce(s,capital,bodyRadius);
    }
  }`:`for(var fleet=0u;fleet<${capacity.fleetCount}u;fleet++) {
    for(var typeId=30u;typeId<32u;typeId++) {
      let g=fleet*32u+typeId;
      for(var n=0u;n<groupOrder(g).x;n++) {
        let index=groupSlot(g,liveOrdinal(g,n));if(index==i){continue;}
        let capital=old[index];
        force+=capitalObstacleForce(s,capital,bodyRadius);
      }
    }
  }`}
  return force;
}
fn bodyAvoidance(s:Ship,now:f32)->vec4<f32> {
  if(u.warp.z<0.5||journeyLocalDt(s,now,u.clock.y)<=0.0){return vec4<f32>(0.0,0.0,0.0,1e20);}
  var acceleration=vec3<f32>(0.0);var clearance=1e20;
  // Four fleet-sticky spheres. CPU ranks; this is never ships × catalog.
  let slots=director.nearby[s.identity.y];
  for(var b=0u;b<4u;b++) {
    let index=slots[b];
    if(index==0xffffffffu){continue;}
    let sphere=body(index,now,u.control.x);
    if(sphere.w<=0.0){continue;}
    let a=sceneAdapt(max(sphere.w,0.02));
    let hull=sphere.w+sceneHull(shipType(s),sphere.w)+${OBSTACLE_PADDING}*a;
    let padded=select(hull,max(sphere.w*3.0,hull),a<.99);
    // Match the hard exclusion shell and planner. Passing an inflated 3R as
    // a raw body radius also tripled the ship adaptation and repelled hulls
    // far outside otherwise valid corridors.
    let force=sphereObstacleForce(s,sphere.xyz,bodyVelocity(index,now,u.control.x),padded-${OBSTACLE_PADDING}*a,0.0,a);
    acceleration+=force;
    if(dot(force,force)>0.0){clearance=min(clearance,max(.02,length(s.p.xyz-sphere.xyz)-padded));}
  }
  return vec4<f32>(acceleration,clearance);
}
fn avoidBodies(s:Ship,now:f32)->vec3<f32>{return bodyAvoidance(s,now).xyz;}
fn separateFromBodies(s:Ship,now:f32)->vec3<f32> {
  var p=s.p.xyz;
  let slots=director.nearby[s.identity.y];
  for(var b=0u;b<4u;b++) {
    let index=slots[b];
    if(index==0xffffffffu){continue;}
    let sphere=body(index,now,u.control.x);
    if(sphere.w<=0.0){continue;}
    let a=sceneAdapt(max(sphere.w,0.02));
    let hull=sphere.w+sceneHull(shipType(s),sphere.w)+${OBSTACLE_PADDING}*a;
    let padded=select(hull,max(sphere.w*3.0,hull),a<0.99);
    let d=p-sphere.xyz;let dist=length(d);
    if(dist<padded){p=sphere.xyz+select(vec3<f32>(0.0,1.0,0.0),unit(d),dist>.00001)*padded;}
  }
  return p;
}
${tacticalMemoryWgsl(Boolean(solar&&capacity.occupancy))}
${lifecycleWgsl(solar)}
${navigationWgsl(solar,Boolean(capacity.occupancy))}
${ENGAGEMENT_WGSL}
${EFFECTS_SIM}
fn tacticalVelocity(s:Ship,contact:Ship,order:vec4<u32>,now:f32)->vec3<f32> {
  let delta=contact.p.xyz-s.p.xyz;let horizon=clamp(length(delta)/max(s.v.w,0.1),0.0,1.5);
  let surface=dimensions(shipType(s)).w+dimensions(shipType(contact)).w+0.5;
  let lead=contact.p.xyz+contact.v.xyz*horizon-unit(delta)*surface;
  if(s.a.w==1.0 && now<s.aux.z) {
    let axis=unit(vec3<f32>(variation(s.identity.w+8u)-0.5,variation(s.identity.w+9u)-0.5,variation(s.identity.w+10u)-0.5));
    return unit(unit(s.v.xyz)+axis*0.8)*s.v.w;
  }
  if(order.y==1u){return contact.v.xyz+unit(lead-s.p.xyz)*clamp((length(delta)-surface)*1.1,-1.0,s.v.w);}
  return unit(lead-s.p.xyz)*s.v.w;
}
fn localStep(initial:Ship,i:u32,now:f32,dt:f32,controlDt:f32)->Ship {
  ${capacity.visualFormation?'return visualShipStep(initial,dt);':`var s=initial;let typeId=shipType(s);var limits=dynamics(typeId);let order=groupOrder(groupOf(s));
  let journey0=journeyFor(s);
  if(journey0.range.z>0.0){limits=sceneLimits(typeId,body(u32(journey0.range.z)-1u,now,u.control.x).w);}
  let attacking=order.w==1u && order.y<2u;
  ${solar&&capacity.occupancy?'if(!attacking&&fleetPilotActive(s)){return pilotPhysical(s,i,now,dt,controlDt,limits);}':''}
  // End the tagged local recovery lifetime before combat/legacy guidance owns it.
  ${solar&&capacity.occupancy?'if(s.tactic.x<0.0){s.tactic=vec4<f32>(0.0,0.0,now,s.tactic.w);s.aim=vec4<f32>(0.0);s.memory.w=0.0;s.a.w=0.0;s.aux.y=0.0;s.aux.z=0.0;s.fx.z=0.0;}':''}
  // Route progress and tactical memory share storage, but never meaning.
  if(attacking && s.memory.z<0.0){s.memory=vec4<f32>(0.0,0.0,0.0,s.memory.w);}
  var contact=u32(s.aux.x);
  if(!attacking){contact=0u;s.a.w=0.0;}
  if(attacking && (contact==0u || !validTarget(contact-1u,s,order))) { contact=selectTarget(s,i,order,now);s.a.w=0.0; }
  s.aux.x=f32(contact);
  if(attacking){s=refreshMemory(s,i,order,now);contact=u32(s.aux.x);}else{s.memory.x=0.0;}
  if(s.memory.w==0.0){s.memory.w=select(-1.0,1.0,(s.identity.w&1u)==0u);}
  var desiredV=vec3<f32>(0.0);var guidanceReach=0.0;
  if(order.w==1u && order.y==3u) { desiredV=vec3<f32>(select(-1.0,1.0,(s.identity.y%2u)==1u),0.0,0.0)*s.v.w; }
  if(attacking && contact>0u) {
    let enemy=old[contact-1u];
    if(now>=s.aux.y) {
      s.a.w=0.0;
      let delta=enemy.p.xyz-s.p.xyz;let relV=enemy.v.xyz-s.v.xyz;
      let tau=clamp(-dot(delta,relV)/max(dot(relV,relV),0.01),0.0,0.7);
      let clearance=dimensions(typeId).w+dimensions(shipType(enemy)).w;
      if(length(delta)<clearance+0.7 || (dot(delta,relV)<0.0 && length(delta+relV*tau)<clearance+0.3)){s.a.w=1.0;s.aux.z=now+0.6+variation(s.identity.w)*0.7;}
      s.aux.y=now+0.0333+variation(s.identity.w)*0.008;
    }
    // Maintain the maneuver for its local animation interval, without changing the order.
    if(now<s.aux.z){s.a.w=1.0;}
    desiredV=evadePursuer(s,enemy,closeEngagement(s,enemy,tacticalVelocity(s,enemy,order,now)),now);
  }
  if(attacking&&contact>0u){let guidance=branchGuidance(s,desiredV,now);s=guidance.ship;desiredV=guidance.velocity;}
  let journey=journeyFor(s);
  if(s.flight.w==1.0){desiredV=journeyVelocity(s,now);}
  let navigating=s.flight.w<0.0||(s.flight.w==1.0&&journey.range.z>0.0);
  if(navigating){let navigation=navigationStep(s,journey,now);s=navigation.ship;desiredV=navigation.velocity;guidanceReach=navigation.reach;}
  if(!navigating){desiredV=capped(desiredV,limits.x);}
  // Broad director-owned return preference, not a prescribed ring or hard wall.
  let offset=s.p.xyz-encounterFrame(s);let distance=length(offset);let outward=unit(offset);
  let returnWeight=smoothstep(40.0+dimensions(typeId).w*2.0,140.0+dimensions(typeId).w*2.0,distance);
  if(attacking){desiredV-=outward*(max(0.0,dot(desiredV,outward))+limits.x*0.35)*returnWeight;}
  ${solar?'if(!attacking){desiredV=subDirect(s,desiredV,limits,now);}':''}
  let avoid=avoidBodies(s,now);
  var desiredA=(desiredV-s.v.xyz)*2.0+pressure(s)+avoidCapitals(s,i);
  if(attacking&&contact>0u){let other=old[contact-1u];desiredA+=obstacleForce(s,other.p.xyz,other.v.xyz,dimensions(shipType(other)).w);}
  let spacing=neighborSeparation(s,i);
  // Contact escape gets steering priority; pursuit cannot pin coincident peers together.
  desiredA=mix(desiredA+spacing.xyz,spacing.xyz,spacing.w*.95);
  // A formation target may lie beyond a planet. Once body avoidance consumes
  // the available acceleration, following that target cannot cancel the escape
  // or keep thrusting into the shell. The planet guard remains the last resort.
  let bodyPriority=clamp(length(avoid)/max(limits.y,.0001),0.0,1.0);
  desiredA=mix(desiredA+avoid,avoid,bodyPriority);
  // Forces express steering intent. Locomotion owns the achievable turn and
  // thrust together, so avoidance cannot translate the hull sideways.
  s=localFlightMotion(s,desiredV,desiredA,guidanceReach,${solar&&!capacity.occupancy?'fleetAligning(s)':'false'},spacing,avoid,${solar&&!capacity.occupancy?'fleetTravelLimits(s,limits)':'limits'},dynamics(typeId).w,dt,controlDt);
  s=correctShipPosition(s,separateFromBodies(s,now));
  return combatPresentation(s,now,dt);`}
}

// Diagnostic entry point uses the actual runtime uniforms and model layout.
// It is dispatched only by the GPU contract fixture, into an isolated output.
@compute @workgroup_size(1) fn inspectBodies(@builtin(global_invocation_id) gid:vec3<u32>) {
  var s:Ship;s.p=body(gid.x,u.clock.x,u.control.x);
  s.v=vec4<f32>(bodyVelocity(gid.x,u.clock.x,u.control.x),0.0);next[gid.x]=s;
}

${solar?NAVIGATION_INSPECTION_WGSL:''}
${integrationWgsl(solar)}
${solar?eventMotionWgsl(capacity.visualFormation)+CORRECTION_WRITE+(capacity.visualFormation?VISUAL_EVENT_INTEGRATION_WGSL:ARRIVAL_CORRECTION_WGSL)+RECOVERY_WGSL:''}
${recoveryEntry(solar)}
${solar&&splitAdvance?splitAdvanceWgsl(capacity.visualFormation):''}
${solar&&capacity.occupancy?`@compute @workgroup_size(128) fn advanceTransit(@builtin(global_invocation_id) gid:vec3<u32>){
  let fleet=u32(u.pilotView.w);let form=director.forms[fleet];
  if(gid.x>=form.head.w){return;}
  let i=form.head.z+gid.x;if(i>=u32(u.clock.z)){return;}
  let s=old[i];if(s.identity.z==0u||s.identity.y!=fleet){next[i]=s;return;}
  next[i]=applyJourney(s,u.clock.x,u.clock.y);
}`:''}
@compute @workgroup_size(128) fn advance(@builtin(global_invocation_id) gid: vec3<u32>) {
  if(gid.x>=u32(u.clock.z)) { return; }
  let i=${capacity.visualFormation?'gid.x':'links[u32(u.clock.z)+gid.x]'};
  ${solar?`let stepped=${splitAdvance?'advancePreparedShip(i)':'advanceEventShip(old[i],i)'};next[i]=stepped;${capacity.visualFormation?'':'recordFormationPose(stepped);'}`:'next[i]=integrateShip(old[i],i,u.clock.x,u.clock.y,true,trailFirst(u.clock.x,u.clock.y),trailLast(u.clock.x));'}
}
`;

const drawingSource = (cellSize=4,capacity=fleetCapacity(2),pressureScopes=null,solar=false)=>common(solar) + /* wgsl */`
struct View { eye: vec4<f32>, aim: vec4<f32>, clock: vec4<f32>, config: vec4<f32>, interpolation: vec4<f32> ${solar?',phase:vec4<f32>':''} }
@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage,read> ships: array<Ship>;
@group(0) @binding(2) var<storage,read> history: array<vec4<f32>>;
@group(0) @binding(3) var<storage,read> previous: array<Ship>;

${controlWgsl(capacity,pressureScopes,solar)}
${solar?eventPoseRead+CORRECTION_READ:''}
struct Vertex { @builtin(position) clip: vec4<f32>, @location(0) color: vec4<f32>, @location(1) recovery:f32 }
${displayWgsl(solar)}
${recoveryFade(solar)}
fn project(p: vec3<f32>) -> vec4<f32> {
  let chosen=displayShip(min(u32(view.config.w),u32(view.clock.y)-1u));let selected=chosen.p.xyz;
  let cameraRange=max(4.5,dimensions(shipType(chosen)).w*3.0);
  let rig=vec3<f32>(cameraRange*${solar?'view.phase.x':'cos(view.clock.x*0.10)'},cameraRange*.6,cameraRange*${solar?'view.phase.y':'sin(view.clock.x*0.10)'});
  let eye=mix(view.eye.xyz,selected+rig,view.aim.w);
  let aim=mix(view.aim.xyz,selected,view.aim.w);
  let f=unit(aim-eye); let right=unit(cross(f,vec3<f32>(0.0,1.0,0.0))); let up=cross(right,f);
  let d=p-eye; let z=dot(d,f);
  return vec4<f32>(dot(d,right)*1.7/view.eye.w,dot(d,up)*1.7,z*4000.0/3999.95-200.0/3999.95,z);
}
fn color(s: Ship) -> vec3<f32> {let colors=array<vec3<f32>,8>(vec3<f32>(.1,.75,1),vec3<f32>(1,.38,.12),vec3<f32>(.5,1,.45),vec3<f32>(.85,.4,1),vec3<f32>(1,.85,.1),vec3<f32>(.2,1,.85),vec3<f32>(1,.35,.6),vec3<f32>(.65,.7,1));return colors[s.identity.y%8u];}
@vertex fn hull(@builtin(vertex_index) v:u32,@builtin(instance_index) i:u32)->Vertex {
  let s=displayShip(i);var out:Vertex;
  if(s.identity.z==0u){out.clip=vec4<f32>(2,2,2,1);out.color=vec4<f32>(0);return out;}
  let corners=array<vec3<f32>,8>(vec3<f32>(-1,-1,-1),vec3<f32>(1,-1,-1),vec3<f32>(1,1,-1),vec3<f32>(-1,1,-1),vec3<f32>(-1,-1,1),vec3<f32>(1,-1,1),vec3<f32>(1,1,1),vec3<f32>(-1,1,1));
  let indices=array<u32,36>(0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5);
  let typeId=shipType(s);let kind=classIndex(typeId);let extent=dimensions(typeId).xyz;
  var local=corners[indices[v]];
  let nose=select(0.05,0.78,kind>=3u);
  if(local.z>0.0){local.x*=nose;local.y*=select(0.15,0.65,kind>=3u);}
  local*=extent;
  if(s.flight.w>=2.0){let beat=min(2.0,(s.flight.z-s.flight.y)*.25);let stretch=smoothstep(0.0,beat,view.clock.x-s.flight.y)*smoothstep(0.0,beat,s.flight.z-view.clock.x);local.z=-extent.z+(local.z+extent.z)*(1.0+6.0*stretch*(1.0-view.aim.w));}
  out.clip=project(s.p.xyz+rotate(s.q,local));
  let face=f32(v/6u);let shade=0.35+0.09*face;
  let paint=mix(color(s),vec3<f32>(.48,.55,.62),select(0.0,.55,kind>=3u));
  out.recovery=recoveryFade(s,view.clock.x);
  out.color=vec4<f32>(paint*shade,1.0);return out;
}
@vertex fn targetLink(@builtin(vertex_index) vertex:u32,@builtin(instance_index) line:u32)->Vertex {
  var out:Vertex;out.clip=vec4<f32>(2,2,2,1);out.color=vec4<f32>(0);
  // Physical ranges need not be contiguous by fleet after packing or retirement.
  let i=(line*u32(view.clock.y))/32u;
  let s=displayShip(i);let handle=u32(s.aux.x);
  if(view.interpolation.y<0.5||handle==0u||s.identity.z==0u||s.identity.y!=u32(view.interpolation.z)){return out;}
  let contact=displayShip(handle-1u);if(contact.identity.z==0u){return out;}
  out.clip=project(select(s.p.xyz,contact.p.xyz,vertex==1u));out.color=vec4<f32>(color(s)*.35,.35);return out;
}
${trailWgsl(solar)}
fn fieldViewOrigin()->vec3<f32>{return director.reserved.xyz;}
${densityDrawing(64,cellSize,pressureScopes)}
${EFFECTS_DRAW}
@vertex fn planet(@builtin(vertex_index) v: u32,@builtin(instance_index) i: u32) -> Vertex {
  if(view.config.y<0.5){var hidden:Vertex;hidden.clip=vec4<f32>(2.0,2.0,2.0,1.0);hidden.color=vec4<f32>(0.0);return hidden;}
  let corner=array<vec2<u32>,6>(vec2<u32>(0,0),vec2<u32>(1,0),vec2<u32>(0,1),vec2<u32>(1,0),vec2<u32>(1,1),vec2<u32>(0,1));
  let cell=v/6u; let uv=(vec2<f32>(f32(cell%64u),f32(cell/64u))+vec2<f32>(corner[v%6u]))/vec2<f32>(64.0,32.0);
  let n=vec3<f32>(sin(uv.y*PI)*cos(uv.x*2.0*PI),cos(uv.y*PI),sin(uv.y*PI)*sin(uv.x*2.0*PI));
  let b=body(i,view.clock.x,view.config.x);
  let colors=array<vec3<f32>,3>(vec3<f32>(1.0,0.65,0.15),vec3<f32>(0.12,0.4,0.5),vec3<f32>(0.4,0.24,0.36));
  let light=select(0.22+0.78*max(0.0,dot(n,unit(body(0u,view.clock.x,view.config.x).xyz-b.xyz))),1.0,i==0u);
  var out:Vertex; out.clip=project(b.xyz+n*b.w);out.color=vec4<f32>(colors[i]*light,1.0);return out;
}
@fragment fn fragment(input: Vertex) -> @location(0) vec4<f32> {
  if(input.recovery>0.0) {
    let pixel=vec2<u32>(input.clip.xy);let noise=f32((pixel.x*3u+pixel.y*5u)%16u)/16.0;
    if(noise<input.recovery){discard;}
  }
  return input.color;
}
`;

export const simulation=(cellSize=4,capacity=fleetCapacity(2),pressureScopes=null,solar=false,splitAdvance=false)=>spatialShaderSource(simulationSource(cellSize,capacity,pressureScopes,solar,splitAdvance),Boolean(solar&&capacity.occupancy));
export const drawing=(cellSize=4,capacity=fleetCapacity(2),pressureScopes=null,solar=false)=>spatialShaderSource(drawingSource(cellSize,capacity,pressureScopes,solar),Boolean(solar&&capacity.occupancy));
export const SIM=simulation();
export const DRAW=drawing();

function displayWgsl(solar){return /* wgsl */`
fn displayShip(i: u32) -> Ship {
  if(i>=u32(view.clock.y)){var empty:Ship;return empty;}
  var s=ships[i]; let p=previous[i]; let fraction=view.interpolation.x;
  ${solar?'if(director.events.clock.x>0.0&&director.events.directory[groupOf(p)].x>0u){return eventDisplay(i,p,s);}':''}
  ${solar?'':'if(s.flight.x!=p.flight.x&&s.origin.w<0.0){return s;}'}
  ${solar?'let end=view.config.z;return correctionDisplay(i,p,s,end-view.phase.w,end,view.clock.x,false);':''}
${solar?'':`  s=mixShipPosition(p,s,fraction);
  let sign=select(-1.0,1.0,dot(p.q,s.q)>=0.0);
  s.q=normalize(mix(p.q,s.q*sign,fraction));
  return s;`}
}
${solar?`@group(0) @binding(6) var<storage,read_write> displayProbe:array<Ship>;
@compute @workgroup_size(64) fn inspectHistory(@builtin(global_invocation_id) gid:vec3<u32>) {
  if(gid.x<48u){displayProbe[gid.x].p=displayHistory(u32(view.config.w),gid.x);}
}
@compute @workgroup_size(128) fn inspectDisplay(@builtin(global_invocation_id) gid:vec3<u32>) {
  if(gid.x<u32(view.clock.y)){displayProbe[gid.x]=displayShip(gid.x);}
}`:''}
`;}

function recoveryFade(solar){return `fn recoveryFade(s:Ship,now:f32)->f32 {${solar?"if(s.tactic.w>0.0){return 1.0-smoothstep(0.0,.35,now+1.0-s.tactic.w);}":""}return 0.0;}`;}

function recoveryEntry(solar){return solar?`@compute @workgroup_size(128) fn recover(@builtin(global_invocation_id) gid:vec3<u32>) {
  if(gid.x<u32(u.clock.z)){next[gid.x]=recoverShip(old[gid.x],gid.x,u.clock.x);}
}`:"";}

// Use static call graphs: a held/event/recovery interval must not pull the
// steering tree into its pipeline or duplicate it at each boundary when inlined.
function integrationWgsl(solar){
  return solar ? motionIntegrationWgsl(true, false) + motionIntegrationWgsl(true, true) : motionIntegrationWgsl(false, true);
}
function motionIntegrationWgsl(solar, controlled){return /* wgsl */`
fn ${solar?(controlled?'integrateMotion':'integrateHeldMotion'):'integrateShip'}(original:Ship,i:u32,now:f32,dt:f32,${solar?'':'controlled:bool,'}first:u32,last:u32)->Ship {
  var s=original;
  let group=groupOf(s);
  if(!admitted(s)) { if(s.identity.z==1u){s.fx.x=now;}s.identity.z=0u;s.aux.x=0.0;s.aux.w=0.0;return s; }
  s.identity.z=1u;s=applyJourney(s,now,dt);
  let localDt=journeyLocalDt(s,now,dt);
  if(localDt>0.0${solar&&controlled?'||(u.clock.y>0.0&&!inWarp(s,now))':''}) { ${solar?(controlled?'s=localStep(s,i,now,localDt,u.clock.y);':'s=heldMotion(s,localDt);'):'s=localStep(s,i,now,localDt,localDt);'} }
  let emitting=u.control.z>0.5;
  let base=i*3u*RING;
  let corrected=s.flight.x!=original.flight.x&&s.origin.w<0.0;
  ${solar?"if(corrected){s.tactic.w=now+1.0;recordCorrection(original,s,i,now);}":""}
  if(emitting && (original.aux.w<0.5||corrected)) {
    for(var j=0u;j<3u*RING;j++) { history[base+j]=vec4<f32>(0.0,0.0,0.0,-1.0); }
    for(var e=0u;e<3u;e++) { history[base+e*RING+last%RING]=vec4<f32>(sceneEmitter(s,e),now); }
  } else if(emitting && dt>0.0) {
    let begin=max(first,select(0u,last-(RING-1u),last>=RING));
    for(var k=begin;k<=last;k++) {
      let birth=f32(k)/${solar?30:60}.0;
      let f=clamp((birth-(now-dt))/dt,0.0,1.0);
      for(var e=0u;e<3u;e++) {
        history[base+e*RING+k%RING]=vec4<f32>(mix(sceneEmitter(original,e),sceneEmitter(s,e),f),birth);
      }
    }
  }
  s.aux.w=select(0.0,1.0,emitting);
  return s;
}
`;}

function trailWgsl(solar){return /* wgsl */`
@vertex fn trail(@builtin(vertex_index) vertex: u32,@builtin(instance_index) instance: u32) -> Vertex {
  let i=instance/3u; let e=instance%3u; let s=displayShip(i);
  let segment=vertex/2u; let end=vertex%2u;
  let tick=${solar?'u32(view.phase.z)':'u32(floor(view.clock.x*60.0))'};
  let age=segment+end;
  let safeTick=max(tick,age);
  let sample=${solar?'displayHistory(i,e*RING+(safeTick-age)%RING)':'history[(i*3u+e)*RING+(safeTick-age)%RING]'};
  var p=sample.xyz; var born=sample.w;
  if(age==0u && view.clock.w>0.5 && s.identity.z>0u) { p=emitter(s,e); born=view.clock.x; }
  var alpha=max(0.0,1.0-(view.clock.x-born)/0.27)*0.7*min(1.0,.15+s.fx.w);
  if(born<0.0 || tick<age) { alpha=0.0; }
  // Validity applies to the WHOLE segment, including a missing newer endpoint.
  let newer=${solar?'displayHistory(i,e*RING+(max(tick,segment)-segment)%RING)':'history[(i*3u+e)*RING+(max(tick,segment)-segment)%RING]'};
  let older=${solar?'displayHistory(i,e*RING+(max(tick,segment+1u)-segment-1u)%RING)':'history[(i*3u+e)*RING+(max(tick,segment+1u)-segment-1u)%RING]'};
  let newerBirth=select(newer.w,view.clock.x,segment==0u && view.clock.w>0.5 && s.identity.z>0u);
  if(older.w<0.0 || newerBirth<0.0 || tick<segment+1u || newerBirth<older.w || newerBirth-older.w>0.034) { alpha=0.0; }
  var out: Vertex; out.clip=project(p); out.color=vec4<f32>(color(s)*alpha,alpha); return out;
}
`;}
