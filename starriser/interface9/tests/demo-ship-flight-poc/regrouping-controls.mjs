// Mock director: choose coarse counts. Individual selection and GPU state
// preservation belong to the runtime, not the UI.
export function halfFleetRequests(engine,from) {
  const roster=engine.director.roster,to=(from+1)%roster.fleetCount,requests=[];
  if(to===from)throw Error('A second fleet is needed for regrouping');
  for(let type=0;type<32;type++) {
    let free=256-roster.retainedFor(to,type);
    for(let cohort=0;cohort<2;cohort++) {
      const batches=roster.batches[from*32+type].filter(b=>b.admitted&&b.cohort===cohort);
      const live=batches.flatMap(b=>b.ordinals).filter(n=>roster.isLive(from,type,n)).length;
      const total=batches.reduce((sum,b)=>sum+b.logical,roster.residual[(from*32+type)*2+cohort]);
      const visual=Math.min(free,Math.ceil(live/2)),logical=live?Math.floor(total*visual/live):Math.ceil(total/2);
      if(logical>0){requests.push({from,to,type,cohort,visual,logical});free-=visual;}
    }
  }
  if(!requests.length)throw Error('No transferable ships or destination capacity');
  return requests;
}

export function bindRegrouping(getEngine,onError) {
  const button=document.getElementById('regroup');let pending=false;
  button.onclick=async()=>{
    const engine=getEngine();if(!engine||pending)return;pending=true;button.disabled=true;
    try {
      const from=Number(document.getElementById('fleet').value);
      const result=await transferCurrent(engine,getEngine,from);
      if(getEngine()!==engine)return;
      if(result.status!=='applied')throw Error(`Regrouping ${result.status}; retry at the current scene time`);
      onError('');
    }catch(error){if(getEngine()===engine)onError(error.message);}
    finally{pending=false;button.disabled=false;}
  };
}

async function transferCurrent(engine,getEngine,from) {
  const lifetime=engine.lifetime;let result;
  for(let attempt=0;attempt<3;attempt++) {
    result=await engine.regroup(halfFleetRequests(engine,from),{lifetime});
    if(result.status!=='superseded'||getEngine()!==engine||engine.lifetime!==lifetime)break;
  }
  return result;
}
