/**
 * Lit triangle-mesh asteroid (solo mesh-500 compare path).
 * Vertex: pos3 + normal3 + uv2 + tangent3 (11 floats, matches mesh.ts).
 * model col3 = world translation; camRight.w = instance scale.
 */
export const ASTEROID_MESH_WGSL = /* wgsl */ `
struct MeshUniforms {
  viewProj: mat4x4f,
  model: mat4x4f,
  camPos: vec4f,
  lightDir: vec4f,
  camRight: vec4f,
  camUp: vec4f,
  params: vec4f,
  steps: vec4f,
  budget: vec4f,
};

@group(0) @binding(0) var<uniform> U: MeshUniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var albedoMap: texture_2d<f32>;
@group(0) @binding(3) var normalMap: texture_2d<f32>;
@group(0) @binding(4) var heightConeMap: texture_2d<f32>;

struct VSIn {
  @location(0) pos: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) tangent: vec3f,
};

struct VSOut {
  @builtin(position) clip: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) worldN: vec3f,
  @location(2) uv: vec2f,
};

fn normalize_fast(v: vec3f) -> vec3f {
  return v * inverseSqrt(max(dot(v, v), 1e-20));
}

@vertex
fn vs_main(input: VSIn) -> VSOut {
  let scale = max(U.camRight.w, 0.05);
  let center = U.model[3].xyz;
  // model columns 0..2 = rotation; scale radial mesh then translate
  let rpos = input.pos * scale;
  let world =
    U.model[0].xyz * rpos.x
    + U.model[1].xyz * rpos.y
    + U.model[2].xyz * rpos.z
    + center;
  let worldN = normalize_fast(
    U.model[0].xyz * input.normal.x
    + U.model[1].xyz * input.normal.y
    + U.model[2].xyz * input.normal.z,
  );
  var out: VSOut;
  out.clip = U.viewProj * vec4f(world, 1.0);
  out.worldPos = world;
  out.worldN = worldN;
  out.uv = input.uv;
  return out;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4f {
  let N = normalize_fast(input.worldN);
  let V = normalize_fast(U.camPos.xyz - input.worldPos);
  let L = normalize_fast(U.lightDir.xyz);
  let ndl = max(dot(N, L), 0.0);
  let albedo = textureSampleLevel(albedoMap, samp, input.uv, 0.0).rgb;
  // Cheap lit surface (mesh compare path — not ray-heightfield)
  let ambient = 0.18;
  let wrap = ndl * 0.85 + 0.15;
  let H = normalize_fast(L + V);
  let spec = pow(max(dot(N, H), 0.0), 24.0) * 0.12;
  var col = albedo * (ambient + wrap * 0.95) + vec3f(spec);
  // Gamma
  col = pow(max(col, vec3f(0.0)), vec3f(1.0 / 2.2));
  return vec4f(col, 1.0);
}
`;
/**
 * Disc-impostor multi-method planet surface comparison.
 *
 * Topology = camera-facing quad (solar-system planet disc style). Fragment
 * reconstructs unit-sphere position from disc local xy:
 *   rr² = |local|², discard if rr² > 1
 *   nBillboard = (local.x, local.y, sqrt(1−rr²))  // already unit
 *   nWorld = camRight·x + camUp·y + camFwd·z
 *   P_body = R^T nWorld  (planet orientation)
 *
 * Surface methods run on body-space P (flat / normal / ray-heightfield walks).
 * Hit = opaque; true ray miss = discard. No geometric mesh displace.
 *
 * ALU: solar-disc style cheap equivalents (inverseSqrt normalize/sqrt,
 * exp2 gamma, r² solid tests, dual height+cone fetch, integer pow32).
 * Step budgets / hit-miss semantics unchanged.
 */
