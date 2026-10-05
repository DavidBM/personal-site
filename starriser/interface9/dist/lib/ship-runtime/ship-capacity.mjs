// Physical representatives only. Logical fleet counts may be much larger.
// Super FX is a startup reservation; Normal/High keep their 50K growth ceiling.
export const DEFAULT_SHIP_CAPACITY=10_000;
export const HIGH_SHIP_CAPACITY=50_000;
export const MAX_SHIP_CAPACITY=200_000;
export function sceneShipCapacity(highFx=false,superFx=false){return superFx?MAX_SHIP_CAPACITY:highFx?HIGH_SHIP_CAPACITY:DEFAULT_SHIP_CAPACITY;}
