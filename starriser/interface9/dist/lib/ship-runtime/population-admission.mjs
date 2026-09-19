import {classOf,radiusOf} from './classes.mjs';
const FIELDS=new Set(['fleet','type','cohort','visual','logical','position','velocity','spread']);
function vector(value,name) {
  if(!Array.isArray(value)||value.length!==3||value.some(x=>!Number.isFinite(x)||Math.abs(x)>1e9))throw Error(`Invalid reinforcement ${name}`);
  return [...value];
}
export function preparePopulationAdmission(director,input) {
  const requests=structuredClone(Array.isArray(input)?input:[input]);
  if(requests.length<1||requests.length>director.capacity.groups)throw Error('Population admission batch exceeds group capacity');
  const candidate=director.fork(),batches=[];
  for(const request of requests) {
    validateFields(request);const {position,velocity,spread}=region(request);
    const batch=candidate.reinforce({revision:candidate.revision+1,fleet:request.fleet,type:request.type,cohort:request.cohort??0,visual:request.visual,logical:request.logical});
    batches.push({...batch,position,velocity,spread});
  }
  return {director:candidate,batches};
}

function region(request) {
  const kind=shipKind(request.type);
  const position=vector(request.position,'position'),velocity=vector(request.velocity??[0,0,0],'velocity');
  const spread=request.spread??Math.max(8,radiusOf(request.type)*2);
  if(!Number.isFinite(spread)||spread<0||spread>1e6)throw Error('Invalid reinforcement spread');
  const speed=kind.speed;
  if(!speed||Math.hypot(...velocity)>speed+1e-6)throw Error('Reinforcement velocity exceeds cruise speed');
  return {position,velocity,spread};
}

function shipKind(type) {
  if(!Number.isInteger(type)||type<0||type>=32)throw Error('Invalid reinforcement type');
  return classOf(type);
}

function validateFields(request) {
  if(!request||typeof request!=='object'||Object.keys(request).some(key=>!FIELDS.has(key)))throw Error('Invalid reinforcement fields; admission uses the current simulation boundary');
}
