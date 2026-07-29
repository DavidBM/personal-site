/**
 * Instanced textured ship mesh draw (model LOD band).
 *
 * Per instance: ShipSim storage row (pos + full quaternion).
 * Lighting: **point light at fleet pathEnd** (hop destination / orbit center)
 * via FleetGpu lookup on ship.fleetIndex. Ambient + small camera rim; no shadows/IBL.
 *
 * Vertex layout (interleaved): pos.xyz, normal.xyz, uv.xy (32 B).
 */
import { SHIP_SIM_STRIDE } from "../visual/ship-sim-layout.js";
import { MODEL_LOD_MAX_INSTANCES } from "../visual/fleet-lod.js";
import { FLEET_GPU_STRIDE } from "../visual/fleet-layout.js";
export const FLEET_MODEL_VERTEX_STRIDE = 32; // 8 × f32
/**
 * mat4 viewProjRel + origin.xyz + modelScale + fallbackLight.xyz + ambient +
 * eyeWorld.xyz + meshYawHalf + thrusterPulse + WGSL vec3 pad = **144 B**.
 * (thrusterPulse @112; next vec3 aligns to 128 → struct rounds to 144.)
 * Primary diffuse = per-ship pathEnd; fallbackLight only when |center−ship|≈0.
 * eyeWorld is **camera eye in world** for rim only (not the key light).
 * thrusterPulse gently modulates the aft hard thruster light.
 */
export const FLEET_MODEL_UNIFORM_SIZE = 144;
export { MODEL_LOD_MAX_INSTANCES };
/** Must match ShipSim stride used by integrate. */
export const FLEET_MODEL_SHIP_SIM_STRIDE = SHIP_SIM_STRIDE;
/** Must match FleetGpu stride for pathEnd lookup. */
export const FLEET_MODEL_FLEET_GPU_STRIDE = FLEET_GPU_STRIDE;
/**
 * Epsilon (world) for center≈ship — mirror {@link MODEL_LIGHT_CENTER_EPS}.
 * Injected into WGSL so TS pure helper and GPU stay aligned.
 */
