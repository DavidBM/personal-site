export const MEMORY_WGSL=/* wgsl */`
fn clearTactical(index:u32){if(index<u32(u.clock.z)){atomicStore(&heads[32768u+index],0u);}}
fn registerTarget(s:Ship) {
  let handle=u32(s.aux.x);
  if(handle>0u&&handle<=u32(u.clock.z)){atomicAdd(&heads[32768u+handle-1u],1u);}
}
fn pursuers(index:u32)->f32{return f32(atomicLoad(&heads[32768u+index]));}
fn validThreat(index:u32,s:Ship)->bool {
  if(index>=u32(u.clock.z)){return false;}
  let threat=old[index];return admitted(threat)&&permittedFleet(threat.identity.y,s.identity.y)&&groupOrder(groupOf(threat)).w==1u&&!inWarp(threat,u.clock.x);
}
fn nearbyPursuer(s:Ship,i:u32)->u32 {
  if(pursuers(i)==0.0){return 0u;}
  var found=0u;var nearest=36.0;
  for(var cell=0u;cell<27u;cell++) {
    let handle=links[pursuerOffset(i,cell)];if(handle==0u){continue;}
    let delta=old[handle-1u].p.xyz-s.p.xyz;let distance=dot(delta,delta);
    if(distance<nearest){nearest=distance;found=handle;}
  }
  return found;
}
fn refreshMemory(initial:Ship,i:u32,order:vec4<u32>,now:f32)->Ship {
  var s=initial;
  if(u.control.w<.5){s.memory.x=0.0;return s;}
  if(s.memory.x>0.0&&!validThreat(u32(s.memory.x)-1u,s)){s.memory.x=0.0;}
  if(now<s.memory.z){return s;}
  s.memory.z=now+.12+variation(s.identity.w)*.03;
  let threat=nearbyPursuer(s,i);
  if(threat>0u){s.memory.x=f32(threat);s.memory.y=now+.65;}
  if(now>s.memory.y){s.memory.x=0.0;}
  // Periodic replacement only when crowding improves materially. Retain the
  // allowed target mask; a single approved colossus may intentionally draw all fire.
  let current=u32(s.aux.x);
  if(current>0u&&pursuers(current-1u)>8.0&&((redistributionPhase(now)+s.identity.w)%8u)==0u) {
    let candidate=selectTarget(s,i,order,now);
    if(candidate>0u&&pursuers(candidate-1u)+3.0<pursuers(current-1u)){s.aux.x=f32(candidate);}
  }
  return s;
}
fn evadePursuer(s:Ship,contact:Ship,incoming:vec3<f32>,now:f32)->vec3<f32> {
  if(s.memory.x==0.0||now>s.memory.y){return incoming;}
  let threat=old[u32(s.memory.x)-1u];let gap=s.p.xyz-threat.p.xyz;
  let distance=length(gap);let targetDistance=length(contact.p.xyz-s.p.xyz);
  if(targetDistance<engagementRadius(s,contact)+4.0||distance>6.0){return incoming;}
  let toward=unit(contact.p.xyz-s.p.xyz);
  var side=gap-toward*dot(gap,toward);
  if(length(side)<.05){side=passingTangent(s,contact,toward);}
  let strength=(1.0-smoothstep(2.0,6.0,distance))*.8;
  return capped(incoming+unit(side)*dynamics(shipType(s)).x*strength,dynamics(shipType(s)).x);
}
`;
