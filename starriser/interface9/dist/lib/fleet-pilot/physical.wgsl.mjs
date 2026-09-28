import {COMMON} from './common.wgsl.mjs';
import {ANGULAR_MOTION_WGSL} from '../ship-runtime/angular-motion.mjs';
import {FORWARD_INTEGRATION_WGSL} from '../ship-runtime/forward-integration.mjs';
import {FORWARD_MOTION_WGSL} from '../ship-runtime/forward-motion.mjs';
import {TRANSPORT_MOTION_WGSL} from '../ship-runtime/transport-motion.mjs';
export const PHYSICAL=COMMON+ANGULAR_MOTION_WGSL+FORWARD_INTEGRATION_WGSL+FORWARD_MOTION_WGSL+TRANSPORT_MOTION_WGSL+/*wgsl*/`
@compute @workgroup_size(128) fn integrate(@builtin(global_invocation_id) id:vec3<u32>){
  let index=id.x;if(index>=u32(u.clock.z)){return;}
  let tick=u32(u.clock.w);let s=old[index];let f=fleets[s.identity.y];
  // The urgent pass refreshes changed orders/inspection before this stage.
  // Ordinary delayed prediction runs afterward and cannot affect this tick.
  let intent=intents[page(select(tick,tick+1u,u.settings.y>.5),index)];
  let age=max(0.0,u.clock.x-intent.motion.w);
  let aimPoint=intent.aimPoint.xyz+intent.motion.xyz*age;
  let limits=LIMITS[s.identity.x];
  var result=transportMotion(s,aimPoint-s.p.xyz,intent.aimPoint.w,limits,limits.w,u.clock.y,u.clock.y);
  result.aim=vec4<f32>(aimPoint,intent.aimPoint.w);
  next[index]=result;
}
`;
