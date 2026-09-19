export const DESTRUCTION_SECONDS=1.8;
export const EFFECTS_SIM=/* wgsl */`
fn facingDirection(s:Ship)->vec3<f32> {
  let handle=u32(s.aux.x);
  if(classIndex(shipType(s))>=3u&&handle>0u) {
    let enemy=old[handle-1u];let delta=enemy.p.xyz-s.p.xyz;
    if(length(delta)<engagementRadius(s,enemy)+8.0){return delta;}
  }
  return s.v.xyz;
}
fn combatPresentation(initial:Ship,now:f32,dt:f32)->Ship {
  var s=initial;let typeId=shipType(s);let intent=groupIntent(groupOf(s));let handle=u32(s.aux.x);
  let acceleration=length(s.a.xyz)/max(.01,dynamics(typeId).y);
  s.fx.w=clamp(acceleration*.7+length(s.v.xyz)/max(.1,s.v.w)*.25,0.0,1.0);
  s.aim.w=max(0.0,-dot(s.a.xyz,unit(s.v.xyz)))/max(.01,dynamics(typeId).y);
  if(handle==0u||!validTarget(handle-1u,s,groupOrder(groupOf(s)))){return s;}
  let enemy=old[handle-1u];let delta=enemy.p.xyz-s.p.xyz;
  let aligned=dot(rotate(s.q,vec3<f32>(0.0,0.0,1.0)),unit(delta))>.45;
  let interval=select(.55,1.6,classIndex(typeId)>=3u)+variation(s.identity.w)*.4;
  if(intent.weapon.x>0.5&&aligned&&length(delta)<45.0+dimensions(typeId).w+dimensions(shipType(enemy)).w&&now>s.fx.z) {
    s.fx.y=now;s.fx.z=now+interval;s.aim=vec4<f32>(enemy.p.xyz,s.aim.w);
  }
  return s;
}
`;
export const EFFECTS_DRAW=/* wgsl */`
@vertex fn weapon(@builtin(vertex_index) vertex:u32,@builtin(instance_index) i:u32)->Vertex {
  var out:Vertex;out.clip=vec4<f32>(2,2,2,1);out.color=vec4<f32>(0);
  let s=displayShip(i);let age=view.clock.x-s.fx.y;
  if(s.identity.z==0u||s.fx.y<=0.0||age<0.0||age>.12){return out;}
  let muzzle=s.p.xyz+rotate(s.q,vec3<f32>(0,0,dimensions(shipType(s)).z));
  let impact=s.aim.xyz;out.clip=project(select(muzzle,impact,vertex==1u));
  let fade=(1.0-age/.12)*select(.18,.7,classIndex(shipType(s))>=3u);out.color=vec4<f32>(mix(color(s),vec3<f32>(1,.9,.65),.65)*fade,fade);return out;
}
@vertex fn thruster(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Vertex {
  var out:Vertex;out.clip=vec4<f32>(2,2,2,1);out.color=vec4<f32>(0);
  let i=instance/6u;let nozzle=instance%6u;let s=displayShip(i);if(s.identity.z==0u){return out;}
  let axes=array<vec3<f32>,6>(vec3<f32>(1,0,0),vec3<f32>(-1,0,0),vec3<f32>(0,1,0),vec3<f32>(0,-1,0),vec3<f32>(0,0,1),vec3<f32>(0,0,-1));
  let axis=axes[nozzle];let exhaust=rotate(s.q,axis);let limits=dynamics(shipType(s));
  var thrust=max(0.0,-dot(s.a.xyz,exhaust))/limits.y;
  if(nozzle==5u){thrust=max(thrust,s.fx.w*.35);}
  if(s.flight.w>=2.0&&nozzle==5u){thrust=2.0;}
  let extent=dimensions(shipType(s)).xyz;let base=s.p.xyz+rotate(s.q,axis*extent);
  let length=max(.3,dimensions(shipType(s)).w)*thrust*2.0;
  out.clip=project(base+exhaust*length*f32(vertex));
  out.color=vec4<f32>(vec3<f32>(.35,.7,1.0)*thrust,clamp(thrust,0.0,1.0));return out;
}
@vertex fn destruction(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Vertex {
  var out:Vertex;out.clip=vec4<f32>(2,2,2,1);out.color=vec4<f32>(0);
  let i=instance/12u;let spark=instance%12u;let s=displayShip(i);let age=view.clock.x-s.fx.x;
  if(s.identity.z!=0u||s.fx.x<0.0||age<0.0||age>${DESTRUCTION_SECONDS}){return out;}
  let angle=f32(spark)*2.39996323;let y=1.0-2.0*(f32(spark)+.5)/12.0;
  let direction=vec3<f32>(cos(angle)*sqrt(1-y*y),y,sin(angle)*sqrt(1-y*y));
  let extent=dimensions(shipType(s)).w;let radius=extent+age*(1.8+extent*.4);
  let point=s.p.xyz+s.v.xyz*age*.3+direction*radius*select(.6,1.0,vertex==1u);
  let fade=1.0-age/${DESTRUCTION_SECONDS};out.clip=project(point);out.color=vec4<f32>(vec3<f32>(1,.35,.05)*fade,fade);return out;
}
`;
