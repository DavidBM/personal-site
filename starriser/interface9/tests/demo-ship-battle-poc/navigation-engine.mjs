import {routeBasis} from './route-basis.mjs';
import {createProgressRetargeter} from './progress-navigation.mjs';
import {prepareApproaches,admitApproach} from './navigation-planner.mjs';
import {createEngine} from './engine.mjs';
export async function createNavigationEngine(canvas,settings) {
  const engine=await createEngine(canvas,{...settings,navigation:true,cellSize:8,pressurePlanet:1});
  const scenario=settings.scenario,warpEnd=settings.warpEnd??8;
  const approaches=await initialApproaches(engine,scenario,warpEnd);
  const directive=()=>({mode:scenario===0?'orbit':scenario===3?'warp':'approach',revision:1,at:0,end:scenario===3?warpEnd:0,exit:[-20,0,0],planet:1});
  if(scenario===0||scenario===3)for(const fleet of [0,1])engine.command({revision:engine.director.revision+1,fleet,journey:directive()});
  if(scenario!==0&&scenario!==3)for(const plan of approaches)admitApproach(engine,plan);
  if(scenario===3)engine.enqueueEvent({effectiveAt:warpEnd,routes:approaches.map(plan=>({...plan,basis:routeBasis(engine.director,plan)}))});
  const retargeter=createProgressRetargeter(engine);
  engine.setPhase=retargeter.retarget;
  Object.defineProperty(engine,'navigationStatus',{get:()=>retargeter.status});
  return engine;
}

async function initialApproaches(engine,scenario,warpEnd) {
  if(scenario===0)return [];
  try{return await prepareApproaches(engine,{warp:scenario===3,at:scenario===3?warpEnd:0,revision:scenario===3?2:1});}
  catch(error){engine.destroy();throw error;}
}
