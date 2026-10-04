/** Stable IDs shared by the editor and squad-only GPU dispatch. */
export const BATTLE_STRATEGIES=Object.freeze([
 'Automatic','Capital cruise','Guard and intercept','Escort bombers','Strike and return',
 'Pursuit','Evasion','Orbit enemy','Attack pass','Pincer','Regroup','Friendly orbit',
]);
export const BATTLE_STRATEGY_WORDS=6*16;
export function validBattleStrategies(value){
 if(!Array.isArray(value)||value.length!==16)return false;
 for(let i=0;i<16;i++)if(!Number.isInteger(value[i])||value[i]<0||value[i]>=BATTLE_STRATEGIES.length)return false;
 return true;
}
