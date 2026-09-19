const FIELDS=new Set(['from','to','type','cohort','visual','logical']);

// No positions are accepted: the director transfers membership, and the GPU
// retains the individual motion state. Select by stable serial, never slot order.
export function regroupPopulation(roster,population,input) {
  const requests=structuredClone(Array.isArray(input)?input:[input]);
  if(!requests.length||requests.length>roster.fleetCount*64)throw Error('Regrouping batch exceeds cohort capacity');
  const candidate=roster.clone(),used=new Set(),departures=[];
  for(const request of requests) {
    validate(request,roster.fleetCount);
    const indices=selectSource(population,roster,request,used);
    departures.push({...request,cohort:request.cohort??0,indices});
  }
  // All departures precede arrivals, permitting atomic exchanges even when
  // both destination type tables initially occupy all 256 ordinals.
  for(const row of departures)candidate.depart(row.from,row.type,row.indices.map(i=>population.keys[i]&255),row.logical,row.cohort);
  const members=[],groups=new Set();
  for(const row of departures) {
    const batch=row.visual?candidate.reinforce(row.to,row.type,row.visual,row.logical,row.cohort):candidate.receiveLogical(row.to,row.type,row.logical,row.cohort);
    row.indices.forEach((index,n)=>members.push({index,id:population.ids[index],previousKey:population.keys[index],key:(row.to*32+row.type)*256+batch.ordinals[n],cohort:row.cohort}));
    groups.add(row.from*32+row.type);groups.add(row.to*32+row.type);
  }
  return {roster:candidate,population:population.reassign(members),members,groups:[...groups]};
}

function validate(row,fleets) {
  if(!row||typeof row!=='object'||Object.keys(row).some(k=>!FIELDS.has(k)))throw Error('Invalid regrouping fields; transfers use the current simulation boundary');
  validateAddress(row,fleets);
  if(!Number.isInteger(row.visual)||row.visual<0||row.visual>256)throw Error('Invalid regrouping visual count');
}

function validateAddress(row,fleets) {
  if(![row.from,row.to].every(f=>Number.isInteger(f)&&f>=0&&f<fleets)||row.from===row.to)throw Error('Regrouping needs distinct known fleets');
  if(!Number.isInteger(row.type)||row.type<0||row.type>=32||![0,1].includes(row.cohort??0))throw Error('Unknown regrouping type or cohort');
}

function selectSource(population,roster,row,used) {
  const group=row.from*32+row.type,cohort=row.cohort??0,indices=[];
  for(let i=0;i<population.count;i++) {
    const key=population.keys[i];
    if(key>>>8===group&&population.cohorts[i]===cohort&&!used.has(i)&&roster.isLive(row.from,row.type,key&255))indices.push(i);
  }
  indices.sort((a,b)=>population.ids[a]-population.ids[b]);
  if(indices.length<row.visual)throw Error('Not enough live representatives in the source cohort');
  const selected=indices.slice(0,row.visual);for(const i of selected)used.add(i);return selected;
}

export function preparePopulationRegrouping(director,input) {
  const candidate=director.fork(),members=candidate.regroup(input);
  return {director:candidate,members};
}
