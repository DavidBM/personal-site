/** Squad-only helpers. Default friendly guides run heavy-to-light in one fleet
 * invocation; arbitrary editor attachments use previous physical snapshots. */
export const BATTLE_COORDINATION_WGSL=/* wgsl */`
struct BattleSupport { anchor:BattleSquad, kind:u32, action:u32 }
const BATTLE_CRUISE:u32=1u;
const BATTLE_GUARD:u32=2u;
const BATTLE_ESCORT:u32=3u;
const BATTLE_STRIKE:u32=4u;
const BATTLE_PURSUIT:u32=5u;
const BATTLE_EVADE:u32=6u;
const BATTLE_ORBIT:u32=7u;
const BATTLE_PASS:u32=8u;
const BATTLE_PINCER:u32=9u;
const BATTLE_REGROUP:u32=10u;
const BATTLE_FRIENDLY_ORBIT:u32=11u;
fn battlePhaseStrategy(phase:u32)->u32 {
  switch phase {
    case 0u:{return BATTLE_PINCER;}
    case 1u:{return BATTLE_PASS;}
    case 2u:{return BATTLE_PURSUIT;}
    case 3u:{return BATTLE_EVADE;}
    case 5u:{return BATTLE_REGROUP;}
    default:{return BATTLE_ORBIT;}
  }
}
fn battleStrategy(b:VisualBattle,kind:u32,k:u32)->u32 {
  let chosen=director.battleStrategies[kind*4u+k/4u][k%4u];
  if(chosen>0u){return chosen;}
  if(kind>=4u){return BATTLE_CRUISE;}
  if(b.reserve.w!=1u){return battlePhaseStrategy(b.own.w);}
  if(kind==2u){return BATTLE_STRIKE;}
  if(kind==1u&&(k&1u)==1u){return BATTLE_ESCORT;}
  return BATTLE_GUARD;
}
fn battleUsesAnchor(strategy:u32)->bool {
  return strategy==BATTLE_GUARD||strategy==BATTLE_ESCORT||strategy==BATTLE_STRIKE||strategy==BATTLE_FRIENDLY_ORBIT;
}
fn battleUsesEnemy(strategy:u32)->bool {
  return strategy!=BATTLE_CRUISE&&strategy!=BATTLE_REGROUP&&strategy!=BATTLE_FRIENDLY_ORBIT;
}
// Action lives in the previously unused guide velocity.w: patrol, intercept,
// return. Nothing is added to per-ship storage or the guide allocation.
const BATTLE_PATROL:u32=0u;
const BATTLE_INTERCEPT:u32=1u;
const BATTLE_RETURN:u32=2u;

fn battleAnchorClass(b:VisualBattle,kind:u32,k:u32)->u32 {
  if(b.classes[5].y>0u&&(b.classes[4].y==0u||((k>>1u)&1u)==0u)){return 5u;}
  if(b.classes[4].y>0u){return 4u;}
  if(kind<3u&&b.classes[3].y>0u){return 3u;}
  if(kind<2u&&b.classes[2].y>0u){return 2u;}
  return 6u;
}
// Explicit lower/same-class attachments read the previous physical snapshot,
// not in-place guides. This makes arbitrary editor combinations race-free.
fn battleFriendlyAnchor(b:VisualBattle,fleet:u32,kind:u32,k:u32,anchorKind:u32)->BattleSquad {
  var anchor:BattleSquad;
  if(anchorKind>=6u){return anchor;}
  let range=b.classes[anchorKind];if(range.y==0u){return anchor;}
  let count=battleSquadCount(director.battleProfiles[anchorKind],range.y);
  if(anchorKind>kind){
    anchor=director.battleSquads[fleet*96u+anchorKind*16u+k%count];
    if(anchor.lifetime!=b.own.x){anchor.lifetime=0u;}
    return anchor;
  }
  let ordinal=range.x+(k+1u)%min(count,max(1u,range.z));
  let form=director.forms[fleet];let index=form.head.z+ordinal;
  if(ordinal>=form.head.w||index>=u32(u.clock.z)){return anchor;}
  let ship=old[index];
  if(!admitted(ship)||ship.identity.y!=fleet||ship.identity.w!=b.own.x+ordinal||inWarp(ship,u.clock.x)){return anchor;}
  anchor.offset=vec4<f32>(visualDelta(ship,visualPoint(b.center.xyz,vec3<f32>(0.0))),0.0);
  anchor.velocity=vec4<f32>(ship.v.xyz,0.0);anchor.lifetime=b.own.x;return anchor;
}
fn battleSupportClass(b:VisualBattle,p:BattleProfile,kind:u32,k:u32,strategy:u32)->u32 {
  let chosen=u32(p.attack.y);
  if(chosen>0u&&b.classes[chosen-1u].y>0u){return chosen-1u;}
  if(strategy==BATTLE_ESCORT&&b.classes[2].y>0u){return 2u;}
  return battleAnchorClass(b,kind,k);
}
fn battleEscortAction(previous:u32,phase:f32,homeGap2:f32,threatGap2:f32,r:f32,enemyValid:bool)->u32 {
  // Return is latched until well inside the leash. Different entry/exit
  // thresholds prevent an escort chattering between pursuit and recovery.
  if(previous==BATTLE_RETURN&&homeGap2>r*r*.20*.20){return BATTLE_RETURN;}
  if(homeGap2>r*r*.42*.42){return BATTLE_RETURN;}
  let window=phase>=.42&&phase<.70;
  if(previous==BATTLE_INTERCEPT){
    if(!window||!enemyValid||threatGap2>r*r*.70*.70){return BATTLE_RETURN;}
    return BATTLE_INTERCEPT;
  }
  if(window&&enemyValid&&threatGap2<r*r*.55*.55){return BATTLE_INTERCEPT;}
  return BATTLE_PATROL;
}
fn battleSupport(b:VisualBattle,fleet:u32,kind:u32,k:u32,phase:f32,previous:BattleSquad,enemy:Ship,strategy:u32)->BattleSupport {
  var support:BattleSupport;support.kind=6u;
  if(!battleUsesAnchor(strategy)){return support;}
  support.kind=battleSupportClass(b,director.battleProfiles[kind],kind,k,strategy);
  support.anchor=battleFriendlyAnchor(b,fleet,kind,k,support.kind);
  if(strategy==BATTLE_STRIKE){
    support.action=select(BATTLE_INTERCEPT,BATTLE_RETURN,phase>=.65);
    return support;
  }
  if(support.anchor.lifetime==0u||strategy==BATTLE_FRIENDLY_ORBIT){return support;}
  let home=previous.offset.xyz-support.anchor.offset.xyz;
  let threat=visualDelta(enemy,visualPoint(b.center.xyz,support.anchor.offset.xyz));
  support.action=battleEscortAction(u32(previous.velocity.w),phase,dot(home,home),dot(threat,threat),b.center.w,enemy.identity.z>0u);
  return support;
}

fn battleStrikeGoal(b:VisualBattle,p:BattleProfile,support:BattleSupport,enemy:BattleGoal,wave:BattleGoal,side:vec3<f32>,up:vec3<f32>,cs:f32,sn:f32,omega:f32,enemyValid:bool)->BattleGoal {
  let r=b.center.w;
  var home=BattleGoal(b.axis.xyz*(b.axis.w*r*.25),vec3<f32>(0.0));
  if(support.anchor.lifetime>0u){home=BattleGoal(support.anchor.offset.xyz,support.anchor.velocity.xyz);}
  // Approach alongside the protected group, pass the target, and curl back.
  // Endpoint lateral velocity stays nonzero, so a bomber never parks at a beat.
  home.p+=side*r*.12;
  if(!enemyValid){return BattleGoal(home.p+wave.p*r*.12,home.v+wave.v*r*.12);}
  let weight=.5-.5*cs;let derivative=.5*sn*omega;
  let span=r*(.10+.14*p.shape.w);
  let offset=side*(sn*span*p.attack.x)+up*(2.0*sn*cs*r*.12*p.shape.y);
  let velocity=(side*(cs*span*p.attack.x)+up*((cs*cs-sn*sn)*r*.24*p.shape.y))*omega;
  return BattleGoal(mix(home.p,enemy.p,weight)+offset,
    mix(home.v,enemy.v,weight)+(enemy.p-home.p)*derivative+velocity);
}
fn battleEscortGoal(b:VisualBattle,kind:u32,support:BattleSupport,enemy:BattleGoal,wave:BattleGoal)->BattleGoal {
  let r=b.center.w;let home=BattleGoal(support.anchor.offset.xyz,support.anchor.velocity.xyz);
  var radius=r*.14;
  if(kind==0u){radius=r*.19;}
  if(kind==3u){radius=r*.10;}
  if(support.action==BATTLE_RETURN){radius=r*.09;}
  if(support.action==BATTLE_INTERCEPT){
    // Attack only as far as the protected squad's leash. Enemy selection is
    // cached/assigned, never a nearest-ship search. A short pass keeps it moving.
    let delta=enemy.p-home.p;let gap=length(delta);let leash=r*.32;
    let blend=min(1.0,leash/max(gap,.00001));
    return BattleGoal(home.p+delta*blend+wave.p*r*.07,mix(home.v,enemy.v,blend)+wave.v*r*.07);
  }
  return BattleGoal(home.p+wave.p*radius,home.v+wave.v*radius);
}
`;
