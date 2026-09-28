import {eventPoseWrite} from './event-gpu.mjs';
export const EVENT_MOTION_WGSL=/* wgsl */`
${eventPoseWrite}
// Controllers run once per simulation tick. Between exact directive boundaries,
// retain scalar thrust and angular velocity; warp still evaluates analytically.
fn heldMotion(initial:Ship,dt:f32)->Ship {
  return heldForwardMotion(initial,dt);
}
fn advanceEventShip(initial:Ship,i:u32)->Ship {
  journalEnabled=true;links[correctionDirectory(u32(u.clock.z))+i]=0u;
  let group=groupOf(initial);let count=director.events.directory[group].x;
  var s=initial;var dt=u.clock.y;var first=trailFirst(u.clock.x,u.clock.y);
  if(director.events.clock.x!=0.0&&count>0u) {
    eventGroup=group;eventRow=0u;
    var at=director.events.clock.y;var tick=u32(director.events.clock.w);
    s=integrateHeldShip(s,i,at,0.0,tick+1u,tick);
    for(var row=1u;row<=count;row++) {
      let command=director.events.rows[eventIndex(group,row)].clock;
      s=integrateHeldShip(s,i,command.x,max(0.0,command.x-at),tick+1u,u32(command.y));
      storeEventPose(s,i,row-1u,0u);eventRow=row;
      s=integrateHeldShip(s,i,command.x,0.0,u32(command.y)+1u,u32(command.y));
      storeEventPose(s,i,row-1u,1u);at=command.x;tick=u32(command.y);
    }
    dt=max(0.0,u.clock.x-at);first=tick+1u;
  }
  // One controller call site, regardless of how many event boundaries preceded it.
  return integrateShip(s,i,u.clock.x,dt,first,trailLast(u.clock.x));
}
`;
