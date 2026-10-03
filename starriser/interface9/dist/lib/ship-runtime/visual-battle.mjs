/** Fixed allocation per fleet, independent of ships. No legacy combat imports. */
export const BATTLE_ORDER_WORDS=24;
export const BATTLE_SQUADS=8;
export const battleStorageBytes=n=>n*(BATTLE_ORDER_WORDS*4+BATTLE_SQUADS*32);
export const BATTLE_DECL=/* wgsl */`
struct VisualBattle { own:vec4<u32>, opponent:vec4<u32>, center:vec4<f32>, axis:vec4<f32>, clock:vec4<f32>, reserve:vec4<u32> }
struct BattleSquad { offset:vec4<f32>, velocity:vec4<f32> }
`;
export const battleFields=n=>`,battleOrders:array<VisualBattle,${n}>,battleSquads:array<BattleSquad,${n*BATTLE_SQUADS}>`;

export const VISUAL_BATTLE_WGSL=/* wgsl */`
fn visualBattleConfigured(s:Ship)->bool {
  let b=director.battleOrders[s.identity.y];
  return b.own.y>0u&&b.reserve.z==1u&&b.own.x==s.identity.w-sceneOrdinal(s.identity.x);
}
fn visualInBattle(s:Ship)->bool {
  let guide=director.fleetGuides[s.identity.y];
  return visualBattleConfigured(s)&&guide.ship.memory.z==-4.0&&guide.ship.fx.x==f32(director.battleOrders[s.identity.y].own.y);
}
fn battleTemplate(b:VisualBattle,k:u32,time:f32)->BattleSquad {
  let side=b.axis.w;let wing=select(-1.0,1.0,(k&1u)==0u);
  let lane=f32(k/2u);let t=time/max(1.0,b.clock.y);let angle=t*(2.0*PI)+lane*.48;
  let forward=b.axis.xyz;let right=vec3<f32>(forward.z,0.0,-forward.x);let up=vec3<f32>(0.0,1.0,0.0);
  let r=b.center.w;var p:vec3<f32>;var v:vec3<f32>;
  let omega=2.0*PI/max(1.0,b.clock.y);
  // Paired wings share an attack window; membership never reshuffles per tick.
  if(b.own.w==0u){
    p=forward*(-side*cos(angle)*.62)+up*(wing*sin(angle)*.55)+right*((lane-1.5)*.10);
    v=(forward*(side*sin(angle)*.62)+up*(wing*cos(angle)*.55))*omega;
  }else if(b.own.w==5u){
    p=forward*(-side*.55)+right*((lane-1.5)*.15)+up*(wing*.15);v=vec3<f32>(0.0);
  }else{
    let pace=select(1.0,.5,b.own.w==4u);let a=angle*pace;
    p=forward*(cos(a)*.5)+right*(sin(a)*side*.5)+up*(wing*(.12+.1*sin(a*2.0)));
    v=(forward*(-sin(a)*.5)+right*(cos(a)*side*.5)+up*(wing*.2*cos(a*2.0)))*omega*pace;
  }
  return BattleSquad(vec4<f32>(p*r,0.0),vec4<f32>(v*r,0.0));
}
fn prepareBattleFleet(member:Ship,prior:FleetGuide,dt:f32)->FleetGuide {
  let fleet=member.identity.y;let b=director.battleOrders[fleet];var g=prior.ship;
  let fresh=prior.status.z==0.0||g.memory.z!=-4.0||g.fx.x!=f32(b.own.y)||g.identity.w-sceneOrdinal(g.identity.x)!=b.own.x;
  let changed=fresh||prior.status.x!=f32(b.own.z);
  if(changed){g.memory.x=b.clock.x;}
  g.memory.x+=dt;g.memory.z=-4.0;g.fx.x=f32(b.own.y);g.identity=member.identity;g.flight=member.flight;
  for(var k=0u;k<8u;k++){
    let index=fleet*8u+k;var oldGuide=director.battleSquads[index];
    if(fresh){oldGuide=BattleSquad(vec4<f32>(visualDelta(member,visualPoint(b.center.xyz,vec3<f32>(0.0))),0.0),member.v);}
    let desired=battleTemplate(b,k,g.memory.x);
    let e=oldGuide.offset.xyz-desired.offset.xyz+desired.velocity.xyz*dt;
    let relative=oldGuide.velocity.xyz-desired.velocity.xyz;
    let w=1.8;let h=relative+w*e;let decay=exp(-w*dt);
    director.battleSquads[index]=BattleSquad(vec4<f32>(desired.offset.xyz+(e+h*dt)*decay,0.0),
      vec4<f32>(desired.velocity.xyz+(relative-w*h*dt)*decay,0.0));
  }
  return FleetGuide(g,prior.limits,vec4<f32>(f32(b.own.z),1.0,1.0,0.0));
}
fn battleOpponent(s:Ship,b:VisualBattle)->Ship {
  var opponent:Ship;
  if(b.opponent.x>=FORM_FLEETS||b.opponent.w==0u){return opponent;}
  let other=director.battleOrders[b.opponent.x];
  if(other.own.y!=b.own.y||other.own.x!=b.opponent.y){return opponent;}
  // Stable logical ordinal; relocation only changes the fleet's range base.
  let bomber=classIndex(shipType(s))==2u&&b.reserve.y>0u;
  let start=select(b.opponent.z,b.reserve.x,bomber);let count=select(b.opponent.w,b.reserve.y,bomber);
  let ordinal=start+(sceneOrdinal(s.identity.x)*17u+shipType(s))%count;
  let form=director.forms[b.opponent.x];let index=form.head.z+ordinal;
  if(ordinal>=form.head.w||index>=u32(u.clock.z)){return opponent;}
  opponent=old[index];
  if(opponent.identity.z==0u||!admitted(opponent)||opponent.identity.y!=b.opponent.x||opponent.identity.w!=b.opponent.y+ordinal||inWarp(opponent,u.clock.x)){opponent.identity.z=0u;}
  return opponent;
}
fn visualBattleStep(s:Ship,dt:f32)->Ship {
  let b=director.battleOrders[s.identity.y];let ordinal=sceneOrdinal(s.identity.x);
  let squad=director.battleSquads[s.identity.y*8u+(ordinal%8u)];
  let bits=(vec3<u32>(s.identity.w)*vec3<u32>(2654435769u,2246822519u,3266489917u))>>vec3<u32>(8u);
  let seat=vec3<f32>(bits)/16777216.0-vec3<f32>(.5);
  let center=visualPoint(b.center.xyz,vec3<f32>(0.0));
  var offset=squad.offset.xyz+seat*b.center.w*.25;var velocity=squad.velocity.xyz;
  let phase=b.own.w;let heavy=classIndex(shipType(s))>=4u;
  if(heavy){
    offset=b.axis.xyz*(-b.axis.w*b.center.w*.22)+seat*b.center.w*.36;
    velocity=vec3<f32>(0.0);
  }else if(phase>0u&&phase<5u){
    let opponent=battleOpponent(s,b);
    if(opponent.identity.z>0u&&length(visualDelta(opponent,center))<b.center.w*1.1){
      let forward=rotate(opponent.q,vec3<f32>(0.0,0.0,1.0));
      let targetOffset=visualDelta(opponent,center);
      var goal=targetOffset-forward*b.center.w*.10+seat*b.center.w*.18;
      if(phase==1u){goal=targetOffset+unit(visualDelta(opponent,s))*b.center.w*.22+seat*b.center.w*.2;}
      if(phase==3u){goal=targetOffset+unit(visualDelta(s,opponent)+seat*.1)*b.center.w*.55;}
      if(phase==4u){goal=targetOffset+squad.offset.xyz*.35;}
      let influence=select(.60,.85,phase==2u);
      offset=mix(offset,goal,influence);velocity=mix(velocity,opponent.v.xyz,influence);
    }
  }
  // Constrain intent, not pose. Damping brings stragglers back continuously.
  let bounded=capped(offset,b.center.w*.84);
  let radial=unit(bounded);
  if(length(offset)>b.center.w*.80){velocity-=radial*max(0.0,dot(velocity,radial));}
  velocity=capped(velocity,b.center.w*.65);
  var result=visualTrack(s,visualPoint(b.center.xyz,bounded),velocity,2.5,dt);
  result.memory=vec4<f32>(0.0,0.0,-4.0,0.0);
  return result;
}
`;
