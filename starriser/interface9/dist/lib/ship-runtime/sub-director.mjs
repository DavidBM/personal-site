// Fine motion for one fleet journey. The director still names the journey.
// This function chooses form, planet ring, warp-body, or leaves combat alone.

/** Planet-ring blend: 1 at 1.1× the anchor ring, 0 at 1.6×. */
export const RING_INNER = 1.1;
export const RING_OUTER = 1.6;

/** 1 means the planet ring owns the ship. 0 means the travel shell does. */
export function ringWeight(anchorDistance, ringRadius) {
  const ring = Number(ringRadius);
  const dist = Number(anchorDistance);
  if (!(ring > 0) || !Number.isFinite(dist)) return 0;
  const inner = ring * RING_INNER;
  const outer = ring * RING_OUTER;
  if (dist <= inner) return 1;
  if (dist >= outer) return 0;
  const t = (dist - inner) / (outer - inner);
  const u = t * t * (3 - 2 * t);
  return 1 - u;
}

/**
 * @param {"warp"|"escape"|"orbit"|"departure"|"local"|"approach"} mode
 * @returns {"engage"|"warp"|"form"|"ring"|"blend"}
 */
export function fleetStance(mode, attacking, anchorDistance = Infinity, ringRadius = 0) {
  if (attacking) return "engage";
  if (mode === "warp" || mode === "escape") return "warp";
  if (mode === "orbit") {
    const weight = ringWeight(anchorDistance, ringRadius);
    if (weight >= 1) return "ring";
    if (weight <= 0) return "form";
    return "blend";
  }
  return "form";
}

export function subDirectorWgsl(fleetPilot = false) {
  return /* wgsl */ `
fn classType(kind: u32) -> u32 {
  let types = array<u32, 6>(0u, 12u, 22u, 27u, 30u, 31u);
  return types[min(kind, 5u)];
}
fn shipIsAnchor(s: Ship, form: FleetForm) -> bool {
  if (classIndex(shipType(s)) != form.head.x) { return false; }
  let ordinal = sceneOrdinal(s.identity.x);
  for (var k = 0u; k < form.head.y; k++) {
    if (formOrdinal(form, k) == ordinal) { return true; }
  }
  return false;
}
fn subDirect(s: Ship, desired: vec3<f32>, limits: vec4<f32>, now: f32) -> vec3<f32> {
  ${fleetPilot?'if(fleetPilotActive(s)){return desired;}':''}
  let orbit = s.flight.w < -0.5 && s.flight.w > -1.5;
  if (!orbit) { return formationSteer(s, desired, limits); }
  let fleet = s.identity.y;
  if (fleet >= FORM_FLEETS) { return desired; }
  let form = director.forms[fleet];
  let n = form.head.y;
  if (n == 0u) { return desired; }
  let journey = journeyFor(s);
  if (journey.range.z <= 0.0) { return formationSteer(s, desired, limits); }
  let page = 1u - (u32(u.trail.z) & 1u);
  var mean = vec3<f32>(0.0);
  var live = 0u;
  for (var k = 0u; k < n; k++) {
    let pose = loadFormPose(page, fleet, k);
    if (pose.p.w < 0.5) { continue; }
    mean += pose.p.xyz;
    live++;
  }
  if (live == 0u) { return formationSteer(s, desired, limits); }
  mean /= f32(live);
  let planet = body(u32(journey.range.z) - 1u, now, u.control.x);
  let ring = destinationRing(classType(form.head.x), planet.w);
  if (ring <= 0.0) { return formationSteer(s, desired, limits); }
  let dist = length(mean - planet.xyz);
  let ringW = 1.0 - smoothstep(ring * ${RING_INNER}, ring * ${RING_OUTER}, dist);
  if (ringW <= 0.0) { return formationSteer(s, desired, limits); }
  if (ringW >= 1.0) { return desired; }
  return mix(formationSteer(s, desired, limits), desired, ringW);
}
`;
}
