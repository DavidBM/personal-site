/** Local forward flight only: callers own guidance and exceptional pose resets. */
export const FORWARD_INTEGRATION_WGSL = /* wgsl */ `
// Integrals of cos(phi*t) and sin(phi*t), weighted by constant/linear speed,
// for t in [0,1]. Taylor terms avoid cancellation near a straight trajectory.
fn forwardArcIntegrals(phi:f32)->vec4<f32> {
  let p2=phi*phi;
  if(abs(phi)<.25) {
    let sinc=1.0+p2*(-1.0/6.0+p2*(1.0/120.0-p2/5040.0));
    let cosc=phi*(.5+p2*(-1.0/24.0+p2/720.0));
    let linearCos=.5+p2*(-1.0/8.0+p2*(1.0/144.0-p2/5760.0));
    let linearSin=phi*(1.0/3.0+p2*(-1.0/30.0+p2/840.0));
    return vec4<f32>(sinc,cosc,linearCos,linearSin);
  }
  let sine=sin(phi);let cosine=cos(phi);
  return vec4<f32>(sine/phi,(1.0-cosine)/phi,
    sine/phi+(cosine-1.0)/p2,(sine-phi*cosine)/p2);
}
fn forwardArcDisplacement(forward:vec3<f32>,omega:vec3<f32>,speed:f32,axial:f32,dt:f32)->vec3<f32> {
  let distance=dt*(speed+.5*axial*dt);let rate=length(omega);
  if(rate==0.0){return forward*distance;}
  let axis=omega/rate;let parallel=axis*dot(axis,forward);
  let perpendicular=forward-parallel;let side=cross(axis,forward);
  let integral=forwardArcIntegrals(rate*dt);
  let cosine=dt*(speed*integral.x+axial*dt*integral.z);
  let sine=dt*(speed*integral.y+axial*dt*integral.w);
  return parallel*distance+perpendicular*cosine+side*sine;
}
fn integrateForwardMotion(initial:Ship,omega:vec3<f32>,axialAcceleration:f32,dt:f32)->Ship {
  var s=initial;let forward=rotate(s.q,vec3<f32>(0.0,0.0,1.0));
  s.origin=vec4<f32>(omega,s.origin.w);
  // A final event exactly at the tick boundary still updates the controller
  // state. It must not rotate, move, or rewrite the existing velocity.
  s.a=vec4<f32>(forward*axialAcceleration+cross(omega,s.v.xyz),s.a.w);
  if(dt<=0.0){return s;}
  let speed=length(s.v.xyz);var moving=dt;var axial=axialAcceleration;
  if(axial<0.0){moving=min(dt,speed/-axial);}
  s=moveShipPosition(s,forwardArcDisplacement(forward,omega,speed,axial,moving));
  s.q=angularRotation(s.q,omega*dt);
  let nextForward=normalize(rotate(s.q,vec3<f32>(0.0,0.0,1.0)));
  let nextSpeed=max(0.0,speed+axial*dt);
  if(axial<0.0&&nextSpeed==0.0){axial=0.0;}
  s.v=vec4<f32>(nextForward*nextSpeed,s.v.w);
  // Endpoint derivative, not the interval's secant acceleration. Its forward
  // projection recovers scalar thrust without inventing thrust during a turn.
  s.a=vec4<f32>(nextForward*axial+cross(omega,s.v.xyz),s.a.w);
  return s;
}
fn heldForwardMotion(initial:Ship,dt:f32)->Ship {
  let forward=rotate(initial.q,vec3<f32>(0.0,0.0,1.0));
  return integrateForwardMotion(initial,localAngularVelocity(initial),dot(initial.a.xyz,forward),dt);
}
`;