export const FLEET_MODEL_LIGHT_CENTER_EPS = 1e-3;
/** Uniform float index for thruster pulse (after meshYawHalf @ 27). */
export const FLEET_MODEL_U_THRUSTER_PULSE = 28;
export const FLEET_MODEL_SHIPS_WGSL = /* wgsl */ `
struct ModelUniforms {
  /** proj * lookAt(eye−origin, target−origin) — origin-relative viewProj. */
  viewProj : mat4x4<f32>,
  /** Frame floating origin (camera eye or followed ship). */
  origin : vec3<f32>,
  modelScale : f32,
  /** Fallback light dir when ship ≈ pathEnd (unit-ish; normalized in FS). */
  fallbackLight : vec3<f32>,
  ambient : f32,
  /** Camera eye in **world** space — rim/specular only; key light is pathEnd. */
  eyeWorld : vec3<f32>,
  /** Half-angle (rad) for yaw pre-rotate so mesh nose → body +Z. */
  meshYawHalf : f32,
  /** Aft thruster light pulse (~0.86…1.14). @ offset 112. */
  thrusterPulse : f32,
  /**
   * Explicit vec3 pad: WGSL aligns it to 16 B → offset 128, struct size 144.
   * Host buffer must be ≥ 144 or CreateBindGroup fails (minBindingSize).
   */
  _padPulse : vec3<f32>,
};

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

@group(0) @binding(0) var<uniform> u : ModelUniforms;
@group(0) @binding(1) var<storage, read> ships : array<ShipSim>;
@group(0) @binding(2) var baseColorTex : texture_2d<f32>;
@group(0) @binding(3) var normalTex : texture_2d<f32>;
@group(0) @binding(4) var texSampler : sampler;
@group(0) @binding(5) var specularDiffuseTex : texture_2d<f32>;
@group(0) @binding(6) var<storage, read> shipIndices : array<u32>;
/** Fleet pathEnd for per-ship point light (indexed by ShipSim.fleetIndex). */
@group(0) @binding(7) var<storage, read> fleets : array<FleetGpu>;

const SHIP_MODE_PAUSED: u32 = 0u;
const SHIP_MODE_ORBIT: u32 = 3u;
/** FleetGpu bit6 — sphere agent; pathEndY in _pad0. Match fleet-layout. */
const FLEET_FLAG_SPACE3D: u32 = 64u;
const LIGHT_CENTER_EPS: f32 = ${FLEET_MODEL_LIGHT_CENTER_EPS};

struct VSIn {
  @location(0) meshPos : vec3<f32>,
  @location(1) meshNrm : vec3<f32>,
  @location(2) meshUv : vec2<f32>,
  @builtin(instance_index) inst : u32,
};

struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) uv : vec2<f32>,
  @location(1) worldNrm : vec3<f32>,
  /** Origin-relative surface position (for camera rim only). */
  @location(2) relPos : vec3<f32>,
  /** Unit light dir from ship → pathEnd (point light at destination/orbit). */
  @location(3) lightDir : vec3<f32>,
  /** Unit dir from surface toward aft thruster lamp (body −Z). */
  @location(4) aftLightDir : vec3<f32>,
};

fn quatRotate(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

fn quatNormalize(q: vec4<f32>) -> vec4<f32> {
  let len = length(q);
  if (len < 1e-8) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }
  return q / len;
}

/** L = normalize(center − ship); fallback when degenerate. Matches TS lightDirFromOrbitCenter. */
fn lightDirFromOrbitCenter(shipPos: vec3<f32>, center: vec3<f32>) -> vec3<f32> {
  let d = center - shipPos;
  let len2 = dot(d, d);
  let eps2 = LIGHT_CENTER_EPS * LIGHT_CENTER_EPS;
  if (len2 <= eps2) {
    return normalize(u.fallbackLight);
  }
  return d * inverseSqrt(len2);
}

@vertex
fn vs_main(input : VSIn) -> VSOut {
  var out : VSOut;
  let shipIdx = shipIndices[input.inst];
  let ship = ships[shipIdx];
  if (ship.mode == SHIP_MODE_PAUSED) {
    out.clip = vec4<f32>(0.0, 0.0, 2.0, 1.0);
    out.uv = input.meshUv;
    out.worldNrm = vec3<f32>(0.0, 1.0, 0.0);
    out.relPos = vec3<f32>(0.0);
    out.lightDir = normalize(u.fallbackLight);
    out.aftLightDir = vec3<f32>(0.0, 0.0, -1.0);
    return out;
  }
  var q = quatNormalize(vec4<f32>(ship.qx, ship.qy, ship.qz, ship.qw));
  let qLenSq = ship.qx * ship.qx + ship.qy * ship.qy + ship.qz * ship.qz + ship.qw * ship.qw;
  if (qLenSq < 1e-8) {
    let h = ship.heading;
    let half = h * 0.5;
    q = vec4<f32>(0.0, sin(half), 0.0, cos(half));
  }
  let meshFix = vec4<f32>(0.0, sin(u.meshYawHalf), 0.0, cos(u.meshYawHalf));
  let localMesh = quatRotate(meshFix, input.meshPos) * u.modelScale;
  let nMesh = quatRotate(meshFix, input.meshNrm);
  let worldOff = quatRotate(q, localMesh);

  // PathEnd + orbit phase for planar CIRCULATE: origin-relative without abs thrash.
  // SPACE3D CIRCULATE stays on shipPos−origin (sphere agent; planar phase would snap).
  let fi = ship.fleetIndex;
  var pathEnd = vec3<f32>(ship.posX, ship.posY, ship.posZ);
  var space3d = false;
  if (fi < arrayLength(&fleets)) {
    let f = fleets[fi];
    pathEnd = vec3<f32>(f.pathEndX, f.pathEndY, f.pathEndZ);
    space3d = (f.flags & FLEET_FLAG_SPACE3D) != 0u;
  }
  var shipPos = vec3<f32>(ship.posX, ship.posY, ship.posZ);
  var rel: vec3<f32>;
  // Planar CIRCULATE only: reconstruct from phase (match triangle scatter gate).
  // localOrb.y = live posY (approach ramp + settled personal height).
  if (ship.mode == SHIP_MODE_ORBIT && !space3d) {
    let R = select(2.0, ship.orbitR, ship.orbitR > 1e-6);
    let sp = sin(ship.orbitPhase);
    let cp = cos(ship.orbitPhase);
    let localOrb = vec3<f32>(R * sp, ship.posY, R * cp);
    // Draw: f32(pathEnd − origin) + local — keeps R-scale under follow-cam.
    rel = (pathEnd - u.origin) + localOrb + worldOff;
    // Light toward pathEnd from ship = −radial (precise, no absolute thrash).
    out.lightDir = lightDirFromOrbitCenter(localOrb, vec3<f32>(0.0));
  } else {
    rel = shipPos - u.origin + worldOff;
    out.lightDir = lightDirFromOrbitCenter(shipPos, pathEnd);
  }
  let nWorld = quatRotate(q, nMesh);
  out.clip = u.viewProj * vec4<f32>(rel, 1.0);
  out.uv = input.meshUv;
  out.worldNrm = nWorld;
  out.relPos = rel;
  // Aft thruster lamp: body −Z (forward is +Z). Direction from surface toward light.
  out.aftLightDir = normalize(quatRotate(q, vec3<f32>(0.0, 0.0, -1.0)));
  return out;
}

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  let baseSample = textureSample(baseColorTex, texSampler, input.uv);
  let specSample = textureSample(specularDiffuseTex, texSampler, input.uv);
  let cool = vec3<f32>(0.35, 0.72, 0.95);
  let hot = vec3<f32>(1.0, 0.45, 0.15);
  let albedo = mix(cool, baseSample.rgb, 0.55) * mix(vec3<f32>(1.0), specSample.rgb, 0.2);
  let nMap = textureSample(normalTex, texSampler, input.uv).xyz * 2.0 - 1.0;
  var n = normalize(input.worldNrm);
  n = normalize(n + vec3<f32>(nMap.x, nMap.y, nMap.z) * 0.35);

  // Key light: pathEnd point light (world). Does NOT use origin or camera.
  let L = normalize(input.lightDir);
  let NdotL = max(dot(n, L), 0.0);
  let hemi = u.ambient + (1.0 - u.ambient) * NdotL;

  // Soft rim only: true camera eye vs surface (origin-relative).
  // Follow mode sets origin = ship — must NOT use -relPos as light (old bug).
  let eyeRel = u.eyeWorld - u.origin;
  let toEye = eyeRel - input.relPos;
  let viewDir = select(
    vec3<f32>(0.0, 1.0, 0.0),
    normalize(toEye),
    dot(toEye, toEye) > 1e-6,
  );
  let rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.5);
  // Keep rim subtle so pathEnd key light dominates (esp. under follow cam).
  let eng = hot * rim * 0.18;

  // Hard aft thruster light (body −Z), lightly pulsing with trails.
  let Laft = normalize(input.aftLightDir);
  let nAft = max(dot(n, Laft), 0.0);
  let aftHard = pow(nAft, 1.35) * 1.35 * max(u.thrusterPulse, 0.5);
  let aftCol = vec3<f32>(0.55, 0.75, 1.0) * aftHard;

  let lit = albedo * hemi + eng + aftCol + vec3<f32>(0.04, 0.06, 0.1);
  return vec4<f32>(lit, max(baseSample.a, 0.92));
}
`;
//# sourceMappingURL=fleet-model-ships.wgsl.js.map