/** Shared physical-pose ABI; history samples retain their independent layout. */
export const SHIP_WORDS = 56;
export const SHIP_BYTES = SHIP_WORDS * 4;
// Three emitters, sixteen vec4 samples each. Independent of physical Ship ABI.
export const SHIP_HISTORY_WORDS = 3 * 16 * 4;
export const SHIP_HISTORY_BYTES = SHIP_HISTORY_WORDS * 4;
export const CORRECTION_AFTER = 4 + SHIP_WORDS;
export const CORRECTION_HISTORY = 4 + 2 * SHIP_WORDS;
export const POSITION_CELL = 1;
/** CPU seeding only. p remains an approximate navigation/observation cache. */
export function writePositionLow(f, at, x, y, z) {
  const ax=Math.floor(x/POSITION_CELL)*POSITION_CELL;
  const ay=Math.floor(y/POSITION_CELL)*POSITION_CELL;
  const az=Math.floor(z/POSITION_CELL)*POSITION_CELL;
  f[at+52]=ax;f[at+53]=ay;f[at+54]=az;
  f[at+48]=x-ax;f[at+49]=y-ay;f[at+50]=z-az;
  f[at+51]=1;
}
export const POSITION_WGSL = /* wgsl */ `
// Physical integration uses cell + local offset. Never recover rounding error
// algebraically: GPU fast-math can legally simplify that recovery to zero.
fn initializeShipPosition(initial: Ship) -> Ship {
  var s=initial;
  if(s.positionLow.w==0.0){
    let anchor=floor(s.p.xyz/${POSITION_CELL}.0)*${POSITION_CELL}.0;
    s.positionAnchor=vec4<f32>(anchor,s.positionAnchor.w);
    s.positionLow=vec4<f32>(s.p.xyz-anchor,1.0);
  }
  return s;
}
fn moveShipPosition(initial: Ship, delta: vec3<f32>) -> Ship {
  var s=initializeShipPosition(initial);
  let local=s.positionLow.xyz+delta;
  let cell=floor(local/${POSITION_CELL}.0)*${POSITION_CELL}.0;
  s.positionAnchor=vec4<f32>(s.positionAnchor.xyz+cell,s.positionAnchor.w);
  s.positionLow=vec4<f32>(local-cell,1.0);
  s.p=vec4<f32>(s.positionAnchor.xyz+s.positionLow.xyz,s.p.w);
  return s;
}
fn correctShipPosition(initial: Ship, point: vec3<f32>) -> Ship {
  var s=initial;
  if(any(point!=s.p.xyz)){s.p=vec4<f32>(point,s.p.w);s.positionLow=vec4<f32>(0.0);}
  return initializeShipPosition(s);
}
fn mixShipPosition(a: Ship, b: Ship, alpha: f32) -> Ship {
  let first=initializeShipPosition(a);var s=initializeShipPosition(b);
  let delta=(s.positionAnchor.xyz-first.positionAnchor.xyz)+(s.positionLow.xyz-first.positionLow.xyz);
  s.positionAnchor=first.positionAnchor;s.positionLow=first.positionLow;
  return moveShipPosition(s,delta*alpha);
}
// Warp uses the nearest integrated tick, never origin + velocity * a long age.
// positionAnchor.w is the epoch-local instant of that tick's warp placement.
fn warpShipPosition(initial: Ship, time: f32) -> Ship {
  return moveShipPosition(initial,initial.v.xyz*(time-initial.positionAnchor.w));
}
`;

export const SHIP_WGSL=`struct Ship { p: vec4<f32>, v: vec4<f32>, a: vec4<f32>, q: vec4<f32>, aux: vec4<f32>, identity: vec4<u32>, memory:vec4<f32>, flight:vec4<f32>, origin:vec4<f32>, tactic:vec4<f32>, fx:vec4<f32>, aim:vec4<f32>, positionLow:vec4<f32>, positionAnchor:vec4<f32> }
${POSITION_WGSL}`;
