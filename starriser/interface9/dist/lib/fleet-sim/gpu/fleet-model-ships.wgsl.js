/**
 * Instanced textured ship mesh draw (model LOD band).
 *
 * GPU owns poses: compute writes ShipSim (pos + quaternion), this VS
 * `drawIndexed(mesh, N)` reads `ships[shipIndices[instance]]`. Host does not
 * upload per-ship transforms; it only names which instances when that set changes.
 *
 * Lighting: **point light at fleet pathEnd** (hop destination / orbit center)
 * via FleetGpu lookup on ship.fleetIndex. Ambient + small camera rim; no shadows/IBL.
 *
 * Vertex layout (interleaved): pos.xyz, normal.xyz, uv.xy (32 B).
 */
import { SHIP_SIM_STRIDE } from "../visual/ship-sim-layout.js";
import { MODEL_LOD_MAX_INSTANCES } from "../visual/fleet-lod.js";
import { FLEET_GPU_STRIDE } from "../visual/fleet-layout.js";
import { MODEL_SHIP_TYPES_WGSL, MODEL_SHIP_POSE_WGSL } from "./model-ship-pose.wgsl.js";
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
/** u32 lodMask in the same uniform (float slot 29 / byte 116). */
export const FLEET_MODEL_U_LOD_MASK = 29;
/** u32 hullBand in the same uniform (float slot 30 / byte 120). */
export const FLEET_MODEL_U_HULL_BAND = 30;
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
  /** FleetGpu flag that must be set for this draw (LOW or HIGH). 0 = no filter. */
  lodMask : u32,
  /** 1 = jewel hull band (draw); 0 = triangle band (clip every hull). */
  hullBand : u32,
  batchOffsetWord : u32,
  batchClass : u32,
  catalog : u32,
  pixelGain : f32,
};

${MODEL_SHIP_TYPES_WGSL}

@group(0) @binding(0) var<uniform> u : ModelUniforms;
@group(0) @binding(1) var<storage, read> ships : array<ShipSim>;
@group(0) @binding(2) var baseColorTex : texture_2d<f32>;
@group(0) @binding(3) var normalTex : texture_2d<f32>;
@group(0) @binding(4) var texSampler : sampler;
@group(0) @binding(5) var specularDiffuseTex : texture_2d<f32>;
@group(0) @binding(6) var<storage, read> shipIndices : array<u32>;
/** Fleet pathEnd for per-ship point light (indexed by ShipSim.fleetIndex). */
@group(0) @binding(7) var<storage, read> fleets : array<FleetGpu>;

