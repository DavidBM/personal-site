import {createEngine} from './engine.mjs';
const centers=[[-160,0,0],[160,0,0]];
const encounter=fleet=>({name:`Battle ${Math.floor(fleet/2)+1}`,center:centers[Math.floor(fleet/2)],halfExtent:128,blend:2});
const planet=()=>({name:'Planet',planet:1,halfExtent:320,blend:2});
const event=(id,time,label,commands)=>({id,effectiveAt:time,deliveredAt:time,label,commands});
export async function createScopeDemo(canvas,settings) {
  const engine=await createEngine(canvas,{...settings,scenario:5,fleetCount:4,fleetCenters:[centers[0],centers[0],centers[1],centers[1]]});
  const fleets=[0,1,2,3];
  for(const fleet of fleets)engine.command({revision:engine.director.revision+1,fleet,
    pressure:{...encounter(fleet),blend:0},battle:Math.floor(fleet/2)+1,team:fleet%2,battleCenter:centers[Math.floor(fleet/2)],joined:true,fire:true});
  const events=[
    event('two-battles',0,'Two battles with independent pressure',[]),
    event('shared-planet',12,'Pressure merges around the moving planet; battles stay independent',fleets.map(fleet=>({fleet,pressure:planet()}))),
    event('split-pressure',20,'Pressure splits back into two encounter fields',fleets.map(fleet=>({fleet,pressure:encounter(fleet)}))),
    event('peace',28,'Director ends both battles and orders planetary orbit',fleets.map(fleet=>({fleet,pressure:planet(),joined:false,fire:false,
      journey:{mode:'orbit',revision:1,at:28,end:28,exit:[0,0,0],planet:1}}))),
  ];
  const queue=engine.events.replay(events);
  engine.sequence={events,history:queue.history,duration:60};
  return engine;
}
