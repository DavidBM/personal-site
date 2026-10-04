import {BATTLE_TUNING_BYTES} from './battle-tuning.mjs';
import {BATTLE_COORDINATION_WGSL} from './battle-coordination.mjs';
/** Fixed capacity, independent of population. No legacy pilot/contact imports. */
export const BATTLE_ORDER_WORDS=48;
export const BATTLE_SQUADS=96;
export const BATTLE_GUIDE_BYTES=48;
export const battleStorageBytes=n=>n*(BATTLE_ORDER_WORDS*4+BATTLE_SQUADS*BATTLE_GUIDE_BYTES)+BATTLE_TUNING_BYTES;
export const BATTLE_DECL=/* wgsl */`
struct VisualBattle { own:vec4<u32>, opponent:vec4<u32>, center:vec4<f32>, axis:vec4<f32>, clock:vec4<f32>, reserve:vec4<u32>, classes:array<vec4<u32>,6> }
struct BattleSquad { offset:vec4<f32>, velocity:vec4<f32>, clock:vec3<f32>, lifetime:u32 }
struct BattleProfile { motion:vec4<f32>, shipNoise:vec4<f32>, squadNoise:vec4<f32>, shape:vec4<f32>, attack:vec4<f32> }
`;
export const battleFields=n=>`,battleOrders:array<VisualBattle,${n}>,battleSquads:array<BattleSquad,${n*BATTLE_SQUADS}>,battleProfiles:array<BattleProfile,6>,battleStrategies:array<vec4<u32>,24>`;

