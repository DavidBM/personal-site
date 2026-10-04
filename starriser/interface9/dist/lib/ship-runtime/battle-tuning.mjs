/** Compact presentation profiles; no combat rules or shader specialization. */
export const BATTLE_TUNING_WORDS=20;
export const BATTLE_TUNING_FIELDS=Object.freeze(['speed','cycleTicks','spread','response','shipNoise','shipPeriod','shipVertical','shipEnabled','squadNoise','squadPeriod','squadVertical','squadEnabled','squads','height','cohesion','breakaway','passWidth']);
export const BATTLE_TUNING_LIMITS=Object.freeze([[.05,3],[60,7200],[0,10],[.2,8],[0,1],[10,3600],[0,2],[0,1],[0,1],[30,7200],[0,2],[0,1],[1,16],[.1,2],[0,1],[.1,1],[.1,1]]);
export function defaultBattleTuning(){
 return [1.25,1,.75,.45,.22,.10].map((speed,index)=>({speed,cycleTicks:1200,
  spread:[.7,.65,.45,.5,.35,.25][index],response:[3.5,3,2.3,1.8,1.2,.9][index],
  shipNoise:index<3?.18:0,shipPeriod:100,shipVertical:.7,shipEnabled:1,
  squadNoise:[.3,.25,.15,.18,.12,.08][index],squadPeriod:300,squadVertical:1,squadEnabled:1,squads:16,
  height:[.85,.7,.4,.5,.3,.2][index],cohesion:[.2,.3,.65,.55,.7,.8][index],
  breakaway:[.85,.65,1,.55,.35,.2][index],passWidth:[.65,.5,.35,.7,.8,.75][index]}));
}
const rows=defaultBattleTuning();
const packed=new Float32Array(BATTLE_TUNING_WORDS*6);
const state={version:0,data:packed};
function pack(){for(let i=0;i<6;i++)BATTLE_TUNING_FIELDS.forEach((key,k)=>{packed[i*BATTLE_TUNING_WORDS+k]=rows[i][key];});}
pack();
export function battleTuningState(){return state;}
export function battleTuningProfiles(){return rows.map(r=>({...r}));}
export function scheduleBattleTuning(patches){
  if(!Array.isArray(patches)||patches.length>6)return false;
  let changed=false;
  for(const patch of patches){
    if(!Number.isInteger(patch?.index)||patch.index<0||patch.index>=6)continue;
    const row=rows[patch.index];
    BATTLE_TUNING_FIELDS.forEach((key,i)=>{
      if(!Number.isFinite(patch[key]))return;
      const [min,max]=BATTLE_TUNING_LIMITS[i];let value=Math.max(min,Math.min(max,patch[key]));
      if(key==='squads'||key.endsWith('Ticks')||key.endsWith('Period'))value=Math.round(value);
      if(row[key]!==value){row[key]=value;changed=true;}
    });
  }
  if(changed){state.version++;pack();}return changed;
}
