import {authorTactic,validateJourney} from './tactics.mjs';
import {createEventQueue as eventQueue} from './event-queue.mjs';
export const SEQUENCE_DURATION=60;
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function event(id,at,label,commands,delay=0){return {id,effectiveAt:at,deliveredAt:at+delay,label,commands};}
const journey=(mode,revision,at,end,exit,cohort=0)=>({cohort,journey:validateJourney({mode,revision,at,end,exit})});
export function createSequence() {
  return freeze([
    event('approach',0,'Blue approaches moving planet',[{fleet:0,...journey('approach',1,0,12,[-8,5,5])}]),
    event('arrival',2,'Orange begins warp arrival',[{fleet:1,...journey('warp',1,2,7,[24,10,-10])}]),
    event('reroute',4,'Blue route changes in flight',[{fleet:0,...journey('approach',2,4,12,[-5,5,-8])}]),
    event('exit-warp',7,'Orange exits warp and approaches',[{fleet:1,...journey('approach',2,7,12,[8,5,-5])}]),
    event('battle',12,'Backend starts battle: two-wing pincer',[0,1].map(fleet=>({fleet,...journey('local',3,12,12,[0,0,0]),joined:true,strategy:'pass',attackClass:5,fire:true,tactic:authorTactic({fleet,name:'pincer',splits:2,revision:1,at:12})}))),
    event('vertical',18,'Four-wing vertical tactic',[0,1].map(fleet=>({fleet,tactic:authorTactic({fleet,name:'vertical-pincer',splits:4,revision:2,at:18})}))),
    event('reinforcement',22,'Fresh Orange cohort warps in',[{fleet:1,admit:1,...journey('warp',3,22,26,[24,-6,8],1)}]),
    event('blue-reinforcement',24,'Fresh Blue cohort warps in',[{fleet:0,admit:1,...journey('warp',1,24,28,[-24,8,10],1)}]),
    event('blue-reinforcement-ready',28,'Blue reinforcements join the attack',[{fleet:0,...journey('local',2,28,28,[0,0,0],1)}]),
    event('reinforcement-ready',26,'Reinforcements join the attack',[{fleet:1,...journey('local',4,26,26,[0,0,0],1)}]),
    event('late-loss',27,'Delayed report: Blue loses 20%',[{fleet:0,cohort:0,survivalFraction:.8}],1),
    event('retarget',31,'Small wings switch to enemy fighters',[0,1].map(fleet=>({fleet,attackClass:1}))),
    event('losses',36,'Backend reports further casualties',[{fleet:0,cohort:0,survivalFraction:.6},{fleet:1,cohort:0,survivalFraction:.8}]),
    event('withdraw',40,'Blue ordered to withdraw',[0,1].map(cohort=>({fleet:0,strategy:'withdraw',fire:false,...journey('approach',4,40,48,[-26,8,-14],cohort)}))),
    event('escape',48,'Blue disengages and jumps out',[0,1].map(cohort=>({fleet:0,joined:false,...journey('escape',5,48,52,[-90,8,-14],cohort)}))),
    event('battle-end',52,'Battle ends; Orange returns to planet',[0,1].map(cohort=>({fleet:1,joined:false,strategy:'hold',fire:false,...journey('approach',5,52,60,[5,5,4],cohort)}))),
  ].sort((a,b)=>a.effectiveAt-b.effectiveAt));
}
// Events are delivered and become effective independently. The integrator owns
// time; this queue merely supplies exact boundaries and admitted immutable facts.
export function createEventQueue(events=createSequence()) {
  return eventQueue(events);
}
