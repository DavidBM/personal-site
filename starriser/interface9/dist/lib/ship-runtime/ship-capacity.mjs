// Presentation quality controls the admitted population, not logical ship IDs.
export const DEFAULT_SHIP_CAPACITY=10_000;
export const MAX_SHIP_CAPACITY=50_000;
export function sceneShipCapacity(highFx=false){return highFx?MAX_SHIP_CAPACITY:DEFAULT_SHIP_CAPACITY;}
