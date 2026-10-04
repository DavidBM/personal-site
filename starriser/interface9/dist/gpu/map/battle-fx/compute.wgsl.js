import { FX_SHARED } from './shared.wgsl.js';
import { SCENE_CAMERA_WGSL } from '../../scene-camera.js';
export const FX_COMPUTE = /*wgsl*/ `${FX_SHARED}${SCENE_CAMERA_WGSL}
fn unit(v:vec3<f32>)->vec3<f32>{return v*inverseSqrt(max(dot(v,v),1e-12));}
fn profile(k:u32,i:u32)->vec4<f32>{return u.profiles[min(k,5u)*8u+i];}
@group(0) @binding(1) var<storage,read> sources:array<vec4<u32>>;
@group(0) @binding(2) var<storage,read> sims:array<vec4<u32>>;
@group(0) @binding(3) var<storage,read_write> fx:array<Effect>;
@group(0) @binding(4) var<storage,read_write> args:array<atomic<u32>>;
@group(0) @binding(5) var<storage,read_write> visible:array<vec2<u32>>;
@group(0) @binding(6) var<storage,read_write> history:array<vec4<f32>>;
struct Pose { anchor:vec3<f32>, p:vec3<f32>, forward:vec3<f32>, radius:f32, velocity:vec3<f32>, serial:u32, kind:u32, valid:u32 }
fn source(slot:u32,row:u32)->vec4<u32>{return sources[32u+min(slot,127u)*13u+row];}
fn pose(slot:u32,serial:u32)->Pose{
 var p:Pose;if(slot>=128u){return p;}let own=source(slot,0u);let range=source(slot,12u);
 if(own.x==0u||serial<own.x||serial-own.x>=range.y){return p;}
 let i=range.x+serial-own.x;if(i>=arrayLength(&sims)/22u){return p;}
 let a=sims[i*22u+4u];let b=sims[i*22u+5u];
 if(b.w!=serial||sims[i*22u+3u].z==0u){return p;}
 let q=bitcast<vec4<f32>>(sims[i*22u+1u]);let f=vec3<f32>(0,0,1);
 p.anchor=bitcast<vec3<f32>>(vec3<u32>(a.y,b.y,b.z));p.p=bitcast<vec3<f32>>(vec3<u32>(a.z,a.w,b.x));
 p.forward=f+2.0*cross(q.xyz,cross(q.xyz,f)+q.w*f);p.radius=max(.001,f32(a.x>>16u)*.0004);
 p.velocity=p.forward*bitcast<f32>(sims[i*22u].w)*560.0;
 p.serial=serial;p.kind=a.x&7u;p.valid=1u;return p;
}
fn assignedTarget(slot:u32,seed:u32,kind:u32)->vec2<u32>{
 let other=source(slot,1u);if(other.x>=128u){return vec2<u32>(0,128);}
 let order=source(other.x,0u);if(order.x!=other.y||order.y!=source(slot,0u).y){return vec2<u32>(0,128);}
 var start=other.z;var count=other.w;
 let bomber=source(slot,5u);if(kind==2u&&bomber.y>0u){start=bomber.x;count=bomber.y;}
 return vec2<u32>(other.y+start+seed%max(count,1u),other.x);
}
// Weapon palette: warm gunfire/exhaust and restrained cool laser cores.
fn tint(kind:u32)->vec3<f32>{return select(vec3<f32>(1,.76,.45),vec3<f32>(.65,.82,1),kind==2u);}
fn effectClass(e:Effect)->u32{return u32(e.extra.x)&7u;}
fn mount(p:Pose,index:u32,spacing:f32)->vec3<f32>{
 let axis=select(vec3<f32>(0,1,0),vec3<f32>(1,0,0),abs(p.forward.y)>.9);
 let side=unit(cross(axis,p.forward));let up=cross(p.forward,side);
 // Stable staggered proxy hardpoints. Never tied to the reused pool slot.
 let h=hash(index+71u);let lateral=vec2<f32>(f32(h&255u),f32((h>>8u)&255u))/127.5-1.0;
 return p.p+(p.forward*.65+(side*lateral.x*.6+up*lateral.y*.3)*spacing)*p.radius;
}
fn projected(p:vec3<f32>,anchor:vec3<f32>)->vec4<f32>{
 let rel=(anchor-sceneCamera.cameraHigh.xyz)/560.0+(p/560.0-sceneCamera.cameraLow.xyz);
 return sceneCamera.relativeViewProj*vec4<f32>(rel,1);
}
fn available(id:u32)->bool{return fx[id].head.w<=0.0||age(fx[id].anchor.w)>fx[id].head.w;}
fn shot(i:u32,slot:u32,p:Pose,seed:u32,mountId:u32)->Effect{
 var e:Effect;let serial=p.serial;let kind=p.kind;
 let targetId=assignedTarget(slot,seed,kind);let t=pose(targetId.y,targetId.x);if(t.valid==0u){return e;}
 let travel=profile(kind,1u);let weapon=profile(kind,2u);let look=profile(kind,3u);let range=profile(kind,4u);if(look.y<=0.0){return e;}
 let delta=(t.anchor-p.anchor)+(t.p-p.p);let d=unit(delta);
 // Forward batteries fire only during an attack pass; capital hardpoints swivel.
 if(i==0u&&kind<2u&&dot(p.forward,d)<.65){return e;}
 let clip=projected(p.p,p.anchor);if(clip.w<=0.0||any(abs(clip.xy)>vec2<f32>(clip.w*1.2))){return e;}
 e.anchor=vec4<f32>(p.anchor,u.clock.x);e.head=vec4<f32>(mount(p,mountId,range.y),travel.y);
 e.motion=vec4<f32>(d,travel.z);e.color=vec4<f32>(tint(i)*look.y,f32(i));
 e.owner=vec4<u32>(serial,slot,targetId.x,targetId.y);e.extra=vec4<f32>(f32(kind+mountId*8u),p.radius,0,0);
 let radius=max(.1,bitcast<f32>(source(slot,2u).w));
 if(i==0u){
  let velocity=unit(select(d,p.forward,kind<2u)+direction(seed)*.008)*radius*3.0*travel.x+p.velocity;
  e.motion=vec4<f32>(velocity,max(.003,p.radius*.04)*travel.z);
  e.head.w=min(travel.y,radius*look.z/max(length(velocity),.001));
 }
 if(i==1u){e.head.w=look.w;e.motion=vec4<f32>(p.forward*radius*weapon.y+p.velocity,max(.007,p.radius*.04)*travel.z);}
 if(i==2u){e.head.w=weapon.w;e.motion=vec4<f32>(delta+p.p-d*t.radius-e.head.xyz,max(.004,p.radius*.04)*look.x);}
 return e;
}
fn emitter(id:u32)->vec2<u32>{
 if(u.limits.x==0u){return vec2<u32>(128,0);}
 if(id==0u&&u.selected.x<128u&&source(u.selected.x,0u).y!=0u&&source(u.selected.x,5u).z==1u){return u.selected.xy;}
 let activeIndex=id%u.limits.x;let slot=sources[activeIndex/4u][activeIndex%4u];let info=source(slot,0u);let range=source(slot,12u);
 if(id/u.limits.x>=range.y){return vec2<u32>(128,0);}
 let ordinal=id/u.limits.x;let quota=min(range.y,(u.counts.x+u.limits.x-1u)/u.limits.x);
 let serial=info.x+(ordinal*range.y/quota+hash(slot*31u))%range.y;
 return vec2<u32>(slot,serial);
}
fn crossed(period:f32,phase:f32)->bool{
 // Suppress catch-up bursts. At most one birth per slot and displayed update.
 let t=age(0.0)+phase;return floor(t/period)!=floor((t-u.clock.y)/period);
}
@compute @workgroup_size(64) fn emit(@builtin(global_invocation_id) tid:vec3<u32>){
 let id=tid.x;if(id==0u){atomicStore(&args[0],6u);atomicStore(&args[4],6u);atomicStore(&args[8],3u);}
 if(u.clock.y<=0.0||id>=u.counts.x){return;}
 let emission=emitter(id);if(emission.x>=128u){return;}let p=pose(emission.x,emission.y);if(p.valid==0u){return;}
 let seed=hash(p.serial);let a=profile(p.kind,0u);let count=u32(a.x);
 let page=u.counts.y/u.counts.x;let slots=max(1u,page/max(count,1u));
 for(var gun=0u;gun<count;gun++){
  let phase=random(seed+gun*23u+1u);let cycle=u32(floor((u.clock.x+phase)*a.w));
  let at=id*page+gun*slots+cycle%slots;
  if(crossed(1.0/a.w,phase)&&available(at)){fx[at]=shot(0u,emission.x,p,seed+gun*31u+cycle,gun);}
 }
}
// Fixed mount pages keep cost bounded. Small fights can display every mount;
// dense fights sample mounts/ships within the same global effect budget.
fn launchBeam(id:u32)->Effect{
 var e:Effect;let emission=emitter(id%u.counts.x);if(emission.x>=128u){return e;}
 let p=pose(emission.x,emission.y);if(p.valid==0u){return e;}
 let mountId=id/u.counts.x;let a=profile(p.kind,0u);if(mountId>=u32(a.z)){return e;}
 let period=profile(p.kind,2u).w+profile(p.kind,4u).x;let seed=hash(p.serial+mountId*31u);
 if(crossed(period,random(seed)*period)){e=shot(2u,emission.x,p,seed,mountId);}return e;
}
fn launchMissile(id:u32)->Effect{
 var e:Effect;let launcher=id/20u;let emission=emitter(launcher%u.counts.x);if(emission.x>=128u){return e;}
 let p=pose(emission.x,emission.y);if(p.valid==0u){return e;}
 let mountId=launcher/u.counts.x;let a=profile(p.kind,0u);let b=profile(p.kind,1u);let c=profile(p.kind,2u);
 if(mountId>=u32(a.y)||id%20u>=u32(b.w)){return e;}
 let seed=hash(p.serial+mountId*31u);let period=c.x+1.5;let phase=random(seed+6u)*period-f32(id%20u)*.065;
 if(crossed(period,phase)){e=shot(1u,emission.x,p,seed+id,mountId);}return e;
}
fn impact(e:Effect,p:vec3<f32>){
 let kind=effectClass(e);let laser=u32(e.color.w)==2u;
 let a=profile(kind,4u);let b=profile(kind,5u);let c=profile(kind,6u);let d=profile(kind,7u);
 let size=select(c.z,a.w,laser);let life=select(c.w,b.x,laser);
 let brightness=select(d.x,b.y,laser)*profile(kind,3u).y;
 if(size<=0.0||brightness<=0.0){return;}
 // Drop disabled/thinned impacts before touching the bounded GPU request queue.
 if(!laser&&(c.y<=0.0||(c.y<1.0&&random(e.owner.x+bitcast<u32>(e.anchor.w)+u32(e.extra.x))>=c.y))){return;}
 let slot=atomicAdd(&args[12],1u);if(slot>=u.limits.y){return;}
 let at=u.offsets.w+slot;var burst=e;burst.anchor.w=u.clock.x;burst.head=vec4<f32>(p,life);
 // Snapshot counts at birth. Draw-list construction omits disabled layers entirely.
 burst.motion=vec4<f32>(select(d.y,b.z,laser),select(d.z,b.w,laser),0,0);
 burst.color=vec4<f32>(vec3<f32>(1,.65,.28)*brightness,3);
 burst.extra=vec4<f32>(f32(atomicAdd(&args[13],1u)%u.limits.y),max(.04,e.extra.y*2.0)*size,e.color.w,select(d.w,c.x,laser));fx[at]=burst;
}
fn advanceTorpedo(id:u32){
  let at=u.offsets.x+id;var e=fx[at];
  if(available(at)){e=launchMissile(id);if(e.head.w>0.0){for(var j=0u;j<4u;j++){history[id*4u+j]=vec4<f32>(e.head.xyz,0);}}}
  if(e.head.w<=0.0){fx[at]=e;return;}
  let t=pose(e.owner.w,e.owner.z);let dt=min(u.clock.y,age(e.anchor.w));let k=effectClass(e);
  let speed=max(.1,bitcast<f32>(source(e.owner.y,2u).w))*profile(k,2u).y;
  if(t.valid!=0u){
    let goal=(t.anchor-e.anchor.xyz)+t.p;let delta=goal-e.head.xyz;let distance=length(delta);
    let radius=max(t.radius,.015)+e.motion.w;
    // Home in the target's relative frame. No permanent lead point to orbit.
    // Turning tightens as time-to-contact falls; a proximity fuse finishes the
    // approach instead of damping toward a tiny hull indefinitely.
    let response=profile(k,2u).z+2.0*speed/max(distance,radius);
    let wanted=t.velocity+delta*(speed/max(distance,.001));
    e.motion=vec4<f32>(mix(e.motion.xyz,wanted,min(1.0,dt*response)),e.motion.w);
    let travel=(e.motion.xyz-t.velocity)*dt;let before=delta-t.velocity*dt;
    let along=clamp(dot(before,travel)/max(dot(travel,travel),1e-9),0.0,1.0);
    let near=before-travel*along;
    if(dot(near,near)<radius*radius){impact(e,goal-unit(delta)*t.radius);e.head.w=0.0;}
  }
  if(crossed(.06,0.0)){for(var j=3u;j>0u;j--){history[id*4u+j]=history[id*4u+j-1u];}history[id*4u]=vec4<f32>(e.head.xyz,0);}
  e.head=vec4<f32>(e.head.xyz+e.motion.xyz*dt,e.head.w);fx[at]=e;
}
@compute @workgroup_size(64) fn advance(@builtin(global_invocation_id) tid:vec3<u32>){
 let id=tid.x;if(id<u.counts.z){advanceTorpedo(id);}
 if(id<u.counts.w){let at=u.offsets.y+id;var e=fx[at];if(available(at)){e=launchBeam(id);}if(e.head.w<=0.0){fx[at]=e;return;}
  let a=pose(e.owner.y,e.owner.x);let b=pose(e.owner.w,e.owner.z);
  if(a.valid==0u||b.valid==0u){e.head.w=0.0;}else{
    e.anchor=vec4<f32>(a.anchor,e.anchor.w);e.head=vec4<f32>(mount(a,u32(e.extra.x)>>3u,profile(effectClass(e),4u).y),e.head.w);
    let delta=(b.anchor-a.anchor)+b.p-e.head.xyz;e.motion=vec4<f32>(delta-unit(delta)*b.radius,e.motion.w);
    let rate=profile(effectClass(e),4u).z;
    if(rate>0.0&&crossed(1.0/max(rate,.001),random(e.owner.x+u32(e.extra.x)))){impact(e,e.head.xyz+e.motion.xyz);}
  }fx[at]=e;
 }
}
fn append(id:u32,part:u32){let i=atomicAdd(&args[1],1u);if(i<u.limits.z){visible[i]=vec2<u32>(id,part);}}
fn ownerAlive(e:Effect)->bool{
 if(e.owner.y>=128u){return false;}let base=source(e.owner.y,0u).x;
 return base>0u&&e.owner.x>=base&&e.owner.x-base<source(e.owner.y,12u).y;
}
fn show(id:u32){
 let e=fx[id];if(e.head.w<=0.0){return;}
 if(age(e.anchor.w)>e.head.w||!ownerAlive(e)){fx[id].head.w=0.0;return;}
 var p=e.head.xyz;if(id<u.offsets.x){p+=e.motion.xyz*age(e.anchor.w);}
 let clip=projected(p,e.anchor.xyz);let beam=id>=u.offsets.y&&id<u.offsets.z;
 if(clip.w<=0.0&&!beam){return;}
 if(id<u.offsets.y&&any(abs(clip.xy)>vec2<f32>(clip.w*1.3))){return;}
 if(id>=u.offsets.z){
   let t=age(e.anchor.w)*1.8/e.head.w;if(t<.15){append(id,0u);}
   if(t<.7){for(var j=1u;j<=u32(e.motion.x);j++){append(id,j);}}
   for(var j=0u;j<u32(e.motion.y);j++){append(id,5u+j);}
 }else if(id>=u.offsets.x&&id<u.offsets.y){for(var j=0u;j<5u;j++){append(id,j);}}
 else{append(id,0u);if(id<u.offsets.x&&age(e.anchor.w)<.04){append(id,1u);}}
 atomicOr(&args[9],1u);
}
@compute @workgroup_size(64) fn prepare(@builtin(global_invocation_id) tid:vec3<u32>){
 let id=tid.x;
 // Fixed impact slots share lifetime with a bounded request queue. Existing bursts
 // finish before replacement; queue overflow drops cosmetic bursts only.
 if(id<u.limits.y){let request=fx[u.offsets.w+id];let at=u.offsets.z+u32(request.extra.x);
   if(id<min(atomicLoad(&args[12]),u.limits.y)&&available(at)){fx[at]=request;}
 }
 if(id<u.offsets.z){show(id);}
}
// Separate dispatch: explosion writes are visible before draw lists/lens selection.
@compute @workgroup_size(64) fn bursts(@builtin(global_invocation_id) tid:vec3<u32>){
 let id=tid.x;if(id<u.limits.y){show(u.offsets.z+id);}
 if(id>=u.selected.z){return;}
 var best=0xffffffffu;var score=0.0;
 for(var j=id;j<u.limits.y;j+=u.selected.z){let e=fx[u.offsets.z+j];let a=age(e.anchor.w)*1.8/max(e.head.w,.001);
   if(e.head.w>0.0&&a<.8&&e.extra.w>0.0&&ownerAlive(e)){let p=projected(e.head.xyz,e.anchor.xyz);
    if(p.w>0.0&&all(abs(p.xy)<vec2<f32>(p.w))){let s=(.8-a)*e.extra.y;if(s>score){score=s;best=u.offsets.z+j;}}
   }
 }
 visible[u.limits.z+id]=vec2<u32>(best,0);if(id==0u){atomicStore(&args[5],u.selected.z*3u);}
}
`;
//# sourceMappingURL=compute.wgsl.js.map