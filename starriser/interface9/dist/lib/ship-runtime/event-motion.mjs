import {eventPoseWrite} from './event-gpu.mjs';
export const EVENT_MOTION_WGSL=/* wgsl */`
${eventPoseWrite}
// Controllers run once per simulation tick. Between exact directive boundaries,
// retain the previous acceleration; kinematic warp still evaluates analytically.
fn heldMotion(initial:Ship,dt:f32)->Ship {
  var s=initial;s.v=vec4<f32>(s.v.xyz+s.a.xyz*dt,s.v.w);
  s.p=vec4<f32>(s.p.xyz+s.v.xyz*dt,s.p.w);s.q=attitude(s.q,s.v.xyz,dt,dynamics(shipType(s)).w);return s;
}
fn advanceEventShip(initial:Ship,i:u32)->Ship {
  journalEnabled=true;links[correctionDirectory(u32(u.clock.z))+i]=0u;
  let group=groupOf(initial);let count=director.events.directory[group].x;
  if(director.events.clock.x==0.0||count==0u){return integrateShip(initial,i,u.clock.x,u.clock.y,true,trailFirst(u.clock.x,u.clock.y),trailLast(u.clock.x));}
  eventGroup=group;eventRow=0u;
  var at=director.events.clock.y;var tick=u32(director.events.clock.w);
  var s=integrateShip(initial,i,at,0.0,false,tick+1u,tick);
  for(var row=1u;row<=count;row++) {
    let command=director.events.rows[eventIndex(group,row)].clock;
    s=integrateShip(s,i,command.x,max(0.0,command.x-at),false,tick+1u,u32(command.y));
    storeEventPose(s,i,row-1u,0u);eventRow=row;
    s=integrateShip(s,i,command.x,0.0,false,u32(command.y)+1u,u32(command.y));
    storeEventPose(s,i,row-1u,1u);at=command.x;tick=u32(command.y);
  }
  return integrateShip(s,i,u.clock.x,max(0.0,u.clock.x-at),true,tick+1u,trailLast(u.clock.x));
}
`;
