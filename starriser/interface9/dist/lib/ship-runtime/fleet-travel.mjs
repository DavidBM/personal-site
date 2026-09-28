/** One workgroup per fleet; all admitted members contribute without CPU readback.
 * Previous-tick arc progress tolerates outliers; persistent pacing survives bends.
 * The director tail stores 64 bytes per fleet; no new binding/dispatch/readback.
 */
export const FLEET_TRAVEL_WGSL = /* wgsl */ `
var<workgroup> travelSum:array<vec4<f32>,64>;
var<workgroup> travelKnown:array<vec4<f32>,64>;
var<workgroup> travelMin:array<f32,64>;
var<workgroup> travelMax:array<f32,64>;
var<workgroup> travelReady:array<vec4<u32>,64>;
var<workgroup> travelReference:array<u32,64>;
var<workgroup> travelBins:array<atomic<u32>,32>;
var<workgroup> travelProgressCount:atomic<u32>;
var<workgroup> travelSpan:u32;
var<workgroup> travelCenter:vec3<f32>;
var<workgroup> travelAxis:vec3<f32>;
var<workgroup> travelBounds:vec2<f32>;
var<workgroup> travelHeading:vec3<f32>;
fn travelMember(fleet:u32,ordinal:u32)->Ship {
  let form=director.forms[fleet];
  let index=form.head.z+ordinal;
  var s:Ship;
  if(index>=u32(u.clock.z)){return s;}
  s=old[index];
  if(s.identity.z==0u||s.identity.y!=fleet||sceneOrdinal(s.identity.x)!=ordinal){s.identity.z=0u;return s;}
  // Read the authoritative preceding tick. Advancing journey/body state here
  // duplicates navigation work twice per member; a new order may wait one tick.
  if(s.flight.w!=-3.0){s.identity.z=0u;}
  return s;
}
fn travelNeutral(s:Ship,form:FleetForm,width:f32)->vec3<f32>{
  return s.p.xyz-sceneRouteOffset(s,form,width);
}
fn travelQuorum(value:u32,total:u32)->f32 {
  return smoothstep(.5,.9,f32(value)/max(1.0,f32(total)));
}
@compute @workgroup_size(64)
fn clearFormation(@builtin(workgroup_id) wid:vec3<u32>,@builtin(local_invocation_index) lane:u32){
  let fleet=wid.x;
  if(fleet>=FORM_FLEETS){return;}
  let page=u32(u.trail.z)&1u;
  if(lane<FORM_ANCHORS){let at=formPoseIndex(page,fleet,lane);var pose=director.formPoses[at];pose.w=0u;director.formPoses[at]=pose;}
  let form=director.forms[fleet];let head=director.sceneRoutes[fleet].head;let info=director.sceneRoutes[fleet].info;
  if(lane==0u){
    let available=u32(u.clock.z)-min(form.head.z,u32(u.clock.z));
    travelSpan=select(0u,min(form.head.w,available),head.x>=2.0);
    if(travelSpan==0u){director.fleetTravel[fleet]=FleetTravel(vec4<f32>(0.0),vec4<f32>(0.0),vec4<f32>(0.0),vec4<f32>(0.0));}
  }
  let span=workgroupUniformLoad(&travelSpan);
  if(span==0u){return;}
  let token=u32(head.w);
  var sum=vec4<f32>(0.0);var known=vec4<f32>(0.0);var lo=1e30;var hi=-1e30;var reference=0xffffffffu;
  for(var ordinal=lane;ordinal<span;ordinal+=64u){
    let s=travelMember(fleet,ordinal);if(s.identity.z==0u){continue;}
    // Scene capacity is at most 50K: 16 ordinal bits retain the first live
    // member of the heaviest class, without relying on the eight anchor slots.
    reference=min(reference,(5u-classIndex(shipType(s)))*65536u+ordinal);
    sum+=vec4<f32>(s.p.xyz,1.0);
    let captured=director.warpOffsets[sceneTravelIndex(s)];
    if(token==0u||u32(captured.w)==token){
      let p=travelNeutral(s,form,head.y);known+=vec4<f32>(p,1.0);
    }
    if(s.memory.z==-1.0 && s.memory.y==info.w){lo=min(lo,s.memory.x);hi=max(hi,s.memory.x);}
  }
  travelSum[lane]=sum;travelKnown[lane]=known;travelMin[lane]=lo;travelMax[lane]=hi;travelReference[lane]=reference;
  if(lane==0u){atomicStore(&travelProgressCount,0u);}if(lane<32u){atomicStore(&travelBins[lane],0u);}workgroupBarrier();
  for(var stride=32u;stride>0u;stride/=2u){
    if(lane<stride){travelSum[lane]+=travelSum[lane+stride];travelKnown[lane]+=travelKnown[lane+stride];travelMin[lane]=min(travelMin[lane],travelMin[lane+stride]);travelMax[lane]=max(travelMax[lane],travelMax[lane+stride]);travelReference[lane]=min(travelReference[lane],travelReference[lane+stride]);}workgroupBarrier();
  }
  if(lane==0u){
    travelCenter=travelSum[0].xyz/max(1.0,travelSum[0].w);
    if(travelKnown[0].w>0.0){travelCenter=travelKnown[0].xyz/travelKnown[0].w;}
    travelAxis=unit(director.sceneRoutes[fleet].points[u32(head.x)-1u].xyz-travelCenter);
    travelBounds=vec2<f32>(travelMin[0],travelMax[0]);
    if(travelBounds.x>travelBounds.y){travelBounds=vec2<f32>(0.0);}
    travelHeading=vec3<f32>(0.0);
    if(travelReference[0]!=0xffffffffu){
      var guide=travelMember(fleet,travelReference[0]&65535u);
      guide.p=vec4<f32>(travelCenter+sceneRouteOffset(guide,form,head.y),guide.p.w);
      travelHeading=unit(sceneRouteVelocity(guide,sceneLimits(shipType(guide),journeyBodyRadius(guide))));
    }
  }workgroupBarrier();
  var ready=vec4<u32>(0u);
  for(var ordinal=lane;ordinal<span;ordinal+=64u){
    let s=travelMember(fleet,ordinal);if(s.identity.z==0u){continue;}
    let captureAt=sceneTravelIndex(s);
    if(token!=0u&&u32(director.warpOffsets[captureAt].w)!=token){
      director.warpOffsets[captureAt]=vec4<f32>(s.p.xyz-travelCenter,head.w);
    }
    if(s.memory.z==-1.0 && s.memory.y==info.w){
      let bin=u32(clamp((s.memory.x-travelBounds.x)/max(.00001,travelBounds.y-travelBounds.x)*32.0,0.0,31.0));
      atomicAdd(&travelBins[bin],1u);atomicAdd(&travelProgressCount,1u);
    }
    // Readiness asks whether every hull faces the shared center-route intent.
    // Individual navigation still computes its own translated path and braking.
    let aligned=dot(travelHeading,travelHeading)<.00000001||dot(rotate(s.q,vec3<f32>(0.0,0.0,1.0)),travelHeading)>.9659258;
    let heavy=classIndex(shipType(s))==form.head.x;
    ready+=vec4<u32>(select(0u,1u,aligned),1u,select(0u,1u,aligned&&heavy),select(0u,1u,heavy));
  }
  travelReady[lane]=ready;workgroupBarrier();
  for(var stride=32u;stride>0u;stride/=2u){if(lane<stride){travelReady[lane]+=travelReady[lane+stride];}workgroupBarrier();}
  // The shared heading consumed the preceding tick's storage-backed speed record.
  // Finish those reads before publishing this tick's replacement.
  storageBarrier();
  if(lane==0u){
    let total=atomicLoad(&travelProgressCount);var prefix=0u;var low=0.0;var high=0.0;
    for(var bin=0u;bin<32u;bin++){
      let previous=prefix;prefix+=atomicLoad(&travelBins[bin]);
      let progress=mix(travelBounds.x,travelBounds.y,(f32(bin)+.5)/32.0);
      if(previous<=total/10u&&prefix>total/10u){low=progress;}
      if(previous<=total*9u/10u&&prefix>total*9u/10u){high=progress;}
    }
    let counts=travelReady[0];let quorum=min(travelQuorum(counts.x,counts.y),select(travelQuorum(counts.x,counts.y),travelQuorum(counts.z,counts.w),counts.w>0u));
    let spread=max(0.0,high-low);let tolerance=max(.75,form.origin.w*.5);
    let cohesion=1.0-smoothstep(tolerance,tolerance*3.0,spread);
    let previous=director.fleetTravel[fleet];
    let sameOrder=previous.center.w>0.0 && previous.state.x==head.w;
    let dt=clamp(u.clock.y,0.0,.1);
    var departure=select(0.0,previous.state.y,sameOrder);
    // Latch departure after half a second of readiness. Cruise bends never
    // re-arm this gate, even if the heaviest hulls are temporarily misaligned.
    if(departure<.5){departure=clamp(departure+select(-dt,dt,quorum>.8),0.0,.5);}
    let readiness=select(max(.035,quorum),1.0,departure>=.5);
    let requestedPace=head.z*.65*readiness*mix(.5,1.0,cohesion);
    let before=select(0.0,previous.direction.w,previous.center.w>0.0);
    let acceleration=info.z*.35;
    let desired=clamp((requestedPace-before)/2.0,-acceleration,acceleration);
    let oldAcceleration=select(0.0,previous.state.z,previous.center.w>0.0);
    let thrust=oldAcceleration+clamp(desired-oldAcceleration,-acceleration*dt,acceleration*dt);
    let pace=max(0.0,before+thrust*dt);
    let revision=select(0.0,info.w,total>0u);
    director.fleetTravel[fleet]=FleetTravel(vec4<f32>(travelCenter,travelSum[0].w),vec4<f32>(travelAxis,pace),vec4<f32>(low,high,head.z,quorum),vec4<f32>(head.w,departure,thrust,revision));
  }
}
`;
