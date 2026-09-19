export const EVENT_LIMITS=Object.freeze({pending:1024,bytes:4*1024*1024,packetBytes:512*1024,lanes:4096,receiptWindow:4096,history:256});
const ready=event=>Math.max(event.effectiveAt,event.deliveredAt);
const FIELDS=new Set(['id','sequence','effectiveAt','commands','routes','lane','revision','label']);
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function clock(value){if(!Number.isFinite(value)||value<0)throw new Error('Invalid live event clock');}
function sequence(value){if(!Number.isSafeInteger(value)||value<1)throw new Error('Invalid live event sequence');}
function header(packet,now) {
  sequence(packet.sequence);clock(packet.effectiveAt);clock(now);
  if(Object.keys(packet).some(key=>!FIELDS.has(key)))throw new Error('Invalid live event fields');
  if(typeof packet.id!=='string'||packet.id.length<1||packet.id.length>128)throw new Error('Invalid live event identity');
  if(packet.label!==undefined&&(typeof packet.label!=='string'||packet.label.length>256))throw new Error('Invalid live event label');
}
function snapshot(packet,now,options={}) {
  header(packet,now);
  if(!Array.isArray(packet.commands)||packet.commands.length>520)throw new Error('Invalid live event commands');
  if(packet.routes!==undefined&&(!Array.isArray(packet.routes)||packet.routes.length>512))throw new Error('Invalid live event routes');
  validateLane(packet);
  const encoded=JSON.stringify(packet),fingerprint=options.fingerprint??encoded,bytes=options.bytes??new TextEncoder().encode(encoded).length;
  if(bytes>EVENT_LIMITS.packetBytes)throw new Error('Live event packet exceeds byte limit');
  return {event:freeze({...structuredClone(packet),deliveredAt:now}),fingerprint,bytes};
}
function validateLane(packet) {
  if(packet.lane===undefined){if(packet.revision!==undefined)throw new Error('Live event revision requires a replacement lane');return;}
  if(!Number.isInteger(packet.lane)||packet.lane<0||packet.lane>=EVENT_LIMITS.lanes)throw new Error('Invalid event replacement lane');
  sequence(packet.revision);
}
function insertion(pending,event) {
  let low=0,high=pending.length;
  while(low<high){const mid=(low+high)>>>1,other=pending[mid].event;
    if(ready(other)<ready(event)||(ready(other)===ready(event)&&other.sequence<event.sequence))low=mid+1;else high=mid;
  }
  return low;
}
// Numbered receipts bound duplicate tracking independently of effect time.
// Replacement lanes are explicit director-owned pending-order streams. Facts
// that must both occur use distinct packets without a shared replacement lane.
export function createEventInbox({validate=()=>{}}={},restoring=null) {
  const pending=[],bySequence=new Map(),receipts=new Set(),lanes=new Map(),versions=new Float64Array(EVENT_LIMITS.lanes),versionSequences=new Float64Array(EVENT_LIMITS.lanes),history=[];
  let prefix=0,highest=0,bytes=0,receivedAt=0,appliedAt=0,settled=0,closed=false,lastFailure=null;
  function record(event,status,at,error) {
    const entry={id:event.id,sequence:event.sequence,effectiveAt:event.effectiveAt,receivedAt:event.deliveredAt,appliedAt:at,late:at>event.effectiveAt+1e-6,label:event.label,status,...(error?{error:String(error.message??error).slice(0,2048)}:{})};
    history.push(entry);if(status==='rejected')lastFailure=entry;
    if(history.length>EVENT_LIMITS.history)history.shift();
  }
  function remove(ticket) {
    pending.splice(pending.indexOf(ticket),1);bySequence.delete(ticket.event.sequence);bytes-=ticket.bytes;
    if(lanes.get(ticket.event.lane)===ticket)lanes.delete(ticket.event.lane);
  }
  function receipt(ticket) {
    const n=ticket.event.sequence;highest=Math.max(highest,n);if(n<=prefix)return;receipts.add(n);
    while(receipts.has(prefix+1)){receipts.delete(++prefix);}
  }
  function duplicate(ticket) {
    const n=ticket.event.sequence,old=bySequence.get(n)?.fingerprint;
    if(old!==undefined&&old!==ticket.fingerprint)throw new Error('Conflicting live event sequence');
    return n<=prefix||receipts.has(n);
  }
  function receive(packet,time,options={}) {
    if(closed)return {status:'closed'};
    if(time<Math.max(receivedAt,appliedAt))throw new Error('Live receipt cannot rewind time');
    const ticket=snapshot(packet,time,options),event=ticket.event;
    if(duplicate(ticket))return {status:'duplicate',sequence:event.sequence};
    if(event.sequence>prefix+EVENT_LIMITS.receiptWindow)throw new Error('Live event receipt gap exceeds window; snapshot recovery required');
    const lane=event.lane,previous=lanes.get(lane);
    if(lane!==undefined&&event.revision<=versions[lane])return superseded(ticket,time);
    if(validate(ticket.event)==='superseded')return superseded(ticket,time);
    return enqueue(ticket,previous,time);
  }
  function superseded(ticket,time){receipt(ticket);record(ticket.event,'superseded',time);receivedAt=time;return {status:'superseded',sequence:ticket.event.sequence};}
  function enqueue(ticket,previous,time) {
    if(pending.length-Number(Boolean(previous))>=EVENT_LIMITS.pending||bytes-(previous?.bytes??0)+ticket.bytes>EVENT_LIMITS.bytes)throw new Error('Live event inbox is full');
    if(previous){remove(previous);record(previous.event,'superseded',time);}
    const event=ticket.event;
    if(event.lane!==undefined){lanes.set(event.lane,ticket);versions[event.lane]=event.revision;versionSequences[event.lane]=event.sequence;}
    pending.splice(insertion(pending,event),0,ticket);bySequence.set(event.sequence,ticket);bytes+=ticket.bytes;receipt(ticket);receivedAt=time;
    return {status:'queued',sequence:event.sequence};
  }
  function nextBoundary(start,end) {
    clock(start);clock(end);if(end<start)throw new Error('Invalid live event interval');
    return pending.length?Math.min(end,Math.max(start,ready(pending[0].event))):end;
  }
  function drain(time,apply) {
    clock(time);if(time<appliedAt)throw new Error('Live event admission cannot rewind time');
    appliedAt=time;let count=0;
    while(count<EVENT_LIMITS.pending&&pending.length&&ready(pending[0].event)<=time) {
      const ticket=pending[0];remove(ticket);count++;settled=Math.max(settled,ticket.event.sequence);
      try{const result=apply(ticket.event);record(ticket.event,result==='superseded'?'superseded':'applied',time);}catch(error){record(ticket.event,'rejected',time,error);}
    }
    return count;
  }
  function reset(){pending.length=0;bySequence.clear();receipts.clear();lanes.clear();versions.fill(0);versionSequences.fill(0);history.length=0;prefix=0;highest=0;bytes=0;receivedAt=0;appliedAt=0;settled=0;lastFailure=null;}
  function projectSource(time) {
    clock(time);
    if(closed||time<Math.max(receivedAt,appliedAt))throw new Error('Cannot project before the latest received director state');
    if(prefix!==highest)throw new Error('Mock director cannot reconstruct missing receipts');
    const future=pending.filter(ticket=>ticket.event.effectiveAt>time).map(ticket=>{const {deliveredAt,...packet}=ticket.event;return packet;});
    return {stream:{through:highest,lanes:Array.from(versions),pending:structuredClone(future)},due:pending.filter(ticket=>ready(ticket.event)<=time).map(ticket=>ticket.event)};
  }
  function restore(source,time,validator=validate) {
    const prior={pending,receipts,versions,versionSequences,history,prefix,highest,receivedAt,appliedAt,settled};
    validateRestore(source,time,prior);
    return createEventInbox({validate:validator},{source:structuredClone(source),time,prior});
  }
  function seedRestore({source,time,prior}) {
    prefix=source.through;highest=prefix;settled=prefix;appliedAt=time;receivedAt=Math.max(time,prior.receivedAt);
    versions.set(source.lanes);versionSequences.fill(source.through);history.push(...prior.history);
    const seen=new Set(),seenLanes=new Set();
    for(const packet of source.pending) {
      if(packet.sequence>source.through||packet.effectiveAt<=time||seen.has(packet.sequence))throw new Error('Invalid snapshot future packet');
      seen.add(packet.sequence);const ticket=snapshot(packet,time);
      uniqueLane(packet,seenLanes);
      if(packet.lane!==undefined&&packet.revision!==versions[packet.lane])throw new Error('Snapshot pending lane does not match its watermark');
      seedTicket(ticket,time,false);
    }
    for(const ticket of prior.pending)if(ticket.event.sequence>source.through)seedTicket(ticket,time,true);
    restoreReceipts(source.through,prior);
    highest=Math.max(highest,prior.highest);
    record({id:'snapshot',sequence:source.through,effectiveAt:time,deliveredAt:time},'snapshot',time);
  }
  function restoreReceipts(through,prior) {
    for(let n=through+1;n<=prior.prefix;n++)receipt({event:{sequence:n}});
    for(const n of prior.receipts)if(n>through)receipt({event:{sequence:n}});
  }
  function staleLane(event,retained){return retained&&event.lane!==undefined&&event.revision<=versions[event.lane];}
  function seedTicket(ticket,time,retained) {
    const event=ticket.event,lane=event.lane;
    if(staleLane(event,retained)){receipt(ticket);record(event,'superseded',time);return;}
    if(validate(event)==='superseded'){receipt(ticket);record(event,'superseded',time);return;}
    const previous=lanes.get(lane),nextBytes=bytes-(previous?.bytes??0)+ticket.bytes;
    if(pending.length-Number(Boolean(previous))>=EVENT_LIMITS.pending||nextBytes>EVENT_LIMITS.bytes)throw new Error('Restored inbox is full');
    if(previous){remove(previous);record(previous.event,'superseded',time);}
    pending.splice(insertion(pending,event),0,ticket);bySequence.set(event.sequence,ticket);bytes+=ticket.bytes;
    if(lane!==undefined){lanes.set(lane,ticket);versions[lane]=event.revision;versionSequences[lane]=event.sequence;}
    receipt(ticket);
  }
  if(restoring)seedRestore(restoring);
  return {receive,nextBoundary,drain,history,reset,restore,projectSource,through:time=>pending.filter(ticket=>ready(ticket.event)<=time).map(ticket=>ticket.event),destroy(){closed=true;reset();},
    get empty(){return pending.length===0;},
    get lastFailure(){return lastFailure;},
    get nextSequence(){return highest+1;},get status(){return {pending:pending.length,bytes,receiptPrefix:prefix,receiptGaps:receipts.size,lanes:lanes.size,closed};}};
}

function validateRestore(source,time,prior) {
  clock(time);
  if(time<prior.appliedAt||!Number.isSafeInteger(source.through)||source.through<prior.settled)throw new Error('Snapshot watermark regressed');
  if(prior.highest-source.through>EVENT_LIMITS.receiptWindow)throw new Error('Snapshot is behind the retained receipt window');
  if(!Array.isArray(source.pending)||source.pending.length>EVENT_LIMITS.pending)throw new Error('Snapshot future queue exceeds capacity');
  if(!Array.isArray(source.lanes)||source.lanes.length!==EVENT_LIMITS.lanes||!source.lanes.every(n=>Number.isSafeInteger(n)&&n>=0))throw new Error('Invalid snapshot lane watermarks');
  monotonicLanes(source,prior);
}

function uniqueLane(packet,seen){if(packet.lane!==undefined){if(seen.has(packet.lane))throw new Error('Duplicate snapshot future lane');seen.add(packet.lane);}}

function monotonicLanes(source,prior){if(source.lanes.some((value,lane)=>prior.versionSequences[lane]<=source.through&&value<prior.versions[lane]))throw new Error('Snapshot lane revision regressed');}
