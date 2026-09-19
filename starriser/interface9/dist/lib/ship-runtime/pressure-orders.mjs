// Named/explicit visual regions are orders, never evidence of combat permission.
export function pressureDefinition(pressure,value) {
  object(value);const {blend=1,...definition}=value;
  if(!Number.isFinite(blend)||blend<0||blend>10)throw new Error('Invalid directed pressure blend');
  if(Object.keys(definition).some(key=>!['name','center','halfExtent','planet','frame'].includes(key)))throw new Error('Invalid directed pressure fields');
  label(definition);
  return {definition:pressure.definition(definition),blend};
}
export const pressureKey=value=>JSON.stringify([value.name,value.center,value.halfExtent,value.planet,value.frame]);
export function fleetPressure(pressure) {
  return pressure.members.map(member=>{
    if(member.pending)throw new Error('Recovery requires pressure orders in the director stream');
    if(!member.target)throw new Error('Lab recovery requires a current pressure destination');
    const {name,center,halfExtent,planet,frame}=pressure.resolve(member.target);
    return {name,center:[...center],halfExtent,planet,frame};
  });
}
export function packPressure(definitions) {
  const scopes=[],keys=[],members=definitions.map(definition=>{
    const key=pressureKey(definition);let index=keys.indexOf(key);
    if(index<0){index=scopes.length;keys.push(key);scopes.push(definition);}return index;
  });
  return {scopes,members};
}

function label(definition){
  if(definition.name!==undefined&&(typeof definition.name!=='string'||definition.name.length>128))throw new Error('Invalid pressure name');
  if(definition.frame!==undefined&&definition.frame!=='encounter')throw new Error('Invalid pressure frame');
}

function object(value){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid pressure order');}
