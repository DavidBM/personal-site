/**
 * Hillaire / Bruneton LUT bake + FOCUS apply snippet.
 *
 * Year-1: one FOCUS body. Not a sky-view dome / aerial-perspective volume.
 * Transmittance is Bruneton T(r, μ) (256×64). Multi-scatter is Hillaire’s
 * isotropic bounce table (32×32). Apply is a disc-impostor march that
 * samples those tables from the shipped Band-C ray (`camPos=(0,0,camDist)`).
 *
 * Apply resources live on **bind group 1** (FOCUS pipeline only).
 * Do not touch earth-crack’s reserved group-0 slot.
 */
/** Storage format for both LUT textures (write in compute, sample in FS). */
export const HILLAIRE_LUT_STORAGE_FORMAT = "rgba16float";
export const HILLAIRE_BAKE_UNIFORM_SIZE = 64;
/**
 * Two compute entries. `cs_transmittance` writes T. `cs_multiscatter`
 * samples T and writes the isotropic MS table.
 */
export const HILLAIRE_BAKE_WGSL = /* wgsl */ `
struct LutBakeUniforms {
  rInner : f32,
  rOuter : f32,
  extScale : f32,
  intensity : f32,
  color : vec4<f32>,   // rgb = Rayleigh β, w = Mie ext (12×extScale)
  mieEmit : f32,
  rayH : f32,          // scale height (matches disc ph_ray = 0.05)
  mieH : f32,          // scale height (matches disc ph_mie = 0.02)
  _pad : f32,
};

@group(0) @binding(0) var outLut : texture_storage_2d<rgba16float, write>;
@group(0) @binding(1) var<uniform> bake : LutBakeUniforms;
// MS pass only — unused by cs_transmittance (auto layout drops them).
@group(0) @binding(2) var tLut : texture_2d<f32>;
@group(0) @binding(3) var tSamp : sampler;

const LOG2_E : f32 = 1.4426950408889634;
const PI : f32 = 3.14159265;
const TRANSMITTANCE_STEPS : i32 = 32;
const MS_DIRS : i32 = 8;

fn exp_fast(x : f32) -> f32 {
  return exp2(x * LOG2_E);
}

fn exp_fast3(v : vec3<f32>) -> vec3<f32> {
  return exp2(v * LOG2_E);
}

fn sqrt_fast(x : f32) -> f32 {
  return select(0.0, x * inverseSqrt(x), x > 0.0);
}

fn ray_vs_sphere(p : vec3<f32>, dir : vec3<f32>, r : f32) -> vec2<f32> {
  let b = dot(p, dir);
  let c = dot(p, p) - r * r;
  let d = b * b - c;
  if (d < 0.0) {
    return vec2<f32>(1e4, -1e4);
  }
  let s = sqrt_fast(d);
  return vec2<f32>(-b - s, -b + s);
}

fn dens_r(r : f32, h : f32) -> f32 {
  let thick = max(bake.rOuter - bake.rInner, 0.001);
  return exp_fast(-max(r - bake.rInner, 0.0) / thick / max(h, 1e-4));
}

/** Bruneton 2017: uv.x ← μ mapping, uv.y ← ρ / H. */
fn uv_to_r_mu(uv : vec2<f32>) -> vec2<f32> {
  let bottom = bake.rInner;
  let top = bake.rOuter;
  let H = sqrt_fast(max(top * top - bottom * bottom, 0.0));
  let rho = H * clamp(uv.y, 0.0, 1.0);
  let r = sqrt_fast(rho * rho + bottom * bottom);
  let d_min = top - r;
  let d_max = rho + H;
  let d = d_min + clamp(uv.x, 0.0, 1.0) * max(d_max - d_min, 1e-5);
  var mu = 1.0;
  if (d > 1e-5 && r > 1e-5) {
    mu = clamp((top * top - r * r - d * d) / (2.0 * r * d), -1.0, 1.0);
  }
  return vec2<f32>(max(r, bottom), mu);
}

fn r_mu_to_uv(r0 : f32, mu : f32) -> vec2<f32> {
  let bottom = bake.rInner;
  let top = bake.rOuter;
  let r = max(r0, bottom);
  let H = sqrt_fast(max(top * top - bottom * bottom, 0.0));
  let rho = sqrt_fast(max(r * r - bottom * bottom, 0.0));
  let d = max(-r * mu + sqrt_fast(max(r * r * (mu * mu - 1.0) + top * top, 0.0)), 0.0);
  let d_min = top - r;
  let d_max = rho + H;
  let x_mu = (d - d_min) / max(d_max - d_min, 1e-5);
  let x_r = rho / max(H, 1e-5);
  return vec2<f32>(clamp(x_mu, 0.0, 1.0), clamp(x_r, 0.0, 1.0));
}

fn k_ray() -> vec3<f32> {
  return bake.color.xyz * bake.extScale;
}

fn k_mie() -> f32 {
  return bake.color.w;
}

/** Optical depth along (r, μ) to the atmosphere top. Hits ground → 0 T. */
fn integrate_transmittance(r : f32, mu : f32) -> vec3<f32> {
  let sin_th = sqrt_fast(max(1.0 - mu * mu, 0.0));
  let pos = vec3<f32>(0.0, 0.0, r);
  let dir = vec3<f32>(sin_th, 0.0, mu);
  let hitO = ray_vs_sphere(pos, dir, bake.rOuter);
  if (hitO.y <= 0.0) {
    return vec3<f32>(1.0);
  }
  let hitG = ray_vs_sphere(pos, dir, bake.rInner * 0.999);
  if (hitG.x > 0.0 && hitG.x < hitG.y && hitG.x < hitO.y) {
    return vec3<f32>(0.0);
  }
  let t0 = max(hitO.x, 0.0);
  let t1 = hitO.y;
  let span = t1 - t0;
  if (span <= 1e-5) {
    return vec3<f32>(1.0);
  }
  let ds = span / f32(TRANSMITTANCE_STEPS);
  var od_ray = vec3<f32>(0.0);
  var od_mie = 0.0;
  var t = t0 + ds * 0.5;
  for (var i = 0; i < TRANSMITTANCE_STEPS; i = i + 1) {
    let p = pos + dir * t;
    let rr = max(length(p), bake.rInner);
    od_ray = od_ray + dens_r(rr, bake.rayH) * ds;
    od_mie = od_mie + dens_r(rr, bake.mieH) * ds;
    t = t + ds;
  }
  let ext = od_ray * k_ray() + vec3<f32>(od_mie * k_mie() * 1.05);
  return exp_fast3(-ext);
}

@compute @workgroup_size(8, 8, 1)
fn cs_transmittance(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = textureDimensions(outLut);
  if (gid.x >= dim.x || gid.y >= dim.y) {
    return;
  }
  let uv = vec2<f32>(
    (f32(gid.x) + 0.5) / f32(dim.x),
    (f32(gid.y) + 0.5) / f32(dim.y),
  );
  let rm = uv_to_r_mu(uv);
  let T = integrate_transmittance(rm.x, rm.y);
  textureStore(outLut, vec2<i32>(i32(gid.x), i32(gid.y)), vec4<f32>(T, 1.0));
}

fn sample_T(r : f32, mu : f32) -> vec3<f32> {
  let uv = r_mu_to_uv(r, mu);
  return textureSampleLevel(tLut, tSamp, uv, 0.0).rgb;
}

/** 8 cube-ish unit directions (no reject). */
fn ms_dir(i : i32) -> vec3<f32> {
  var dirs = array<vec3<f32>, 8>(
    vec3<f32>( 0.577,  0.577,  0.577),
    vec3<f32>(-0.577,  0.577,  0.577),
    vec3<f32>( 0.577, -0.577,  0.577),
    vec3<f32>(-0.577, -0.577,  0.577),
    vec3<f32>( 0.577,  0.577, -0.577),
    vec3<f32>(-0.577,  0.577, -0.577),
    vec3<f32>( 0.577, -0.577, -0.577),
    vec3<f32>(-0.577, -0.577, -0.577),
  );
  return dirs[i];
}

@compute @workgroup_size(8, 8, 1)
fn cs_multiscatter(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = textureDimensions(outLut);
  if (gid.x >= dim.x || gid.y >= dim.y) {
    return;
  }
  let u = (f32(gid.x) + 0.5) / f32(dim.x);
  let v = (f32(gid.y) + 0.5) / f32(dim.y);
  let r = mix(bake.rInner, bake.rOuter, v);
  let mu_s = u * 2.0 - 1.0;

  var L2 = vec3<f32>(0.0);
  var f_acc = 0.0;
  let kr = k_ray();
  let km = k_mie();
  let dens = dens_r(r, bake.rayH);
  for (var i = 0; i < MS_DIRS; i = i + 1) {
    let d = ms_dir(i);
    let mu = d.z;
    let T = sample_T(r, mu);
    let Tsun = sample_T(r, mu_s);
    L2 = L2 + T * Tsun * dens * (kr + vec3<f32>(km * 0.25));
    let lum = dot(T, vec3<f32>(0.2126, 0.7152, 0.0722));
    f_acc = f_acc + dens * (1.0 - clamp(lum, 0.0, 1.0));
  }
  let invN = 1.0 / f32(MS_DIRS);
  L2 = L2 * (4.0 * PI) * invN;
  let Fms = clamp(f_acc * invN, 0.0, 0.95);
  // Hillaire infinite isotropic bounce: L2 × F / (1 − F)
  let Lms = L2 * Fms / max(1.0 - Fms, 0.05);
  let rgb = clamp(Lms * bake.intensity * 0.15, vec3<f32>(0.0), vec3<f32>(8.0));
  textureStore(outLut, vec2<i32>(i32(gid.x), i32(gid.y)), vec4<f32>(rgb, Fms));
}
`;
/**
 * Appended to `PLANET_DISC_WGSL`. Uses existing disc helpers (`density`,
 * `phase_ray`, `ray_vs_sphere`, `in_scatter` knobs) and `BodyUniforms`.
 *
 * Bind group 1 is statically used only by `fs_band_c_lut` so Band-B `fs_main`
 * and RecurseDraw `fs_band_c` keep a group-0-only auto layout.
 */
