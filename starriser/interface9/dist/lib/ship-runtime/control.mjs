import {ROUTE_CONTROL_WGSL,ROUTE_WORDS} from './local-routes.mjs';
import {eventControlWgsl,eventOwnWgsl,eventField} from './event-gpu.mjs';
import {SOLAR_WORDS} from './solar-runtime.mjs';
import {pressureScopeWgsl} from './pressure-scopes.mjs';
import {fleetCapacity} from './runtime-capacity.mjs';
import {createTargetTables,targetTableWgsl} from './target-tables.mjs';
// The layout is shared verbatim with CONTROL_WGSL; 16-byte blocks throughout.
export const CONTROL_FLOATS=fleetCapacity(2).words;
const GROUP_FLOATS=96;
const MODE=Object.freeze({local:0,approach:1,warp:2,escape:3,orbit:-1,departure:-2});
export function createControl(director,pressure=null,solar=null,routes=null,clock=null) {
  const capacity=director.capacity;
  const solarOffset=capacity.words+(pressure?.layout.words??0);
  const routesOffset=solarOffset+(solar?SOLAR_WORDS:0);
  const data=new ArrayBuffer((routesOffset+(routes?.data.length??0))*4),f=new Float32Array(data),w=new Uint32Array(data);
  const syncTargets=createTargetTables(w,capacity.tableBase);
  const local=time=>time-(clock?.origin??0);
  function writeJourney(offset,journey,range) {
    f.fill(0,offset,offset+12);if(!journey)return;
    f.set([MODE[journey.mode],journey.revision,local(journey.at),local(journey.end)],offset);
    f.set([...range,journey.planet===undefined?0:journey.planet+1,journey.planeShift??0],offset+4);f.set([...journey.exit,0],offset+8);
  }
  function writeGroup(group) {
    const at=capacity.groupBase+group*GROUP_FLOATS,intent=director.intents[group];
    const occupied=director.occupied?.[group];
    const type=occupied?occupied.type:group%32,fleet=occupied?occupied.slot:Math.floor(group/32);
    const tactic=intent.tactic;f.fill(0,at,at+GROUP_FLOATS);
    if(tactic)f.set([tactic.revision,tactic.splits,local(tactic.at),tactic.blend],at);
    f[at+4]=intent.fire;f[at+5]=type;
    const split=director.roster.split[type],groupCapacity=director.roster.sizeFor(fleet,type);
    writeJourney(at+8,intent.journeys[0],[0,split]);writeJourney(at+20,intent.journeys[1],[split,groupCapacity]);
    if(!tactic)return;
    for(const [i,branch] of tactic.branches.entries()) {
      f.set([...branch.offset,branch.radius],at+32+i*8);
      f.set([branch.speed,branch.approachWeight,0,0],at+36+i*8);
    }
  }
  function syncNearby(){w.set(director.nearby,capacity.nearbyBase);}
  function sync(){w.set(director.roster.live,8);for(let group=0;group<capacity.groups;group++)writeGroup(group);syncTargets(director);w.set(director.battles,capacity.battleBase);f.set(director.encounters,capacity.encounterBase);syncNearby();}
  function frame(x,y,z,time,pressure=[x,y,z]){f.set([x,y,z,local(time),...pressure,0],0);}
  function syncPressure(){if(pressure)w.set(new Uint32Array(pressure.data),capacity.words);}
  function syncSolar(){if(solar){f.set(solar.data,solarOffset);f[solarOffset]=local(solar.time);}}
  function syncRoutes(){if(routes){f.set(routes.data,routesOffset);for(const [index,record] of routes.records){const at=routesOffset+index*ROUTE_WORDS;f[at+4]=local(record.request.at);f[at+5]=local(record.request.end);}}}
  function captureGroup(group){writeGroup(group);return new Uint32Array(data, (capacity.groupBase+group*GROUP_FLOATS)*4,GROUP_FLOATS);}
  sync();syncPressure();syncSolar();syncRoutes();return {data,frame,sync,syncNearby,syncPressure,syncSolar,syncRoutes,captureGroup,solarOffset,routesOffset};
}
export const controlWgsl=(capacity=fleetCapacity(2),pressure=null,solar=false,temporal=false)=>/* wgsl */`
struct Journey { mode:vec4<f32>, range:vec4<f32>, exit:vec4<f32> }
struct Branch { goal:vec4<f32>, weights:vec4<f32> }
struct GroupIntent { tactic:vec4<f32>, weapon:vec4<f32>, journeys:array<Journey,2>, branches:array<Branch,8> }
${pressure?pressureScopeWgsl(pressure):''}
${solar?ROUTE_CONTROL_WGSL:''}
${solar?eventControlWgsl(capacity):''}
struct DirectorControl { frame:vec4<f32>, reserved:vec4<f32>, live:array<u32,${capacity.groups*8}>, groups:array<GroupIntent,${capacity.groups}>, ordinals:array<u32,${capacity.ordinalWords}>, targets:array<u32,${capacity.targetWords}>, battles:array<vec4<u32>,${capacity.fleetCount}>, encounters:array<vec4<f32>,${capacity.fleetCount}>, nearby:array<vec4<u32>,${capacity.fleetCount}> ${pressure?',pressure:PressureControl':''} ${solar?`,solar:SolarControl,routes:array<LocalRoute,${capacity.groups*2}>,events:EventControl`:''} }
@group(0) @binding(8) var<storage,read> director:DirectorControl;
${controlAccessors(solar,temporal)}
${targetTableWgsl(capacity)}
`;

export const CONTROL_WGSL=controlWgsl();

function controlAccessors(solar,temporal){return /* wgsl */`
${temporal?eventOwnWgsl:''}
${eventField('groupIntent','GroupIntent','director.groups[group]','intent',temporal)}
${eventField('groupEncounter','vec4<f32>','director.encounters[group/32u]','encounter',temporal)}
${solar?`fn groupRoute(group:u32,cohort:u32)->LocalRoute {${temporal?'if(ownEvent(group)){return director.events.rows[eventIndex(group,eventRow)].routes[cohort];}':''}return director.routes[group*2u+cohort];}`:''}
fn admitted(s:Ship)->bool {
  if(s.identity.w==0u){return false;}
  let ordinal=s.identity.x&255u;
  ${temporal?'if(ownEvent(groupOf(s))){return (director.events.rows[eventIndex(groupOf(s),eventRow)].live[ordinal/32u]&(1u<<(ordinal%32u)))!=0u;}':''}
  return (director.live[groupOf(s)*8u+ordinal/32u]&(1u<<(ordinal%32u)))!=0u;
}
fn encounterFrame(s:Ship)->vec3<f32>{let frame=groupEncounter(groupOf(s));return select(director.frame.xyz,frame.xyz,frame.w>0.0);}
`;}
