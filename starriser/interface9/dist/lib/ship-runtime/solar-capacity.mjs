export const SOLAR_BODY_CAPACITY=16;
export const MAX_SOLAR_BODY_CAPACITY=4096;
export const SOLAR_ORBIT_WORDS=12;
export const SOLAR_WORDS=8+SOLAR_BODY_CAPACITY*SOLAR_ORBIT_WORDS;
export function validateSolarBodyIndex(index,capacity=SOLAR_BODY_CAPACITY) {
  if(index!==undefined && (!Number.isInteger(index)||index<0||index>=capacity))throw new Error('Body index exceeds configured solar capacity');
}
/** Storage capacity, independent of the four nearby bodies queried per ship. */
export function solarWords(bodyCapacity=SOLAR_BODY_CAPACITY) {
  if(!Number.isInteger(bodyCapacity)||bodyCapacity<1||bodyCapacity>MAX_SOLAR_BODY_CAPACITY)throw new RangeError(`Use 1 to ${MAX_SOLAR_BODY_CAPACITY} solar bodies`);
  return 8+bodyCapacity*SOLAR_ORBIT_WORDS;
}
