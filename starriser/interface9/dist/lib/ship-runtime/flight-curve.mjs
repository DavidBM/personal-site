/** Worker-only curvature-continuous corner spans, conservatively revalidated
 * against the shared planetary model. Never evaluated per ship or render tick.
 */
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const add=(p,v,k)=>p.map((x,i)=>x+v[i]*k);
const length=v=>Math.hypot(...v);
const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
const steps=8;

function corner(a,p,b,radius,factor,passageFraction,passageLimit) {
  const incoming=sub(p,a),outgoing=sub(b,p),before=length(incoming),after=length(outgoing);
  if(Math.min(before,after)<1e-8)return null;
  const u=incoming.map(v=>v/before),v=outgoing.map(x=>x/after),cosine=dot(u,v);
  if(cosine>.9995||cosine<-.95)return null;
  // At t=.5 the quintic is .1875*trim*(outgoing-incoming) from the knot.
  // Bound the passage distance without imposing an exact stop at each click.
  const passage=Math.min(Math.min(before,after)*passageFraction,passageLimit)/(.1875*Math.sqrt(2-2*cosine));
  const trim=Math.min(before*.4,after*.4,2*radius*Math.tan(Math.acos(Math.max(-1,cosine))*.5),passage)*factor;
  const entry=add(p,u,-trim),exit=add(p,v,trim);
  // Equal first differences at each end make second derivatives exactly zero.
  return [entry,add(entry,u,.4*trim),add(entry,u,.8*trim),add(exit,v,-.8*trim),add(exit,v,-.4*trim),exit];
}
function evaluate(controls,t) {
  let values=controls;
  for(let size=5;size>0;size--)values=Array.from({length:size},(_,i)=>values[i].map((v,a)=>v*(1-t)+values[i+1][a]*t));
  return values[0];
}
function chordError(controls,sampleSteps) {
  let bound=0;
  for(let i=0;i<4;i++)bound=Math.max(bound,length(controls[i].map((v,a)=>20*(v-2*controls[i+1][a]+controls[i+2][a]))));
  // The second derivative is a convex combination of these control vectors.
  return bound/(8*sampleSteps*sampleSteps);
}
export function flightCurvePoints(knots,radius,factor=1,sampleSteps=steps,passageFraction=Infinity,passageLimits=[]) {
  if(knots.length<2)return {points:knots.map(p=>p.slice()),error:0,spans:[]};
  const points=[knots[0].slice()],spans=[];let error=0;
  for(let i=1;i+1<knots.length;i++) {
    const controls=corner(knots[i-1],knots[i],knots[i+1],radius,factor,passageFraction,passageLimits[i]??Infinity);
    if(!controls){points.push(knots[i].slice());continue;}
    error=Math.max(error,chordError(controls,sampleSteps));
    spans.push({knot:i,first:points.length,middle:points.length+sampleSteps/2,last:points.length+sampleSteps});points.push(controls[0]);
    for(let sample=1;sample<=sampleSteps;sample++)points.push(evaluate(controls,sample/sampleSteps));
  }
  points.push(knots.at(-1).slice());return {points,error,spans};
}
export function prepareFlightCurve(knots,capability,isClear) {
  const [speed,acceleration,,turn]=capability;
  const cruise=speed*.65;
  const radius=Math.max(cruise/(turn*.65),cruise*cruise/(acceleration*.65));
  for(const factor of [1,.5,.25,.125]) {
    const curve=flightCurvePoints(knots,radius,factor);
    if(curve.points.length<=128&&isClear(curve.points,curve.error))return {...curve,status:'smooth'};
  }
  // A truly narrow corridor can require a deliberate slow corner. Never trade
  // obstacle safety for smoothness or silently borrow the polyline's proof.
  return {points:knots.map(p=>p.slice()),error:0,status:'narrow'};
}
