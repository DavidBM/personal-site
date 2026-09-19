const ready=event=>Math.max(event.effectiveAt,event.deliveredAt);
function freeze(value) {
  if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
}
function valid(event) {
  return typeof event.id==='string'&&event.id.length>0&&[event.effectiveAt,event.deliveredAt].every(Number.isFinite)&&Array.isArray(event.commands);
}
function snapshot(events) {
  if(!Array.isArray(events)||events.length>4096)throw new Error('Event replay must contain at most 4096 events');
  const ids=new Map(),result=[];
  for(const value of events) {
    const event=structuredClone(value);
    if(!valid(event))throw new Error('Invalid directed event');
    const key=JSON.stringify(event),previous=ids.get(event.id);
    if(previous!==undefined&&previous!==key)throw new Error('Conflicting directed event identity');
    if(previous===undefined){ids.set(event.id,key);result.push(freeze(event));}
  }
  return result.sort((a,b)=>ready(a)-ready(b));
}
// Finite, immutable replay journal. Delivery and effect are independent; a late
// event is admitted at the current clock, never by rewinding the simulation.
export function createEventQueue(events) {
  const pending=snapshot(events),history=[];let cursor=0,clock=-Infinity;
  function nextBoundary(now,end) {
    if(!Number.isFinite(now)||!Number.isFinite(end)||end<now)throw new Error('Invalid event interval');
    const item=pending[cursor];return item?Math.min(end,Math.max(now,ready(item))):end;
  }
  function drain(now,apply) {
    if(!Number.isFinite(now)||now<clock-1e-7)throw new Error('Event admission cannot rewind time');
    clock=Math.max(clock,now);let count=0;
    while(cursor<pending.length&&ready(pending[cursor])<=clock) {
      const item=pending[cursor];
      const admission={id:item.id,effectiveAt:item.effectiveAt,receivedAt:item.deliveredAt,appliedAt:clock,late:clock-item.effectiveAt>1e-6,label:item.label};
      apply(item,admission);cursor++;count++;history.push(admission);
    }
    return count;
  }
  function reconcile(time) {
    return drain(time,(_,admission)=>{admission.status='reconciled';});
  }
  return {nextBoundary,drain,reconcile,history,through:time=>pending.slice(cursor).filter(event=>ready(event)<=time),get complete(){return cursor===pending.length;}};
}