export const HILLAIRE_APPLY_WGSL = /* wgsl */ `

@group(1) @binding(0) var hillaireT : texture_2d<f32>;
@group(1) @binding(1) var hillaireMS : texture_2d<f32>;
@group(1) @binding(2) var hillaireSamp : sampler;

fn hillaire_T_uv(r : f32, mu : f32, rInner : f32, rOuter : f32) -> vec2<f32> {
  let bottom = rInner;
  let top = rOuter;
  let rr = max(r, bottom);
  let H = sqrt_fast(max(top * top - bottom * bottom, 0.0));
  let rho = sqrt_fast(max(rr * rr - bottom * bottom, 0.0));
  let d = max(-rr * mu + sqrt_fast(max(rr * rr * (mu * mu - 1.0) + top * top, 0.0)), 0.0);
  let d_min = top - rr;
  let d_max = rho + H;
  let x_mu = (d - d_min) / max(d_max - d_min, 1e-5);
  let x_r = rho / max(H, 1e-5);
  return vec2<f32>(clamp(x_mu, 0.0, 1.0), clamp(x_r, 0.0, 1.0));
}

fn sample_hillaire_T(r : f32, mu : f32, rInner : f32, rOuter : f32) -> vec3<f32> {
  let uv = hillaire_T_uv(r, mu, rInner, rOuter);
  return textureSampleLevel(hillaireT, hillaireSamp, uv, 0.0).rgb;
}

fn sample_hillaire_MS(r : f32, mu_s : f32, rInner : f32, rOuter : f32) -> vec3<f32> {
  let u = clamp(0.5 + 0.5 * mu_s, 0.0, 1.0);
  let v = clamp((r - rInner) / max(rOuter - rInner, 0.001), 0.0, 1.0);
  return textureSampleLevel(hillaireMS, hillaireSamp, vec2<f32>(u, v), 0.0).rgb;
}

/**
 * Disc-local Hillaire apply: short view march (same steps as O’Neil) but
 * sun optical depth + multi-scatter come from the baked LUTs.
 */
fn hillaire_in_scatter(o : vec3<f32>, dir : vec3<f32>, e : vec2<f32>, l : vec3<f32>) -> vec3<f32> {
  let ph_ray = 0.05;
  let ph_mie = 0.02;
  let ext = body.look1.y;
  let intensity = body.look1.x;
  let atmCol = body.look3.xyz;
  let mieEmit = body.look2.z;
  let rInner = body.look2.x;
  let thick = max(body.look0.w, 0.001);
  let rOuter = rInner + thick;
  let k_ray = atmCol * ext;
  let k_mie = vec3<f32>(12.0) * ext;
  let k_mie_ex = 1.05;
  let span = e.y - e.x;
  if (span <= 1e-5) {
    return vec3<f32>(0.0);
  }
  let stepLen = span / f32(VIEW_SCATTER_STEPS);
  let stepDir = dir * stepLen;
  var v = o + dir * (e.x + stepLen * 0.5);
  var sum_ray = vec3<f32>(0.0);
  var sum_mie = vec3<f32>(0.0);
  var sum_ms = vec3<f32>(0.0);
  var n_ray0 = 0.0;
  var n_mie0 = 0.0;
  for (var i = 0; i < VIEW_SCATTER_STEPS; i = i + 1) {
    let d_ray = density(v, ph_ray) * stepLen;
    let d_mie = density(v, ph_mie) * stepLen;
    n_ray0 = n_ray0 + d_ray;
    n_mie0 = n_mie0 + d_mie;
    let rr = max(length(v), 1e-5);
    let up = v * (1.0 / rr);
    let mu_s = clamp(dot(l, up), -1.0, 1.0);
    let Tsun = sample_hillaire_T(rr, mu_s, rInner, rOuter);
    let att_view = exp_fast3(-n_ray0 * k_ray - n_mie0 * k_mie * k_mie_ex);
    let att = att_view * Tsun;
    sum_ray = sum_ray + d_ray * att;
    sum_mie = sum_mie + d_mie * att;
    sum_ms = sum_ms + d_ray * att_view * sample_hillaire_MS(rr, mu_s, rInner, rOuter);
    v = v + stepDir;
  }
  let c = clamp(dot(dir, -l), -1.0, 1.0);
  let cc = c * c;
  let scatter =
    sum_ray * atmCol * phase_ray(cc) +
    sum_mie * vec3<f32>(mieEmit) * phase_mie(-0.78, c, cc) +
    sum_ms;
  return intensity * min(scatter, vec3<f32>(8.0));
}

@fragment
fn fs_band_c_lut(in : VSOut) -> BandCFSOut {
  var o : BandCFSOut;
  let local = in.local;
  let r = length(local);
  let margin = body.spinOblMargin.z;
  let discR = 1.0 / margin;
  let rr = r / discR;
  let edgeOuter = body.look0.y;
  let atmOuterRr = body.look0.z;
  if (rr > atmOuterRr) {
    discard;
  }

  let spin = body.spinOblMargin.x;
  let obl = body.spinOblMargin.y;
  let rInner = body.look2.x;
  let atmThick = max(body.look0.w, 0.001);
  let camDist = max(body.look1.w, 1.0);
  let atmGain = body.look1.z;
  let glowMul = body.look2.y;
  let glowCol = body.glowStr.xyz;
  let albedoBase = body.albedoKind.xyz;
  let texI = body.look3.w;
  let ambient = body.look4.x;
  let dayStr = body.look4.y;
  let specStr = body.look4.z;
  let specPow = max(body.look4.w, 1.0);
  let cloudAmt = body.look5.x;
  let nightAmt = body.look5.y;
  let nrmStr = body.look5.z;
  let edgeInner = body.look0.x;

  let camPos = vec3<f32>(0.0, 0.0, camDist);
  let p = vec2<f32>(local.x / discR, local.y / discR);
  let dir = normalize_fast(vec3<f32>(p.x, p.y, -camDist));
  let hit = ray_vs_sphere(camPos, dir, rInner);
  let usedSphere = hit.x < hit.y && hit.x > 0.0;

  var nLocal : vec3<f32>;
  var surfaceMask : f32;
  if (usedSphere) {
    let pHit = camPos + dir * hit.x;
    nLocal = normalize_fast(pHit);
    surfaceMask = 1.0;
  } else {
    let zSphere = sqrt_fast(max(0.0, 1.0 - min(rr * rr, 1.0)));
    nLocal = normalize_fast(vec3<f32>(
      local.x / discR,
      local.y / discR,
      select(0.12, zSphere, rr <= edgeOuter),
    ));
    let softEdge = max(edgeOuter - edgeInner, max(body.spinOblMargin.w, 1e-4));
    surfaceMask = 1.0 - smoothstep(edgeOuter - softEdge, edgeOuter, rr);
  }

  let camFwd = normalize_fast(cross(body.camRight.xyz, body.camUp.xyz));
  var nWorld = normalize_fast(
    body.camRight.xyz * nLocal.x
    + body.camUp.xyz * nLocal.y
    + camFwd * nLocal.z
  );
  var nBody = nWorld;
  nBody = rotateX(nBody, -obl);
  nBody = rotateY(nBody, -spin);
  nBody = normalize_fast(nBody);
  let uv = sphereToUv(nBody);
  let uvCloud = vec2<f32>(fract(uv.x + frame.timePad.x * 0.003), uv.y);

  let sunDir = normalize_fast(frame.sunPos.xyz - body.centerRadius.xyz);

  let dayMap = Dual(texAlbedo, texPoleN, texPoleS, uv, nBody);
  let cloudS = Dual(texCloud, texCloudPoleN, texCloudPoleS, uvCloud, nBody);
  let cloudCover = cloudS.a * cloudAmt;
  var surface = mix(dayMap.rgb, cloudS.rgb, cloudCover);
  let nMap = textureSampleLevel(texNormal, samp, uv, 0.0).xyz * 2.0 - 1.0;
  let specMap = textureSampleLevel(texSpec, samp, uv, 0.0).r;
  let nightMap = textureSampleLevel(texNight, samp, uv, 0.0).rgb;
  let upRef = vec3<f32>(0.0, 1.0, 0.0);
  var tAxis = cross(upRef, nBody);
  if (dot(tAxis, tAxis) < 1e-8) {
    tAxis = vec3<f32>(1.0, 0.0, 0.0);
  }
  tAxis = normalize_fast(tAxis);
  let bAxis = cross(nBody, tAxis);
  let nMapped = normalize_fast(tAxis * nMap.x + bAxis * nMap.y + nBody * nMap.z);
  var nShade = normalize_fast(mix(nBody, nMapped, clamp(nrmStr, 0.0, 1.5)));
  nShade = rotateY(nShade, spin);
  nShade = rotateX(nShade, obl);
  nShade = normalize_fast(nShade);
  let lavaHint = smoothstep(0.0, 0.15, dayMap.r - dayMap.b) * smoothstep(0.35, 0.85, specMap);
  let nightCol = nightMap + dayMap.rgb * lavaHint * 0.1;
  let specAmt = specMap * (1.0 - lavaHint);
  surface = surface * texI;
  let Ldot = dot(nShade, sunDir);
  let day = smoothstep(-0.12, 0.18, Ldot);
  var lit = surface * (ambient + dayStr * day);
  let viewDir = normalize_fast(frame.eyePos.xyz - body.centerRadius.xyz);
  let halfV = normalize_fast(sunDir + viewDir);
  let spec = pow_fast(max(dot(nShade, halfV), 0.0), specPow) * specAmt * day * specStr;
  lit = lit + vec3<f32>(1.0, 0.94, 0.82) * spec;
  lit = mix(nightCol * nightAmt, lit, day);

  var atm = vec3<f32>(0.0);
  var e = ray_vs_sphere(camPos, dir, rInner + atmThick);
  if (e.x < e.y && e.x > 0.0) {
    let f = ray_vs_sphere(camPos, dir, rInner);
    if (f.x < f.y && f.x > 0.0) {
      e.y = min(e.y, f.x);
    }
    if (e.y > e.x + 1e-4) {
      var sunLocal = vec3<f32>(
        dot(sunDir, body.camRight.xyz),
        dot(sunDir, body.camUp.xyz),
        dot(sunDir, camFwd),
      );
      let sl = length(sunLocal);
      sunLocal = select(vec3<f32>(0.0, 0.0, 1.0), sunLocal / max(sl, 1e-6), sl > 1e-5);
      let scatter = hillaire_in_scatter(camPos, dir, e, sunLocal) * 1.15;
      let gStr = body.glowStr.w * glowMul;
      atm = scatter * mix(vec3<f32>(1.0), glowCol, 0.35) * (0.85 + 0.55 * gStr) * atmGain;
    }
  }
  atm = atm * (1.0 - smoothstep(edgeOuter + 0.02, atmOuterRr, rr));
  atm = clamp(atm, vec3<f32>(0.0), vec3<f32>(6.0));
  let rgb = clamp(lit * surfaceMask + atm, vec3<f32>(0.0), vec3<f32>(6.0));

  if (usedSphere) {
    let radius = body.centerRadius.w;
    let hitWorld = body.centerRadius.xyz + nWorld * radius;
    let clip = frame.viewProjRel * vec4<f32>(hitWorld, 1.0);
    o.depth = clamp(clip.z / max(clip.w, 1e-8), 0.0, 1.0);
  } else {
    o.depth = in.position.z;
  }
  o.color = vec4<f32>(rgb, clamp(surfaceMask, 0.0, 1.0));
  o.color = vec4<f32>(o.color.rgb + albedoBase * 0.0, o.color.a);
  return o;
}
`;
//# sourceMappingURL=hillaire-lut.wgsl.js.map