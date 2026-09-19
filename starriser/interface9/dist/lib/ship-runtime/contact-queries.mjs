// Lanes prepare conservative contact masks in parallel. The
// integrator still evaluates and accumulates responses in their original order.
export const CONTACT_QUERY_WORDS=81;
export const QUERY_WORKGROUP_SIZE=128;
const QUERY_TILE_SHIPS=32;
export const queryWorkgroups=count=>Math.ceil(Math.ceil(count/QUERY_TILE_SHIPS)*QUERY_TILE_SHIPS*27/QUERY_WORKGROUP_SIZE);
export const SEPARATION_QUERY_WGSL=/* wgsl */`
fn separationOffset(i:u32)->u32{return u32(u.clock.z)*18u+i*${CONTACT_QUERY_WORDS}u;}
fn pursuerOffset(i:u32,cell:u32)->u32{return separationOffset(i)+54u+cell;}
fn neighborCell(center:vec3<i32>,cell:u32)->vec3<i32>{return center+vec3<i32>(i32(cell%3u)-1,i32(cell/3u%3u)-1,i32(cell/9u)-1);}
fn possibleContact(s:FilterGeometry,other:FilterGeometry)->bool {
  let gap=s.p.xyz-other.p.xyz;let squared=dot(gap,gap);
  let clearance=s.radius+other.radius+0.15*min(1.0,(s.radius+other.radius)/0.4);
  let closing=max(0.0,-dot(s.v.xyz-other.v,gap));
  // Multiply the original inequality by distance before squaring its
  // nonnegative sides. Conservative slack covers float32 cancellation.
  let remaining=max(0.0,squared-closing*.4-squared*.00001);
  let padded=clearance+.001;
  return remaining*remaining<=padded*padded*squared;
}
// Independent cell queries need no workgroup shared state or barriers.
@compute @workgroup_size(${QUERY_WORKGROUP_SIZE}) fn buildContactMasks(@builtin(global_invocation_id) gid:vec3<u32>) {
  let count=u32(u.clock.z);let work=gid.x/${QUERY_TILE_SHIPS*27}u*${QUERY_TILE_SHIPS}u+gid.x%${QUERY_TILE_SHIPS}u;if(work>=count){return;}
  let cell=gid.x/${QUERY_TILE_SHIPS}u%27u;let i=links[count+work];let query=typedGeometry[count+i];
  let at=separationOffset(i)+cell*2u;var mask=vec2<u32>(0u);
  if((query.flags&QUERY_PRESSURE)!=0u){
    let s=query;
    let c=neighborCell(contactCell(s.p),cell);let bucket=contactBucket(c);let begin=firstContact(bucket);let end=links[contactRange(bucket)+1u];
    if(begin>0u){
      for(var visit=0u;visit<min(64u,end-(begin-1u));visit++){
        if(possibleContact(s,typedGeometry[begin-1u+visit])){mask[visit/32u]|=1u<<(visit%32u);}
      }
    }
  }
  links[at]=mask.x;links[at+1u]=mask.y;
}
fn neighborSeparation(s:Ship,i:u32)->vec4<f32> {
  if(pressureEnabled()==0.0){return vec4<f32>(0.0);}
  let center=contactCell(s.p.xyz);var push=vec3<f32>(0.0);var urgency=0.0;
  for(var cell=0u;cell<27u;cell++) {
    let at=separationOffset(i)+cell*2u;let low=links[at];let high=links[at+1u];
    if((low|high)==0u){continue;}
    let c=neighborCell(center,cell);let begin=firstContact(contactBucket(c));
    for(var half=0u;half<2u;half++) {
      var mask=select(low,high,half==1u);
      while(mask!=0u){
        let visit=half*32u+firstTrailingBit(mask);mask&=mask-1u;
        let other=loadContact(begin-1u+visit);
        if(other.slot==i||any(other.cell!=c)||other.kind>=4u){continue;}
        let response=contactPush(s,other);push+=response.xyz;urgency=max(urgency,response.w);
      }
    }
  }
  return vec4<f32>(capped(push,1.0)*dynamics(shipType(s)).y,urgency);
}
`;

export const CONTACT_QUERY_WGSL=SEPARATION_QUERY_WGSL+/* wgsl */`
@compute @workgroup_size(${QUERY_WORKGROUP_SIZE}) fn buildPursuerQueries(@builtin(global_invocation_id) gid:vec3<u32>) {
  let count=u32(u.clock.z);let work=gid.x/${QUERY_TILE_SHIPS*27}u*${QUERY_TILE_SHIPS}u+gid.x%${QUERY_TILE_SHIPS}u;if(work>=count){return;}
  let cell=gid.x/${QUERY_TILE_SHIPS}u%27u;let i=links[count+work];let query=typedGeometry[count+i];var found=0u;var nearest=36.0;
  if((query.flags&QUERY_MEMORY)!=0u){
    let c=neighborCell(contactCell(query.p),cell);let bucket=contactBucket(c);let begin=firstContact(bucket);let end=links[contactRange(bucket)+1u];
    if(begin>0u){
      for(var visit=0u;visit<min(16u,end-(begin-1u));visit++){
        let other=loadContact(begin-1u+visit);
        if(other.targetHandle!=f32(i+1u)||!validThreat(other.slot,old[i])){continue;}
        let delta=other.p-query.p;let distance=dot(delta,delta);
        if(distance<nearest){nearest=distance;found=other.slot+1u;}
      }
    }
  }
  links[pursuerOffset(i,cell)]=found;
}
`;
