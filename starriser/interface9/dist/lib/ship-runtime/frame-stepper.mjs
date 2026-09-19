export const PRESENTATION_TICK=1/120;
export const PRESENTATION_FREEZE=0.3;
export const PRESENTATION_LIMITS=Object.freeze({steps:1,debt:PRESENTATION_FREEZE});

function simDt(engine) {
  const dt=engine.simDt??PRESENTATION_TICK;
  if(!Number.isFinite(dt)||dt<=0)throw new Error('Invalid simulation dt');
  return dt;
}

export function createFrameStepper(engine) {
  let target=engine.now,reason=null,skipped=0,frozen=false,lastGap=0;
  function reset(){target=engine.now;reason=null;skipped=0;frozen=false;lastGap=0;}
  function state(steps=0,activations=0) {
    const dt=simDt(engine),debt=Math.max(0,target-engine.now);
    const status=reason?'needs-reconciliation':frozen?'needs-reconciliation':debt>=dt-1e-9?'catching-up':'ready';
    return {status,reason,target,simulated:engine.now,debt,steps,activations,alpha:Math.min(1,debt/dt),skipped,frozen,simHz:1/dt,gapMs:lastGap*1000,ticked:steps};
  }
  function integrate(gap,options) {
    const dt=simDt(engine);let steps=0,activations=0;
    try {
      if(gap>PRESENTATION_FREEZE){frozen=true;reason=reason??'suspension';return {steps,activations};}
      if(target-engine.now>=dt-1e-9) {
        engine.step(engine.now+dt,dt,stepOptions(options,0));steps=1;frozen=false;
      } else {
        skipped++;
        activations=Number((engine.flushEvents?.(options)??0)>0);
      }
    }catch(error) {
      if(error.code!=='event-frame-capacity')throw error;
      reason='event-overflow';
    }
    return {steps,activations};
  }
  function advance(time,options) {
    if(engine.closed)return {...state(),status:'closed'};
    engine.clock.shiftFor(time);
    if(engine.now>target)target=engine.now;
    if(time<target||time<engine.now)throw new Error('Presentation clock cannot rewind');
    lastGap=time-target;target=time;if(reason)return state();
    const {steps,activations}=integrate(lastGap,options);
    return state(steps,activations);
  }
  return {advance,reset,get state(){return state();}};
}

function stepOptions(options,index){return options?.querySet?{...options,queryIndex:(options.queryIndex??0)+index*2}:options;}
