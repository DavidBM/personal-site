import {eventPoseWrite} from './event-gpu.mjs';
export const eventMotionWgsl=(visual=false)=>/* wgsl */`
${eventPoseWrite}
// Controllers run once per simulation tick. Between exact directive boundaries,
// retain scalar thrust and angular velocity; warp still evaluates analytically.
fn heldMotion(initial:Ship,dt:f32)->Ship {
  return ${visual?'moveShipPosition(initial,initial.v.xyz*dt)':'heldForwardMotion(initial,dt)'};
}
fn prepareEventShip(initial:Ship,i:u32)->ShipIntegration {
  journalEnabled=true;links[correctionDirectory(u32(u.clock.z))+i]=0u;
  let group=groupOf(initial);let count=director.events.directory[group].x;
  let events=director.events.clock.x!=0.0&&count>0u;
  // Boundary 0 applies the starting directive; odd/even boundaries record
  // the before/after sides of each event. The last interval runs the controller.
  let finalBoundary=select(0u,count*2u+1u,events);
  var at=director.events.clock.y;var tick=u32(director.events.clock.w);
  var s=initial;var dt=u.clock.y;var first=trailFirst(u.clock.x,u.clock.y);
  if(events){eventGroup=group;eventRow=0u;}
  for(var boundary=0u;boundary<=finalBoundary;boundary++) {
    let held=boundary<finalBoundary;
    var end=u.clock.x;var duration=dt;var begin=first;var last=trailLast(u.clock.x);
    let row=(boundary+1u)/2u;let after=boundary>0u&&(boundary&1u)==0u;
    if(held) {
      end=at;duration=0.0;begin=tick+1u;last=tick;
      if(boundary>0u) {
        let command=director.events.rows[eventIndex(group,row)].clock;
        end=command.x;last=u32(command.y);
        if(after){begin=last+1u;}else{duration=max(0.0,end-at);}
      }
    } else if(events) {duration=max(0.0,u.clock.x-at);begin=tick+1u;}
    let interval=prepareShipIntegration(s,i,end,duration,begin,last,held);
    s=interval.ship;
    if(!held){dt=interval.dt;first=interval.first;break;}
    if(boundary>0u) {
      storeEventPose(s,i,row-1u,select(0u,1u,after));
      if(after){at=end;tick=last;}else{eventRow=row;}
    }
  }
  return ShipIntegration(s,dt,first);
}
fn advanceEventShip(initial:Ship,i:u32)->Ship {
  let interval=prepareEventShip(initial,i);
  return integrateMotion(interval.ship,i,u.clock.x,interval.dt,interval.first,trailLast(u.clock.x));
}
`;

// Scratch is the final two words per populated slot in the existing links binding.
// It is transient: every prepare invocation overwrites it before movement reads it.
export const ADVANCE_SCRATCH_WORDS=2;
export const splitAdvanceWgsl=(visual=false)=>/* wgsl */`
fn advanceScratch(i:u32)->u32{return arrayLength(&links)-u32(u.clock.z)*${ADVANCE_SCRATCH_WORDS}u+i*${ADVANCE_SCRATCH_WORDS}u;}
@compute @workgroup_size(128) fn prepareAdvance(@builtin(global_invocation_id) gid:vec3<u32>) {
  if(gid.x>=u32(u.clock.z)){return;}
  let i=${visual?'gid.x':'links[u32(u.clock.z)+gid.x]'};let interval=prepareEventShip(old[i],i);
  next[i]=interval.ship;let at=advanceScratch(i);
  links[at]=bitcast<u32>(interval.dt);links[at+1u]=interval.first;
}
fn advancePreparedShip(i:u32)->Ship {
  // Invocation-private state does not survive a dispatch. Restore the final
  // event row, but do not clear the correction chain built by prepareAdvance.
  journalEnabled=true;let group=groupOf(old[i]);let count=director.events.directory[group].x;
  if(director.events.clock.x!=0.0&&count>0u){eventGroup=group;eventRow=count;}
  let at=advanceScratch(i);
  return integrateMotion(next[i],i,u.clock.x,bitcast<f32>(links[at]),links[at+1u],trailLast(u.clock.x));
}
`;
