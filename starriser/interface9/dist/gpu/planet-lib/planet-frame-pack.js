/**
 * Shared planet/sun frame + body UBO packers (DOM-free, no device / rAF).
 *
 * Map later uploads origin-relative centers (f64 compose − frameOrigin).
 * Lab passes origin = (0,0,0) so viewProjRel ≡ viewProj and eyeRel ≡ orbit eye.
 *
 * Frame layout (PLANET_FRAME_UNIFORM_SIZE = 160 bytes / 40 floats):
 *   [0..15]  viewProjRel (mat4)
 *   [16..19] eyeRel.xyz, 1     (WGSL field: eyePos — documented eyeRel)
 *   [20..23] sunRel.xyz, 1     (WGSL field: sunPos — documented sunRel)
 *   [24..27] time, 0, 0, 0
 *   [28..31] origin.xyz, 1
 *   [32..39] pad
 *
 * Body layouts stay PLANET_BODY_UNIFORM_SIZE / SUN_BODY_UNIFORM_SIZE = 256.
 * Binding 9 reserved. Atmosphere stays disc-local (camPos = (0,0,camDist)).
 */
import { bodyKindId } from "./solar-bodies.js";
import { PLANET_FRAME_UNIFORM_SIZE } from "./planet-disc.wgsl.js";
import { sunEffectiveDrawMargin } from "./sun-look-params.js";
/** Lab / showcase camera FOV (50°). Map uses its own log-height camera. */
export const LAB_PLANET_FOVY_RAD = (50 * Math.PI) / 180;
export const LAB_ORIGIN_ZERO = Object.freeze({ x: 0, y: 0, z: 0 });
/** Float index of origin.x in the frame UBO (must match PLANET_FRAME_UNIFORM_SIZE). */
export const PLANET_FRAME_ORIGIN_FLOAT = 28;
function originOf(o) {
    return o ?? LAB_ORIGIN_ZERO;
}
/**
 * Pack shared FrameUniforms. Does not write GPU — caller uploads `out`.
 * Lab: origin = (0,0,0), sunRel = (0,0,0), eyeRel = orbit eye.
 */
export function writePlanetFrameUniforms(out, viewProjRel, eyeRel, sunRel, origin, timeSec) {
    const need = PLANET_FRAME_UNIFORM_SIZE / 4;
    if (out.length < need) {
        throw new Error(`writePlanetFrameUniforms: out.length ${out.length} < ${need} (PLANET_FRAME_UNIFORM_SIZE=${PLANET_FRAME_UNIFORM_SIZE})`);
    }
    if (viewProjRel.length < 16) {
        throw new Error("writePlanetFrameUniforms: viewProjRel needs 16 floats");
    }
    out.set(viewProjRel, 0);
    out[16] = eyeRel.eyeX;
    out[17] = eyeRel.eyeY;
    out[18] = eyeRel.eyeZ;
    out[19] = 1;
    out[20] = sunRel.x;
    out[21] = sunRel.y;
    out[22] = sunRel.z;
    out[23] = 1;
    out[24] = timeSec;
    out[25] = 0;
    out[26] = 0;
    out[27] = 0;
    out[28] = origin.x;
    out[29] = origin.y;
    out[30] = origin.z;
    out[31] = 1;
    for (let i = 32; i < need; i++)
        out[i] = 0;
    return out;
}
/**
 * ~N screen pixels expressed in disc `rr` units at this body (for limb AA).
 * limbWorld = radius → rr=1; worldPerPx from perspective at camera distance.
 * Pass origin-relative pose + eyeRel (same origin) — distance is invariant.
 */
