import {ROUTE_WORDS} from './local-routes.mjs';
export const MAX_GROUP_EVENTS=4;
export function eventFrameOverflow(message){return Object.assign(new Error(message),{code:'event-frame-capacity'});}
export const EVENT_ROW_WORDS=4+4+8+96+2*ROUTE_WORDS+4+4;
export function eventFrameLayout(capacity) {
  const directory=4,records=directory+capacity.groups*4,placements=records+capacity.groups*(MAX_GROUP_EVENTS+1)*EVENT_ROW_WORDS,words=placements+capacity.groups*2*8;
  return {directory,records,placements,words,bytes:words*4};
}
function commandFleets(event,fleetCount) {
  const values=[...event.commands,...(event.routes??[])];
  for(const value of values) {
    if(!Number.isInteger(value.fleet)||value.fleet<0||value.fleet>=fleetCount)throw new Error('Invalid event fleet');
  }
  return values;
}
function denseAffected(event,fleetCount) {
  const groups=new Set();
  for(const value of commandFleets(event,fleetCount)) {
    const types=value.type===undefined?Array.from({length:32},(_,i)=>i):[value.type];
    for(const type of types)groups.add(value.fleet*32+type);
  }
  return groups;
}
function occupancyAffected(event,occupied,fleetCount) {
  const groups=new Set();
  for(const value of commandFleets(event,fleetCount)) {
    for(let i=0;i<occupied.length;i++) {
      const g=occupied[i];
      if(g.slot===value.fleet&&(value.type===undefined||g.type===value.type))groups.add(i);
    }
  }
  return groups;
}
function affected(event,capacity,occupied) {
  return occupied?occupancyAffected(event,occupied,capacity.fleetCount):denseAffected(event,capacity.fleetCount);
}
// Admission remains untouched if a frame cannot represent all its boundaries.
// Recovery owns over-budget intervals; never silently overwrite an event row.
export function validateEventFrame(events,start,capacity,occupied=null) {
  const times=Array.from({length:capacity.groups},()=>new Set());
  for(const event of events) {
    const at=Math.max(start,event.effectiveAt,event.deliveredAt);
    for(const group of affected(event,capacity,occupied)) {
      if(group>=times.length)continue;
      times[group].add(at);
      if(times[group].size>MAX_GROUP_EVENTS)throw eventFrameOverflow(`GPU event capacity exceeded for group ${group}; reconcile the interval`);
    }
  }
}
export function createEventFrame(director,control,routes,clock) {
  const capacity=director.capacity,layout=eventFrameLayout(capacity),data=new ArrayBuffer(layout.bytes),w=new Uint32Array(data),f=new Float32Array(data);
  const epochs=new Float64Array(capacity.groups),times=new Float64Array(capacity.groups*(MAX_GROUP_EVENTS+1)),counts=new Uint32Array(capacity.groups);
  let active=false,start=0,end=0;
  const offset=(group,row)=>layout.records+(group*(MAX_GROUP_EVENTS+1)+row)*EVENT_ROW_WORDS;
  function write(group,row,time) {
    const at=offset(group,row),fleet=director.occupied?.[group]?.slot??Math.floor(group/32);times[group*(MAX_GROUP_EVENTS+1)+row]=time;
    f.set([clock.local(time),clock.trailTick(time),0,0],at);
    w.set(director.groups.subarray(group*8,group*8+4),at+4);w.set(director.roster.live.subarray(group*8,group*8+8),at+8);
    w.set(control.captureGroup(group),at+16);
    f.set(routes.data.subarray(group*2*ROUTE_WORDS,(group+1)*2*ROUTE_WORDS),at+112);
    for(let cohort=0;cohort<2;cohort++) {
      const record=routes.records.get(group*2+cohort);if(!record)continue;
      f[at+112+cohort*ROUTE_WORDS+4]=clock.local(record.request.at);f[at+112+cohort*ROUTE_WORDS+5]=clock.local(record.request.end);
    }
    w.set(director.battles.subarray(fleet*4,fleet*4+4),at+256);f.set(director.encounters.subarray(fleet*4,fleet*4+4),at+260);
  }
  function begin(from,to) {
    start=from;end=to;active=false;counts.fill(0);w.fill(0,0,layout.records);epochs.set(director.groupEpochs);
    for(let group=0;group<capacity.groups;group++)write(group,0,start);
  }
  function capture(time) {
    for(let group=0;group<capacity.groups;group++) {
      if(epochs[group]===director.groupEpochs[group])continue;
      epochs[group]=director.groupEpochs[group];const row=++counts[group];
      if(row>MAX_GROUP_EVENTS)throw new Error('GPU event frame overflow after preflight');
      write(group,row,time);w[layout.directory+group*4]=row;active=true;
    }
  }
  function finish() {
    f.set([Number(active),clock.local(start),clock.local(end),clock.trailTick(start)],0);
    return active;
  }
  function rebase(shift) {
    if(!active)return;
    for(let group=0;group<capacity.groups;group++)for(let row=0;row<=counts[group];row++) {
      const at=offset(group,row);f[at]=clock.local(times[group*(MAX_GROUP_EVENTS+1)+row]);f[at+1]=clock.trailTick(times[group*(MAX_GROUP_EVENTS+1)+row]);
      for(const field of [18,26,27,38,39,116,117,116+ROUTE_WORDS,117+ROUTE_WORDS])f[at+field]-=shift;
    }
    finish();
  }
  function disable(){active=false;f[0]=0;}
  return {layout,data,begin,capture,finish,disable,rebase,counts,get active(){return active;},get start(){return start;},get end(){return end;}};
}
