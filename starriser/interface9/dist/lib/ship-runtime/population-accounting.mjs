import {batchOrdinals} from './roster-membership.mjs';
// Admission batches keep their original representation ratio through later
// reinforcements. A new batch never changes how earlier casualties are rounded.
export const MAX_LOGICAL=0xffffffff;
export function logicalInteger(value){return Number.isInteger(value)&&value>=0&&value<=MAX_LOGICAL;}
export function visualQuota(batch) {
  const numerator=BigInt(batch.count)*BigInt(batch.logical),denominator=BigInt(batch.initialLogical);
  return Number((numerator*2n+denominator)/(denominator*2n));
}
export function initialBatches(sizes,split,fleets) {
  return Array.from({length:fleets*32},(_,group)=>{
    const type=group%32;
    return [[0,split[type],0],[split[type],sizes[type]-split[type],1]].filter(([,count])=>count>0)
      .map(([first,count,cohort])=>({first,count,cohort,initialLogical:count*20,logical:count*20,ordinals:batchOrdinals(first,count),admitted:false}));
  });
}
export function removeLogical(batches,remaining) {
  const total=batches.reduce((sum,batch)=>sum+batch.logical,0);
  if(!logicalInteger(remaining)||remaining>total)throw Error('Loss report cannot restore logical ships');
  if(total===0)return;
  const lost=BigInt(total-remaining),denominator=BigInt(total);
  const shares=batches.map((batch,index)=>{
    const product=lost*BigInt(batch.logical);
    return {batch,index,count:Number(product/denominator),remainder:product%denominator};
  });
  let extra=Number(lost)-shares.reduce((sum,row)=>sum+row.count,0);
  shares.sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1);
  for(const row of shares){row.batch.logical-=row.count+Number(extra>0);extra--;}
}
