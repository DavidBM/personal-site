import assert from 'node:assert/strict';
import {createDirector} from './director.mjs';
import {validateCorrectionBudget} from './correction-budget.mjs';
const d=createDirector(1000,{reserveFraction:.25});
const journey=(mode,end)=>({mode,end,at:0,revision:1,exit:[0,0,0]});
const event=(mode,end,at=1)=>({effectiveAt:at,deliveredAt:0,commands:[0,1].map(fleet=>({fleet,cohort:0,journey:journey(mode,end)}))});
const budget=events=>validateCorrectionBudget(events,1,2,d,1000);
assert.equal(budget([]),0);
for(let fleet=0;fleet<2;fleet++)for(let cohort=0;cohort<2;cohort++)d.apply({revision:d.revision+1,fleet,cohort,journey:journey('approach',1.5)});
assert.equal(budget([]),1000); // Two disjoint cohort ranges, not two full populations.
assert.equal(budget([event('approach',1.7)]),2000);
assert.throws(()=>budget([event('approach',1.7),event('warp',.5)]),/Correction history/);
assert.equal(budget([event('approach',3),event('warp',1.8)]),1000);
assert.equal(budget([event('warp',1+1e-8)]),2000); // Same f32 admission boundary.
assert.equal(validateCorrectionBudget([event('warp',257+1e-8,257)],257,258,d,1000,192),2000);
assert.equal(budget([{effectiveAt:1,deliveredAt:0,commands:[],routes:[{fleet:0,type:0,revision:2,request:{end:1.5}}]}]),1000+d.roster.sizes[0]);
const reserved=createDirector(1000,{reserveFraction:.8});
reserved.apply({revision:1,fleet:0,journey:journey('approach',1.5)});
assert.equal(validateCorrectionBudget([],1,2,reserved,1000),500);
assert.throws(()=>validateCorrectionBudget([event('warp',.5),event('warp',.5),event('warp',.5)],1,2,reserved,1000),/Correction history/);
console.log('ok: correction budget covers cohort ranges, replacement bursts and GPU clock quantization');
