/** Production-only bounded perception. All periods are physical simulation ticks.
 * Advice and contact handles are disposable; only advance writes physical poses.
 * Search batches cover every neighbour, including corners, without full masks.
 */
export const PILOT_WORK_BUDGET=16384;
export const BOUNDED_PILOT_WGSL=/* wgsl */`
fn pilotTick()->u32{return bitcast<u32>(u.trail.w);}
fn clearPilotWork(){
  atomicStore(&director.pilotDispatch[0],0u);atomicStore(&director.pilotDispatch[1],1u);
  atomicStore(&director.pilotDispatch[2],1u);atomicStore(&director.pilotDispatch[3],0u);
  atomicStore(&director.pilotDispatch[4],0u);atomicStore(&director.pilotDispatch[5],1u);
  atomicStore(&director.pilotDispatch[6],1u);atomicStore(&director.pilotDispatch[7],0u);
}
@compute @workgroup_size(128) fn schedulePilots(@builtin(global_invocation_id) gid:vec3<u32>){
  let count=u32(u.clock.z);let follow=u32(max(0.0,u.pilotView.z));
  let reserve=u.pilotView.z>=0.0&&follow<count&&count>${PILOT_WORK_BUDGET}u;
  let budget=min(count,${PILOT_WORK_BUDGET}u-u32(reserve));
  // Reserve an additional lane; never repeatedly replace the same window member.
  // The full dispatch still stays inside PILOT_WORK_BUDGET, including follow.
  let start=(pilotTick()%max(count,1u))*budget%max(count,1u);var i=(gid.x+start)%max(count,1u);
  if(gid.x>=budget){
    if(!reserve||gid.x!=budget||(follow+count-start)%count<budget){return;}
    i=follow;
  }
  let s=applyJourney(old[i],u.clock.x,u.clock.y);
  if(!admitted(s)||s.identity.z==0u||inWarp(s,u.clock.x)||!pilotDue(s,i)){return;}
  let work=atomicAdd(&director.pilotDispatch[3],1u);
  if(work>=${PILOT_WORK_BUDGET}u){return;}
  director.pilotWork[work]=i;
  atomicMax(&director.pilotDispatch[0],(work+128u)/128u);
}
fn pilotContact(slot:u32)->Contact {
  let s=old[slot];
  return Contact(s.p.xyz,repelRadius(shipType(s),journeyBodyRadius(s)),s.v.xyz,s.identity.y,
    contactCell(s.p.xyz),classIndex(shipType(s)),s.identity.w,s.aux.x,slot,0u);
}
struct PilotContacts {items:array<Contact,4>,responses:array<vec4<f32>,4>,count:u32}
fn keepPilotContact(s:Ship,i:u32,t:Contact,result:ptr<function,PilotContacts>,limit:u32,context:ContactContext){
  if(t.slot==i){return;}
  for(var k=0u;k<(*result).count;k++){if((*result).items[k].serial==t.serial){return;}}
  let gap=t.p-s.p.xyz;
  let reach=CONTACT_CELL_SIZE+context.radius+t.radius;
  if(dot(gap,gap)>reach*reach){return;}
  let response=contactPushWith(s,t,context);
  if(response.w<=.01&&dot(response.xyz,response.xyz)<.00000001){return;}
  var at=(*result).count;
  if(at>=limit){
    at=0u;for(var k=1u;k<limit;k++){if((*result).responses[k].w<(*result).responses[at].w){at=k;}}
    // Retained peers win small ties; discovery cannot churn a useful maneuver.
    if(response.w<=(*result).responses[at].w+.05){return;}
  }
  (*result).items[at]=t;(*result).responses[at]=response;(*result).count=min(limit,(*result).count+1u);
}
fn pilotNeighborCell(batch:u32,entry:u32,cycle:u32)->u32 {
  let ordinal=(entry+cycle)%9u;let n=batch+ordinal*3u;
  return select(n+u32(n>=13u),27u,n>=26u);
}
fn collectPilotContacts(s:Ship,i:u32,advice:ptr<function,PilotAdvice>,period:u32,context:ContactContext)->PilotContacts{
  var result:PilotContacts;let limit=select(4u,2u,period==8u);
  for(var k=0u;k<limit;k++){
    let handle=(*advice).contacts[k];if(handle==0u||handle>u32(u.clock.z)){continue;}
    let slot=handle-1u;let peer=old[slot];
    if(peer.identity.w!=(*advice).serials[k]||!contributes(peer)){continue;}
    keepPilotContact(s,i,pilotContact(slot),&result,limit,context);
  }
  let discovery=select(select(4u,16u,period==8u),1u,period==1u);
  let fresh=(*advice).state.x!=s.identity.w;
  if(fresh||pilotTick()-(*advice).schedule.x>=discovery){
    let center=contactCell(s.p.xyz);let batch=select((*advice).schedule.y,s.identity.w%3u,fresh);
    let budget=select(select(16u,8u,period==8u),32u,period==1u)-limit;
    // Reserve half for neighbour exploration, even when the own cell is dense.
    // Rotate the allocation remainder too: tiny budgets must eventually visit
    // every cell, not permanently skip the same early entries in each batch.
    var own=budget/2u;var remaining=budget-own;
    for(var entry=0u;entry<10u;entry++){
      var cell=13u;var allowance=own;
      if(entry>0u){
        cell=pilotNeighborCell(batch,entry-1u,(*advice).schedule.z/3u);
        if(cell>=27u){continue;}
        allowance=remaining/(10u-entry);remaining-=allowance;
      }
      let location=center+vec3<i32>(i32(cell%3u)-1,i32(cell/3u%3u)-1,i32(cell/9u)-1);
      let range=contactRange(contactBucket(location));let begin=links[range];if(begin==0u){continue;}
      let size=links[range+1u]-(begin-1u);let visits=min(size,allowance);
      let start=hash(s.identity.w+(*advice).schedule.z*97u+cell*43u)%max(size,1u);
      for(var j=0u;j<visits;j++){
        let t=loadContact(begin-1u+(start+j)%size);if(any(t.cell!=location)){continue;}
        keepPilotContact(s,i,t,&result,limit,context);
      }
    }
    (*advice).schedule=vec4<u32>(pilotTick(),(batch+1u)%3u,(*advice).schedule.z+1u,0u);
  }
  (*advice).contacts=vec4<u32>(0u);(*advice).serials=vec4<u32>(0u);
  for(var k=0u;k<result.count;k++){
    (*advice).contacts[k]=result.items[k].slot+1u;(*advice).serials[k]=result.items[k].serial;
  }
  return result;
}
fn pilotManeuver(desired:vec3<f32>,choice:u32,side:f32)->vec3<f32>{
  if(choice==3u){return desired*.35;}
  if(choice!=2u){return desired;}
  let forward=unit(desired);var right=cross(vec3<f32>(0.0,1.0,0.0),forward);
  if(dot(right,right)<.001){right=vec3<f32>(1.0,0.0,0.0);}
  return unit(forward+unit(right)*(.45*side))*length(desired)*.85;
}
fn pilotAcceptable(s:Ship,wanted:vec3<f32>,contacts:PilotContacts,limits:vec4<f32>,samples:u32)->bool {
  let mine=repelRadius(shipType(s),journeyBodyRadius(s));
  let horizon=clamp(length(s.v.xyz)/max(limits.y,.0001),.5,3.0);
  // Coarse acceleration-limited chord, not a second copy of the physical motor.
  // Retained lateral/turn momentum remains in the current velocity.
  var before=vec3<f32>(0.0);
  for(var sample=1u;sample<=samples;sample++){
    let time=horizon*f32(sample)/f32(samples);let prior=horizon*f32(sample-1u)/f32(samples);
    let velocity=s.v.xyz+capped(wanted-s.v.xyz,limits.y*time);
    let position=(s.v.xyz+velocity)*(.5*time);
    for(var k=0u;k<contacts.count;k++){
      let peer=contacts.items[k];let gap=peer.p-s.p.xyz;
      let start=gap+peer.v*prior-before;let end=gap+peer.v*time-position;let delta=end-start;
      let closest=start+delta*clamp(-dot(start,delta)/max(dot(delta,delta),.000001),0.0,1.0);
      let clearance=(mine+peer.radius)*.9;
      // Existing overlap may separate; do not reject every possible escape.
      if(dot(closest,closest)<min(clearance*clearance,dot(gap,gap)*.9)){return false;}
    }
    before=position;
  }
  return true;
}
fn choosePilotManeuver(s:Ship,desired:vec3<f32>,limits:vec4<f32>,contacts:PilotContacts,advice:ptr<function,PilotAdvice>,period:u32){
  var choice=u32((*advice).correction.w);var side=(*advice).correction.x;
  if(side==0.0){side=select(-1.0,1.0,(hash(s.identity.w)&1u)==0u);}
  let clear=contacts.count==0u;
  (*advice).broad.w=select(0.0,(*advice).broad.w+1.0,clear);
  if(clear){if((*advice).broad.w>=2.0){choice=1u;}}
  else if(period==8u){choice=1u;} // Tiny traffic gets separation only.
  else {
    let samples=select(1u,2u,period==1u);
    // Keep a safe passing side. Retry normal travel after braking so a cached
    // brake request cannot strand a ship beside an otherwise harmless neighbor.
    let previous=choice;
    let retained=previous==2u&&pilotAcceptable(s,pilotManeuver(desired,2u,side),contacts,limits,samples);
    if(!retained){
      choice=1u;
      if(!pilotAcceptable(s,desired,contacts,limits,samples)){
        choice=3u;
        if(previous!=2u&&pilotAcceptable(s,pilotManeuver(desired,2u,side),contacts,limits,samples)){choice=2u;}
      }
    }
  }
  (*advice).correction=vec4<f32>(side,0.0,0.0,f32(choice));
}
`;