export const VISUAL_BATTLE_WGSL=/* wgsl */`
fn visualBattleConfigured(s:Ship)->bool {
  let b=director.battleOrders[s.identity.y];
  return b.own.y>0u&&b.reserve.z==1u&&b.own.x==s.identity.w-sceneOrdinal(s.identity.x);
}
fn visualInBattle(s:Ship)->bool {
  let guide=director.fleetGuides[s.identity.y];
  return visualBattleConfigured(s)&&guide.ship.memory.z==-4.0&&guide.ship.fx.x==f32(director.battleOrders[s.identity.y].own.y);
}
fn battleHash(value:u32)->u32 {
  var x=value;x=(x^(x>>16u))*0x7feb352du;x=(x^(x>>15u))*0x846ca68bu;return x^(x>>16u);
}
fn battleRandom(seed:u32)->vec3<f32> {
  let h=battleHash(seed);
  return vec3<f32>(f32(h&1023u),f32((h>>10u)&1023u),f32((h>>20u)&1023u))/511.5-vec3<f32>(1.0);
}
struct BattleNoise { p:vec3<f32>, v:vec3<f32> }
// Temporal value noise, three components from each of two hashes. Bounded phase
// survives clock rebasing; changing its period never recomputes elapsed/period.
fn battleNoise(seed:u32,phase:vec2<f32>,step:f32,vertical:f32,dt:f32)->BattleNoise {
  let a=battleRandom(seed+u32(phase.y)*1597334677u);let b=battleRandom(seed+((u32(phase.y)+1u)&65535u)*1597334677u);
  let t=phase.x;let d=b-a;let scale=vec3<f32>(1.0,vertical,1.0);
  return BattleNoise((a+d*t*t*(3.0-2.0*t))*scale,d*(6.0*t*(1.0-t)*step/max(dt,.00001))*scale);
}
fn battleNoiseClock(previous:vec2<f32>,step:f32)->vec2<f32>{
  let value=previous.x+step;return vec2<f32>(fract(value), (previous.y+floor(value))%65536.0);
}
// A stable offset in each temporal noise axis de-synchronizes a ship's turns.
// Use its persistent serial, not position or GPU slot. All three shifted axes
// fit within two adjacent intervals, so three endpoint hashes suffice.
fn battleShipNoise(serial:u32,phase:vec2<f32>,step:f32,vertical:f32,dt:f32)->BattleNoise {
  let offset=battleRandom(serial^0x68bc21ebu)*.5+vec3<f32>(.5);
  let seed=serial^0x02e5be93u;let cell=u32(phase.y);
  let a=battleRandom(seed+cell*1597334677u);
  let b=battleRandom(seed+((cell+1u)&65535u)*1597334677u);
  let c=battleRandom(seed+((cell+2u)&65535u)*1597334677u);
  let shifted=vec3<f32>(phase.x)+offset;let crossed=shifted>=vec3<f32>(1.0);
  let start=select(a,b,crossed);let delta=select(b,c,crossed)-start;
  let t=fract(shifted);let scale=vec3<f32>(1.0,vertical,1.0);
  return BattleNoise((start+delta*t*t*(3.0-2.0*t))*scale,
    delta*(6.0*t*(1.0-t)*step/max(dt,.00001))*scale);
}
fn battleSquadCount(profile:BattleProfile,count:u32)->u32{return max(1u,min(count,u32(profile.shape.x)));}
// One representative from the previous physical tick per squad. Reading old[]
// avoids cross-workgroup races between in-place guide updates. It also removes
// the old per-ship opponent lookup; no nearest search or new pass is needed.
fn battleSquadOpponent(b:VisualBattle,kind:u32,k:u32,strategy:u32)->Ship {
  var opponent:Ship;
  if(!battleUsesEnemy(strategy)||b.opponent.x>=FORM_FLEETS||b.opponent.w==0u){return opponent;}
  let other=director.battleOrders[b.opponent.x];
  if(other.own.y!=b.own.y||other.own.x!=b.opponent.y){return opponent;}
  let bomber=strategy==BATTLE_STRIKE&&b.reserve.y>0u;
  var start=select(b.opponent.z,b.reserve.x,bomber);var count=select(b.opponent.w,b.reserve.y,bomber);
  // Interceptors screen against bomber squads when present. Fighters still
  // engage their authority-assigned light targets, including bomber escorts.
  if(b.reserve.w==1u&&kind==0u&&other.classes[2].y>0u){start=other.classes[2].x;count=max(1u,other.classes[2].z);}
  let chosen=u32(director.battleProfiles[kind].attack.z);
  if(chosen>0u&&other.classes[chosen-1u].y>0u){start=other.classes[chosen-1u].x;count=max(1u,other.classes[chosen-1u].z);}
  var squads=1u;
  for(var targetKind=0u;targetKind<6u;targetKind++){
    let range=other.classes[targetKind];
    if(range.x==start&&range.y>0u){squads=min(count,battleSquadCount(director.battleProfiles[targetKind],range.y));break;}
  }
  let ordinal=start+k%max(1u,squads);
  let form=director.forms[b.opponent.x];let index=form.head.z+ordinal;
  if(ordinal>=form.head.w||index>=u32(u.clock.z)){return opponent;}
  opponent=old[index];
  if(!admitted(opponent)||opponent.identity.y!=b.opponent.x||opponent.identity.w!=b.opponent.y+ordinal||inWarp(opponent,u.clock.x)){opponent.identity.z=0u;}
  return opponent;
}
struct BattleGoal { p:vec3<f32>, v:vec3<f32> }
${BATTLE_COORDINATION_WGSL}
// Safe local choreography is a clipped convex part of the encounter sphere,
// not the four-corner ingress loop. Tangent half-spaces keep targets on the
// encounter side of nearby bodies. Cached body poses; this runs per squad only.
fn battleConstrain(goal:BattleGoal,b:VisualBattle,margin:f32)->BattleGoal {
  let r=b.center.w;var out=goal;out.p=capped(out.p,r*.64);
  for(var i=0u;i<solarBodyCount();i++){
    let body=director.pilotBodies[i].position;let delta=b.center.xyz-body.xyz;
    if(dot(delta,delta)>(body.w+r+margin)*(body.w+r+margin)){continue;}
    let distance=length(delta);let normal=delta/max(distance,.000001);
    let clearance=body.w+margin-distance;
    let gap=dot(out.p,normal)-clearance;
    if(gap<0.0){out.p-=normal*gap;out.v-=normal*min(0.0,dot(out.v,normal));}
  }
  // A changing role/target may request motion out of the sphere. Preserve its
  // tangential velocity instead of feeding an outward derivative to the tracker.
  let lengthP=length(out.p);
  if(lengthP>r*.63){let normal=out.p/max(lengthP,.000001);out.v-=normal*max(0.0,dot(out.v,normal));}
  return out;
}
fn battleGuideTarget(b:VisualBattle,p:BattleProfile,clock:vec3<f32>,seed:u32,kind:u32,k:u32,previous:BattleSquad,enemy:Ship,support:BattleSupport,strategy:u32,dt:f32)->BattleGoal {
  let r=b.center.w;let rate=p.motion.x*(.85+f32(battleHash(seed)&255u)/850.0)/max(60.0,p.motion.y);
  let angle=clock.x*6.2831853;let omega=6.2831853*rate/max(dt,.00001);
  // Different fixed orbital planes for each squad, including real depth. The
  // curve is relative to its moving opponent, never a shared world-space lap.
  let forward=unit(b.axis.xyz);let side=visualSide(forward,battleRandom(seed+71u));let up=cross(forward,side);
  let cs=cos(angle);let sn=sin(angle);let sn2=2.0*sn*cs;let cs2=cs*cs-sn*sn;
  let wave=(forward*cs+side*sn+up*(sn2*.55*p.shape.y));
  let waveV=(-forward*sn+side*cs+up*(cs2*1.1*p.shape.y))*omega;
  var center=vec3<f32>(0.0);var drift=vec3<f32>(0.0);
  if(enemy.identity.z>0u){center=visualDelta(enemy,visualPoint(b.center.xyz,vec3<f32>(0.0)));drift=capped(enemy.v.xyz,r*omega*2.0);}
  var goal=BattleGoal(center+wave*(r*.22),drift+waveV*(r*.22));
  let wing=select(-1.0,1.0,(k&1u)==0u);
  if(strategy==BATTLE_CRUISE){
    goal=BattleGoal(forward*(b.axis.w*r*.22)+wave*r*.18,waveV*r*.18);
  }else if(strategy==BATTLE_STRIKE){
    goal=battleStrikeGoal(b,p,support,BattleGoal(center,drift),BattleGoal(wave,waveV),side,up,cs,sn,omega,enemy.identity.z>0u);
  }else if(battleUsesAnchor(strategy)&&support.anchor.lifetime>0u){
    goal=battleEscortGoal(b,kind,support,BattleGoal(center,drift),BattleGoal(wave,waveV));
  }else {
    // Missing friendly classes still animate; no uninitialized anchor is used.
    let mode=select(strategy,battlePhaseStrategy(b.own.w),battleUsesAnchor(strategy));
    switch mode {
    case BATTLE_PINCER: { // Pincer: split wings continually close, cross, and pull out.
      let scale=r*(.16+.24*p.shape.w);
      goal=BattleGoal(center+forward*(cs*scale)+side*(wing*abs(sn)*r*.28*p.attack.x)+up*(sn2*r*.16*p.shape.y),
        drift+(-forward*(sn*scale)+side*(wing*sign(sn)*cs*r*.28*p.attack.x)+up*(cs2*r*.32*p.shape.y))*omega);
    }
    case BATTLE_PASS: { // Pass / bomber run: fly through, then curl around the target.
      let scale=r*(.15+.25*p.shape.w);
      goal=BattleGoal(center+forward*(cs*scale)+side*(sn*r*.18*p.attack.x)+up*(sn2*r*.16*p.shape.y),
        drift+(-forward*(sn*scale)+side*(cs*r*.18*p.attack.x)+up*(cs2*r*.32*p.shape.y))*omega);
    }
    case BATTLE_PURSUIT: { // Pursuit actually follows the assigned moving squad.
      let heading=unit(select(forward,enemy.v.xyz,dot(enemy.v.xyz,enemy.v.xyz)>.000001));
      goal=BattleGoal(center-heading*r*.08+wave*r*.09,drift+waveV*r*.09);
    }
    case BATTLE_EVADE: { // Evasion depends on pursuer position, with a changing escape plane.
      let away=unit(previous.offset.xyz-center+side*r*.04);
      goal=BattleGoal(center+away*r*(.18+.22*p.shape.w)+wave*r*.24,drift+waveV*r*.24);
    }
    case BATTLE_REGROUP: {goal=BattleGoal(forward*(b.axis.w*r*.25)+wave*r*.2,waveV*r*.2);}
    default: {}
  }}
  let noise=battleNoise(seed,clock.yz,1.0/max(30.0,p.squadNoise.y),p.squadNoise.z,dt);
  let amplitude=r*.16*p.squadNoise.x*p.squadNoise.w;
  goal.p+=noise.p*amplitude;goal.v+=noise.v*amplitude;
  return battleConstrain(goal,b,r*.30);
}
fn prepareBattleFleet(member:Ship,prior:FleetGuide,dt:f32)->FleetGuide {
  let fleet=member.identity.y;let b=director.battleOrders[fleet];var g=prior.ship;
  let fresh=prior.status.z==0.0||g.memory.z!=-4.0||g.fx.x!=f32(b.own.y)||g.identity.w-sceneOrdinal(g.identity.x)!=b.own.x;
  g.memory.z=-4.0;g.fx.x=f32(b.own.y);g.identity=member.identity;g.flight=member.flight;
  // One invocation owns this fleet. Heavy guides are ready before any lighter
  // squad follows them, with no cross-workgroup guide read or extra snapshot.
  for(var order=0u;order<6u;order++){
    let kind=5u-order;
    let range=b.classes[kind];if(range.y==0u){continue;}
    let p=director.battleProfiles[kind];let count=battleSquadCount(p,range.y);
    for(var k=0u;k<16u;k++){
      let index=fleet*96u+kind*16u+k;
      if(k>=count){director.battleSquads[index].lifetime=0u;continue;}
      var previous=director.battleSquads[index];let seed=b.own.x+kind*4099u+k*131u;
      if(fresh||previous.lifetime!=b.own.x){
        var representative=visualMember(fleet,range.x+min(k,max(1u,range.z)-1u));
        if(representative.identity.z==0u){representative=member;}
        previous.offset=vec4<f32>(visualDelta(representative,visualPoint(b.center.xyz,vec3<f32>(0.0))),0.0);
        previous.velocity=vec4<f32>(representative.v.xyz,0.0);
        let info=director.sceneRoutes[fleet].info;let start=max(0.0,-info.y-1.0);
        let phase=fract(max(0.0,prior.ship.memory.x-start)/max(.001,info.x-start));
        let base=director.battleSquads[fleet*96u+kind*16u];
        let joined=select(phase,base.clock.x,!fresh&&base.lifetime==b.own.x);
        previous.clock=vec3<f32>(fract(joined+f32(battleHash(seed+317u)&1023u)/1024.0),fract(f32(seed&1023u)/1024.0),0.0);
      }
      var clock=previous.clock;
      clock.x=fract(clock.x+p.motion.x*(.85+f32(battleHash(seed)&255u)/850.0)/max(60.0,p.motion.y));
      clock=vec3<f32>(clock.x,battleNoiseClock(clock.yz,1.0/max(30.0,p.squadNoise.y)));
      let strategy=battleStrategy(b,kind,k);
      let enemy=battleSquadOpponent(b,kind,k,strategy);
      let support=battleSupport(b,fleet,kind,k,clock.x,previous,enemy,strategy);
      let desired=battleGuideTarget(b,p,clock,seed,kind,k,previous,enemy,support,strategy,dt);
      let e=previous.offset.xyz-desired.p+desired.v*dt;
      let relative=previous.velocity.xyz-desired.v;let w=1.8;let h=relative+w*e;let decay=exp(-w*dt);
      let speed=b.center.w*6.2831853*p.motion.x/max(60.0,p.motion.y)/max(dt,.00001)*2.0;
      let next=desired.p+(e+h*dt)*decay;
      director.battleSquads[index]=BattleSquad(vec4<f32>(previous.offset.xyz+capped(next-previous.offset.xyz,speed*dt),b.center.w*.25),
        vec4<f32>(capped(desired.v+(relative-w*h*dt)*decay,speed),f32(support.action)),clock,b.own.x);
    }
  }
  return FleetGuide(g,prior.limits,vec4<f32>(f32(b.own.z),1.0,1.0,0.0));
}
fn battleShipGoal(s:Ship,p:BattleProfile,squad:BattleSquad,clock:vec2<f32>,rate:f32,dt:f32)->BattleGoal {
  let rawSeat=battleRandom(s.identity.w);let width=squad.offset.w;
  let seat=unit(rawSeat)*(.25+.75*f32(battleHash(s.identity.w+917u)&1023u)/1023.0);
  let tangent=unit(squad.velocity.xyz);let side=visualSide(tangent,vec3<f32>(1.0,0.0,0.0));let up=cross(tangent,side);
  let spread=width*.25*p.motion.z;
  let offsetSeat=(side*seat.x+up*seat.y*p.shape.y+tangent*seat.z*(1.5-p.shape.z))*(spread*.35);
  let noise=battleShipNoise(s.identity.w,clock,rate,p.shipNoise.z,dt);
  let amplitude=width*.40*p.shipNoise.x*p.shipNoise.w;
  return BattleGoal(squad.offset.xyz+offsetSeat+noise.p*amplitude,squad.velocity.xyz+noise.v*amplitude);
}
fn visualBattleStep(s:Ship,dt:f32)->Ship {
  let fleet=s.identity.y;let b=director.battleOrders[fleet];let kind=classIndex(shipType(s));
  let p=director.battleProfiles[kind];let range=b.classes[kind];let count=battleSquadCount(p,range.y);
  let ordinal=sceneOrdinal(s.identity.x);let squad=director.battleSquads[fleet*96u+kind*16u+((ordinal-range.x)%count)];
  if(squad.lifetime!=b.own.x){return s;}
  var clock=s.memory.xy;
  if(s.memory.z!=-4.0||s.memory.w!=f32(b.own.y)){clock=vec2<f32>(f32(battleHash(s.identity.w)&1023u)/1024.0,0.0);}
  let rate=(.85+f32(s.identity.w&255u)/850.0)/max(10.0,p.shipNoise.y);
  clock=battleNoiseClock(clock,rate);
  let goal=battleShipGoal(s,p,squad,clock,rate,dt);
  var result=visualTrack(s,visualPoint(b.center.xyz,goal.p),goal.v,p.motion.w,dt);
  result.memory=vec4<f32>(clock,-4.0,f32(b.own.y));
  return result;
}
`;
