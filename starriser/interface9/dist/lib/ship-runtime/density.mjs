
const densityAccess=scopes=>/* wgsl */`
${scopes?'':`fn pressureAffinity(a:u32,b:u32)->f32{return select(pressureMix(),1.0,a==b);}`}
${SPACING_WGSL}
const FIELD_COUNT:u32=${scopes?.fields??2}u;
fn densityFrame(field:u32)->vec4<f32>{return ${scopes?'director.pressure.frames[field]':'vec4<f32>(fieldOrigin(),FIELD_CELL)'};}
fn contributionWeight(fleet:u32,field:u32)->f32{return ${scopes?'director.pressure.weights[fleet*FIELD_COUNT+field]':'select(0.0,1.0,fleet==field)'};}
fn pressureFieldWeight(fleet:u32,field:u32)->f32{return ${scopes?'contributionWeight(fleet,field)':'select(pressureMix(),1.0,fleet==field)'};}
fn activeFieldCount()->u32{return ${scopes?'director.pressure.counts.x':'2u'};}
fn activeField(index:u32)->u32{return ${scopes?'director.pressure.occupied[index]':'index'};}

`;

import {SPACING_WGSL} from './spacing.mjs';
export const densitySimulation=(side=64,cellSize=4,scopes=null)=>/* wgsl */`
const FIELD_SIDE:u32=${side}u;
const FIELD_CELLS:u32=${side**3}u;
const FIELD_HALF:f32=${side*cellSize/2}.0;
const FIELD_CELL:f32=${cellSize}.0;
@group(0) @binding(5) var<storage,read_write> density:array<atomic<u32>>;
fn hash(value:u32)->u32 { var x=value;x=(x^(x>>16u))*0x7feb352du;x=(x^(x>>15u))*0x846ca68bu;return x^(x>>16u); }
fn variation(id:u32)->f32 { return f32(hash(id)&65535u)/65536.0; }
${densityAccess(scopes)}
fn gridPoint(p:vec3<f32>,field:u32)->vec3<f32> {let frame=densityFrame(field);return (p-frame.xyz)/frame.w+vec3<f32>(f32(FIELD_SIDE)*.5);}
fn cell(p:vec3<i32>,fleet:u32)->u32 { let c=vec3<u32>(clamp(p,vec3<i32>(0),vec3<i32>(i32(FIELD_SIDE)-1)));return fleet*FIELD_CELLS+c.x+FIELD_SIDE*c.y+FIELD_SIDE*FIELD_SIDE*c.z; }
@compute @workgroup_size(128) fn clearDensity(@builtin(global_invocation_id) gid:vec3<u32>) { if(gid.x<activeFieldCount()*FIELD_CELLS){let field=activeField(gid.x/FIELD_CELLS);atomicStore(&density[field*FIELD_CELLS+gid.x%FIELD_CELLS],0u);}
  if(gid.x<32768u){atomicStore(&heads[gid.x],0u);}
  clearSpatial(gid.x); }
fn depositDensity(p:vec3<f32>,fleet:u32,mass:f32) {
  let g=gridPoint(p,fleet);if(any(g<vec3<f32>(1.0))||any(g>vec3<f32>(f32(FIELD_SIDE)-2.01))){return;}
  let base=vec3<i32>(floor(g));let f=fract(g);
  for(var corner=0u;corner<8u;corner++) {
    let offset=vec3<i32>(i32(corner&1u),i32((corner>>1u)&1u),i32((corner>>2u)&1u));
    let weight=mix(vec3<f32>(1.0)-f,f,vec3<f32>(offset));
    atomicAdd(&density[cell(base+offset,fleet)],u32(weight.x*weight.y*weight.z*1024.0*mass));
  }
}
@compute @workgroup_size(128) fn buildDensity(@builtin(global_invocation_id) gid:vec3<u32>) {
  let i=gid.x;if(i>=u32(u.clock.z)){return;}
  let s=old[i];let typeId=shipType(s);
  if(!contributes(s)){return;}
  let bucket=contactBucket(contactCell(s.p.xyz));insertContact(i,s,bucket);
  if(classIndex(typeId)>=4u){return;}
  for(var field=0u;field<FIELD_COUNT;field++) {
    let weight=contributionWeight(s.identity.y,field);if(weight<=0.0){continue;}
    depositDensity(s.p.xyz,field,densityWeight(typeId)*weight);
  }
}
// One cooperative workgroup per capital; sample spacing <= cell width / sqrt(3)
// keeps the deposited volume connected under rotation. Integer quotas conserve total mass without accumulating
// thousands of per-sample truncation errors.
fn depositHull(p:vec3<f32>,fleet:u32,mass:u32) {
  let g=gridPoint(p,fleet);if(any(g<vec3<f32>(1.0))||any(g>vec3<f32>(f32(FIELD_SIDE)-2.01))){return;}
  let base=vec3<i32>(floor(g));let f=fract(g);var accumulated=0.0;var assigned=0u;
  for(var corner=0u;corner<8u;corner++) {
    let offset=vec3<i32>(i32(corner&1u),i32((corner>>1u)&1u),i32((corner>>2u)&1u));
    let weight=mix(vec3<f32>(1.0)-f,f,vec3<f32>(offset));
    accumulated+=weight.x*weight.y*weight.z;
    let upto=select(min(mass,u32(round(accumulated*f32(mass)))),mass,corner==7u);
    atomicAdd(&density[cell(base+offset,fleet)],upto-assigned);assigned=upto;
  }
}
@compute @workgroup_size(64) fn buildHullDensity(@builtin(workgroup_id) group:vec3<u32>,@builtin(local_invocation_index) lane:u32) {
  let index=hullSlot(group.x);if(index>=u32(u.clock.z)){return;}
  let s=old[index];if(!contributes(s)){return;}
  let typeId=shipType(s);let extent=dimensions(typeId).xyz;
  for(var field=0u;field<FIELD_COUNT;field++) {
  let weight=contributionWeight(s.identity.y,field);if(weight<=0.0){continue;}
  let counts=vec3<u32>(ceil(extent*2.0/(densityFrame(field).w/sqrt(3.0))));let total=counts.x*counts.y*counts.z;
  let mass=u32(densityWeight(typeId)*weight*1024.0);
  for(var sample=lane;sample<total;sample+=64u) {
    let cellId=vec3<u32>(sample%counts.x,(sample/counts.x)%counts.y,sample/(counts.x*counts.y));
    let offset=((vec3<f32>(cellId)+.5)/vec3<f32>(counts)*2.0-1.0)*extent;
    let quota=mass/total+select(0u,1u,sample<mass%total);
    depositHull(s.p.xyz+rotate(s.q,offset),field,quota);
  }
  }
}

fn sampleDensity(p:vec3<f32>,fleet:u32)->f32 {
  let g=gridPoint(p,fleet);if(any(g<vec3<f32>(1.0))||any(g>vec3<f32>(f32(FIELD_SIDE)-2.01))){return 0.0;}let base=vec3<i32>(floor(g));let f=fract(g);var sum=0.0;
  for(var corner=0u;corner<8u;corner++) {
    let offset=vec3<i32>(i32(corner&1u),i32((corner>>1u)&1u),i32((corner>>2u)&1u));
    let w=mix(vec3<f32>(1.0)-f,f,vec3<f32>(offset));
    let own=f32(atomicLoad(&density[cell(base+offset,fleet)]));
    sum+=w.x*w.y*w.z*own/1024.0;
  }
  return sum;
}
fn fieldPressure(p:vec3<f32>,field:u32)->vec3<f32> {
  let g=gridPoint(p,field);let edge=min(min(g.x,g.y),min(g.z,min((f32(FIELD_SIDE)-1.0)-g.x,min((f32(FIELD_SIDE)-1.0)-g.y,(f32(FIELD_SIDE)-1.0)-g.z))));
  if(edge<=2.0){return vec3<f32>(0.0);}
  let fade=smoothstep(2.0,4.0,edge);let size=densityFrame(field).w;
  let x=sampleDensity(p+vec3<f32>(size,0,0),field)-sampleDensity(p-vec3<f32>(size,0,0),field);
  let y=sampleDensity(p+vec3<f32>(0,size,0),field)-sampleDensity(p-vec3<f32>(0,size,0),field);
  let z=sampleDensity(p+vec3<f32>(0,0,size),field)-sampleDensity(p-vec3<f32>(0,0,size),field);
  return -vec3<f32>(x,y,z)*(0.44/size)*fade;
}
fn pressure(s:Ship)->vec3<f32> {
  if(pressureEnabled()==0.0){return vec3<f32>(0.0);}var force=vec3<f32>(0.0);
  for(var field=0u;field<FIELD_COUNT;field++) {
    let weight=pressureFieldWeight(s.identity.y,field);if(weight<=0.0){continue;}
    force+=fieldPressure(s.p.xyz,field)*weight;
  }
  return capped(force,2.0*sceneAdapt(journeyBodyRadius(s)))*pressureEnabled()/max(1.0,densityWeight(shipType(s)));
}
`;
export const densityDrawing=(side=64,cellSize=4,scopes=null)=>/* wgsl */`
const FIELD_SIDE:u32=${side}u;
const FIELD_CELLS:u32=${side**3}u;
const FIELD_HALF:f32=${side*cellSize/2}.0;
const FIELD_CELL:f32=${cellSize}.0;
@group(0) @binding(4) var<storage,read> densityView:array<u32>;
@vertex fn densityCell(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Vertex {
  var out:Vertex;out.clip=vec4<f32>(2,2,2,1);out.color=vec4<f32>(0);
  ${scopes?'if(director.pressure.counts.z==0u){return out;}':''}
  let fleet=${scopes?'director.pressure.counts.y':'u32(view.interpolation.z)'};
  let frame=${scopes?'director.pressure.frames[fleet]':'vec4<f32>(fieldViewOrigin(),FIELD_CELL)'};
  let mass=${scopes?'f32(densityView[fleet*FIELD_CELLS+instance])/1024.0':'(f32(densityView[fleet*FIELD_CELLS+instance])+view.interpolation.w*f32(densityView[(1u-fleet)*FIELD_CELLS+instance]))/1024.0'};
  if(mass<0.01){return out;}
  let corners=array<vec3<f32>,8>(vec3<f32>(-1,-1,-1),vec3<f32>(1,-1,-1),vec3<f32>(1,1,-1),vec3<f32>(-1,1,-1),vec3<f32>(-1,-1,1),vec3<f32>(1,-1,1),vec3<f32>(1,1,1),vec3<f32>(-1,1,1));
  let edges=array<u32,24>(0,1,1,2,2,3,3,0,4,5,5,6,6,7,7,4,0,4,1,5,2,6,3,7);
  let center=vec3<f32>(f32(instance%FIELD_SIDE),f32((instance/FIELD_SIDE)%FIELD_SIDE),f32(instance/(FIELD_SIDE*FIELD_SIDE)))*frame.w-vec3<f32>(f32(FIELD_SIDE)*.5*frame.w)+frame.xyz;
  let heat=clamp(log2(1.0+mass)/5.0,0.0,1.0);
  out.clip=project(center+corners[edges[vertex]]*frame.w*.46);
  let tint=mix(vec3<f32>(.05,.55,1.0),vec3<f32>(1.0,.2,.03),heat);
  let alpha=.08+.28*heat;out.color=vec4<f32>(tint*alpha,alpha);return out;
}
`;

export const DENSITY_SIM=densitySimulation();
export const DENSITY_DRAW=densityDrawing();
