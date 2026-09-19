import {fleetCapacity} from './runtime-capacity.mjs';
// Derived permission/roster indexes only. Tactical scoring stays on the GPU.
export const ORDINAL_WORDS=64*64,TARGET_WORDS=64*9;
function setByte(words,base,index,value){words[base+(index>>>2)]|=value<<((index&3)*8);}
function groupFleetType(director,g) {
  const occupied=director.occupied?.[g];
  return occupied?{fleet:occupied.slot,type:occupied.type}:{fleet:Math.floor(g/32),type:g%32};
}
function writeOrdinals(words,base,roster,capacity,director) {
  words.fill(0,base,base+capacity.ordinalWords);
  const occupied=director?.occupied;
  if(occupied) {
    for(let g=0;g<capacity.groups;g++) {
      const n=Math.min(occupied[g]?.visual|0,256);
      for(let ordinal=0;ordinal<n;ordinal++)setByte(words,base+g*64,ordinal,ordinal);
    }
    return;
  }
  for(let g=0;g<capacity.groups;g++) {
    let rank=0;const {fleet,type}=groupFleetType(director??{capacity},g);
    for(let ordinal=0;ordinal<roster.sizeFor(fleet,type);ordinal++)if(roster.isLive(fleet,type,ordinal))setByte(words,base+g*64,rank++,ordinal);
  }
}
function writePermissions(words,base,director) {
  const {capacity,groups}=director;
  words.fill(0,base,base+capacity.targetWords);
  for(let g=0;g<capacity.groups;g++) {
    const mask=groups[g*8+2],at=base+g*capacity.targetStride;let count=0;
    const from=groupFleetType(director,g);
    for(let target=0;target<capacity.groups;target++) {
      const to=groupFleetType(director,target);
      if(!director.canTarget(from.fleet,to.fleet))continue;
      if((mask&(1<<(to.type)))!==0&&groups[target*8+3]===1&&groups[target*8]>0)setByte(words,at+1,count++,target);
    }
    words[at]=count|(groups[g*8]<<16);
  }
}
export function createTargetTables(words,base) {
  let previousRoster,lastOrdinal=-1,lastPermission=-1;
  return director=>{
    const ordinalEpoch=director.ordinalEpoch,permissionEpoch=director.permissionEpoch;
    if(ordinalEpoch===undefined) {
      if(previousRoster!==director.roster){writeOrdinals(words,base,director.roster,director.capacity,director);previousRoster=director.roster;}
      writePermissions(words,base+director.capacity.ordinalWords,director);
      return;
    }
    if(ordinalEpoch!==lastOrdinal) {
      writeOrdinals(words,base,director.roster,director.capacity,director);
      lastOrdinal=ordinalEpoch;
    }
    if(permissionEpoch!==lastPermission) {
      writePermissions(words,base+director.capacity.ordinalWords,director);
      lastPermission=permissionEpoch;
    }
  };
}
export const targetTableWgsl=(capacity=fleetCapacity(2))=>/* wgsl */`
fn eligibleCount(s:Ship)->u32{return director.targets[groupOf(s)*${capacity.targetStride}u]&65535u;}
fn eligibleGroup(s:Ship,rank:u32)->u32 {
  let packed=director.targets[groupOf(s)*${capacity.targetStride}u+1u+rank/4u];return (packed>>((rank%4u)*8u))&255u;
}
fn liveOrdinal(group:u32,rank:u32)->u32 {
  if(rank>=(director.targets[group*${capacity.targetStride}u]>>16u)){return 256u;}
  let packed=director.ordinals[group*64u+rank/4u];return (packed>>((rank%4u)*8u))&255u;
}
fn permittedFleet(a:u32,b:u32)->bool {
  let left=director.battles[a];let right=director.battles[b];
  return a!=b&&left.x!=0u&&left.x==right.x&&left.y!=right.y;
}
`;
export const TARGET_TABLE_WGSL=targetTableWgsl();
