// Optional conditional continuation. Authoritative replacement routes may omit
// this; a locally prepared continuation must not revive superseded navigation.
export function routeBasis(director,plan) {
  const group=plan.fleet*32+plan.type,cohort=plan.cohort??0;
  return {journey:director.intents[group].journeys[cohort]?.revision??0,epoch:director.navigationEpochs[group*2+cohort]};
}
export function validateRouteBasis(plan) {
  const basis=plan.basis;if(basis===undefined)return;
  if(!basis||Array.isArray(basis)||Object.keys(basis).length!==2)throw new Error('Invalid route continuation basis');
  for(const key of ['journey','epoch'])if(!Number.isSafeInteger(basis[key])||basis[key]<0)throw new Error('Invalid route continuation basis');
}
export function routeBasisMatches(director,plan) {
  validateRouteBasis(plan);if(plan.basis===undefined)return true;
  const current=routeBasis(director,plan);
  return current.journey===plan.basis.journey&&current.epoch===plan.basis.epoch;
}
