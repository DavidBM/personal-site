/** Optional diagnostic entry. Reuses navigation/formation/body steering exactly;
 * writes only to an isolated 12-row output, never to the simulation's next pose. */
export const NAVIGATION_INSPECTION_WGSL = /* wgsl */ `
@compute @workgroup_size(1) fn inspectNavigation(@builtin(global_invocation_id) gid:vec3<u32>) {
  let index=next[gid.x].identity.w;
  if(index>=u32(u.clock.z)){return;}
  let s=old[index];var out=s;
  if(s.identity.z==0u){next[gid.x]=out;return;}
  let journey=journeyFor(s);let limits=sceneLimits(shipType(s),journeyBodyRadius(s));
  var guide=NavigationResult(s,vec3<f32>(0.0),0.0);
  let navigating=s.flight.w<0.0||(s.flight.w==1.0&&journey.range.z>0.0);
  if(navigating){guide=navigationStep(s,journey,u.clock.x);}
  out.a=vec4<f32>(guide.velocity,guide.reach);
  let order=groupOrder(groupOf(s));let attacking=order.w==1u && order.y<2u;
  var postFormation=guide.velocity;
  if(!attacking){postFormation=subDirect(guide.ship,guide.velocity,limits,u.clock.x);}
  out.flight=vec4<f32>(postFormation,s.flight.w);
  out.origin=vec4<f32>(avoidBodies(s,u.clock.x),repelScale(shipType(s)));
  out.tactic=director.fleetTravel[s.identity.y].center;
  out.fx=director.fleetTravel[s.identity.y].direction;
  let travel=director.fleetTravel[s.identity.y];
  out.aim=vec4<f32>(travel.progress.w,travel.state.y,travel.progress.xy);
  out.aux=vec4<f32>(limits.xyz,dynamics(shipType(s)).w);
  next[gid.x]=out;
}
`;