${MODEL_SHIP_POSE_WGSL}
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
  @location(5) @interpolate(flat) selected: f32,
  @location(6) @interpolate(flat) team: vec3<f32>,
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
  var offset = 0u;
  if (u.batchOffsetWord != 0u) { offset = shipIndices[u.batchOffsetWord]; }
  let shipIdx = shipIndices[offset + input.inst];
  if (shipIdx == 0xffffffffu || u.hullBand == 0u) {
    out.clip = vec4<f32>(0.0, 0.0, 2.0, 1.0);
    out.uv = input.meshUv;
    out.worldNrm = vec3<f32>(0.0, 1.0, 0.0);
    out.relPos = vec3<f32>(0.0);
    out.lightDir = vec3<f32>(0.0, 1.0, 0.0);
    out.aftLightDir = vec3<f32>(0.0, 0.0, -1.0);
    return out;
  }
  let ship = ships[shipIdx];
  out.team = vec3<f32>(ship.slotX, ship.slotY, ship.slotZ);
  out.selected = select(select(0.0, 0.4, (ship.targetKind & 2048u) != 0u), 1.0, (ship.targetKind & 256u) != 0u);
  if (!modelShipLodMatches(ship, u.lodMask) || (u.catalog != 0u && (ship.targetKind & 255u) != u.batchClass)) {
    out.clip = vec4<f32>(0.0, 0.0, 2.0, 1.0);
    out.uv = input.meshUv;
    out.worldNrm = vec3<f32>(0.0, 1.0, 0.0);
    out.relPos = vec3<f32>(0.0);
    out.lightDir = vec3<f32>(0.0, 1.0, 0.0);
    out.aftLightDir = vec3<f32>(0.0, 0.0, -1.0);
    return out;
  }
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
  let pose = modelShipPose(ship, u.origin, u.modelScale);
  let localMesh = quatRotate(meshFix, input.meshPos) * pose.hullScale;
  let nMesh = quatRotate(meshFix, input.meshNrm);
  var worldOff = quatRotate(q, localMesh);

  let rel = pose.centerRel + worldOff;
  out.lightDir = lightDirFromOrbitCenter(pose.lightOffset, pose.lightCenter);
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
  if(u.lodMask==8192u){
    // Flat faction-colored facets, no texture, normal-map or specular reads.
    let light=.65+.35*max(dot(normalize(input.worldNrm),normalize(u.fallbackLight)),0.0);
    return vec4<f32>(input.team*light,1.0);
  }
  let baseSample = textureSample(baseColorTex, texSampler, input.uv);
  let specSample = textureSample(specularDiffuseTex, texSampler, input.uv);
  let cool = vec3<f32>(0.35, 0.72, 0.95);
  let hot = vec3<f32>(1.0, 0.45, 0.15);
  var albedo = mix(cool, baseSample.rgb, 0.55) * mix(vec3<f32>(1.0), specSample.rgb, 0.2);
  if (u.catalog != 0u) {
    // The shared palette carries armor, machinery, glazing and restricted paint.
    // Team color only tints the ochre paint swatch, preserving the hull material.
    let paint = baseSample.r > 0.3 && baseSample.g > 0.15 && baseSample.b < baseSample.r * 0.55;
    albedo = mix(baseSample.rgb, baseSample.rgb * 0.55 + input.team * 0.45, select(0.0, 0.65, paint));
  }
  let nMap = textureSample(normalTex, texSampler, input.uv).xyz * 2.0 - 1.0;
  var n = normalize(input.worldNrm);
  if (u.catalog == 0u) { n = normalize(n + vec3<f32>(nMap.x, nMap.y, nMap.z) * 0.35); }

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
    dot(toEye, toEye) > 1e-20,
  );
  let rim = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 2.5);
  // Keep rim subtle so pathEnd key light dominates (esp. under follow cam).
  let eng = hot * rim * 0.18;

  // Hard aft thruster light (body −Z), lightly pulsing with trails.
  let Laft = normalize(input.aftLightDir);
  let nAft = max(dot(n, Laft), 0.0);
  let aftHard = pow(nAft, 1.35) * 1.35 * max(u.thrusterPulse, 0.5);
  let aftCol = vec3<f32>(0.55, 0.75, 1.0) * aftHard;

  if (u.catalog != 0u) {
    let roughness = clamp(specSample.g, 0.25, 1.0);
    let halfVector = L + viewDir;
    let halfway = halfVector * inverseSqrt(max(dot(halfVector, halfVector), 1e-12));
    let specular = pow(max(dot(n, halfway), 0.0), mix(72.0, 8.0, roughness)) * (0.06 + specSample.b * 0.14) * NdotL;
    let engine = baseSample.b > baseSample.r * 1.35 && baseSample.b > 0.55;
    let lit = albedo * (0.24 + NdotL * 0.76) + vec3<f32>(specular) + albedo * select(0.0, 0.6, engine);
    // A chase camera sees much of the roof at grazing angles; keep even the
    // maximum rim below the material lighting instead of washing the hull cyan.
    let mark = vec3<f32>(0.12, 0.85, 0.92) * input.selected * (0.025 + rim * 0.20);
    return vec4<f32>(lit + mark + vec3<f32>(0.03, 0.04, 0.055) * rim, 1.0);
  }
  let lit = albedo * hemi + eng + aftCol + vec3<f32>(0.04, 0.06, 0.1);
  return vec4<f32>(mix(lit, lit * 0.6 + vec3<f32>(0.0, 0.8, 0.9) * (0.35 + rim), input.selected), max(baseSample.a, 0.92));
}
`;
//# sourceMappingURL=fleet-model-ships.wgsl.js.map