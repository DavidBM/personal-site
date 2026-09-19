// Limits describe one visible runtime, not world population. M4 owns growth.
export const MAX_FLEETS=8;
export function fleetCapacity(fleetCount) {
  if(!Number.isInteger(fleetCount)||fleetCount<1||fleetCount>MAX_FLEETS)throw new Error(`Use 1 to ${MAX_FLEETS} fleets`);
  const groups=fleetCount*32,targetStride=1+Math.ceil(Math.max(1,(fleetCount-1)*32)/4);
  const groupBase=8+groups*8,tableBase=groupBase+groups*96;
  const ordinalWords=groups*64,targetWords=groups*targetStride;
  const battleBase=tableBase+ordinalWords+targetWords;
  const encounterBase=battleBase+fleetCount*4,nearbyBase=encounterBase+fleetCount*4;
  return {fleetCount,groups,targetStride,groupBase,tableBase,ordinalWords,targetWords,battleBase,encounterBase,nearbyBase,words:nearbyBase+fleetCount*4};
}
