import {createDirector} from './director.mjs';
import assert from 'node:assert/strict';
import {cohortSizes} from './classes.mjs';
import {createRoster} from './roster.mjs';
import {authorTactic,branchOf,validateJourney} from './tactics.mjs';
import {createSequence,createEventQueue} from './sequence.mjs';
const roster=createRoster(cohortSizes(5000),{reserveFraction:.2});
const count=f=>Array.from({length:32},(_,t)=>roster.count(f,t)).reduce((a,b)=>a+b,0);
const initial=count(1),ids=new Uint32Array(roster.admitted);
assert(initial<5000&&initial>3900);
roster.lose(1,0,.8);const survivors=count(1);assert.equal(survivors,Math.round(initial*.8));
const dead=[];for(let t=0;t<32;t++)for(let n=0;n<roster.split[t];n++)if(!roster.isLive(1,t,n))dead.push([t,n]);
assert(roster.admit(1,1));assert.equal(count(1),survivors+5000-initial);
assert(dead.every(([t,n])=>!roster.isLive(1,t,n)));
assert.equal(roster.admit(1,1),false);assert.throws(()=>roster.lose(1,0,1));
assert.equal(count(0),initial);assert(ids.some((x,i)=>x!==roster.admitted[i]));
const copy=roster.clone();copy.lose(1,1,0);assert(copy.live.some((x,i)=>x!==roster.live[i]));
for(let splits=1;splits<=8;splits++) {
 const tactic=authorTactic({name:'pincer',splits});assert.equal(tactic.branches.length,splits);
 const membership=Array.from({length:256},(_,i)=>branchOf(i,splits));
 assert(membership.every(x=>x>=0&&x<splits));assert.equal(new Set(membership).size,splits);
}
assert.throws(()=>authorTactic({splits:9}));assert.throws(()=>authorTactic({name:'bad'}));
assert.throws(()=>validateJourney({mode:'warp',revision:1,at:2,end:1,exit:[0,0,0]}));
const sequence=createSequence(),queue=createEventQueue(sequence),applied=[];
assert(Object.isFrozen(sequence)&&Object.isFrozen(sequence[0].commands));
for(let t=0;t<=60;t+=.25)queue.drain(t,item=>applied.push(item.id));
assert.equal(applied.length,sequence.length);assert(queue.complete);
assert.equal(queue.history.find(x=>x.id==='late-loss').appliedAt,28);
assert(queue.history.find(x=>x.id==='late-loss').late);
queue.drain(100,()=>assert.fail('repeated event'));assert.equal(queue.nextBoundary(60,61),61);
const duplicate=createEventQueue([sequence[0],sequence[0]]);let admissions=0;duplicate.drain(0,()=>admissions++);assert.equal(admissions,1);
console.log('Director cohort admission, losses, branch authoring and timeline checks passed');

const directed=createDirector(1000,{reserveFraction:.2}),liveBefore=directed.roster.live.slice();
assert.throws(()=>directed.apply({revision:1,fleet:0,admit:1,strategy:'invalid'}));
assert.deepEqual(directed.roster.live,liveBefore);assert.equal(directed.revision,0);
assert.throws(()=>directed.apply({revision:1,fleet:0,cohort:1,survivalFraction:.5}));
assert.equal(directed.apply({revision:1,fleet:0,admit:1}),true);
assert.equal(directed.apply({revision:1,fleet:0,survivalFraction:0}),false);
console.log('Director rejects partial admission and stale or premature losses');

assert(authorTactic({type:31,name:'pincer'}).branches.every(x=>x.approachWeight===0));
assert(authorTactic({type:31,name:'pincer',detour:true}).branches.every(x=>x.approachWeight===1));
console.log('CPU owns per-type detour choice, including explicit capital overrides');