export function edgeAaRrForBody(pose, eye, viewportH, look, fovyRad = LAB_PLANET_FOVY_RAD) {
    const dx = pose.x - eye.eyeX;
    const dy = pose.y - eye.eyeY;
    const dz = pose.z - eye.eyeZ;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const worldPerPx = (2 * dist * Math.tan(fovyRad / 2)) / Math.max(viewportH, 1);
    const limbPx = pose.def.radius / Math.max(worldPerPx, 1e-9);
    return Math.max(look.edgeAaPx, 0.25) / Math.max(limbPx, 1);
}
/** Pack one planet BodyUniforms (256 bytes). `cpu[0..2]` = centerRel. */
export function fillPlanetBody(cpu, pose, opts) {
    const a = opts.look;
    const origin = originOf(opts.origin);
    const lightMul = opts.planetLightMul ?? 1;
    const fovy = opts.fovyRad ?? LAB_PLANET_FOVY_RAD;
    const shaderLayer = opts.shaderLayer ?? 0;
    const eye = opts.eyeRel;
    cpu[0] = pose.x - origin.x;
    cpu[1] = pose.y - origin.y;
    cpu[2] = pose.z - origin.z;
    cpu[3] = pose.def.radius;
    cpu[4] = pose.def.albedo[0];
    cpu[5] = pose.def.albedo[1];
    cpu[6] = pose.def.albedo[2];
    cpu[7] = bodyKindId(pose.def.kind);
    cpu[8] = pose.def.glow[0];
    cpu[9] = pose.def.glow[1];
    cpu[10] = pose.def.glow[2];
    cpu[11] = pose.def.glowStrength * lightMul;
    cpu[12] = pose.spin;
    cpu[13] = pose.def.obliquity;
    cpu[14] = pose.def.drawMargin * a.drawMarginMul;
    cpu[15] = edgeAaRrForBody(pose, eye, opts.viewportH, a, fovy);
    cpu[16] = opts.camRight[0];
    cpu[17] = opts.camRight[1];
    cpu[18] = opts.camRight[2];
    cpu[19] = 0;
    cpu[20] = opts.camUp[0];
    cpu[21] = opts.camUp[1];
    cpu[22] = opts.camUp[2];
    cpu[23] = 0;
    // look0: edgeInner, edgeOuter, atmOuter, atmThick
    cpu[24] = a.edgeInner;
    cpu[25] = a.edgeOuter;
    cpu[26] = a.atmOuter;
    cpu[27] = a.atmThick;
    // look1: intensity, extScale, atmGain, camDist
    cpu[28] = a.intensity * lightMul;
    cpu[29] = a.extScale;
    cpu[30] = a.atmGain * Math.min(lightMul, 1.5);
    cpu[31] = a.camDist;
    // look2: rInner, glowMul, mieEmit, shaderLayer (0=full; 1..5 cumulative)
    cpu[32] = a.rInner;
    cpu[33] = a.glowMul * lightMul;
    cpu[34] = a.mieEmit;
    cpu[35] = shaderLayer;
    // look3: colorRGB, texIntensity
    cpu[36] = a.colorR;
    cpu[37] = a.colorG;
    cpu[38] = a.colorB;
    cpu[39] = a.texIntensity;
    // look4: ambient, dayStrength, specStrength, specPower
    cpu[40] = a.ambient;
    cpu[41] = a.dayStrength * lightMul;
    cpu[42] = a.specStrength * Math.min(lightMul, 1.8);
    cpu[43] = a.specPower;
    // look5: cloudAmount, nightLights, normalStrength, screenRadiusPx (shader LOD)
    cpu[44] = a.cloudAmount;
    cpu[45] = a.nightLights;
    cpu[46] = a.normalStrength;
    {
        const dx = pose.x - eye.eyeX;
        const dy = pose.y - eye.eyeY;
        const dz = pose.z - eye.eyeZ;
        const dist = Math.hypot(dx, dy, dz) || 1;
        const worldPerPx = (2 * dist * Math.tan(fovy / 2)) / Math.max(opts.viewportH, 1);
        cpu[47] = pose.def.radius / Math.max(worldPerPx, 1e-9);
    }
}
/** Pack one sun BodyUniforms (256 bytes). `cpu[0..2]` = centerRel. */
export function fillSunBody(cpu, pose, opts) {
    const L = opts.look;
    const S = opts.resolved;
    const origin = originOf(opts.origin);
    const eye = opts.eyeRel;
    cpu[0] = pose.x - origin.x;
    cpu[1] = pose.y - origin.y;
    cpu[2] = pose.z - origin.z;
    cpu[3] = S.radius;
    cpu[4] = S.glow[0];
    cpu[5] = S.glow[1];
    cpu[6] = S.glow[2];
    cpu[7] = S.glowStrength;
    cpu[8] = pose.spin * S.spinScale;
    cpu[9] = sunEffectiveDrawMargin(S.drawMargin, L);
    cpu[10] = opts.timeSec;
    cpu[11] = pose.def.obliquity;
    cpu[12] = opts.camRight[0];
    cpu[13] = opts.camRight[1];
    cpu[14] = opts.camRight[2];
    cpu[15] = 0;
    cpu[16] = opts.camUp[0];
    cpu[17] = opts.camUp[1];
    cpu[18] = opts.camUp[2];
    cpu[19] = 0;
    cpu[20] = eye.eyeX;
    cpu[21] = eye.eyeY;
    cpu[22] = eye.eyeZ;
    cpu[23] = 1;
    // look0: discGain, coreLift, discWarm, limbSoft
    cpu[24] = L.discGain;
    cpu[25] = L.coreLift;
    cpu[26] = L.discWarm;
    cpu[27] = L.limbSoft;
    // look1: chromGain, sheathGain, rayGain, veilGain
    cpu[28] = L.chromGain;
    cpu[29] = L.sheathGain;
    cpu[30] = L.rayGain;
    cpu[31] = L.veilGain;
    // look2: shaderLayer, outerGain, outerFalloff, glowMul
    cpu[32] = opts.shaderLayer ?? 0;
    cpu[33] = L.outerGain;
    cpu[34] = L.outerFalloff;
    cpu[35] = L.glowMul;
    // look3: outerFadeStart, outerFadeEnd, granGain, pad
    cpu[36] = L.outerFadeStart;
    cpu[37] = L.outerFadeEnd;
    cpu[38] = L.granGain;
    cpu[39] = 0;
}
//# sourceMappingURL=planet-frame-pack.js.map