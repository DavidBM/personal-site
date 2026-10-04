import {BATTLE_STRATEGY_WORDS,validBattleStrategies} from './battle-strategies.mjs';
/** Compact presentation profiles; no combat rules or shader specialization. */
export const BATTLE_TUNING_WORDS=20;
export const BATTLE_TUNING_BYTES=(BATTLE_TUNING_WORDS*6+BATTLE_STRATEGY_WORDS)*4;
export const BATTLE_TUNING_FIELDS=Object.freeze(['speed','cycleTicks','spread','response','shipNoise','shipPeriod','shipVertical','shipEnabled','squadNoise','squadPeriod','squadVertical','squadEnabled','squads','height','cohesion','breakaway','passWidth']);
export const BATTLE_TUNING_LIMITS=Object.freeze([[.05,3],[60,7200],[0,10],[.2,8],[0,1],[10,3600],[0,2],[0,1],[0,1],[30,7200],[0,2],[0,1],[1,16],[.1,2],[0,1],[.1,1],[.1,1]]);
export function defaultBattleTuning(){
 return [1.25,1,.75,.15,.22,.10].map((speed,index)=>({speed,cycleTicks:1200,
  spread:[6.65,2.3,8.55,3.75,10,10][index],response:[3.5,3,1,1.55,1.2,.2][index],
  shipNoise:[1,.5,.18,0,0,0][index],shipPeriod:index===5?10:100,shipVertical:index===0?2:.7,shipEnabled:index<4?1:0,
  squadNoise:[.8,1,.1,.5,.4,0][index],squadPeriod:300,squadVertical:1,squadEnabled:1,squads:16,
  height:[.85,.7,.4,.5,.3,.2][index],cohesion:[.2,0,.65,.55,.7,.8][index],
  breakaway:[.85,.65,1,.55,.35,.2][index],passWidth:[.65,1,.35,.7,.8,.75][index],anchorClass:0,targetClass:0,strategies:Array(16).fill(0)}));
}
const rows=defaultBattleTuning();
const packed=new Float32Array(BATTLE_TUNING_BYTES/4);
const state={version:0,data:packed};
const strategyWords=new Uint32Array(packed.buffer,BATTLE_TUNING_WORDS*6*4);
function pack(){for(let i=0;i<6;i++){
 BATTLE_TUNING_FIELDS.forEach((key,k)=>{packed[i*BATTLE_TUNING_WORDS+k]=rows[i][key];});
 packed[i*BATTLE_TUNING_WORDS+17]=rows[i].anchorClass;
 packed[i*BATTLE_TUNING_WORDS+18]=rows[i].targetClass;
 strategyWords.set(rows[i].strategies,i*16);
}}
pack();
export function battleTuningState(){return state;}
export function battleTuningProfiles(){return rows.map(r=>({...r,strategies:[...r.strategies]}));}
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
    if(updateStrategyTuning(row,patch))changed=true;
  }
  if(changed){state.version++;pack();}return changed;
}

function updateStrategyTuning(row,patch){
 let changed=false;
 for(const key of ['anchorClass','targetClass']){
  const value=patch[key];
  if(Number.isInteger(value)&&value>=0&&value<=6&&value!==row[key]){row[key]=value;changed=true;}
 }
 if(validBattleStrategies(patch.strategies)&&patch.strategies.some((v,i)=>v!==row.strategies[i])){
  row.strategies=[...patch.strategies];changed=true;
 }
 return changed;
}
