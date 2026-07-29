/**
 * Sun impostor — bright white disc with internal granulation + limb detail.
 *
 * Sampling frames (split by purpose):
 *  - Photosphere: body-sphere normal (billboard → world → inverse spin/obl) so
 *    granulation sticks under camera orbit (like planets). Sphere z reconstruct.
 *  - Corona: body-frame **limb** dir from sky-plane edge
 *    (camRight·local.x + camUp·local.y → rotateX(-obl) → rotateY(-spin)).
 *    Disc-centered + orbit-locked. NOT bodyDir2 / body-plane projection of nBody
 *    (that folds under pitch and moves the streamer origin off-center).
 *  - Streamer intensity: seamless **sphere field** (soft body-frame cones +
 *    noise3). Do NOT use multi-lobe sin(k · bodyLongitude) — that phase
 *    bunches vs screen azimuth when poles enter the silhouette / under pitch.
 *
 * Perf rules:
 *  - Interior (rr ≲ 0.9): photosphere only (cheap body-frame fbm)
 *  - Limb / corona: rays + shell fade (no heavy multi-octave stacks)
 *
 * Layer gains + soft outer shell fade are **uniform-driven** (sun-look-params).
 * look3.z = granGain (internal texture amount).
 *
 * Composite: premultiplied RGB, alpha = solid disc only (outer glow additive).
 */
