import {sceneRouteStart} from '../../../lib/ship-runtime/scene-route-start.mjs';
import {SCENE_LAB} from '../../../lib/ship-runtime/flight-layout.mjs';
const norm=v=>Math.hypot(...v);
const unit=v=>{const n=norm(v);return n>1e-10?v.map(x=>x/n):[1,0,0];};
const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function laneFrame(battle,obstacles){
 const center=[battle.center.x,battle.center.y,battle.center.z],a=battle.axis,r=battle.radius;
 let forward=[a.x,a.y,a.z],normal=[0,1,0],nearest=null,gap=Infinity;
 for(const body of obstacles){const delta=center.map((v,i)=>v-[body.x,body.y,body.z][i]);const d=norm(delta)-body.radius;if(d<gap){gap=d;nearest=delta;}}
 if(nearest&&gap<r){
   normal=unit(nearest);
   // Near a body the loop lies in its tangent plane. No collective upward
   // relocation, and no circle whose far half hides inside the planet.
   forward=forward.map((v,i)=>v-normal[i]*dot(forward,normal));
   if(norm(forward)<.1)forward=cross(normal,Math.abs(normal[1])>.9?[1,0,0]:[0,1,0]);
   for(let i=0;i<3;i++)center[i]+=normal[i]*r*.16;
 }
 return {center,forward:unit(forward),side:unit(cross(normal,unit(forward)))};
}
/** One retained closed spine per participant. Planner validates the full swept
 * width, including all individual/squad variation, over a short body horizon. */
export function battleLaneWaypoints(battle,obstacles,padding){
 const {center:c,forward,side:right}=laneFrame(battle,obstacles);
 const side=battle.side===0?1:-1,r=battle.radius,points=[];
 for(const [x,z] of [[-.42,-.32],[.42,-.32],[.42,.32],[-.42,.32]]){
   const p=c.map((v,i)=>v+r*(forward[i]*x+right[i]*z*side));
   const safe=sceneRouteStart(p,c,obstacles,padding);
   if(!safe||Math.hypot(safe[0]-battle.center.x,safe[1]-battle.center.y,safe[2]-battle.center.z)>r*.8)throw Error('Battle lane lacks safe room near encounter');
   points.push(safe);
 }
 return points;
}

export function battleRouteCapability(capability,battle){
 if(battle?.stage!=='engaged')return capability;
 const width=battle.radius*.50;
 capability.width=width*SCENE_LAB;capability.values[5]=width*.5+.0001;
 return capability;
}

export function battleRouteProgram(row,obstacles){
 const battle=row.fleet.state?.battle;if(battle?.stage!=='engaged')return null;
 const padding=row.capability.values[4]+row.capability.values[5];
 return {waypoints:battleLaneWaypoints(battle,obstacles,padding),closed:true,replan:true,
  retained:row.program?{points:row.program.points,cycleStart:row.program.cycleStart}:null};
}

export function battleCycleFits(battle,program,points,width){
 if(battle?.stage!=='engaged'||!(program?.cycleStart>=0))return true;
 const c=battle.center;
 return points.slice(program.cycleStart).every(p=>Math.hypot(p[0]-c.x,p[1]-c.y,p[2]-c.z)+width*.5<=battle.radius);
}
