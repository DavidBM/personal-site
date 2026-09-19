import {PLANET_SCALE,SOLAR_ORIGIN} from './solar-layout.mjs';
export const SOLAR_BODY_CAPACITY=16;
export const SOLAR_ORBIT_WORDS=12;
export const SOLAR_WORDS=8+SOLAR_BODY_CAPACITY*SOLAR_ORBIT_WORDS;
let rulesPromise;
export function loadPlanetaryRules() {
  // Relative to this module so /interface9/ and local /dist/ both resolve.
  const moduleUrl=new URL('../../wasm/game/galaxy_game_wasm.js',import.meta.url);
  rulesPromise??=import(moduleUrl.href).then(async module=>{
    await module.default({module_or_path:new URL('./galaxy_game_wasm_bg.wasm',moduleUrl)});
    return module;
  });
  return rulesPromise;
}
export function labEphemeris(period=1800) {
  const body=(orbit,radius,seconds,phase)=>[orbit,radius,seconds,phase,1,0,0,0,0,.22,1,0];
  return {version:1,epochMs:0,origin:[...SOLAR_ORIGIN],bodies:[
    ...body(0,1.7*PLANET_SCALE,0,0),
    ...body(6.5*PLANET_SCALE,.9*PLANET_SCALE,period*PLANET_SCALE,0),
    ...body(12.5*PLANET_SCALE,1.25*PLANET_SCALE,period*PLANET_SCALE/.62,2.2),
  ]};
}
export async function createSolarRuntime({period=1800,definition=labEphemeris(period),sceneEpochMs=0,rules=null}={}) {
  definition=snapshotDefinition(definition);
  const module=rules??await loadPlanetaryRules();
  validateModel(module,definition,sceneEpochMs);
  const model=new module.PlanetaryModel(definition.version,definition.epochMs,Float64Array.from(definition.origin),Float64Array.from(definition.bodies));
  const data=new Float32Array(SOLAR_WORDS);data.set([...definition.origin,definition.version],4);
  let cachedTime=NaN,cachedState=null,closed=false,phaseTime=0;
  const serverTime=time=>sceneEpochMs+time*1000;
  function check(){if(closed)throw new Error('Planetary model closed');}
  function sample(time) {
    check();if(time!==cachedTime){cachedState=model.sample(serverTime(time));cachedTime=time;}
    return cachedState;
  }
  function bodyAt(index,time) {return Array.from(sample(time).subarray(index*8,index*8+4));}
  function velocityAt(index,time) {return Array.from(sample(time).subarray(index*8+4,index*8+7));}
  function encounterAt(time){const p=bodyAt(1,time);return [p[0],p[1]+100,p[2]];}
  function plan(request) {
    check();if(!Number.isInteger(request.planet)||request.planet<0||request.planet>2)throw new Error('Invalid route frame body');
    return model.plan_route(request.planet,serverTime(request.at),request.end-request.at,
      Float64Array.from(request.start),Float64Array.from(request.destination),Float64Array.from(request.capability));
  }
  function advance(time) {
    check();data[0]=time;data.set(model.phase_records(serverTime(time)),8);
    if(!data.every(Number.isFinite))throw new Error('Planetary model exceeds GPU range');
    phaseTime=time;
  }
  try{advance(0);}catch(error){model.free();throw error;}
  return {definition,sceneEpochMs,data,plan,bodyAt,velocityAt,encounterAt,advance,serverTime,get time(){return phaseTime;},
    destroy(){if(!closed){closed=true;model.free();}}};
}
export const RUNTIME_SOLAR_WGSL=/* wgsl */`
const PLANET_SCALE:f32=50.0;
struct SolarOrbit {shape:vec4<f32>,uAxis:vec4<f32>,vAxis:vec4<f32>}
struct SolarControl {clock:vec4<f32>,origin:vec4<f32>,orbits:array<SolarOrbit,${SOLAR_BODY_CAPACITY}>}
fn body(i:u32,t:f32,period:f32)->vec4<f32> {
  if(i>=${SOLAR_BODY_CAPACITY}u){return vec4<f32>(0.0);}
  let orbit=director.solar.orbits[i];let phase=orbit.shape.w+(t-director.solar.clock.x)*orbit.shape.z;
  return vec4<f32>(director.solar.origin.xyz+orbit.shape.x*(orbit.uAxis.xyz*cos(phase)+orbit.vAxis.xyz*sin(phase)),orbit.shape.y);
}
fn bodyVelocity(i:u32,t:f32,period:f32)->vec3<f32> {
  if(i>=${SOLAR_BODY_CAPACITY}u){return vec3<f32>(0.0);}
  let orbit=director.solar.orbits[i];let phase=orbit.shape.w+(t-director.solar.clock.x)*orbit.shape.z;
  return orbit.shape.x*orbit.shape.z*(-orbit.uAxis.xyz*sin(phase)+orbit.vAxis.xyz*cos(phase));
}
fn encounter(t:f32,period:f32)->vec3<f32>{return body(1u,t,period).xyz+vec3<f32>(0.0,100.0,0.0);}
`;

function validateModel(module,definition,sceneEpochMs) {
  if(definition.version!==module.ephemeris_version())throw new Error('Unsupported planetary model version');
  if(definition.bodies.length!==36)throw new Error('The lab renderer requires three ephemeris bodies');
  if(!Number.isFinite(sceneEpochMs)||Math.abs(sceneEpochMs)>Number.MAX_SAFE_INTEGER)throw new Error('Invalid scene epoch');
}

function snapshotDefinition(value) {
  if(value?.origin?.length!==3||value?.bodies?.length!==36)throw new Error('The lab requires three ephemeris bodies and a 3D origin');
  return Object.freeze({...value,origin:Object.freeze(Array.from(value.origin)),bodies:Object.freeze(Array.from(value.bodies))});
}