export const SUN_FRAME_UNIFORM_SIZE = 128;
/** center…eye (6×vec4) + look0..look3 (4×vec4) = 160 bytes, padded to 256. */
export const SUN_BODY_UNIFORM_SIZE = 256;
export const SUN_IMPOSTOR_WGSL = /* wgsl */ `
struct FrameUniforms {
  viewProj : mat4x4<f32>,
  eyePos : vec4<f32>,
  sunPos : vec4<f32>,
  time : f32,
  _pad0 : f32,
  _pad1 : f32,
  _pad2 : f32,
};

struct BodyUniforms {
  centerRadius : vec4<f32>,
  glowStr      : vec4<f32>,
  // x=spin, y=drawMargin, z=time, w=obliquity
  spinMarginT  : vec4<f32>,
  camRight     : vec4<f32>,
  camUp        : vec4<f32>,
  eyePos       : vec4<f32>,
  // look0: discGain, coreLift, discWarm, limbSoft
  look0        : vec4<f32>,
  // look1: chromGain, sheathGain, rayGain, veilGain
  look1        : vec4<f32>,
  // look2: unused/pad, outerGain, outerFalloff, glowMul
  look2        : vec4<f32>,
  // look3: outerFadeStart, outerFadeEnd, granGain, pad
  look3        : vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame : FrameUniforms;
@group(0) @binding(1) var<uniform> body  : BodyUniforms;

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) local : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi : u32) -> VSOut {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
  );
  let local = corners[vi];
  let halfExt = body.centerRadius.w * body.spinMarginT.y;
  let world =
    body.centerRadius.xyz
    + body.camRight.xyz * (local.x * halfExt)
    + body.camUp.xyz * (local.y * halfExt);
  var o : VSOut;
  o.position = frame.viewProj * vec4<f32>(world, 1.0);
  o.local = local;
  return o;
}

fn rotateX(v : vec3<f32>, a : f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(v.x, c * v.y - s * v.z, s * v.y + c * v.z);
}

fn rotateY(v : vec3<f32>, a : f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

fn hash31(p : vec3<f32>) -> f32 {
  var p3 = fract(p * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

/** 3D value noise — body-sphere / limb domain. */
fn noise3(p : vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = hash31(i);
  let n100 = hash31(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash31(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash31(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash31(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash31(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash31(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash31(i + vec3<f32>(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, u.x);
  let nx10 = mix(n010, n110, u.x);
  let nx01 = mix(n001, n101, u.x);
  let nx11 = mix(n011, n111, u.x);
  let nxy0 = mix(nx00, nx10, u.y);
  let nxy1 = mix(nx01, nx11, u.y);
  return mix(nxy0, nxy1, u.z);
}

/** 2-octave 3D fbm — used sparingly (photosphere prefers single noise now). */
fn fbm3d(p : vec3<f32>) -> f32 {
  var x = p;
  var v = 0.5 * noise3(x);
  x = x * 2.11 + vec3<f32>(11.5, 3.7, 7.1);
  v = v + 0.25 * noise3(x);
  return v * 1.333;
}

fn shellFade(rr : f32, fadeStart : f32, fadeEnd : f32, margin : f32) -> f32 {
  let end = min(fadeEnd, margin * 0.92);
  let start = min(fadeStart, end - 0.05);
  return 1.0 - smoothstep(start, end, rr);
}

// Solar blackbody-ish tint vs disc radius.
// Core = saturated white; limb/rays ramp white -> yellow -> gold -> red-orange.
// warm (discWarm) scales how hard the warm ramp hits (0 = no yellow/red).
// Cool/hot-blue spectral color comes from spectralTint(…, glow) when warm is low.
fn solarTempRgb(rr : f32, warm : f32) -> vec3<f32> {
  let w = clamp(warm, 0.0, 1.5);
  let tLimb = smoothstep(0.4, 1.02, rr);
  let tRay = smoothstep(0.98, 1.85, rr);
  let t = (tLimb * 0.55 + tRay * 0.95) * w;

  let white = vec3<f32>(1.0, 1.0, 1.0);
  let cream = vec3<f32>(1.0, 0.97, 0.88);
  let yellow = vec3<f32>(1.0, 0.88, 0.38);
  let gold = vec3<f32>(1.0, 0.62, 0.14);
  let red = vec3<f32>(1.0, 0.32, 0.06);

  var c = mix(white, cream, smoothstep(0.0, 0.22, t));
  c = mix(c, yellow, smoothstep(0.15, 0.55, t));
  c = mix(c, gold, smoothstep(0.45, 0.95, t));
  c = mix(c, red, smoothstep(0.75, 1.4, t));
  let coreKeep = 1.0 - smoothstep(0.0, 0.55, rr) * 0.15 * w;
  c = mix(c, white, coreKeep * (1.0 - smoothstep(0.25, 0.7, rr)));
  return c;
}

/**
 * Apply body glow as spectral class tint.
 * discWarm ~1 (Sol/red): almost no cool path — yellow/red comes from solarTempRgb.
 * discWarm ~0 (blue O/B): multiply toward normalized glow so the disc reads blue,
 * not blown-out white (glow was only used on corona before).
 */
fn spectralTint(base : vec3<f32>, glow : vec3<f32>, warm : f32) -> vec3<f32> {
  let gMax = max(max(glow.r, glow.g), max(glow.b, 1e-3));
  let gN = glow / gMax;
  let cool = clamp(1.0 - warm, 0.0, 1.0);
  // Boost blue channel slightly so O/B types read clearly on an HDR disc
  let coolTint = gN * vec3<f32>(0.72, 0.88, 1.2);
  // Mild Sol-gold nudge when warm (keeps corona-linked tint on limb)
  let warmTint = mix(vec3<f32>(1.0), gN, 0.1 * clamp(warm, 0.0, 1.0));
  let tint = mix(warmTint, coolTint, cool * cool);
  // Core stays a bit brighter white; limb takes more spectral color
  return base * tint;
}

/**
 * Photosphere granulation on body-sphere normal (camera-stable).
 * Budget: 2× noise3 (was multi-fbm) — cells still read at disc scale.
 */
fn photosphereRgb(
  nBody : vec3<f32>,
  rr : f32,
  time : f32,
  discGain : f32,
  discWarm : f32,
  coreLiftAmt : f32,
  granGain : f32,
) -> vec3<f32> {
  // Slow boil in body frame (sticks under orbit)
  let warp = noise3(nBody * 2.8 + vec3<f32>(time * 0.06, time * 0.04, 0.5));
  let p = nBody * 6.2 + vec3<f32>(warp * 0.7, warp * 0.5, time * 0.035);

  let cells = noise3(p);
  let mid = noise3(p * 2.15 + vec3<f32>(4.2, time * 0.05, 1.1));
  let lanes = noise3(p * 3.1 - vec3<f32>(time * 0.1, time * 0.055, 0.0));

  let cellBright = smoothstep(0.22, 0.72, cells * 0.65 + mid * 0.35);
  let laneDark = smoothstep(0.2, 0.65, lanes);
  var contrast = mix(0.82, 1.14, cellBright);
  contrast = contrast * mix(1.0, 0.78, laneDark);
  contrast = contrast + pow(max(mid, 0.0), 3.0) * 0.08;

  let gAmt = clamp(granGain, 0.0, 2.0);
  contrast = mix(1.0, contrast, clamp(gAmt, 0.0, 1.0));
  contrast = contrast * (1.0 + max(gAmt - 1.0, 0.0) * 0.15 * (cellBright - 0.5));

  let pore = smoothstep(0.8, 0.95, mid);
  contrast = mix(contrast, contrast * 0.72, pore * 0.4 * min(gAmt, 1.0));

  var col = solarTempRgb(rr, discWarm);
  col = mix(col, vec3<f32>(1.0, 0.99, 0.95), cellBright * 0.12 * min(gAmt, 1.0));
  col = mix(col, col * vec3<f32>(1.0, 0.9, 0.75), laneDark * 0.12 * min(gAmt, 1.0));
  col = col * contrast;

  let coreLift = exp(-rr * rr * 1.6) * coreLiftAmt;
  col = col * discGain + vec3<f32>(coreLift);
  return col;
}

/**
 * Body-frame limb direction for corona angular domain.
 * Sky-plane edge from disc center → inverse body orientation.
 * Disc-centered (scaled local same spoke → same dir) + orbit-locked.
 */
fn coronaLimbDirBody(local : vec2<f32>, spin : f32, obl : f32) -> vec3<f32> {
  let r = length(local);
  let invR = select(0.0, 1.0 / max(r, 1e-6), r > 1e-6);
  // Prefer unit local for numerical stability; pure sky plane
  let lx = local.x * invR;
  let ly = local.y * invR;
  // Fallback when r≈0
  let edgeWorld = normalize(
    body.camRight.xyz * select(1.0, lx, r > 1e-6)
    + body.camUp.xyz * select(0.0, ly, r > 1e-6)
  );
  var edgeBody = edgeWorld;
  edgeBody = rotateX(edgeBody, -obl);
  edgeBody = rotateY(edgeBody, -spin);
  return normalize(edgeBody);
}

/**
 * Seamless sphere streamer field on unit body-frame limb dir (soft-fade).
 * Wide body-frame cones + continuous sphere-noise base so angular energy
 * fades under orbit rather than hard-popping when the limb sweeps an axis.
 * Never uses body-longitude multi-lobe phase; no footpoint ribbons.
 */
fn angularRays3d(dir : vec3<f32>, time : f32) -> f32 {
  // Slow axis drift (alive corona) — keep modest so orbit is the main motion.
  // 5 dual-ended soft cones (was 8+) + noise base: same soft-fade streamer look,
  // fewer pow() on the large corona fill.
  let tw = time * 0.045;
  let c0 = cos(tw * 0.11);
  let s0 = sin(tw * 0.11);
  let c1 = cos(tw * 0.07 + 2.094);
  let s1 = sin(tw * 0.07 + 2.094);
  let c2 = cos(tw * 0.13 + 4.189);
  let s2 = sin(tw * 0.13 + 4.189);
  let ax0 = normalize(vec3<f32>(c0, 0.22, s0));
  let ax1 = normalize(vec3<f32>(c1, -0.18, s1));
  let ax2 = normalize(vec3<f32>(c2, 0.35, s2));
  let ax3 = normalize(vec3<f32>(s0 * 0.7, 0.55, c0 * 0.7));

  var lobes = 0.0;
  // 4 dual soft cones (was 5+) — soft-fade streamers, less pow cost on corona fill
  lobes = lobes + 0.62 * pow(max(dot(dir, ax0), 0.0), 3.5);
  lobes = lobes + 0.52 * pow(max(dot(dir, ax1), 0.0), 4.0);
  lobes = lobes + 0.48 * pow(max(dot(dir, ax2), 0.0), 3.8);
  lobes = lobes + 0.42 * pow(max(dot(dir, ax3), 0.0), 4.2);
  lobes = lobes + 0.48 * pow(max(dot(dir, -ax0), 0.0), 3.6);
  lobes = lobes + 0.4 * pow(max(dot(dir, -ax1), 0.0), 4.0);
  lobes = lobes + 0.34 * pow(max(dot(dir, -ax2), 0.0), 4.2);
  lobes = lobes * 1.18;

  // Continuous sphere noise base — energy between cones (anti hard-pop)
  let nBase = noise3(dir * 2.6 + vec3<f32>(time * 0.03, 0.4, time * 0.02));
  let nMid = noise3(dir * 5.5 + vec3<f32>(time * 0.04, -0.2, 1.1));
  let veil =
    0.28 * smoothstep(0.28, 0.72, nBase) +
    0.22 * smoothstep(0.35, 0.78, nMid);

  let elevW = 0.8 + 0.2 * (1.0 - dir.y * dir.y);
  var m = lobes * elevW * (0.55 + 0.55 * nMid);
  m = m + veil * elevW;
  m = m + lobes * pow(max(nMid, 0.0), 2.5) * 0.22;
  return clamp(m, 0.0, 2.2);
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
  let local = in.local;
  let r = length(local);
  if (r > 0.999) {
    discard;
  }

  let margin = max(body.spinMarginT.y, 1.01);
  let discR = 1.0 / margin;
  let time = body.spinMarginT.z;
  let spin = body.spinMarginT.x;
  let obl = body.spinMarginT.w;
  let glowCol = body.glowStr.xyz;
  let glowStr = body.glowStr.w * body.look2.w;

  let discGain = body.look0.x;
  let coreLiftAmt = body.look0.y;
  let discWarm = body.look0.z;
  let limbSoft = max(body.look0.w, 0.004);
  let chromGain = body.look1.x;
  let sheathGain = body.look1.y;
  let rayGain = body.look1.z;
  let veilGain = body.look1.w;
  // look2.x unused (legacy flareGain pad — host may write 0)
  let outerGain = body.look2.y;
  let outerFalloff = max(body.look2.z, 0.2);
  let fadeStart = body.look3.x;
  let fadeEnd = body.look3.y;
  let granGain = body.look3.z;

  let rr = r / discR;

  let sFade = shellFade(rr, fadeStart, fadeEnd, margin);
  if (rr > margin * 0.96 || (rr > 1.02 && sFade < 0.002)) {
    discard;
  }

  let discMask = 1.0 - smoothstep(1.0 - limbSoft, 1.0 + limbSoft * 0.3, rr);

  // --- Body-sphere reconstruct (same idea as planet-disc) ---
  // Photosphere coords: |p| = 1 at limb. Outside limb keep a small +Z so the
  // direction still lifts through the billboard into a stable world ray.
  let px = local.x / discR;
  let py = local.y / discR;
  let rho2 = px * px + py * py;
  let zSphere = sqrt(max(0.0, 1.0 - min(rho2, 1.0)));
  let nLocal = normalize(vec3<f32>(
    px,
    py,
    select(0.18, zSphere, rho2 <= 1.0),
  ));
  let camFwd = normalize(cross(body.camRight.xyz, body.camUp.xyz));
  let nWorld = normalize(
    body.camRight.xyz * nLocal.x
    + body.camUp.xyz * nLocal.y
    + camFwd * nLocal.z
  );
  // Inverse body orientation → detail locked to the sun
  var nBody = nWorld;
  nBody = rotateX(nBody, -obl);
  nBody = rotateY(nBody, -spin);
  nBody = normalize(nBody);

  // ---- Photosphere (body-frame texture + spectral class from glow) ----
  let photoRaw = photosphereRgb(
    nBody, rr, time, discGain, discWarm, coreLiftAmt, granGain,
  );
  let photo = spectralTint(photoRaw, glowCol, discWarm);
  var rgb = photo * discMask;
  let alpha = discMask;

  // Interior photosphere only — skip corona path for most of the disc (limb still soft)
  if (rr < 0.96) {
    rgb = clamp(rgb, vec3<f32>(0.0), vec3<f32>(6.0));
    return vec4<f32>(rgb, clamp(alpha, 0.0, 1.0));
  }

  // ---- Limb / corona (body-frame limb dir: disc-centered + orbit-locked) ----
  let edgeBody = coronaLimbDirBody(local, spin, obl);

  let tempNear = spectralTint(solarTempRgb(rr, discWarm), glowCol, discWarm);
  let tempFar = spectralTint(
    solarTempRgb(rr * 1.15 + 0.2, discWarm * 1.15),
    glowCol,
    discWarm,
  );
  let tempRay = mix(tempNear, tempFar, smoothstep(1.0, 1.6, rr));
  // Corona leans hard on body glow (blue rays for O/B, gold for Sol)
  let cool = clamp(1.0 - discWarm, 0.0, 1.0);
  let glowWarm = mix(tempRay, glowCol, 0.18 + 0.55 * cool);

  // Chromosphere — limb noise in body frame so detail orbits with camera
  let chromPeak = exp(-pow((rr - 1.0) / 0.03, 2.0) * 0.5);
  let spic = noise3(
    edgeBody * 16.0 + vec3<f32>((rr - 0.95) * 28.0 - time * 0.8, time * 0.05, 0.7),
  );
  let chrom = chromPeak * (1.0 + 0.45 * spic * smoothstep(0.9, 1.04, rr));
  let chromTint = mix(vec3<f32>(1.0, 0.95, 0.75), glowCol, cool * 0.7);
  rgb = rgb + tempNear * chromTint * chrom * chromGain * (0.9 + 0.25 * glowStr);

  if (sFade > 0.002) {
    let sheath = smoothstep(0.96, 1.03, rr) * exp(-max(rr - 1.0, 0.0) * 7.5);
    if (sheath > 0.002) {
      let sn = noise3(edgeBody * 7.0 + vec3<f32>(time * 0.04, rr * 10.0, 1.2));
      let sheathCol = mix(tempNear, glowWarm, 0.25 + 0.35 * cool);
      rgb = rgb + sheathCol * sheath * (0.65 + 0.55 * sn) * sheathGain * glowStr * sFade;
    }

    let rayAttach = smoothstep(0.9, 1.03, rr);
    if (rayAttach > 0.001 && rayGain > 0.001) {
      let angM = angularRays3d(edgeBody, time);
      let beyond = max(rr - 1.0, 0.0);
      let rayLen = exp(-beyond * outerFalloff * 0.7) * exp(-beyond * beyond * 0.35);
      let streamer = angM * rayAttach * rayLen * sFade;
      let fineRay = streamer * streamer;

      let rayCol = mix(tempRay, glowCol, 0.2 + 0.55 * cool);
      let rayCore = mix(
        mix(vec3<f32>(1.0, 0.98, 0.9), tempNear, 0.45),
        glowCol * 1.1,
        cool * 0.65,
      );
      rgb = rgb + rayCol * streamer * rayGain * glowStr;
      rgb = rgb + rayCore * fineRay * rayGain * 0.5 * glowStr;

      let veil = exp(-max(rr - 0.95, 0.0) * 0.65) * rayAttach * sFade;
      let veilN = noise3(edgeBody * 1.8 + vec3<f32>(time * 0.03, rr * 1.2, 0.4));
      rgb = rgb + mix(tempFar, glowCol, cool * 0.5) * veil * (0.55 + 0.45 * veilN) * veilGain * glowStr;
    }

    let outer = exp(-max(rr - 1.0, 0.0) * outerFalloff) * smoothstep(0.92, 1.2, rr) * sFade;
    if (outer > 0.002 && outerGain > 0.001) {
      // Outer halo: warm stars → red-gold; cool stars → body glow (blue)
      let outerWarm = mix(tempFar, vec3<f32>(1.0, 0.4, 0.1), 0.35);
      let outerCol = mix(outerWarm, glowCol, cool * 0.85);
      rgb = rgb + outerCol * outer * outerGain * glowStr;
    }
  }

  rgb = clamp(rgb, vec3<f32>(0.0), vec3<f32>(6.0));
  return vec4<f32>(rgb, clamp(alpha, 0.0, 1.0));
}
`;
//# sourceMappingURL=sun-impostor.wgsl.js.map