import {logicalInteger} from './population-accounting.mjs';

// A directed ownership transfer is a new representation boundary for its source
// cohort. Reanchor surviving representatives to the explicit remaining logical
// count; keep casualties and unadmitted reservations separately.
export function departingBatches(batches,cohort,live,selected,logical,residual) {
  const active=batches.filter(b=>b.cohort===cohort&&b.admitted);
  const total=active.reduce((sum,b)=>sum+b.logical,residual);
  const selectedSet=new Set(selected),liveSet=new Set(live);
  if(selectedSet.size!==selected.length||selected.some(n=>!liveSet.has(n)))throw Error('Regrouping requires distinct live source ordinals');
  const remaining=live.length-selected.length;
  if(!logicalInteger(logical)||logical<Math.max(1,selected.length)||total-logical<remaining)throw Error('Regrouping logical count does not represent its source survivors');
  const kept=active.flatMap(b=>b.ordinals).filter(n=>!selectedSet.has(n));
  const living=kept.filter(n=>liveSet.has(n)),dead=kept.filter(n=>!liveSet.has(n));
  const next=batches.filter(b=>b.cohort!==cohort||!b.admitted);
  if(dead.length)next.push(anchor(dead,cohort,0));
  if(living.length)next.push(anchor(living,cohort,total-logical));
  return {batches:next,residual:living.length?0:total-logical};
}

function anchor(ordinals,cohort,logical) {
  ordinals.sort((a,b)=>a-b);
  return {first:ordinals[0],count:ordinals.length,cohort,initialLogical:Math.max(ordinals.length,logical),logical,ordinals,admitted:true};
}
