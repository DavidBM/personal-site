/** Shared braking envelope. Units follow sceneLimits; forward thrust is unchanged. */
export const DECELERATION_MULTIPLIER = 1.5;
export const BRAKING_HEADROOM = .8;
export const THRUST_RAMP_SECONDS = .35;
export const SPEED_RESPONSE_SECONDS = .5;

/** Conservative speed at remaining distance, allowing thrust reversal and one tick.
 * The ramp bound assumes no useful braking until full brakes are available.
 */
export function brakingSpeed(distance, arrival, acceleration, jerk, axial = acceleration, lateral = acceleration * .65, tick = 1 / 30, speed = 0) {
  const a = Math.max(.0001, acceleration);
  const b = Math.sqrt(Math.max(.00000001, (a * DECELERATION_MULTIPLIER) ** 2 - lateral ** 2)) * BRAKING_HEADROOM;
  const j = Math.max(.00001, Math.min(jerk, a / THRUST_RAMP_SECONDS));
  const delay = Math.max(0, axial + b) / j + SPEED_RESPONSE_SECONDS + Math.max(0, tick);
  const positive = Math.max(0, axial), end = Math.max(0, arrival);
  const d = Math.max(0, distance - end * 3 * SPEED_RESPONSE_SECONDS);
  const envelope = Math.sqrt(end * end + (b * delay) ** 2 + b * positive * delay ** 2 + 2 * b * d) - (b + positive) * delay;
  // Overdamped terminal acquisition. The sqrt envelope alone approaches a
  // steep slope at zero, while the velocity servo still has a finite response.
  const terminal = end + Math.max(0, d - speed * SPEED_RESPONSE_SECONDS) / (4 * SPEED_RESPONSE_SECONDS + tick);
  return Math.max(end, Math.min(envelope, terminal));
}

export const BRAKING_WGSL = /* wgsl */ `
fn brakingSpeedAt(s:Ship,limits:vec4<f32>,distance:f32,arrival:f32)->f32 {
  let a=max(.0001,limits.y);
  let forward=rotate(s.q,vec3<f32>(0.0,0.0,1.0));
  // Reserve the turn budget even before a bend starts. Actual tighter turns
  // can only reduce this estimate, never grant extra forward acceleration.
  let lateral=max(a*.65,length(cross(s.origin.xyz,s.v.xyz)));
  let b=sqrt(max(.00000001,(a*${DECELERATION_MULTIPLIER})*(a*${DECELERATION_MULTIPLIER})-lateral*lateral))*${BRAKING_HEADROOM};
  let j=max(.00001,min(limits.z,a/${THRUST_RAMP_SECONDS}));
  let axial=dot(s.a.xyz,forward);
  let delay=max(0.0,axial+b)/j+${SPEED_RESPONSE_SECONDS}+max(0.0,u.clock.y);
  let positive=max(0.0,axial);let end=max(0.0,arrival);
  let d=max(0.0,distance-end*3.0*${SPEED_RESPONSE_SECONDS});
  let envelope=sqrt(end*end+(b*delay)*(b*delay)+b*positive*delay*delay+2.0*b*d)-(b+positive)*delay;
  let terminal=end+max(0.0,d-length(s.v.xyz)*${SPEED_RESPONSE_SECONDS})/(4.0*${SPEED_RESPONSE_SECONDS}+max(0.0,u.clock.y));
  return max(end,min(envelope,terminal));
}
`;
