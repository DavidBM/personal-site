import {COMMON} from './common.wgsl.mjs';
export const SHARED=COMMON+/*wgsl*/`
@compute @workgroup_size(128) fn clearGrid(@builtin(global_invocation_id) id:vec3<u32>){
  if(id.x<BUCKETS){atomicStore(&grid.counts[id.x],0u);}
  if(id.x<16u){atomicStore(&stats.values[id.x],0u);}
}
@compute @workgroup_size(128) fn indexShips(@builtin(global_invocation_id) id:vec3<u32>){
  if(id.x>=u32(u.clock.z)){return;}
  let bucket=hashCell(cell(old[id.x].p.xyz));let slot=atomicAdd(&grid.counts[bucket],1u);
  if(slot<SLOTS){grid.slots[bucket*SLOTS+slot]=id.x;}else{atomicAdd(&stats.values[3],1u);}
}
@compute @workgroup_size(64) fn navigateFleets(@builtin(global_invocation_id) id:vec3<u32>){
  if(id.x>=u32(u.control.x)){return;}
  var f=fleets[id.x];let dt=u.clock.y;
  if(f.info.w==1u){
    let angle=f.velocity.w+f.config.x/max(f.path.w,.1)*dt;
    f.position=vec4<f32>(f.path.xyz+vec3<f32>(cos(angle)*f.path.w,0.0,sin(angle)*f.path.w),f.position.w);
    f.velocity=vec4<f32>(vec3<f32>(-sin(angle),0.0,cos(angle))*f.config.x,angle);
    f.direction=vec4<f32>(unit(f.velocity.xyz),angle);
  }else{
    let gap=f.goal.xyz-f.position.xyz;let wanted=unit(gap);
    let forward=unit(f.direction.xyz);let axis=cross(forward,wanted);
    let angle=atan2(length(axis),clamp(dot(forward,wanted),-1.0,1.0));
    let step=min(angle,f.config.y*dt);
    let turnAxis=select(vec3<f32>(0.0,1.0,0.0),unit(axis),length(axis)>.00001);
    let direction=forward*cos(step)+cross(turnAxis,forward)*sin(step)+turnAxis*dot(turnAxis,forward)*(1.0-cos(step));
    let desired=min(f.config.x,sqrt(2.0*f.config.z*length(gap)));
    let before=length(f.velocity.xyz);let speed=before+clamp(desired-before,-f.config.z*dt,f.config.z*dt);
    f.velocity=vec4<f32>(direction*speed,f.velocity.w);f.position=vec4<f32>(f.position.xyz+f.velocity.xyz*dt,f.position.w);
    f.direction=vec4<f32>(direction,f.direction.w);
  }
  fleets[id.x]=f;
}
`;
