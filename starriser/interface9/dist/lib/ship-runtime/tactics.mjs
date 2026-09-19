import {LOCAL_FLEET_SLOTS} from './sparse-identity.mjs';
import {CLASS_BY_TYPE} from './classes.mjs';
// CPU-authored regions and intent. They never prescribe individual ship poses.
export const MAX_SPLITS=8;
export const TACTICS=Object.freeze(['direct','pincer','vertical-pincer','envelop']);
function integer(value,min,max,name){if(!Number.isInteger(value)||value<min||value>max)throw new Error(`Invalid ${name}`);}
export function branchOf(ordinal,splits){return ordinal%splits;}
function branchRegion(name,index,side,splits) {
  const sign=index%2===0?-1:1,layer=Math.floor(index/2),spread=12+layer*3;
  if(name==='pincer')return [side*5,3+layer*3,sign*spread];
  if(name==='vertical-pincer')return [side*5,sign*spread,layer*4-4];
  if(name==='envelop'){const angle=index*Math.PI*2/splits;return [side*4,Math.sin(angle)*16,Math.cos(angle)*16];}
  return [side*8,3,0];
}
const DEFAULT_TACTIC=Object.freeze({name:'direct',splits:1,fleet:0,revision:1,at:0,blend:2});
export function authorTactic(options={}) {
  const {name,splits,fleet,revision,at,blend}={...DEFAULT_TACTIC,...options};
  if(!TACTICS.includes(name))throw new Error('Unknown tactic');
  integer(splits,1,MAX_SPLITS,'split count');integer(fleet,0,LOCAL_FLEET_SLOTS-1,'fleet');integer(revision,1,16777215,'tactic revision');
  if(!Number.isFinite(at)||!Number.isFinite(blend)||blend<=0)throw new Error('Invalid tactic clock');
  const side=fleet%2===0?-1:1,detour=detourAllowed(options);
  const branches=Array.from({length:splits},(_,index)=>({offset:branchRegion(name,index,side,splits),radius:4,speed:1,approachWeight:name==='direct'?0:Number(detour)}));
  return {name,splits,fleet,revision,at,blend,detour:options.detour,branches};
}
export function validateJourney(journey) {
  if(!['local','approach','warp','escape','orbit','departure'].includes(journey.mode))throw new Error('Unknown journey mode');
  if(!Number.isFinite(journey.at)||!Number.isFinite(journey.end)||journey.end<journey.at)throw new Error('Invalid journey clock');
  validateExit(journey.exit);
  validateNavigation(journey);
  integer(journey.revision,1,16777215,'journey revision');
  if(journey.mode==='warp'||journey.mode==='escape') {
    if(journey.end===journey.at)throw new Error('Warp needs a positive interval');
  }
  return structuredClone(journey);
}

function validateExit(exit){if(!Array.isArray(exit)||exit.length!==3||!exit.every(Number.isFinite))throw new Error('Invalid journey exit');}

function detourAllowed(options) {
  if(options.type!==undefined)integer(options.type,0,31,'type');
  if(options.detour!==undefined){if(typeof options.detour!=='boolean')throw new Error('Invalid detour intent');return options.detour;}
  return options.type===undefined||CLASS_BY_TYPE[options.type]<3;
}

function validateNavigation(journey) {
  if(journey.planet!==undefined)integer(journey.planet,0,15,'navigation planet');
  if(journey.mode==='orbit'&&journey.planet===undefined)throw new Error('Orbit requires a planet');
  if(journey.planeShift!==undefined&&!Number.isFinite(journey.planeShift))throw new Error('Invalid orbit plane shift');
}
