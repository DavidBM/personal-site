/**
 * Azure full multi-map planet disc + sphere classic ray-heightfield on **land**.
 *
 * Migrates sphere-surface classic-parallax semantics:
 * - Camera ray vs radial crack-only height shell (walls / trench floor).
 * - **Hit** = opaque land at hit UV (texture deforms with dig).
 * - **Miss** = transparent land — dig hole.
 * - **No disc-edge land fill**: do not soft-force planet albedo near the circle
 *   edge over dig transparency (that read as a planet-image halo on the disc).
 * - Clouds geometric; Azure analytic atmosphere on land (dig interiors muted).
 */
import { PLANET_DISC_WGSL } from "../solar-system/planet-disc.wgsl.js";
import { DIG_HOLE_H_MAX, DIG_UV_H_MAX, DIG_UV_MAX_OFFSET, } from "./crack-ray-math.js";
import { CRACK_BIN_REFINE, CRACK_CLASSIC_HEIGHT_SCALE, CRACK_CLASSIC_STEPS, CRACK_DEPTH_ALBEDO_FLOOR, CRACK_DEPTH_H_MIN, CRACK_RAY_LOOP_CEIL, CRACK_RAY_STEP, isClassicRayHeightfieldLand, } from "./crack-relief.js";
export { PLANET_FRAME_UNIFORM_SIZE, PLANET_BODY_UNIFORM_SIZE, PLANET_BODY_UNIFORM_ALIGN, PLANET_KIND_OCEAN, PLANET_EDGE_INNER, PLANET_EDGE_OUTER, ATM_OUTER, } from "../solar-system/planet-disc.wgsl.js";
/** Markers for smoke — classic land walk + hit/miss transparency + unwarped clouds. */
export const PLANET_CRACK_DISC_MARKERS = [
    "texHeight",
    "CRACK_CLOUD_UNWARPED",
    "CRACK_ONLY_HEIGHT",
    "CLASSIC_RAY_HEIGHTFIELD",
    "classic-parallax",
    "ray_heightfield_classic",
    "CRACK_SURF_HIT_TRANSPARENCY",
    "surfHitLand",
    "CRACK_HIT_LAND_UV",
    "CRACK_GEOM_UV_NON_DIG",
    "digUv",
    "digHole",
    "digMask",
    "CRACK_DIG_FULL_FOOTPRINT",
    "CRACK_DIG_UV_CLAMP",
    "CRACK_MISS_TRANSPARENT",
    "CRACK_NO_LIMB_LAND_FILL",
    "CRACK_DIG_ONLY_TRANSPARENCY",
    "CRACK_AZURE_COMPOSITE",
    "CRACK_ATM_AZURE",
    "CRACK_ATM_DIG_MUTE",
    "CRACK_LAYER_SEPARATE",
    "crackDepthDark",
    "CRACK_MATTE_TRENCH",
    "crackCrustSpec",
    "CRACK_ATM_HOLE_GATE",
    "CRACK_ATM_BLUE_LAYER",
    "CRACK_CRUST_GEOMETRIC",
    "CRACK_RADIUS_UNIT",
    "deepDig",
    "isFullCrust",
    "CRACK_CLOUDS_ALWAYS",
    "cloudCoverA",
    "uvCloud",
    "uvGeom",
    "in_scatter",
    "SCATTER_ANALYTIC",
    "texCloud",
    "texAlbedo",
];
/**
 * Full Azure disc path with crack-only classic ray-heightfield + solid dig floor.
 */
