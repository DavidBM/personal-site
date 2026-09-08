/** Shared model center reconstruction: visibility and mesh VS use identical arithmetic. */
import { SCENE_AGENT_SCALE, SCENE_SHIP_VISUAL_MUL } from "../visual/ship-motion-config.js";
export const MODEL_SHIP_TYPES_WGSL = /* wgsl */ `
struct ShipSim {
  posX: f32,
  posY: f32,
  posZ: f32,
  speed: f32,
  qx: f32,
  qy: f32,
  qz: f32,
  qw: f32,
  slotX: f32,
  slotY: f32,
  slotZ: f32,
  heading: f32,
  trailWrite: u32,
  sinceSample: f32,
  mode: u32,
  fleetIndex: u32,
  targetKind: u32,
  orbitPhase: f32,
  accel: f32,
  cruiseV: f32,
  orbitR: f32,
  orbitOmega: f32,
  omegaMax: f32,
  _pad1: f32,
};

// FleetGpu stride 64 — pathEnd is the hop/orbit lamp for model lighting.
struct FleetGpu {
  posX: f32,
  posZ: f32,
  heading: f32,
  pathEndY: f32, // _pad0: planar 0; SPACE3D pathEndY
  pathStartX: f32,
  pathStartZ: f32,
  pathEndX: f32,
  pathEndZ: f32,
  t0: f32,
  durationMs: f32,
  flags: u32,
  shipBudget: u32,
  countsPacked: u32,
  instanceStart: u32,
  fleetIdHash: u32,
  _pad1: u32,
};

`;
export const MODEL_SHIP_POSE_WGSL = /* wgsl */ `
const SHIP_MODE_PAUSED: u32 = 0u;
const SHIP_MODE_ORBIT: u32 = 3u;
const FLEET_FLAG_SPACE3D: u32 = 64u;
const FLEET_FLAG_SYSTEM_SCENE: u32 = 128u;
const SCENE_AGENT_SCALE: f32 = ${SCENE_AGENT_SCALE};
const SCENE_SHIP_VISUAL_MUL: f32 = ${SCENE_SHIP_VISUAL_MUL};
struct ModelShipPose {
  centerRel: vec3<f32>, hullScale: f32,
  lightOffset: vec3<f32>, lightCenter: vec3<f32>,
};
fn modelShipPose(ship: ShipSim, origin: vec3<f32>, modelScale: f32) -> ModelShipPose {
  let fi = ship.fleetIndex;
  var pathEnd = vec3<f32>(ship.posX, ship.posY, ship.posZ);
  var space3d = false;
  var inScene = false;
  if (fi < arrayLength(&fleets)) {
    let f = fleets[fi];
    pathEnd = vec3<f32>(f.pathEndX, f.pathEndY, f.pathEndZ);
    space3d = (f.flags & FLEET_FLAG_SPACE3D) != 0u;
    inScene = (f.flags & FLEET_FLAG_SYSTEM_SCENE) != 0u;
  }
  var pose: ModelShipPose;
  pose.hullScale = modelScale;
  if (inScene) { pose.hullScale = SCENE_AGENT_SCALE * SCENE_SHIP_VISUAL_MUL; }
  let shipPos = vec3<f32>(ship.posX, ship.posY, ship.posZ);
  if (ship.mode == SHIP_MODE_ORBIT && !space3d) {
    var R = select(2.0, ship.orbitR, ship.orbitR > 1e-6);
    if (inScene) { R = R * SCENE_AGENT_SCALE; }
    let sp = sin(ship.orbitPhase);
    let cp = cos(ship.orbitPhase);
    // ShipSim.posY is already sun-local and includes an inclined scene center.
    let localOrb = vec3<f32>(R * sp, ship.posY - pathEnd.y, R * cp);
    pose.centerRel = (pathEnd - origin) + localOrb;
    pose.lightOffset = localOrb;
    pose.lightCenter = vec3<f32>(0.0);
  } else {
    pose.centerRel = shipPos - origin;
    pose.lightOffset = shipPos;
    pose.lightCenter = pathEnd;
  }
  return pose;
}
`;
//# sourceMappingURL=model-ship-pose.wgsl.js.map