import {validateCorrectionBudget} from './correction-budget.mjs';
import {validatePressureBudget} from './pressure-budget.mjs';
import {prepareRuntimeSnapshot} from './runtime-snapshot.mjs';
import {createFrameStepper} from './frame-stepper.mjs';
import {validateEventFrame,eventFrameOverflow} from './event-frame.mjs';
import {createEventInbox} from './event-inbox.mjs';
import {createEventQueue} from './event-queue.mjs';
import {validateLiveEvent,routeIsNewer} from './event-validation.mjs';
import {decodeDirectorPacket,directorPacketFingerprint} from '../../../dist/lib/ship-runtime/packet.js';
// One integration owner for startup replay and packets received during motion.
// Each group owns a bounded GPU event sequence; the full physical pipeline
// runs once per tick regardless of how many groups receive independent orders.
export function attachEventRuntime(engine) {
  const step=engine.step,reset=engine.reset,destroy=engine.destroy;
  let inbox=createEventInbox({validate:event=>validateLiveEvent(event,engine)}),replay=null,snapshotRevision=0,recoveries=0;
  const apply=event=>engine.applyCommands(event.commands,event.routes??[]);
  function applyLive(event) {
    const routes=(event.routes??[]).filter(plan=>routeIsNewer(plan,engine));
    if(engine.applyCommands(event.commands,routes).some(accepted=>!accepted))throw new Error('Live route admission rejected; earlier valid reports remain applied');
    return event.routes?.length&&event.commands.length===0&&routes.length===0?'superseded':'applied';
  }
  function applyDue(time) {
    const due=[...(replay?.through(time)??[]),...inbox.through(time)];
    if(due.length===0)return 0;
    validatePressureBudget(due,engine.pressure);
    return engine.batchCommands(()=>(replay?.drain(time,apply)??0)+inbox.drain(time,applyLive));
  }
  function activate(time,options) {
    const count=applyDue(time);
    if(count)step(time,0,options);
    return count;
  }
  function validate(time,dt) {
    if(!Number.isFinite(time)||time<engine.now||!Number.isFinite(dt)||dt<0)throw new Error('Invalid directed runtime clock');
    engine.clock.shiftFor(time);
  }
  function directedFrame(time,dt,options,events) {
    const start=Math.max(engine.now,time-dt);
    validateEventFrame(events,start,engine.director.capacity,engine.director.occupied);validatePressureBudget(events,engine.pressure);
    validateCorrectionBudget(events,start,time,engine.director,engine.count,engine.clock.origin+engine.clock.shiftFor(time));
    if(time-start>32)throw eventFrameOverflow('Directed interval exceeds 32 seconds; reconcile the interval');
    const boundaries=[...new Set(events.map(event=>Math.max(start,event.effectiveAt,event.deliveredAt)))].sort((a,b)=>a-b);
    if(start>engine.now+1e-7)step(start,0,options);
    engine.prepareEventFrame(start,time);
    engine.batchCommands(()=>{
      for(const boundary of boundaries)engine.withEventTime(boundary,()=>{
        replay?.drain(boundary,apply);inbox.drain(boundary,applyLive);engine.eventFrame.capture(boundary);
      });
    });
    engine.finishEventFrame();step(time,time-start,{...options,temporal:true});
  }
  engine.step=(time,dt,options)=>{
    if(engine.closed)return false;validate(time,dt);
    const events=[...(replay?.through(time)??[]),...inbox.through(time)];
    if(events.length===0)return step(time,dt,options);
    if(dt===0){step(time,0,options);activate(time,options);return;}
    directedFrame(time,dt,options,events);
  };
  engine.receiveEvent=(packet,expected,receivedAt=engine.now)=>{
    if(expected!==engine.lifetime)return {status:'superseded'};
    if(packet instanceof ArrayBuffer) {
      const decoded=decodeDirectorPacket(packet);
      delete decoded.authority;
      return inbox.receive(decoded,receivedAt,{fingerprint:directorPacketFingerprint(packet),bytes:packet.byteLength});
    }
    return inbox.receive(packet,receivedAt);
  };
  engine.enqueueEvent=({effectiveAt=engine.now,...event},receivedAt=engine.now)=>engine.receiveEvent({id:`live-${inbox.nextSequence}`,sequence:inbox.nextSequence,effectiveAt,commands:[],...event},engine.lifetime,receivedAt);
  engine.applyDueEvents=time=>engine.closed?0:applyDue(time);
  engine.flushEvents=options=>engine.closed?0:activate(engine.now,options);
  const encode=engine.encodeTick;
  engine.encodeTick=(encoder,time,dt,options)=>{
    if(engine.closed)return;
    applyDue(time);
    return encode.call(engine,encoder,time,dt,options);
  };
  engine.events={projectionSource(time){return {...inbox.projectSource(time),replay:replay?.through(time)??[],hasReplay:Boolean(replay)};},get inbox(){return inbox;},get recovery(){return {revision:snapshotRevision,count:recoveries};},get history(){return inbox.history;},get lastFailure(){return inbox.lastFailure;},
    receiver(){const lifetime=engine.lifetime;return (packet,receivedAt)=>engine.receiveEvent(packet,lifetime,receivedAt);},
    replay(events){if(replay)throw new Error('Replay is already installed');replay=createEventQueue(events);return replay;}};
  const presentation=createFrameStepper(engine);engine.presentation=presentation;engine.advanceTo=presentation.advance;
  engine.installSnapshot=(value,lifetime)=>{
    if(engine.closed||lifetime!==engine.lifetime)return {status:'superseded'};
    const prepared=prepareRuntimeSnapshot(engine,value,inbox,{revision:snapshotRevision,replay:Boolean(replay)});
    engine.commitSnapshot(prepared);prepared.activate();inbox=prepared.inbox;
    replay?.reconcile(prepared.at);snapshotRevision=prepared.revision;recoveries++;presentation.reset();
    return {status:'reconciled',at:prepared.at,revision:snapshotRevision,count:recoveries};
  };
  engine.reset=(...args)=>{inbox.reset();replay=null;snapshotRevision=0;recoveries=0;reset(...args);presentation.reset();};
  engine.destroy=()=>{inbox.destroy();destroy();};
  return engine;
}
