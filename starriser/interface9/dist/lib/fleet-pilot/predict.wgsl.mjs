import {COMMON} from './common.wgsl.mjs';
export const PREDICT=COMMON+/*wgsl*/`
struct Threats {ids:array<u32,8>,count:u32,scanned:u32}
// Both discovery and retained threats are bounded. Overflow is observable;
// this deliberately does not make a collision-free claim.
fn threatsFor(index:u32,horizon:f32,period:u32)->Threats {
  let s=old[index];var result:Threats;let here=cell(s.p.xyz);
  let range=select(1,0,period>=15u);
  for(var z=-range;z<=range;z++) {for(var y=-range;y<=range;y++){for(var x=-range;x<=range;x++){
    let location=here+vec3<i32>(x,y,z);let bucket=hashCell(location);
    let count=min(atomicLoad(&grid.counts[bucket]),SLOTS);
    for(var slot=0u;slot<count;slot++){
      if(result.scanned>=256u){atomicAdd(&stats.values[5],1u);return result;}result.scanned++;
      let other=grid.slots[bucket*SLOTS+slot];if(other==index){continue;}
      let t=old[other];if(any(cell(t.p.xyz)!=location)){continue;}
      let gap=t.p.xyz-s.p.xyz;let velocity=t.v.xyz-s.v.xyz;
      let time=clamp(-dot(gap,velocity)/max(dot(velocity,velocity),.00001),0.0,horizon);
      let radius=(s.p.w+t.p.w)*1.15;
      if(length(gap+velocity*time)<radius){
        if(result.count<8u){result.ids[result.count]=other;result.count++;}
        else{atomicAdd(&stats.values[6],1u);}
      }
    }
  }}}
  return result;
}
fn candidateCost(s:Ship,velocity:vec3<f32>,desired:vec3<f32>,threats:Threats,horizon:f32)->f32{
  var cost=dot(velocity-desired,velocity-desired)/max(dot(desired,desired),.01);
  let limits=LIMITS[s.identity.x];let forward=rotate(s.q,vec3<f32>(0.0,0.0,1.0));
  let wanted=unit(velocity);let axis=unit(cross(forward,wanted));
  let angle=atan2(length(cross(forward,wanted)),clamp(dot(forward,wanted),-1.0,1.0));
  let speed=length(s.v.xyz);var before=vec3<f32>(0.0);
  // Four bounded forward arcs approximate reachable motion, including finite
  // thrust and angular acceleration. Neighbours use constant-velocity advice;
  // this is a heuristic predictor, not an ORCA or collision-free solver.
  for(var sample=1u;sample<=4u;sample++){
    let time=horizon*f32(sample)*.25;let previousTime=horizon*f32(sample-1u)*.25;
    let turn=min(angle,limits.w*max(0.0,time-.125));
    let middle=forward*cos(turn*.5)+cross(axis,forward)*sin(turn*.5);
    let nextSpeed=speed+clamp(length(velocity)-speed,-limits.y*time,limits.y*time);
    let position=middle*((speed+nextSpeed)*.5*time);
    for(var j=0u;j<threats.count;j++){
      let other=old[threats.ids[j]];let gap=other.p.xyz-s.p.xyz;
      let begin=gap+other.v.xyz*previousTime-before;
      let end=gap+other.v.xyz*time-position;let segment=end-begin;
      let along=clamp(-dot(begin,segment)/max(dot(segment,segment),.00001),0.0,1.0);
      let clearance=length(begin+segment*along)/max(s.p.w+other.p.w,.01);
      cost+=12.0*max(0.0,1.15-clearance)/(1.0+time);
    }
    before=position;
  }
  return cost;
}
fn avoidance(index:u32,desired:vec3<f32>,period:u32)->vec3<f32>{
  if(u.settings.w<.5){return desired;}
  let s=old[index];let limits=LIMITS[s.identity.x];
  let horizon=clamp(2.0+length(s.v.xyz)/limits.y,2.0,8.0);
  let threats=threatsFor(index,horizon,period);
  atomicAdd(&stats.values[1],threats.scanned);atomicAdd(&stats.values[2],threats.count);
  if(threats.count==0u){return desired;}
  let forward=unit(desired);let right=unit(cross(vec3<f32>(0.0,1.0,0.0),forward));
  let turn=clamp(limits.w*horizon,.02,.65);
  var best=desired;var score=candidateCost(s,best,desired,threats,horizon);
  // A common handedness breaks symmetric head-on deadlocks. Velocity changes
  // are proposals only: the physical stage still owns angular/thrust limits.
  for(var k=0u;k<5u;k++){
    let angle=select(turn,-turn,k==1u||k==3u);
    let speed=length(desired)*select(1.0,.7,k>=2u);
    var velocity=(forward*cos(angle)+right*sin(angle))*speed;
    if(k==4u){velocity=forward*length(desired)*.35;}
    let bias=select(0.0,.002,k==1u||k==3u);
    let cost=candidateCost(s,velocity,desired,threats,horizon)+bias;
    if(cost<score){score=cost;best=velocity;}
  }
  return best;
}
fn advice(index:u32,urgent:bool){
  if(index>=u32(u.clock.z)){return;}
  let tick=u32(u.clock.w);let s=old[index];let f=fleets[s.identity.y];
  let period=pilotPeriod(s,index);let previous=intents[page(tick+1u,index)];
  let valid=previous.state.x==s.identity.w&&previous.state.y==f.info.z;
  let promoted=period<previous.state.w;
  if(urgent&&valid&&!promoted){return;}
  if(valid&&!promoted&&previous.state.z==tick){intents[page(tick,index)]=previous;return;}
  if(valid&&!promoted&&tick-previous.state.z<period&&(tick+s.identity.w)%period!=0u){intents[page(tick,index)]=previous;return;}
  let home=homes[index].xyz;let limits=LIMITS[s.identity.x];
  let anchor=f.position.xyz+home;let error=anchor-s.p.xyz;
  let forward=unit(f.velocity.xyz);let along=dot(error,forward);
  let speed=clamp(length(f.velocity.xyz)+along/8.0,0.0,limits.x);
  // Intercept a future moving home, instead of first returning perpendicular
  // to a route. Deadband tolerates small slot errors; no fleet-wide throttle.
  let lead=clamp(length(s.v.xyz)/max(limits.w, .001)*.2,2.0,12.0);
  var future=anchor+f.velocity.xyz*lead;
  if(f.info.w==1u){
    let phase=f.velocity.w+f.config.x/f.path.w*lead;
    future=f.path.xyz+vec3<f32>(cos(phase)*f.path.w,0.0,sin(phase)*f.path.w)+home;
  }
  let lateral=error-forward*along;
  future-=capped(lateral,.2); // soft positional tolerance, not pose correction
  // An ahead-of-group ship yields speed while keeping a forward intercept.
  // Its moving home passing behind must never request a U-turn back to a slot.
  let reach=max(length(f.velocity.xyz)*lead,s.p.w*4.0);
  future+=forward*max(0.0,reach-dot(future-s.p.xyz,forward));
  let original=unit(future-s.p.xyz)*speed;
  let chosen=avoidance(index,original,period);
  let aimPoint=s.p.xyz+unit(chosen)*max(length(future-s.p.xyz),s.p.w*4.0);
  var result:Intent;
  result.aimPoint=vec4<f32>(aimPoint,length(chosen));
  result.motion=vec4<f32>(f.velocity.xyz,u.clock.x);
  result.state=vec4<u32>(s.identity.w,f.info.z,tick,period);
  result.avoid=vec4<f32>(chosen-original,f32(promoted));
  intents[page(select(tick,tick+1u,urgent),index)]=result;atomicAdd(&stats.values[0],1u);
  if(promoted){atomicAdd(&stats.values[4],1u);}
}
@compute @workgroup_size(128) fn predict(@builtin(global_invocation_id) id:vec3<u32>){advice(id.x,false);}
@compute @workgroup_size(128) fn refreshUrgent(@builtin(global_invocation_id) id:vec3<u32>){advice(id.x,true);}
`;