export const SPHERE_SURFACE_WGSL = /* wgsl */ `
struct Uniforms {
  viewProj: mat4x4f,
  // Planet body orientation (body → world rotation)
  model: mat4x4f,
  camPos: vec4f,
  lightDir: vec4f,
  // xyz = billboard right (world), w = sphere radius
  camRight: vec4f,
  // xyz = billboard up (world)
  camUp: vec4f,
  // x: method, y: heightScale, z: rayStep, w: normal blend
  params: vec4f,
  // x: steep, y: pom lin, z: pom bin (also linear refine cap), w: cone
  steps: vec4f,
  // x: classic, y: iterative, z: offset requested floors; w: maxSteps
  budget: vec4f,
};

@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var albedoMap: texture_2d<f32>;
@group(0) @binding(3) var normalMap: texture_2d<f32>;
@group(0) @binding(4) var heightConeMap: texture_2d<f32>;

struct VSOut {
  @builtin(position) clip: vec4f,
  @location(0) local: vec2f,
};

// ---- Cheap-equivalent ALU (match solar planet-disc patterns) ----
const INV_PI: f32 = 0.31830988618;
const INV_2PI: f32 = 0.15915494309;
const INV_GAMMA: f32 = 0.454545454545; // 1/2.2
const HIT_EPS: f32 = 1e-4;

/** sqrt(x) for x > 0 via inverseSqrt; 0 when x ≤ 0. */
fn sqrt_fast(x: f32) -> f32 {
  return select(0.0, x * inverseSqrt(x), x > 0.0);
}

/** normalize(v) via inverseSqrt; near-zero → large but finite (callers guard). */
fn normalize_fast(v: vec3f) -> vec3f {
  return v * inverseSqrt(max(dot(v, v), 1e-20));
}

/** length via rsqrt (one inverseSqrt). */
fn length_fast(v: vec3f) -> f32 {
  return sqrt_fast(dot(v, v));
}

/** pow(x,p) = exp2(p·log2(x)) for x > 0. */
fn pow_fast(x: f32, p: f32) -> f32 {
  return select(0.0, exp2(p * log2(x)), x > 0.0);
}

fn pow_fast3(v: vec3f, p: f32) -> vec3f {
  return vec3f(pow_fast(v.x, p), pow_fast(v.y, p), pow_fast(v.z, p));
}

/** Exact integer power 32 via 5 squares (spec lobe). */
fn pow32_fast(x: f32) -> f32 {
  var y = x * x; // 2
  y = y * y;     // 4
  y = y * y;     // 8
  y = y * y;     // 16
  y = y * y;     // 32
  return y;
}

// ---- Sampling ----
/** Height (B) + cone (G) in one fetch. */
fn sampleHeightCone(uv: vec2f) -> vec2f {
  let t = textureSampleLevel(heightConeMap, samp, uv, 0.0);
  return vec2f(t.b, t.g);
}

fn sampleParallaxH(uv: vec2f) -> f32 {
  return textureSampleLevel(heightConeMap, samp, uv, 0.0).b;
}

fn sampleAlbedo(uv: vec2f) -> vec3f {
  return textureSampleLevel(albedoMap, samp, uv, 0.0).rgb;
}

fn sampleNormalTS(uv: vec2f) -> vec3f {
  let n = textureSampleLevel(normalMap, samp, uv, 0.0).xyz * 2.0 - 1.0;
  return normalize_fast(n);
}

fn wrapUV(uv: vec2f) -> vec2f {
  return vec2f(fract(uv.x), clamp(uv.y, 0.0, 1.0));
}

fn uv_to_dir(uv: vec2f) -> vec3f {
  let u = fract(uv.x);
  let v = clamp(uv.y, 0.0, 1.0);
  let phi = u * 6.28318530718;
  let theta = (1.0 - v) * 3.14159265359;
  let st = sin(theta);
  return vec3f(st * cos(phi), cos(theta), st * sin(phi));
}

/**
 * Direction → equirect UV. Uses rsqrt normalize + branchless u fold via fract.
 * (acos/atan2 kept: algebraically required for true equirect; no quality-safe drop.)
 */
fn dir_to_uv(p: vec3f) -> vec2f {
  let n = p * inverseSqrt(max(dot(p, p), 1e-20));
  let theta = acos(clamp(n.y, -1.0, 1.0));
  // fract maps (−π,π]/2π → [0,1) without phi < 0 branch
  let u = fract(atan2(n.z, n.x) * INV_2PI + 1.0);
  let v = 1.0 - theta * INV_PI;
  return vec2f(u, clamp(v, 0.0, 1.0));
}

/** Unit direction → UV (skip rsqrt). */
fn dir_to_uv_unit(n: vec3f) -> vec2f {
  let theta = acos(clamp(n.y, -1.0, 1.0));
  let u = fract(atan2(n.z, n.x) * INV_2PI + 1.0);
  let v = 1.0 - theta * INV_PI;
  return vec2f(u, clamp(v, 0.0, 1.0));
}

// R^T * v for pure rotation (column-major model)
fn world_to_model(v: vec3f) -> vec3f {
  return vec3f(
    dot(U.model[0].xyz, v),
    dot(U.model[1].xyz, v),
    dot(U.model[2].xyz, v),
  );
}

fn model_to_world(v: vec3f) -> vec3f {
  return U.model[0].xyz * v.x + U.model[1].xyz * v.y + U.model[2].xyz * v.z;
}

fn sphere_limb_weight(ndotv: f32) -> f32 {
  return smoothstep(0.04, 0.2, clamp(ndotv, 0.0, 1.0));
}

// View-independent radial shell
fn surface_radius(h: f32, heightScale: f32, _limb: f32) -> f32 {
  return 1.0 - (1.0 - h) * heightScale;
}

/** Solid test without sqrt: |pos| ≤ rSurf+eps ⇔ r² ≤ (rSurf+eps)² */
fn inside_shell_r2(r2: f32, rSurf: f32) -> bool {
  let lim = rSurf + HIT_EPS;
  return r2 <= lim * lim;
}

// Defaults only if uniforms unset; live path uses U.params.z / U.budget.w
const RAY_STEP_DEFAULT: f32 = 0.018;
const RAY_MAX_STEPS_DEFAULT: i32 = 64;
/** Hard WGSL loop ceiling (must be ≥ quality maxSteps). */
const RAY_LOOP_CEIL: i32 = 96;

fn ray_step_size() -> f32 {
  return max(U.params.z, 0.004);
}

fn ray_max_steps() -> i32 {
  let m = i32(U.budget.w + 0.5);
  return clamp(m, 1, RAY_LOOP_CEIL);
}

fn ray_unit_sphere(o: vec3f, d: vec3f) -> vec2f {
  // d assumed unit: |o+td|²=1 → t² + 2(o·d)t + |o|²−1 = 0
  let b = 2.0 * dot(o, d);
  let c = dot(o, o) - 1.0;
  let disc = b * b - 4.0 * c;
  if (disc < 0.0) {
    return vec2f(1e9, -1e9);
  }
  let s = sqrt_fast(disc);
  // Stable ordering: t0 ≤ t1 via min/max (no branch swap)
  let tNear = (-b - s) * 0.5;
  let tFar = (-b + s) * 0.5;
  return vec2f(min(tNear, tFar), max(tNear, tFar));
}

/** Full chord entry→exit. */
fn ray_chord_end(t0: f32, t1: f32) -> vec2f {
  let tEnter = max(t0, 0.0);
  return vec2f(tEnter, max(t1, tEnter));
}

fn adaptive_steps(tEnter: f32, tEnd: f32, requested: i32) -> i32 {
  let span = max(tEnd - tEnter, 0.0);
  let byLen = i32(ceil(span / ray_step_size()));
  let cap = ray_max_steps();
  return min(max(max(requested, 1), byLen), cap);
}

fn binary_refine_steps() -> i32 {
  // Reuse pom-bin slot as shared refine budget for all linear hit refine loops
  return clamp(i32(U.steps.z + 0.5), 1, 16);
}

/** Seam-aware equirect UV distance (U wraps; V does not). */
fn uv_seam_dist(a: vec2f, b: vec2f) -> f32 {
  var du = abs(a.x - b.x);
  du = min(du, 1.0 - du);
  let dv = abs(a.y - b.y);
  return sqrt_fast(du * du + dv * dv);
}

/**
 * AO from UV travel. MUST use seam-aware distance — raw |uv−uvGeom| treats the
 * meridian wrap (u≈0 vs u≈1) as Δu≈1 → full darken → visible grey “plane”
 * exactly where the equirect texture cycles.
 */
fn ao_from_uv_delta(uv: vec2f, uvGeom: vec2f, scale: f32, lo: f32) -> f32 {
  let amt = clamp(uv_seam_dist(uv, uvGeom) * scale, 0.0, 1.0);
  return mix(1.0, lo, amt);
}

fn ray_heightfield(
  cam: vec3f,
  Pgeom: vec3f,
  heightScale: f32,
  _limb: f32,
  steps: i32,
) -> vec3f {
  let P = normalize_fast(Pgeom);
  let uvG = dir_to_uv_unit(P);
  var dir = P - cam;
  let d2 = dot(dir, dir);
  if (d2 < 1e-12) {
    return vec3f(uvG, 1.0);
  }
  dir = dir * inverseSqrt(d2);

  let ts = ray_unit_sphere(cam, dir);
  if (ts.x > ts.y) {
    return vec3f(uvG, 0.0);
  }

  let ne = ray_chord_end(ts.x, ts.y);
  let tEnter = ne.x;
  let tEnd = ne.y;
  let n = adaptive_steps(tEnter, tEnd, steps);

  {
    let pos = cam + dir * tEnter;
    let r2 = dot(pos, pos);
    let uvE = dir_to_uv(pos);
    let rSurf = surface_radius(sampleParallaxH(uvE), heightScale, 1.0);
    if (inside_shell_r2(r2, rSurf)) {
      return vec3f(uvE, 1.0);
    }
  }

  let invN = select(0.0, 1.0 / f32(n), n > 0);
  let dt = (tEnd - tEnter) * invN;
  var tPrev = tEnter;
  let binN = binary_refine_steps();
  for (var i = 1; i <= RAY_LOOP_CEIL; i++) {
    if (i > n) { break; }
    let t = tEnter + dt * f32(i);
    let pos = cam + dir * t;
    let r2 = dot(pos, pos);
    let uv = dir_to_uv(pos);
    let rSurf = surface_radius(sampleParallaxH(uv), heightScale, 1.0);
    if (inside_shell_r2(r2, rSurf)) {
      var a = tPrev;
      var b = t;
      for (var j = 0; j < 16; j++) {
        if (j >= binN) { break; }
        let m = (a + b) * 0.5;
        let mp = cam + dir * m;
        let mr2 = dot(mp, mp);
        let muv = dir_to_uv(mp);
        let mrs = surface_radius(sampleParallaxH(muv), heightScale, 1.0);
        if (inside_shell_r2(mr2, mrs)) { b = m; } else { a = m; }
      }
      return vec3f(dir_to_uv(cam + dir * b), 1.0);
    }
    tPrev = t;
  }
  return vec3f(uvG, 0.0);
}

fn ray_heightfield_pom(
  cam: vec3f,
  Pgeom: vec3f,
  heightScale: f32,
  _limb: f32,
  linSteps: i32,
  binSteps: i32,
) -> vec3f {
  let P = normalize_fast(Pgeom);
  let uvG = dir_to_uv_unit(P);
  var dir = P - cam;
  let d2 = dot(dir, dir);
  if (d2 < 1e-12) {
    return vec3f(uvG, 1.0);
  }
  dir = dir * inverseSqrt(d2);

  let ts = ray_unit_sphere(cam, dir);
  if (ts.x > ts.y) {
    return vec3f(uvG, 0.0);
  }

  let ne = ray_chord_end(ts.x, ts.y);
  let tEnter = ne.x;
  let tEnd = ne.y;
  let n = adaptive_steps(tEnter, tEnd, linSteps);

  {
    let pos = cam + dir * tEnter;
    let r2 = dot(pos, pos);
    let uvE = dir_to_uv(pos);
    let rSurf = surface_radius(sampleParallaxH(uvE), heightScale, 1.0);
    if (inside_shell_r2(r2, rSurf)) {
      return vec3f(uvE, 1.0);
    }
  }

  let invN = select(0.0, 1.0 / f32(n), n > 0);
  let dt = (tEnd - tEnter) * invN;
  var tPrev = tEnter;
  for (var i = 1; i <= RAY_LOOP_CEIL; i++) {
    if (i > n) { break; }
    let t = tEnter + dt * f32(i);
    let pos = cam + dir * t;
    let r2 = dot(pos, pos);
    let uv = dir_to_uv(pos);
    let rSurf = surface_radius(sampleParallaxH(uv), heightScale, 1.0);
    if (inside_shell_r2(r2, rSurf)) {
      var a = tPrev;
      var b = t;
      for (var j = 0; j < 16; j++) {
        if (j >= binSteps) { break; }
        let m = (a + b) * 0.5;
        let mp = cam + dir * m;
        let mr2 = dot(mp, mp);
        let muv = dir_to_uv(mp);
        let mrs = surface_radius(sampleParallaxH(muv), heightScale, 1.0);
        if (inside_shell_r2(mr2, mrs)) { b = m; } else { a = m; }
      }
      return vec3f(dir_to_uv(cam + dir * b), 1.0);
    }
    tPrev = t;
  }
  return vec3f(uvG, 0.0);
}

fn ray_heightfield_cone(
  cam: vec3f,
  Pgeom: vec3f,
  heightScale: f32,
  _limb: f32,
  steps: i32,
) -> vec3f {
  let P = normalize_fast(Pgeom);
  let uvG = dir_to_uv_unit(P);
  var dir = P - cam;
  let d2 = dot(dir, dir);
  if (d2 < 1e-12) {
    return vec3f(uvG, 1.0);
  }
  dir = dir * inverseSqrt(d2);
  let ts = ray_unit_sphere(cam, dir);
  if (ts.x > ts.y) {
    return vec3f(uvG, 0.0);
  }
  let ne = ray_chord_end(ts.x, ts.y);
  let tEnter = ne.x;
  let tEnd = ne.y;
  let n = adaptive_steps(tEnter, tEnd, steps);

  {
    let pos = cam + dir * tEnter;
    let uvE = dir_to_uv(pos);
    let rSurf = surface_radius(sampleParallaxH(uvE), heightScale, 1.0);
    if (inside_shell_r2(dot(pos, pos), rSurf)) {
      return vec3f(uvE, 1.0);
    }
  }

  var t = tEnter;
  let invN = select(0.0, 1.0 / f32(n), n > 0);
  let baseDt = (tEnd - tEnter) * invN;
  let dtMin = baseDt * 0.35;
  let dtMax = max(baseDt * 2.5, ray_step_size());
  for (var i = 0; i < RAY_LOOP_CEIL; i++) {
    if (i >= n) { break; }
    if (t >= tEnd) { break; }
    let pos = cam + dir * t;
    let uv = dir_to_uv(pos);
    // One fetch: height.b + cone.g
    let hc = sampleHeightCone(uv);
    let rSurf = surface_radius(hc.x, heightScale, 1.0);
    if (inside_shell_r2(dot(pos, pos), rSurf)) {
      return vec3f(uv, 1.0);
    }
    let cone = max(hc.y, 0.002);
    var dt = baseDt * (0.65 + cone * 2.0);
    dt = clamp(dt, dtMin, dtMax);
    t = min(tEnd, t + dt);
  }
  return vec3f(uvG, 0.0);
}

fn tbn_from_normal(N: vec3f) -> mat3x3f {
  // Prefer branchless-ish up pick: if |Ny| large use X else Y
  let useX = select(0.0, 1.0, abs(N.y) > 0.9);
  let up = vec3f(useX, 1.0 - useX, 0.0);
  let t = normalize_fast(cross(up, N));
  let B = cross(N, t); // already unit if N,t unit orthogonal
  return mat3x3f(t, B, N);
}

fn shade(albedo: vec3f, N: vec3f, V: vec3f, L: vec3f, ndotv: f32) -> vec3f {
  let ndl = max(dot(N, L), 0.0);
  let H = normalize_fast(L + V);
  let specAmt = 0.04 * smoothstep(0.12, 0.45, ndotv);
  let nh = max(dot(N, H), 0.0);
  let spec = pow32_fast(nh) * specAmt;
  let ambient = 0.16;
  let wrap = ndl * 0.85 + 0.15;
  return albedo * (ambient + wrap * 0.95) + vec3f(spec);
}

fn blended_normal(TBN: mat3x3f, Ngeom: vec3f, uv: vec2f, amount: f32) -> vec3f {
  let nTS = sampleNormalTS(uv);
  let Nmap = normalize_fast(TBN * nTS);
  return normalize_fast(mix(Ngeom, Nmap, clamp(amount, 0.0, 1.0)));
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  // Full-screen-style unit disc corners (two triangles)
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f( 1.0, -1.0),
    vec2f(-1.0,  1.0),
    vec2f(-1.0,  1.0),
    vec2f( 1.0, -1.0),
    vec2f( 1.0,  1.0),
  );
  let local = corners[vi];
  let R = max(U.camRight.w, 0.01);
  // Instance translation packed in model column 3 (rotation in 0..2)
  let center = U.model[3].xyz;
  // Camera-facing disc at instance center (billboard)
  let world =
    U.camRight.xyz * (local.x * R)
    + U.camUp.xyz * (local.y * R)
    + center;
  var out: VSOut;
  out.clip = U.viewProj * vec4f(world, 1.0);
  out.local = local;
  return out;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4f {
  let method = i32(U.params.x + 0.5);
  let heightScale = U.params.y;
  let nBlend = U.params.w;
  let R = max(U.camRight.w, 0.01);
  let center = U.model[3].xyz;

  let local = input.local;
  let rr2 = dot(local, local);
  // Outside unit disc = outside planet silhouette
  if (rr2 > 1.0) {
    discard;
  }

  // Reconstruct unit-sphere normal in billboard frame (already unit: x²+y²+z²=1)
  let zSphere = sqrt_fast(1.0 - rr2);
  let nBill = vec3f(local.x, local.y, zSphere);
  let camFwd = normalize_fast(cross(U.camRight.xyz, U.camUp.xyz));
  // Orthonormal basis × unit nBill → unit Nworld (skip renormalize)
  let Nworld =
    U.camRight.xyz * nBill.x
    + U.camUp.xyz * nBill.y
    + camFwd * nBill.z;
  // Body-frame sphere point (pure rotation preserves length → unit)
  let P = normalize_fast(world_to_model(Nworld));
  let worldPos = Nworld * R + center;

  let Vworld = normalize_fast(U.camPos.xyz - worldPos);
  let L = normalize_fast(U.lightDir.xyz);
  let ndotv_w = dot(Nworld, Vworld);
  if (ndotv_w <= 0.0) {
    discard;
  }
  let ndotv_clamped = clamp(ndotv_w, 0.0, 1.0);

  // Cam relative to instance center so ray-heightfield stays body-local
  let camLocal = world_to_model(U.camPos.xyz - center);
  let Vlocal = normalize_fast(camLocal - P);
  let ndotv = max(dot(Vlocal, P), 0.0);
  let limb = sphere_limb_weight(ndotv);

  var uv = dir_to_uv_unit(P);
  let uvGeom = uv;
  var N = Nworld;
  var albedo = sampleAlbedo(uv);
  var ao = 1.0;
  var surfHit = 1.0;

  // 0 flat · 1 normal · 2 classic · 3 iterative · 4 offset · 5 steep · 6 pom · 7 cone
  // TBN only when needed (not flat).
  if (method == 0) {
    N = Nworld;
  } else if (method == 1) {
    let TBN = tbn_from_normal(Nworld);
    N = blended_normal(TBN, Nworld, uv, nBlend * 0.85);
  } else if (method == 2) {
    let rh = ray_heightfield(camLocal, P, heightScale, limb, i32(U.budget.x + 0.5));
    uv = rh.xy;
    surfHit = rh.z;
    albedo = sampleAlbedo(uv);
    let TBN = tbn_from_normal(Nworld);
    N = blended_normal(TBN, Nworld, uv, nBlend * 0.8);
    ao = ao_from_uv_delta(uv, uvGeom, 10.0, 0.75);
  } else if (method == 3) {
    let rh = ray_heightfield(camLocal, P, heightScale, limb, i32(U.budget.y + 0.5));
    uv = rh.xy;
    surfHit = rh.z;
    albedo = sampleAlbedo(uv);
    let TBN = tbn_from_normal(Nworld);
    N = blended_normal(TBN, Nworld, uv, nBlend * 0.8);
    ao = ao_from_uv_delta(uv, uvGeom, 10.0, 0.7);
  } else if (method == 4) {
    let rh = ray_heightfield(camLocal, P, heightScale * 0.85, limb, i32(U.budget.z + 0.5));
    uv = rh.xy;
    surfHit = rh.z;
    albedo = sampleAlbedo(uv);
    let TBN = tbn_from_normal(Nworld);
    N = blended_normal(TBN, Nworld, uv, nBlend * 0.8);
    ao = ao_from_uv_delta(uv, uvGeom, 10.0, 0.75);
  } else if (method == 5) {
    let rh = ray_heightfield(camLocal, P, heightScale, limb, i32(U.steps.x + 0.5));
    uv = rh.xy;
    surfHit = rh.z;
    albedo = sampleAlbedo(uv);
    let TBN = tbn_from_normal(Nworld);
    N = blended_normal(TBN, Nworld, uv, nBlend * 0.75);
    ao = ao_from_uv_delta(uv, uvGeom, 9.0, 0.55);
  } else if (method == 6) {
    let rh = ray_heightfield_pom(
      camLocal, P, heightScale, limb,
      i32(U.steps.y + 0.5), i32(U.steps.z + 0.5),
    );
    uv = rh.xy;
    surfHit = rh.z;
    albedo = sampleAlbedo(uv);
    let TBN = tbn_from_normal(Nworld);
    N = blended_normal(TBN, Nworld, uv, nBlend * 0.75);
    ao = ao_from_uv_delta(uv, uvGeom, 9.0, 0.5);
  } else {
    // cone-step
    let rh = ray_heightfield_cone(camLocal, P, heightScale, limb, i32(U.steps.w + 0.5));
    uv = rh.xy;
    surfHit = rh.z;
    albedo = sampleAlbedo(uv);
    let TBN = tbn_from_normal(Nworld);
    N = blended_normal(TBN, Nworld, uv, nBlend * 0.75);
    ao = ao_from_uv_delta(uv, uvGeom, 9.0, 0.55);
  }

  if (surfHit < 0.5) {
    discard;
  }

  var col = shade(albedo, N, Vworld, L, ndotv_clamped) * ao;
  col = pow_fast3(max(col, vec3f(0.0)), INV_GAMMA);
  return vec4f(col, 1.0);
}
`;
//# sourceMappingURL=shaders.js.map