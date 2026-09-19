import {pressureDefinition,pressureKey} from './pressure-orders.mjs';
import {orbitRadius, POC_PLANET_RADIUS} from './flight-layout.mjs';
import {radiusOf} from './classes.mjs';
import {bodyAt} from './solar-layout.mjs';
export const PRESSURE_SIDE=64,MAX_PRESSURE_FIELDS=16;
const smooth=value=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};
function integer(value,min,max,label){if(!Number.isInteger(value)||value<min||value>max)throw new Error(`Invalid ${label}`);}
function scopeDefinition(value,sampleBody) {
  const center=value.center??[0,0,0];let halfExtent=value.halfExtent??128;
  if(!Array.isArray(center)||center.length!==3||!center.every(x=>Number.isFinite(x)&&Math.abs(x)<=1e9))throw new Error('Invalid pressure center');
  if(value.planet!==undefined) {
    integer(value.planet,0,15,'pressure planet');
    const pose=sampleBody(value.planet,0,1800);
    const radius=Array.isArray(pose)?pose[3]:undefined;
    halfExtent=Math.max(halfExtent,planetEnvelope(radius));
  }
  if(!Number.isFinite(halfExtent)||halfExtent<0.25||halfExtent>1e9)throw new Error('Invalid pressure extent');
  return {...value,center:[...center],halfExtent};
}
export function pressureLayout(fleets,fields) {
  const activeWords=Math.ceil(fields/4)*4,frames=4+activeWords,weights=frames+fields*4;
  return {fields,fleets,activeWords,frames,weights,words:Math.ceil((weights+fleets*fields)/4)*4};
}
// One queue owns all GPU consumers. Slot reuse is submitted after old consumers
// and followed by clear/rebuild, so recycling needs no pose readback or GPU stall.
export function createPressureScopes(fleetCount,{fieldCapacity=Math.min(MAX_PRESSURE_FIELDS, Math.max(8,fleetCount*2)),cellSize=4,planet=null,sampleBody=bodyAt}={}) {
  integer(fieldCapacity,1,MAX_PRESSURE_FIELDS,'pressure field capacity');
  const layout=pressureLayout(fleetCount,fieldCapacity),data=new ArrayBuffer(layout.words*4),f=new Float32Array(data),w=new Uint32Array(data);
  const slots=Array(fieldCapacity).fill(null),generations=new Uint32Array(fieldCapacity);
  const members=Array.from({length:fleetCount},()=>({weights:new Float64Array(fieldCapacity),from:null,target:null,start:0,end:0,revision:0,pending:null}));
  let now=0,selectedFleet=0,selectedScope=null;
  function resolve(handle) {
    const record=slots[handle?.slot];
    if(!record||record.generation!==handle.generation)throw new Error('Stale pressure scope handle');
    return record;
  }
  function create(definition={}) {
    const value=scopeDefinition(definition,sampleBody),slot=slots.findIndex((record,i)=>record===null&&generations[i]<0xffffffff);
    if(slot<0)throw new Error('Pressure field pool exhausted');
    const record={...value,slot,generation:++generations[slot],retiring:false};slots[slot]=record;
    return Object.freeze({slot,generation:record.generation});
  }
  let shared=create({halfExtent:cellSize*32,...(planet===null?{frame:'encounter'}:{planet})});
  for(const member of members){member.weights[shared.slot]=1;member.target=shared;}
  function evaluate(member,time) {
    if(!member.from)return;
    const blend=smooth((time-member.start)/(member.end-member.start));
    for(let slot=0;slot<fieldCapacity;slot++)member.weights[slot]=member.from[slot]*(1-blend)+(member.target?.slot===slot?blend:0);
    if(blend===1)member.from=null;
  }
  function activate(member,command,time) {
    evaluate(member,time);member.from=member.weights.slice();member.target=command.scope;
    member.start=time;member.end=time+command.blend;member.pending=null;
    if(command.blend===0){member.weights.fill(0);if(command.scope)member.weights[command.scope.slot]=1;member.from=null;}
  }
  function assign({fleet,scope,revision,at=now,blend=1}) {
    integer(fleet,0,fleetCount-1,'pressure fleet');integer(revision,1,0xffffffff,'pressure revision');
    const member=members[fleet];if(revision<=member.revision)return false;
    if(scope!==null&&resolve(scope).retiring)throw new Error('Cannot assign a retiring pressure scope');
    validateTransition(at,blend);
    const command={scope:scope===null?null:Object.freeze({slot:scope.slot,generation:scope.generation}),at,blend};member.revision=revision;
    if(at>now)member.pending=command;else activate(member,command,now);
    return true;
  }
  function retire(handle) {
    const record=resolve(handle);
    if(members.some(m=>m.target?.slot===handle.slot||m.pending?.scope?.slot===handle.slot))throw new Error('Pressure scope is still a destination');
    record.retiring=true;
  }
  function collect() {
    for(let slot=0;slot<fieldCapacity;slot++)if(slots[slot]?.retiring&&!members.some(m=>m.weights[slot]>0)) {
      slots[slot]=null;if(selectedScope?.slot===slot)selectedScope=null;
    }
  }
  function updateMembers(time) {
    for(const member of members) {
      const command=member.pending;
      if(command&&command.at<=time)activate(member,command,Math.max(now,command.at));
      evaluate(member,time);
    }
    now=time;collect();
  }
  function updateFrames(time,period,encounter) {
    let active=0;w.fill(0,4,4+layout.activeWords);
    for(let slot=0;slot<fieldCapacity;slot++) {
      const record=slots[slot];if(!record)continue;
      const center=scopeCenter(record,time,period,encounter,sampleBody);
      f.set([...center,record.halfExtent/32],layout.frames+slot*4);
      if(members.some(m=>m.weights[slot]>0))w[4+active++]=slot;
    }
    w[0]=active;
  }
  function tick(time,period=1800,encounter=[0,0,0]) {
    if(!Number.isFinite(time)||time<now)throw new Error('Pressure clock cannot reverse');
    updateMembers(time);updateFrames(time,period,encounter);
    for(let fleet=0;fleet<fleetCount;fleet++)f.set(members[fleet].weights,layout.weights+fleet*fieldCapacity);
    updateView();
  }
  function updateView() {
    const start=layout.weights+selectedFleet*fieldCapacity,weights=f.subarray(start,start+fieldCapacity);
    w[1]=selectedScope?resolve(selectedScope).slot:weights.indexOf(Math.max(...weights));
    w[2]=Number(w.subarray(4,4+w[0]).includes(w[1]));
  }
  function view(fleet,scope=null){integer(fleet,0,fleetCount-1,'pressure view fleet');if(scope)resolve(scope);selectedFleet=fleet;selectedScope=scope;updateView();}
  function affinity(a,b){if(a===b)return 1;return members[a].weights.reduce((sum,x,i)=>sum+x*members[b].weights[i],0);}
  function reset(){now=0;for(const member of members){member.from=null;member.pending=null;member.weights.fill(0);if(member.target)member.weights[member.target.slot]=1;}tick(0);}
  function used(slot){return members.some(m=>m.weights[slot]>0||m.target?.slot===slot||m.pending?.scope?.slot===slot);}
  function freeSlot() {
    return slots.findIndex((record,slot)=>(record===null||record.retiring&&!used(slot))&&generations[slot]<0xffffffff);
  }
  function reuseScope(definition) {
    const planet=definition.planet;
    const same=slots.find(record=>record&&record.planet===planet);
    if(same)return {slot:same.slot,generation:same.generation};
    const live=slots.find(record=>record);
    return live?{slot:live.slot,generation:live.generation}:null;
  }
  function prepareOrder(fleet,value,time) {
    integer(fleet,0,fleetCount-1,'pressure fleet');
    if(!Number.isFinite(time)||time<now)throw new Error('Pressure order cannot rewind time');
    const prepared=pressureDefinition({definition:value=>scopeDefinition(value,sampleBody)},value);
    const key=pressureKey(prepared.definition);
    const existing=slots.find(record=>record&&pressureKey(record)===key);
    if(existing)return {...prepared,fleet,time,scope:{slot:existing.slot,generation:existing.generation}};
    if(freeSlot()>=0)return {...prepared,fleet,time,scope:null};
    const reused=reuseScope(prepared.definition);
    if(!reused)throw new Error('Pressure field pool exhausted');
    return {...prepared,fleet,time,scope:reused};
  }
  function applyOrder(prepared) {
    if(prepared.scope)resolve(prepared.scope).retiring=false;
    tick(prepared.time);const scope=prepared.scope??create(prepared.definition);
    assign({fleet:prepared.fleet,scope,revision:members[prepared.fleet].revision+1,at:prepared.time,blend:prepared.blend});
    for(const record of slots)if(record&&!members.some(m=>m.target?.slot===record.slot||m.pending?.scope?.slot===record.slot))record.retiring=true;
  }
  function prepareSnapshot(input) {
    if(!Array.isArray(input.scopes)||input.scopes.length<1||input.scopes.length>fieldCapacity)throw new Error('Invalid snapshot pressure fields');
    if(!Array.isArray(input.members)||input.members.length!==fleetCount)throw new Error('Incomplete snapshot pressure membership');
    const definitions=input.scopes.map(value=>scopeDefinition(value,sampleBody));
    for(const index of input.members)integer(index,0,definitions.length-1,'snapshot pressure membership');
    if(generations.some(value=>value===0xffffffff))throw new Error('Pressure generations exhausted');
    return {definitions,members:[...input.members]};
  }
  function commitSnapshot(prepared,time) {
    slots.fill(null);selectedScope=null;
    const handles=prepared.definitions.map((definition,slot)=>{
      slots[slot]={...definition,slot,generation:++generations[slot],retiring:false};
      return Object.freeze({slot,generation:generations[slot]});
    });
    shared=handles[0];
    for(const [fleet,member] of members.entries()) {
      member.from=null;member.pending=null;member.target=handles[prepared.members[fleet]];
      member.revision++;member.weights.fill(0);member.weights[member.target.slot]=1;
    }
    now=time;tick(time);
  }
  tick(0);
  return {layout,data,used,prepareOrder,applyOrder,definition:value=>scopeDefinition(value,sampleBody),get shared(){return shared;},prepareSnapshot,commitSnapshot,reset,create,assign,retire,resolve,tick,view,affinity,members,slots,get now(){return now;},get activeCount(){return w[0];},get allocated(){return slots.filter(Boolean).length;},get bytes(){return fieldCapacity*PRESSURE_SIDE**3*4;}};
}
export const pressureScopeWgsl=layout=>/* wgsl */`
struct PressureControl {counts:vec4<u32>,occupied:array<u32,${layout.activeWords}>,frames:array<vec4<f32>,${layout.fields}>,weights:array<f32,${layout.fleets*layout.fields}>}
fn pressureAffinity(a:u32,b:u32)->f32 {
  if(a==b){return 1.0;}var value=0.0;
  for(var field=0u;field<${layout.fields}u;field++){value+=director.pressure.weights[a*${layout.fields}u+field]*director.pressure.weights[b*${layout.fields}u+field];}
  return value;
}
`;

function planetEnvelope(radius) {
  const r=Number.isFinite(radius)?Math.max(0,radius):0;
  let outer=r;
  for(let type=0;type<32;type++)outer=Math.max(outer,orbitRadius(type,r));
  if(r>=POC_PLANET_RADIUS*0.5) {
    const hull=Math.max(...Array.from({length:32},(_,type)=>radiusOf(type)));
    return (outer+hull+16)/.875;
  }
  return Math.max(outer/.875,r/0.35,0.25);
}

function scopeCenter(record,time,period,encounter,sampleBody) {
  if(record.planet!==undefined)return sampleBody(record.planet,time,period).slice(0,3);
  return record.frame==='encounter'?encounter:record.center;
}

function validateTransition(at,blend) {
  if(!Number.isFinite(at)||!Number.isFinite(blend)||blend<0||blend>10)throw new Error('Invalid pressure transition clock');
}
