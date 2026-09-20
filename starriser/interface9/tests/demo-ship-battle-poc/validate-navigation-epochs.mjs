import assert from 'node:assert/strict';
import {createDirector} from './director.mjs';
const d=createDirector(1000),apply=fields=>d.apply({revision:d.revision+1,fleet:0,type:0,...fields});
const route=(revision,cohort=0)=>apply({cohort,journey:{mode:'approach',revision,at:0,end:20,planet:1,exit:[0,0,0]}});
route(1);const first=d.navigationEpochs[0];assert(first>0);assert.equal(d.navigationEpochs[1],0);
route(2,1);assert.equal(d.navigationEpochs[0],first);assert(d.navigationEpochs[1]>first);
const epochs=d.navigationEpochs.slice();
apply({remaining:19});assert.deepEqual(d.navigationEpochs,epochs);
apply({attackType:2,fire:true});assert.deepEqual(d.navigationEpochs,epochs);
route(1);assert.deepEqual(d.navigationEpochs,epochs);
apply({joined:true});const joined=d.navigationEpochs[0];assert.equal(d.navigationEpochs[1],joined);
apply({joined:false});assert(d.navigationEpochs[0]>joined);
const latest=d.navigationEpochs.slice();assert.throws(()=>apply({strategy:'bad'}));assert.deepEqual(d.navigationEpochs,latest);
assert(!d.apply({revision:1,fleet:0,strategy:'hold'}));assert.deepEqual(d.navigationEpochs,latest);
apply({type:undefined,battle:2});assert(d.navigationEpochs.slice(0,64).every(x=>x===d.revision));assert(d.navigationEpochs.slice(64).every(x=>x===0));
console.log('Navigation epochs preserve independent cohorts, casualty/target-only reports and stale/invalid commands; role changes invalidate both cohorts');

const safe=d.navigationEpochs.slice();assert(!d.apply({revision:Number.MAX_SAFE_INTEGER+1,fleet:0,strategy:'hold'}));assert.deepEqual(d.navigationEpochs,safe);
