// Borrowed physical slots are resolved at use time. A handle belongs to one
// engine lifetime and persistent serial, never a catalog or physical index.
export function createShipHandles(director,layout,lifetime,closed) {
  function capture(index) {
    if(closed()||!Number.isInteger(index)||index<0||index>=director.population.count)return null;
    return Object.freeze({id:director.population.ids[index],lifetime:lifetime()});
  }
  function resolve(handle) {
    if(closed()||!handle||handle.lifetime!==lifetime())return null;
    const index=director.population.indexOf(handle.id);if(index<0)return null;
    return {id:handle.id,index,slot:layout.physical[index]};
  }
  return {capture,resolve};
}