export const PLANET_CRACK_DISC_WGSL = (() => {
    if (!isClassicRayHeightfieldLand()) {
        throw new Error("planet-crack-disc: classic ray-heightfield land config invalid");
    }
    let code = PLANET_DISC_WGSL;
    // UI layers + live parallax depth (host packs after look5 @ float 48)
    if (!code.includes("look5 : vec4<f32>,\n};")) {
        throw new Error("planet-crack-disc: BodyUniforms look5 tail not found");
    }
    code = code.replace(`look5 : vec4<f32>,
};`, `look5 : vec4<f32>,
  // CRACK_LAYER_UI: host earth-crack toggles (see layer-ui.ts packLayerUniforms)
  // layers0: x=landDay y=night z=atmosphere w=parallaxDig (0/1)
  layers0 : vec4<f32>,
  // layers1: x=clouds y=parallaxDepth (live heightScale) z=w pad
  layers1 : vec4<f32>,
};`);
    if (!code.includes("@group(0) @binding(8) var texMoon")) {
        throw new Error("planet-crack-disc: expected texMoon binding in PLANET_DISC_WGSL");
    }
    code = code.replace(`@group(0) @binding(8) var texMoon : texture_2d<f32>;`, `@group(0) @binding(8) var texMoon : texture_2d<f32>;
@group(0) @binding(9) var texHeight : texture_2d<f32>;
// Smoke: CRACK_CLOUD_UNWARPED CRACK_ONLY_HEIGHT CLASSIC_RAY_HEIGHTFIELD
// classic-parallax CRACK_SURF_HIT_TRANSPARENCY CRACK_DEPTH_DARKEN
// CRACK_CRUST_GEOMETRIC CRACK_RADIUS_UNIT CRACK_LAYER_UI CRACK_GEOM_LAND_UV`);
    // Inject classic ray-heightfield helpers before fragment entry.
    const classicHelpers = `
// ---------------------------------------------------------------------------
// Sphere classic ray-heightfield (sphere-surface classic-parallax semantics)
// UV space = planet-disc sphereToUv (Earth equirect + crack height atlas).
// Hit = land UV; miss = transparent (caller zeros land α). CLASSIC_RAY_HEIGHTFIELD
// ---------------------------------------------------------------------------
const CRACK_HIT_EPS: f32 = 1e-4;
const CRACK_RAY_LOOP_CEIL: i32 = ${CRACK_RAY_LOOP_CEIL};
// Default dig scale; live UI overrides via body.layers1.y (parallaxDepth)
const CRACK_HEIGHT_SCALE_DEFAULT: f32 = ${CRACK_CLASSIC_HEIGHT_SCALE};
const CRACK_RAY_STEP: f32 = ${CRACK_RAY_STEP};
const CRACK_CLASSIC_STEPS: i32 = ${CRACK_CLASSIC_STEPS};
const CRACK_BIN_REFINE: i32 = ${CRACK_BIN_REFINE};

fn crack_sample_h(uv: vec2<f32>) -> f32 {
  return textureSampleLevel(texHeight, samp, uv, 0.0).r;
}

fn crack_surface_radius(h: f32, heightScale: f32) -> f32 {
  return 1.0 - (1.0 - h) * heightScale;
}

fn crack_inside_shell_r2(r2: f32, rSurf: f32) -> bool {
  let lim = rSurf + CRACK_HIT_EPS;
  return r2 <= lim * lim;
}

fn crack_ray_unit_sphere(o: vec3<f32>, d: vec3<f32>) -> vec2<f32> {
  let b = 2.0 * dot(o, d);
  let c = dot(o, o) - 1.0;
  let disc = b * b - 4.0 * c;
  if (disc < 0.0) {
    return vec2<f32>(1e9, -1e9);
  }
  let s = sqrt_fast(disc);
  let tNear = (-b - s) * 0.5;
  let tFar = (-b + s) * 0.5;
  return vec2<f32>(min(tNear, tFar), max(tNear, tFar));
}

/**
 * Classic camera-ray vs radial heightfield (sphere-surface classic-parallax).
 * Returns (hitUv.x, hitUv.y, hitFlag).
 * hitFlag=1 → opaque land at hit UV (walls / real floor shell).
 * hitFlag=0 → miss / transparent (CRACK_MISS_TRANSPARENT).
 *
 * Do **not** invent a closest-approach equirect sample on miss — that painted
 * warped Earth into the empty dig and read as a weird “reflection”.
 */
fn ray_heightfield_classic(
  cam: vec3<f32>,
  Pgeom: vec3<f32>,
  heightScale: f32,
  steps: i32,
) -> vec3<f32> {
  let P = normalize_fast(Pgeom);
  let uvG = sphereToUv(P);
  var dir = P - cam;
  let d2 = dot(dir, dir);
  if (d2 < 1e-12) {
    return vec3<f32>(uvG.x, uvG.y, 1.0);
  }
  dir = dir * inverseSqrt(d2);

  let ts = crack_ray_unit_sphere(cam, dir);
  if (ts.x > ts.y) {
    return vec3<f32>(uvG.x, uvG.y, 0.0);
  }

  let tEnter = max(ts.x, 0.0);
  let tEnd = max(ts.y, tEnter);
  let span = max(tEnd - tEnter, 0.0);
  let byLen = i32(ceil(span / max(CRACK_RAY_STEP, 0.004)));
  let n = min(max(max(steps, 1), byLen), CRACK_RAY_LOOP_CEIL);

  {
    let pos = cam + dir * tEnter;
    let r2 = dot(pos, pos);
    let uvE = sphereToUv(normalize_fast(pos));
    let rSurf = crack_surface_radius(crack_sample_h(uvE), heightScale);
    if (crack_inside_shell_r2(r2, rSurf)) {
      return vec3<f32>(uvE.x, uvE.y, 1.0);
    }
  }

  let invN = select(0.0, 1.0 / f32(n), n > 0);
  let dt = (tEnd - tEnter) * invN;
  var tPrev = tEnter;
  for (var i = 1; i <= CRACK_RAY_LOOP_CEIL; i = i + 1) {
    if (i > n) {
      break;
    }
    let t = tEnter + dt * f32(i);
    let pos = cam + dir * t;
    let r2 = dot(pos, pos);
    let uv = sphereToUv(normalize_fast(pos));
    let rSurf = crack_surface_radius(crack_sample_h(uv), heightScale);
    if (crack_inside_shell_r2(r2, rSurf)) {
      var a = tPrev;
      var b = t;
      for (var j = 0; j < 16; j = j + 1) {
        if (j >= CRACK_BIN_REFINE) {
          break;
        }
        let m = (a + b) * 0.5;
        let mp = cam + dir * m;
        let mr2 = dot(mp, mp);
        let muv = sphereToUv(normalize_fast(mp));
        let mrs = crack_surface_radius(crack_sample_h(muv), heightScale);
        if (crack_inside_shell_r2(mr2, mrs)) {
          b = m;
        } else {
          a = m;
        }
      }
      let hitUv = sphereToUv(normalize_fast(cam + dir * b));
      return vec3<f32>(hitUv.x, hitUv.y, 1.0);
    }
    tPrev = t;
  }
  // CRACK_MISS_TRANSPARENT: empty along chord — no fake equirect floor sample
  return vec3<f32>(uvG.x, uvG.y, 0.0);
}

`;
    if (!code.includes("@fragment")) {
        throw new Error("planet-crack-disc: @fragment not found for classic inject");
    }
    code = code.replace("@fragment", classicHelpers + "@fragment");
    // Match PLANET_DISC_WGSL UV block (cloud drift rate may change with product).
    const oldUv = `  let uv = sphereToUv(nBody);
  // Slow cloud drift over land (longitude only; ~1 full turn per ~5–6 min)
  let uvCloud = vec2<f32>(fract(uv.x + frame.timePad.x * 0.003), uv.y);`;
    const hMin = CRACK_DEPTH_H_MIN.toFixed(4);
    const albedoFloor = CRACK_DEPTH_ALBEDO_FLOOR.toFixed(4);
    const digHoleH = DIG_HOLE_H_MAX.toFixed(4);
    const digUvH = DIG_UV_H_MAX.toFixed(4);
    const uvLim = DIG_UV_MAX_OFFSET.toFixed(4);
    const newUv = `  // CRACK_LAYER_UI flags (host layer-ui.ts)
  let uiLand = body.layers0.x;
  let uiNight = body.layers0.y;
  let uiAtm = body.layers0.z;
  let uiParallax = body.layers0.w;
  let uiClouds = body.layers1.x;
  let uiDepth = max(body.layers1.y, 0.0);
  // Geometric body UV (smooth sphere) — clouds always
  let uvGeom = sphereToUv(nBody);
  // CRACK_CLOUD_UNWARPED: cloud UV never uses classic hit (same drift as Azure disc)
  let uvCloud = vec2<f32>(fract(uvGeom.x + frame.timePad.x * 0.003), uvGeom.y);
  let hGeom = crack_sample_h(uvGeom);
  // CRACK_RADIUS_UNIT + CRACK_CRUST_GEOMETRIC
  let isFullCrust = select(0.0, 1.0, hGeom >= 0.985 || uiParallax < 0.5);
  let deepDig = select(1.0, 0.0, hGeom >= 0.40 || uiParallax < 0.5);
  var camBody = (frame.eyePos.xyz - body.centerRadius.xyz)
    / max(body.centerRadius.w, 1e-4);
  camBody = rotateX(camBody, -obl);
  camBody = rotateY(camBody, -spin);
  let liveHeightScale = select(0.0, uiDepth, uiParallax > 0.5);
  let rhLand = ray_heightfield_classic(
    camBody,
    nBody,
    liveHeightScale,
    CRACK_CLASSIC_STEPS,
  );
  // CRACK_NO_LIMB_LAND_FILL + CRACK_DIG_ONLY_TRANSPARENCY + CRACK_DIG_FULL_FOOTPRINT:
  // Dig hole + dig UV use the SAME height band (h < ${digHoleH}) as dig soft on
  // the land atlas so dig parallax is planet-sized, not a nested smaller sphere.
  // Pure crust h=1 → solid + geom UV (no inverted limb strip).
  let digMask = select(0.0, 1.0, hGeom < ${digHoleH});
  let digHole = digMask;
  let digUv = digMask;
  let surfHitLand = select(
    1.0,
    select(1.0, rhLand.z, digHole > 0.5),
    uiParallax > 0.5,
  );
  // CRACK_HIT_LAND_UV + CRACK_GEOM_UV_NON_DIG: hit UV on digMask; geom on crust
  let useHitUv = select(0.0, 1.0, uiParallax > 0.5 && digUv > 0.5 && rhLand.z > 0.5);
  var dUv = rhLand.xy - uvGeom;
  dUv.x = dUv.x - floor(dUv.x + 0.5);
  // CRACK_DIG_UV_CLAMP: wide anti-wrap only
  dUv = clamp(dUv, vec2<f32>(-${uvLim}), vec2<f32>(${uvLim}));
  var uv = select(uvGeom, vec2<f32>(fract(uvGeom.x + dUv.x), clamp(uvGeom.y + dUv.y, 0.0, 1.0)), useHitUv > 0.5);
  let hLand = select(1.0, crack_sample_h(uv), useHitUv > 0.5);
  let crackDepthDark = ${albedoFloor};
  let crackDepthHMin = ${hMin};
  // CRACK_MATTE_TRENCH
  let crackCrustSpec = select(
    1.0,
    smoothstep(0.92, 0.995, hLand) *
      surfHitLand *
      crackDepthDark *
      (1.0 + crackDepthHMin * 0.0) *
      (0.999 + 0.001 * deepDig),
    isFullCrust < 0.5,
  );`;
    if (!code.includes(oldUv)) {
        throw new Error("planet-crack-disc: UV setup block not found in PLANET_DISC_WGSL");
    }
    code = code.replace(oldUv, newUv);
    // UI-scale cloud/night amounts (after look5 read — ui* already defined above)
    code = code.replace(`let cloudAmt = body.look5.x;
  let nightAmt = body.look5.y;`, `let cloudAmt = body.look5.x * uiClouds;
  let nightAmt = body.look5.y * uiNight;`);
    // CRACK_LAYER_SEPARATE: hit → land+cloud; miss → cloud albedo only (α once).
    // Base disc now uses cloudS.a cover + cloudCol (not cloudMap.r white mix).
    const oldEarthSurf = `var earthSurf = mix(dayMap, cloudCol, cloudCover);`;
    const newEarthSurf = `// CRACK_LAYER_SEPARATE + CRACK_CLOUDS_ALWAYS
    var earthSurf = select(
      cloudCol,
      mix(dayMap * uiLand, cloudCol, cloudCover),
      surfHitLand > 0.5,
    );`;
    if (!code.includes(oldEarthSurf)) {
        throw new Error("planet-crack-disc: earthSurf cloud mix not found (PLANET_DISC cloud path changed?)");
    }
    code = code.replace(oldEarthSurf, newEarthSurf);
    const oldSurfM = `surfM = mix(dayMap, cloudColM, cloudCoverM);`;
    const newSurfM = `// CRACK_LAYER_SEPARATE (mid-LOD)
      surfM = select(
        cloudColM,
        mix(dayMap * uiLand, cloudColM, cloudCoverM),
        surfHitLand > 0.5,
      );`;
    if (!code.includes(oldSurfM)) {
        throw new Error("planet-crack-disc: surfM cloud mix not found (PLANET_DISC mid-LOD changed?)");
    }
    code = code.replace(oldSurfM, newSurfM);
    // Hard-kill water specular / night in trench + transparent holes (not linear residual gloss)
    code = code.replace(`specAmt = specMap * (1.0 - lavaHint);`, `specAmt = specMap * (1.0 - lavaHint) * crackCrustSpec;`);
    code = code.replace(`nightCol = nightMap + dayMap * lavaHint * 0.1;`, `nightCol = (nightMap + dayMap * lavaHint * 0.1) * surfHitLand;`);
    // Matte dig only (crackCrustSpec) — no graze RGB kill (that separated land from atm)
    code = code.replace(`let spec = pow_fast(max(dot(nShade, halfV), 0.0), specPow) * specAmt * day * specStr;
    lit = lit + vec3<f32>(1.0, 0.94, 0.82) * spec;`, `let spec = pow_fast(max(dot(nShade, halfV), 0.0), specPow) * specAmt * day * specStr * crackCrustSpec;
    lit = lit + vec3<f32>(1.0, 0.94, 0.82) * spec;`);
    // Mid-LOD ocean specular / night — zero night in transparent dig holes
    code = code.replace(`nightM = nightMap + dayMap * lavaHintM * 0.1;`, `nightM = (nightMap + dayMap * lavaHintM * 0.1) * surfHitLand;`);
    code = code.replace(`litM = litM + vec3<f32>(1.0, 0.94, 0.82) *
        pow_fast(max(dot(nShadeM, halfM), 0.0), max(body.look4.w, 1.0)) *
        0.35 * dayM * body.look4.z * (1.0 - lavaS);`, `litM = litM + vec3<f32>(1.0, 0.94, 0.82) *
        pow_fast(max(dot(nShadeM, halfM), 0.0), max(body.look4.w, 1.0)) *
        0.35 * dayM * body.look4.z * (1.0 - lavaS) * crackCrustSpec;`);
    // Full-path: Azure land+atm composite + dig-only alpha (no limb RGB hacks).
    // Limb dark is day N·L (same as Azure). Prior limbTex/limbBlue/grazeFill made
    // a black trench under the shell that never matched the Azure reference.
    const oldMask = `  let surfaceMask = 1.0 - smoothstep(edgeOuter - soft, edgeOuter, rr);
  var rgb = lit * surfaceMask;
  var alpha = surfaceMask;`;
    const newMask = `  // CRACK_AZURE_COMPOSITE + CRACK_DIG_ONLY_TRANSPARENCY
  // Same soft limb as Azure planet-disc (no artificial softLimb cap).
  let surfaceMask = 1.0 - smoothstep(edgeOuter - soft, edgeOuter, rr);
  let cloudCoverA = textureSampleLevel(texCloud, samp, uvCloud, 0.0).a * cloudAmt;
  // Dig holes transparent; non-dig full geometric land (surface digs always solid)
  let landMask = surfaceMask * max(surfHitLand, cloudCoverA);
  var rgb = lit * landMask;
  var alpha = landMask;`;
    if (!code.includes(oldMask)) {
        throw new Error("planet-crack-disc: surfaceMask block not found");
    }
    code = code.replace(oldMask, newMask);
    // Leave nrmStr as Azure (no graze mute)
    // Exact Azure scatter tint (do not rewrite energy)
    // Marker CRACK_ATM_BLUE_LAYER / CRACK_ATM_AZURE for smoke history
    code = code.replace(`atm = scatter * mix(vec3<f32>(1.0, 1.0, 1.0), glowCol, 0.35) * (0.85 + 0.55 * gStr) * atmGain;`, `// CRACK_ATM_AZURE + CRACK_ATM_BLUE_LAYER(compat): identical Azure scatter
      atm = scatter * mix(vec3<f32>(1.0, 1.0, 1.0), glowCol, 0.35) * (0.85 + 0.55 * gStr) * atmGain;`);
    // Azure full atm on land; mute only dig interiors away from limb
    code = code.replace(`rgb = rgb + atm;`, `// CRACK_ATM_AZURE + CRACK_ATM_DIG_MUTE + CRACK_ATM_HOLE_GATE
  let coverAtm = max(surfHitLand, cloudCoverA);
  let awayFromLimb = 1.0 - smoothstep(edgeOuter - 0.12, edgeOuter - 0.02, rr);
  let digMute = (1.0 - coverAtm) * awayFromLimb;
  let atmHoleGate = (1.0 - digMute) * uiAtm;
  let atmOut = atm * atmHoleGate;
  rgb = rgb + atmOut;`);
    // Mid-LOD: dig alpha + Azure atm (no limb RGB hacks)
    code = code.replace(`return vec4<f32>(
      litM * surfaceMask0 + atmM,
      clamp(surfaceMask0, 0.0, 1.0),
    );`, `let cloudCoverMGate = textureSampleLevel(texCloud, samp, uvCloud, 0.0).a * cloudAmt;
    let coverM = max(surfHitLand, cloudCoverMGate);
    let landMaskM = surfaceMask0 * coverM;
    let awayFromLimbM = 1.0 - smoothstep(edgeOuter - 0.12, edgeOuter - 0.02, rr);
    let digMuteM = (1.0 - coverM) * awayFromLimbM;
    let atmHoleGateM = (1.0 - digMuteM) * uiAtm;
    let atmOutM = atmM * atmHoleGateM;
    return vec4<f32>(
      litM * landMaskM + atmOutM,
      clamp(landMaskM, 0.0, 1.0),
    );`);
    // Tiny-screen LOD: keep full geometric surface (clouds+land soft) — no dig gate
    // (LOD path has no crack composite; leave surfaceMask0 so planet does not shrink)
    // Guards
    if (!code.includes("ray_heightfield_classic")) {
        throw new Error("planet-crack-disc: classic ray_heightfield missing");
    }
    if (!code.includes("CLASSIC_RAY_HEIGHTFIELD")) {
        throw new Error("planet-crack-disc: CLASSIC_RAY_HEIGHTFIELD marker missing");
    }
    if (!code.includes("CRACK_SURF_HIT_TRANSPARENCY") || !code.includes("surfHitLand")) {
        throw new Error("planet-crack-disc: hit/miss transparency missing");
    }
    if (!code.includes("CRACK_CLOUD_UNWARPED")) {
        throw new Error("planet-crack-disc: CRACK_CLOUD_UNWARPED marker missing");
    }
    if (/uvCloud\s*=\s*rhLand|uvCloud\s*=\s*rh\./.test(code)) {
        throw new Error("planet-crack-disc: clouds must not use classic hit UV");
    }
    if (code.includes("nCrackTS") || code.includes("hGradScale") || code.includes("crackNBlend")) {
        throw new Error("planet-crack-disc: height-normal path must not return");
    }
    if (/\bcrackShade\b/.test(code) || /mix\s*\(\s*0\.55/.test(code)) {
        throw new Error("planet-crack-disc: mild crackShade floor must not remain");
    }
    if (!code.includes("CRACK_HIT_LAND_UV")) {
        throw new Error("planet-crack-disc: hit land UV (texture deformation) missing");
    }
    // Dig must not paint a depth-darken albedo ring (looked like land-over-land gradient)
    if (/digAlbedoMul|mix\(\s*0\.\d+\s*,\s*1\.0\s*,\s*digT/.test(code)) {
        throw new Error("planet-crack-disc: dig albedo darken ring must not remain");
    }
    if (!code.includes("CRACK_GEOM_UV_NON_DIG") ||
        !code.includes("CRACK_DIG_UV_CLAMP") ||
        !code.includes("digUv") ||
        !code.includes("digHole") ||
        !code.includes("dUv")) {
        throw new Error("planet-crack-disc: dig UV clamp + digHole/digUv split missing");
    }
    if (/select\(\s*uvGeom\s*,\s*rhLand\.xy\s*,\s*rhLand\.z\s*>\s*0\.5\s*\)/.test(code)) {
        throw new Error("planet-crack-disc: unrestricted hit UV on any ray hit must not return");
    }
    if (!/digMask\s*=\s*select\(\s*0\.0\s*,\s*1\.0\s*,\s*hGeom\s*</.test(code) ||
        !/digHole\s*=\s*digMask/.test(code)) {
        throw new Error("planet-crack-disc: digMask/digHole full dig footprint gate missing");
    }
    if (!code.includes("CRACK_MISS_TRANSPARENT")) {
        throw new Error("planet-crack-disc: miss transparency marker missing");
    }
    if (code.includes("CRACK_FLOOR_CLOSEST") && /tClose/.test(code)) {
        throw new Error("planet-crack-disc: closest-approach equirect floor must not remain");
    }
    if (!code.includes("CRACK_LAYER_SEPARATE")) {
        throw new Error("planet-crack-disc: land/cloud layer separation missing");
    }
    // Disc-edge must not soft-force planet land over dig (the halo bug)
    if (!code.includes("CRACK_NO_LIMB_LAND_FILL")) {
        throw new Error("planet-crack-disc: CRACK_NO_LIMB_LAND_FILL missing");
    }
    if (/max\(\s*rhLand\.z\s*,\s*limbProtect\s*\)|max\(\s*landSolid\s*,\s*limbProtect\s*\)/.test(code)) {
        throw new Error("planet-crack-disc: limbProtect must not fill land over dig");
    }
    if (/trueWall|floorOpen|CRACK_TRUE_WALL|CRACK_FLOOR_OPEN/.test(code)) {
        throw new Error("planet-crack-disc: dig punch-through experiments must stay removed");
    }
    if (/CRACK_GEOM_LAND_UV/.test(code) && /var uv = uvGeom\s*;/.test(code) && !/rhLand\.xy/.test(code)) {
        throw new Error("planet-crack-disc: must not force geom-only land UV");
    }
    if (!code.includes("CRACK_CLOUDS_ALWAYS") ||
        (!code.includes("cloudCoverA") && !code.includes("max(surfHitLand"))) {
        throw new Error("planet-crack-disc: clouds must always cover (not land-hit-only)");
    }
    if (!code.includes("CRACK_CLOUDS_ALWAYS")) {
        throw new Error("planet-crack-disc: CRACK_CLOUDS_ALWAYS marker missing");
    }
    if (!code.includes("crackCrustSpec") || !code.includes("CRACK_MATTE_TRENCH")) {
        throw new Error("planet-crack-disc: matte trench (no residual gloss) missing");
    }
    if (!code.includes("CRACK_ATM_HOLE_GATE") || !code.includes("atmHoleGate")) {
        throw new Error("planet-crack-disc: atm hole gate missing");
    }
    if (!code.includes("CRACK_ATM_AZURE") ||
        !code.includes("CRACK_ATM_DIG_MUTE") ||
        !code.includes("digMute")) {
        throw new Error("planet-crack-disc: Azure atm + dig mute missing");
    }
    // No limb RGB hacks (limbTex / limbBlue / grazeFill / black multiply)
    if (/limbTexOn|limbBlue|grazeW|litLift|limbBridge|rrLimb|grazeAtmFill|CRACK_LIMB_TEX|CRACK_LIMB_BLEND|CRACK_ATM_GRAZE_FILL|CRACK_ATM_RIM_ONLY|CRACK_ATM_HUG_LIMB/.test(code)) {
        throw new Error("planet-crack-disc: limb RGB/atm hack paths must stay removed (use Azure composite)");
    }
    if (!code.includes("CRACK_AZURE_COMPOSITE")) {
        throw new Error("planet-crack-disc: CRACK_AZURE_COMPOSITE missing");
    }
    if (!/var rgb\s*=\s*lit\s*\*\s*landMask\s*;/.test(code)) {
        throw new Error("planet-crack-disc: land must be lit*landMask (Azure)");
    }
    if (!code.includes("CRACK_ATM_DIG_MUTE") || !code.includes("digMute")) {
        throw new Error("planet-crack-disc: dig atm mute missing");
    }
    // Soft faceW premul land fade must not return
    if (/landMask\s*=\s*surfaceMask\s*\*[^\n]*faceW/.test(code)) {
        throw new Error("planet-crack-disc: soft faceW landMask premul must not remain");
    }
    if (!code.includes("CRACK_ATM_BLUE_LAYER")) {
        throw new Error("planet-crack-disc: CRACK_ATM_BLUE_LAYER marker missing");
    }
    // Dim pure-blue 0.45 rewrite thinned the shell — must stay gone
    if (/0\.16,\s*0\.50,\s*1\.35/.test(code) && /\*\s*0\.45/.test(code)) {
        throw new Error("planet-crack-disc: dim pure-blue atm rewrite must not return");
    }
    // Must not full-disc atm gate with max(surfHitLand, …) — that stacked glow wrong
    if (/atmHoleGate\s*=\s*max\(\s*surfHitLand/.test(code)) {
        throw new Error("planet-crack-disc: full-disc atmHoleGate must not remain");
    }
    if (!code.includes("CRACK_LAYER_UI") || !code.includes("layers0")) {
        throw new Error("planet-crack-disc: layer UI uniforms missing");
    }
    if (!code.includes("uiParallax") || !code.includes("liveHeightScale")) {
        throw new Error("planet-crack-disc: live parallax depth UI missing");
    }
    // Azure composite keeps glowCol mix 0.35
    if (!code.includes("CRACK_CRUST_GEOMETRIC")) {
        throw new Error("planet-crack-disc: crust geometric missing");
    }
    if (!code.includes("CRACK_RADIUS_UNIT") || !code.includes("deepDig")) {
        throw new Error("planet-crack-disc: unit radius + deepDig marker missing");
    }
    if (!code.includes("CRACK_DIG_ONLY_TRANSPARENCY") ||
        !code.includes("digHole")) {
        throw new Error("planet-crack-disc: dig-hole transparency missing");
    }
    if (!/surfHitLand\s*=\s*select\(\s*1\.0\s*,\s*select\(\s*1\.0\s*,\s*rhLand\.z\s*,\s*digHole\s*>\s*0\.5\s*\)\s*,\s*uiParallax\s*>\s*0\.5\s*,?\s*\)/.test(code)) {
        throw new Error("planet-crack-disc: dig miss transparent only in digHole; crust solid");
    }
    // Old strict crustSolid@0.97 left soft crust as graze-transparent — must stay gone
    if (/crustSolid|CRACK_CRUST_GRAZE_SOLID/.test(code)) {
        throw new Error("planet-crack-disc: crustSolid@0.97 path must not return");
    }
    // Must not reintroduce disc-edge limbProtect over digs
    if (/limbProtect/.test(code) && /max\(\s*rhLand\.z\s*,\s*limbProtect/.test(code)) {
        throw new Error("planet-crack-disc: limbProtect dig fill must not return");
    }
    return code;
})();
//# sourceMappingURL=planet-crack-disc.wgsl.js.map