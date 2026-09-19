// Broad occupancy and short-range contacts have different jobs. Hash contacts
// cover unbounded fixture coordinates; collisions in the hash are filtered by
// actual cell coordinates. Work is capped even for completely coincident fleets.
export const GRID_SIDE=64;
export const GRID_CELLS=GRID_SIDE**3;
export const HASH_BUCKETS=32768;
export const SPACING_WGSL=/* wgsl */`
struct Contact {p:vec3<f32>,radius:f32,v:vec3<f32>,fleet:u32,cell:vec3<i32>,kind:u32,serial:u32,targetHandle:f32,slot:u32,nextHandle:u32}
@group(0) @binding(6) var<storage,read_write> heads:array<atomic<u32>>;
@group(0) @binding(7) var<storage,read_write> links:array<u32>;
fn contactCell(p:vec3<f32>)->vec3<i32>{return vec3<i32>(floor(p/4.0));}
fn contactBucket(c:vec3<i32>)->u32 {
  return hash((bitcast<u32>(c.x)*73856093u)^(bitcast<u32>(c.y)*19349663u)^(bitcast<u32>(c.z)*83492791u))%32768u;
}
fn pairDirection(a:u32,b:u32)->vec3<f32> {
  let key=hash((min(a,b)*1664525u)^(max(a,b)*1013904223u));
  let direction=unit(vec3<f32>(variation(key)-.5,variation(key+1u)-.5,variation(key+2u)-.5));
  return direction*select(-1.0,1.0,a>b);
}
fn contactPush(s:Ship,t:Contact)->vec4<f32> {
  let gap=s.p.xyz-t.p.xyz;let distance=length(gap);
  let a=sceneAdapt(journeyBodyRadius(s));
  let clearance=dimensions(shipType(s)).w*a+t.radius+.15*a;
  let normal=select(pairDirection(s.identity.w,t.serial),gap/max(distance,.00001),distance>.00001);
  let closing=max(0.0,-dot(s.v.xyz-t.v.xyz,normal));
  let anticipated=max(0.0,distance-closing*.4);
  let urgency=clamp((clearance-anticipated)/max(clearance*.6,.1),0.0,1.0);
  return vec4<f32>(normal*urgency,urgency);
}
fn serialSeparation(s:Ship,i:u32)->vec4<f32> {
  if(pressureEnabled()==0.0){return vec4<f32>(0.0);}
  let center=contactCell(s.p.xyz);var push=vec3<f32>(0.0);var urgency=0.0;
  // Capitals have their own bounded, size-aware obstacle pass.
  for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
    let c=center+vec3<i32>(x,y,z);var handle=firstContact(contactBucket(c));
    for(var visit=0u;visit<64u&&handle>0u;visit++) {
      let other=loadContact(handle-1u);handle=other.nextHandle;if(other.slot==i){continue;}
      if(any(other.cell!=c)||other.kind>=4u){continue;}
      let response=contactPush(s,other);push+=response.xyz;urgency=max(urgency,response.w);
    }
  }}}
  return vec4<f32>(capped(push,1.0)*dynamics(shipType(s)).y,urgency);
}
`;
