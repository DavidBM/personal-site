export const CONTACT_WORDS=16;
export const filterGeometryBytes=count=>count*2*32;
const BATTLE_QUERY_PREPARATION=/* wgsl */`  let query=applyJourney(s,u.clock.x,u.clock.y);
  let local=admitted(query)&&journeyLocalDt(query,u.clock.x,u.clock.y)>0.0;
  let enabled=local&&pressureEnabled()!=0.0;let order=groupOrder(groupOf(query));
  let memory=local&&u.control.w>=.5&&u.clock.x>=query.memory.z&&order.w==1u&&order.y<2u&&pursuers(index)>0.0;
  typedGeometry[count+index]=FilterGeometry(query.p.xyz,sceneHull(shipType(query),journeyBodyRadius(query)),query.v.xyz,(u32(enabled)*QUERY_PRESSURE)|(u32(memory)*QUERY_MEMORY));
`;
export const contactCacheWgsl=(queryPreparation=BATTLE_QUERY_PREPARATION)=>/* wgsl */`
struct ContactGeometry {p:vec3<f32>,radius:f32,v:vec3<f32>,fleet:u32}
struct FilterGeometry {p:vec3<f32>,radius:f32,v:vec3<f32>,flags:u32}
const QUERY_PRESSURE:u32=1u;
const QUERY_MEMORY:u32=2u;
// Binding 3 is geometry for cache/filter entry points and history for advance.
// Their resource interfaces are disjoint; each phase has its own bind group.
@group(0) @binding(3) var<storage,read_write> typedGeometry:array<FilterGeometry>;
fn contactOffset(index:u32)->u32{return u32(u.clock.z)*2u+index*8u;}
fn contactMetadata(index:u32)->u32{return u32(u.clock.z)*10u+index*8u;}
fn recordContact(s:Ship,index:u32,record:u32) {
  let at=contactOffset(record);let tags=contactMetadata(record);
  let geometry=ContactGeometry(s.p.xyz,sceneHull(shipType(s),journeyBodyRadius(s)),s.v.xyz,s.identity.y);typedGeometry[record]=FilterGeometry(geometry.p,geometry.radius,geometry.v,0u);
  let p=bitcast<vec3<u32>>(s.p.xyz);let v=bitcast<vec3<u32>>(s.v.xyz);let c=bitcast<vec3<u32>>(contactCell(s.p.xyz));
  links[at]=p.x;links[at+1u]=p.y;links[at+2u]=p.z;links[at+3u]=bitcast<u32>(geometry.radius);
  links[at+4u]=v.x;links[at+5u]=v.y;links[at+6u]=v.z;links[at+7u]=s.identity.y;
  links[tags]=c.x;links[tags+1u]=c.y;links[tags+2u]=c.z;links[tags+3u]=classIndex(shipType(s));
  links[tags+4u]=s.identity.w;links[tags+5u]=bitcast<u32>(s.aux.x);links[tags+6u]=index;
  let end=links[contactRange(contactBucket(contactCell(s.p.xyz)))+1u];
  links[tags+7u]=select(0u,record+2u,record+1u<end);
}
fn loadContactGeometry(index:u32)->ContactGeometry {
  let at=contactOffset(index);
  return ContactGeometry(bitcast<vec3<f32>>(vec3<u32>(links[at],links[at+1u],links[at+2u])),bitcast<f32>(links[at+3u]),
    bitcast<vec3<f32>>(vec3<u32>(links[at+4u],links[at+5u],links[at+6u])),links[at+7u]);
}
fn loadContact(index:u32)->Contact {
  let geometry=loadContactGeometry(index);let at=contactMetadata(index);
  return Contact(geometry.p,geometry.radius,geometry.v,geometry.fleet,
    bitcast<vec3<i32>>(vec3<u32>(links[at],links[at+1u],links[at+2u])),links[at+3u],links[at+4u],bitcast<f32>(links[at+5u]),links[at+6u],links[at+7u]);
}
// Geometry and metadata each occupy a contiguous 32-byte stream. Filtering
// reads only geometry; final contact response validates the exact metadata.
@compute @workgroup_size(128) fn buildContactCache(@builtin(global_invocation_id) gid:vec3<u32>) {
  let index=gid.x;let count=u32(u.clock.z);if(index>=count){return;}let s=old[index];
${queryPreparation}
  if(!contributes(s)){return;}
  let end=links[contactRange(contactBucket(contactCell(s.p.xyz)))+1u];let record=end-1u-links[index];
  links[u32(u.clock.z)+record]=index;recordContact(s,index,record);
}
`;

export const CONTACT_CACHE_WGSL=contactCacheWgsl();
