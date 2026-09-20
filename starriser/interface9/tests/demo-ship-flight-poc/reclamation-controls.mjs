export function bindReclamation(getEngine,onError) {
  const button=document.getElementById('reclaim-storage');let pending=false;
  button.onclick=async()=>{
    const engine=getEngine();if(!engine||pending)return;pending=true;button.disabled=true;
    try {
      const result=await reclaimCurrent(engine,getEngine);
      if(getEngine()===engine&&result.status==='applied')onError('');
    }catch(error){if(getEngine()===engine)onError(error.message);}
    finally{pending=false;button.disabled=false;}
  };
}

async function reclaimCurrent(engine,getEngine) {
  const lifetime=engine.lifetime;let result;
  for(let attempt=0;attempt<3;attempt++) {
    result=await engine.reclaim();
    if(result.status!=='superseded'||getEngine()!==engine||engine.lifetime!==lifetime)break;
  }
  return result;
}
