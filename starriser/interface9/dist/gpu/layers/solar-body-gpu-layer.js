/**
 * Band B compact Kepler discs + sun (color-only) and Band C depth encode.
 *
 * Origin-relative VS via planet-lib. Per-body 256-byte look UBO.
 * Skip planet screenR < 1.5 unless focused. Always draw the sun (replaces 5px).
 * At most 1 sun + 8 discs. Band C: ray-sphere + frag_depth + Dual() poles
 * via encodeDepth (pass 2). Color-only fs_main stays on encode() (passColor).
 *
 * FOCUS (encodeDepth only): one Hillaire/Bruneton LUT stack when ready;
 * RecurseDraw O’Neil (`fs_band_c`) while late. Neighbours stay catalog-atm
 * O’Neil on `fs_main`. No second 4K. Bake via {@link pumpLutBake} after submit.
 */
import { MAP_MSAA_SAMPLES } from "../map-msaa.js";
import { PLANET_BODY_UNIFORM_SIZE, PLANET_DISC_WGSL, PLANET_FRAME_UNIFORM_SIZE, } from "../planet-lib/planet-disc.wgsl.js";
import { SUN_BODY_UNIFORM_SIZE, SUN_FRAME_UNIFORM_SIZE, SUN_IMPOSTOR_WGSL, } from "../planet-lib/sun-impostor.wgsl.js";
import { fillPlanetBody, fillSunBody, writePlanetFrameUniforms, } from "../planet-lib/planet-frame-pack.js";
import { catalogAtmForBodyId } from "../planet-lib/catalog-atm.js";
import { DEFAULT_SUN_TYPE_ID, resolveSunType, } from "../planet-lib/sun-types.js";
import { spinAngle } from "../planet-lib/solar-bodies.js";
import { COMPACT_SUN_VISUAL_RADIUS, MAX_COMPACT_PLANETS, } from "../compact-kepler.js";
import { BODY_SCREEN_R_MIN, KEPLER_SCALE, bodyScreenRadiusPx, cameraToPlaneDistance, shouldEncodeBandBBody, } from "../solar-system-lod.js";
import { discWorldRelativeF32, keplerPhaseLocalF32, } from "../math/world-origin.js";
import { createHillaireLutStack, DEFAULT_FOCUS_ATM_MODE, } from "../planet-lib/hillaire-lut.js";
/** Re-export draw skip so tests / layer share one constant. */
export { BODY_SCREEN_R_MIN };
/** Band C impostor quad expand (Tutorial 13 off-axis). Draw assist only. */
export const BAND_C_QUAD_MARGIN = 1.5;
function phaseAt(phase0, period, timeSec) {
    const p = Math.max(1e-6, period);
    return phase0 + (timeSec / p) * Math.PI * 2;
}
export class SolarBodyGpuLayer {
    constructor(bootstrap) {
        this.name = "solar-bodies";
        this.planetPipe = null;
        this.planetDepthPipe = null;
        this.planetLutPipe = null;
        this.lut = null;
        this.lastFocusAtmMode = DEFAULT_FOCUS_ATM_MODE;
        this.sunPipe = null;
        this.frameBuf = null;
        this.sunBodyBuf = null;
        this.planetBodyBufs = [];
        this.frameCpu = new Float32Array(PLANET_FRAME_UNIFORM_SIZE / 4);
        this.sunBodyCpu = new Float32Array(SUN_BODY_UNIFORM_SIZE / 4);
        this.planetBodyCpu = new Float32Array(PLANET_BODY_UNIFORM_SIZE / 4);
        this.lastDrawCount = 0;
        this.lastBandCDrawCount = 0;
        this.lastPlanetBinds = 0;
        this.lastSunCenterRel = { x: 0, y: 0, z: 0 };
        this.prepared = [];
        this.preparedDepth = [];
        this.bootstrap = bootstrap;
    }
    getLastDrawCount() {
        return this.lastDrawCount;
    }
    getLastPlanetBinds() {
        return this.lastPlanetBinds;
    }
    getLastBandCDrawCount() {
        return this.lastBandCDrawCount;
    }
    /**
     * Last Band-C FOCUS atmosphere path. `"oneil"` = RecurseDraw / no focus
     * (oneil-fallback). `"hillaire"` = LUT sampled this prepare.
     */
    getLastFocusAtmMode() {
        return this.lastFocusAtmMode;
    }
    /**
     * After submit / on promote. One in-flight. Never from encode / encodeDepth.
     */
    pumpLutBake() {
        this.lut?.pumpLutBake();
    }
    /** Last host-composed sun centerRel uploaded this prepare (look-at goldens). */
    getLastSunCenterRel() {
        return {
            x: this.lastSunCenterRel.x,
            y: this.lastSunCenterRel.y,
            z: this.lastSunCenterRel.z,
        };
    }
    init(options) {
        const { device, format } = this.bootstrap;
        const sampleCount = options?.sampleCount ?? MAP_MSAA_SAMPLES;
        const blendPremul = {
            color: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
            },
            alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
            },
        };
        const planetMod = device.createShaderModule({
            label: "map-planet-disc",
            code: PLANET_DISC_WGSL,
        });
        const sunMod = device.createShaderModule({
            label: "map-sun-impostor",
            code: SUN_IMPOSTOR_WGSL,
        });
        this.planetPipe = device.createRenderPipeline({
            label: "map-planet-disc-pipe",
            layout: "auto",
            vertex: { module: planetMod, entryPoint: "vs_main" },
            fragment: {
                module: planetMod,
                entryPoint: "fs_main",
                targets: [{ format, blend: blendPremul }],
            },
            primitive: { topology: "triangle-list" },
            multisample: { count: sampleCount },
        });
        this.planetDepthPipe = device.createRenderPipeline({
            label: "map-planet-disc-band-c-pipe",
            layout: "auto",
            vertex: { module: planetMod, entryPoint: "vs_main" },
            fragment: {
                module: planetMod,
                entryPoint: "fs_band_c",
                targets: [{ format, blend: blendPremul }],
            },
            primitive: { topology: "triangle-list" },
            depthStencil: {
                format: "depth24plus",
                depthWriteEnabled: true,
                depthCompare: "less",
            },
            multisample: { count: sampleCount },
        });
        // FOCUS LUT pipe — same depth state; group 1 is LUT tables.
        this.planetLutPipe = device.createRenderPipeline({
            label: "map-planet-disc-band-c-lut-pipe",
            layout: "auto",
            vertex: { module: planetMod, entryPoint: "vs_main" },
            fragment: {
                module: planetMod,
                entryPoint: "fs_band_c_lut",
                targets: [{ format, blend: blendPremul }],
            },
            primitive: { topology: "triangle-list" },
            depthStencil: {
                format: "depth24plus",
                depthWriteEnabled: true,
                depthCompare: "less",
            },
            multisample: { count: sampleCount },
        });
        this.lut = createHillaireLutStack(device);
        this.sunPipe = device.createRenderPipeline({
            label: "map-sun-impostor-pipe",
            layout: "auto",
            vertex: { module: sunMod, entryPoint: "vs_main" },
            fragment: {
                module: sunMod,
                entryPoint: "fs_main",
                targets: [{ format, blend: blendPremul }],
            },
            primitive: { topology: "triangle-list" },
            multisample: { count: sampleCount },
        });
        this.frameBuf = device.createBuffer({
            label: "map-solar-body-frame",
            // 256-byte min uniform bind (alignment); pack still writes 160.
            size: Math.max(256, PLANET_FRAME_UNIFORM_SIZE, SUN_FRAME_UNIFORM_SIZE),
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.sunBodyBuf = device.createBuffer({
            label: "map-solar-sun-body",
            size: SUN_BODY_UNIFORM_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.planetBodyBufs = [];
        for (let i = 0; i < MAX_COMPACT_PLANETS; i++) {
            this.planetBodyBufs.push(device.createBuffer({
                label: `map-solar-planet-body-${i}`,
                size: PLANET_BODY_UNIFORM_SIZE,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            }));
        }
    }
    /**
     * Upload frame/body UBOs **before** beginRenderPass (queue writes are illegal
     * mid-pass on some devices and can destroy the instance).
     */
    prepare(opts) {
        this.prepared = [];
        this.preparedDepth = [];
        this.lastDrawCount = 0;
        this.lastBandCDrawCount = 0;
        this.lastPlanetBinds = 0;
        this.lastFocusAtmMode = DEFAULT_FOCUS_ATM_MODE;
        if (!this.planetPipe || !this.sunPipe || !this.frameBuf || !this.sunBodyBuf) {
            return;
        }
        const store = opts.store;
        const n = store.currentCount;
        if (n <= 0 || store.systemId == null)
            return;
        const origin = opts.frameOrigin;
        const eyeRel = {
            eyeX: opts.eyeX - origin.x,
            eyeY: opts.eyeY - origin.y,
            eyeZ: opts.eyeZ - origin.z,
        };
        const sunRel = discWorldRelativeF32(store.systemX, store.systemZ, 0, 0, origin.x, origin.y, origin.z);
        this.lastSunCenterRel = sunRel;
        writePlanetFrameUniforms(this.frameCpu, opts.viewProjRel, eyeRel, sunRel, origin, opts.timeSec);
        this.bootstrap.device.queue.writeBuffer(this.frameBuf, 0, this.frameCpu);
        const fovyRad = (opts.fovyDeg * Math.PI) / 180;
        const focused = opts.focusedBodyIndex == null ? -1 : opts.focusedBodyIndex | 0;
        const bandC = opts.bandC === true && focused >= 0;
        const cmds = [];
        const poses = [];
        for (let i = 0; i < n; i++) {
            if (store.lodHidden[i])
                continue;
            const def = store.defs[i];
            if (!def)
                continue;
            const ph = phaseAt(store.phase0[i], store.orbitPeriod[i], opts.timeSec);
            const local = store.isSun[i]
                ? { x: 0, y: 0, z: 0 }
                : keplerPhaseLocalF32(KEPLER_SCALE, store.orbitRadius[i], ph);
            const rel = discWorldRelativeF32(store.systemX, store.systemZ, local.x, local.z, origin.x, origin.y, origin.z);
            const pose = {
                def,
                x: rel.x,
                y: rel.y,
                z: rel.z,
                spin: spinAngle(store.spinRadPerSec[i], opts.timeSec),
            };
            poses[i] = pose;
            const dx = rel.x - eyeRel.eyeX;
            const dy = rel.y - eyeRel.eyeY;
            const dz = rel.z - eyeRel.eyeZ;
            // ScreenR uses world camera→plane, not hypot(centerRel, eyeRel). A y=0
            // compose + camera-origin dive collapses that hypot to 0 (`|| 1`) and
            // every compact planet passes the 1.5 px gate at a ~34 px span.
            const dist = cameraToPlaneDistance(opts.eyeX, opts.eyeY, opts.eyeZ, store.systemX + local.x, store.systemZ + local.z);
            const screenR = bodyScreenRadiusPx(store.radius[i], dist, opts.viewportH, opts.fovyDeg);
            const isSun = store.isSun[i] === 1;
            if (!shouldEncodeBandBBody(isSun, screenR, i === focused))
                continue;
            cmds.push({ index: i, dist2: dx * dx + dy * dy + dz * dz });
        }
        cmds.sort((a, b) => b.dist2 - a.dist2);
        const sunResolved = resolveSunType(DEFAULT_SUN_TYPE_ID);
        sunResolved.radius = COMPACT_SUN_VISUAL_RADIUS;
        const sunDef = store.defs[0];
        if (sunDef && sunDef.kind === "sun") {
            sunResolved.drawMargin = sunDef.drawMargin;
        }
        let planetSlot = 0;
        for (let c = 0; c < cmds.length; c++) {
            const i = cmds[c].index;
            const pose = poses[i];
            if (store.isSun[i]) {
                fillSunBody(this.sunBodyCpu, pose, {
                    timeSec: opts.timeSec,
                    look: sunResolved.look,
                    resolved: sunResolved,
                    camRight: opts.cameraRight,
                    camUp: opts.cameraUp,
                    eyeRel,
                    origin: { x: 0, y: 0, z: 0 },
                });
                this.bootstrap.device.queue.writeBuffer(this.sunBodyBuf, 0, this.sunBodyCpu);
                const bg = this.bootstrap.device.createBindGroup({
                    label: "map-sun-bg",
                    layout: this.sunPipe.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: this.frameBuf } },
                        { binding: 1, resource: { buffer: this.sunBodyBuf } },
                    ],
                });
                this.prepared.push({ kind: "sun", bindGroup: bg });
                continue;
            }
            if (planetSlot >= MAX_COMPACT_PLANETS)
                continue;
            const bodyBuf = this.planetBodyBufs[planetSlot];
            const catalogId = store.catalogIds[i] ?? pose.def.id;
            const look = catalogAtmForBodyId(catalogId);
            if (bandC && i === focused) {
                this.lut?.requestBake(catalogId, look);
            }
            const fillPose = bandC && i === focused
                ? {
                    ...pose,
                    def: {
                        ...pose.def,
                        drawMargin: pose.def.drawMargin * BAND_C_QUAD_MARGIN,
                    },
                }
                : pose;
            fillPlanetBody(this.planetBodyCpu, fillPose, {
                eyeRel,
                viewportH: opts.viewportH,
                look,
                camRight: opts.cameraRight,
                camUp: opts.cameraUp,
                origin: { x: 0, y: 0, z: 0 },
                planetLightMul: sunResolved.planetLightMul,
                fovyRad,
            });
            this.bootstrap.device.queue.writeBuffer(bodyBuf, 0, this.planetBodyCpu);
            const pack = opts.residency.packForDraw(store.catalogIds[i]);
            const useDepth = bandC && i === focused && this.planetDepthPipe;
            const lutReady = useDepth &&
                !!this.planetLutPipe &&
                !!this.lut &&
                this.lut.isReadyFor(catalogId, look);
            const pipeForBg = lutReady
                ? this.planetLutPipe
                : useDepth
                    ? this.planetDepthPipe
                    : this.planetPipe;
            const bg = this.bootstrap.device.createBindGroup({
                label: `map-planet-bg-${planetSlot}`,
                layout: pipeForBg.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.frameBuf } },
                    { binding: 1, resource: { buffer: bodyBuf } },
                    { binding: 2, resource: pack.sampler },
                    { binding: 3, resource: pack.albedo.createView() },
                    { binding: 4, resource: pack.normal.createView() },
                    { binding: 5, resource: pack.spec.createView() },
                    { binding: 6, resource: pack.night.createView() },
                    { binding: 7, resource: pack.cloud.createView() },
                    { binding: 8, resource: pack.moon.createView() },
                    { binding: 10, resource: pack.poleSampler },
                    { binding: 11, resource: pack.poleNorth.createView() },
                    { binding: 12, resource: pack.poleSouth.createView() },
                    { binding: 13, resource: pack.cloudPoleNorth.createView() },
                    { binding: 14, resource: pack.cloudPoleSouth.createView() },
                ],
            });
            let lutBindGroup;
            if (lutReady && this.planetLutPipe && this.lut) {
                lutBindGroup =
                    this.lut.createApplyBindGroup(this.planetLutPipe.getBindGroupLayout(1)) ?? undefined;
            }
            if (bandC && i === focused) {
                this.lastFocusAtmMode = lutBindGroup ? "hillaire" : DEFAULT_FOCUS_ATM_MODE;
            }
            const cmd = { kind: "planet", bindGroup: bg, lutBindGroup };
            if (bandC && i === focused) {
                this.preparedDepth.push(cmd);
            }
            else {
                this.prepared.push(cmd);
            }
            this.lastPlanetBinds++;
            planetSlot++;
        }
    }
    /**
     * Color-only Band B encode (no frag_depth). Call from passColor after 5px points.
     * Requires {@link prepare} this frame.
     */
    encode(pass) {
        this.lastDrawCount = 0;
        if (!this.planetPipe || !this.sunPipe)
            return;
        for (let i = 0; i < this.prepared.length; i++) {
            const cmd = this.prepared[i];
            if (cmd.kind === "sun") {
                pass.setPipeline(this.sunPipe);
            }
            else {
                pass.setPipeline(this.planetPipe);
            }
            pass.setBindGroup(0, cmd.bindGroup);
            pass.draw(6);
            this.lastDrawCount++;
        }
    }
    /**
     * Band C depth encode (ray-sphere + frag_depth). Call from passResolve
     * when depth is attached (models OR Band C). Requires {@link prepare}.
     */
    encodeDepth(pass) {
        this.lastBandCDrawCount = 0;
        if (!this.planetDepthPipe)
            return;
        for (let i = 0; i < this.preparedDepth.length; i++) {
            const cmd = this.preparedDepth[i];
            const useLut = cmd.kind === "planet" &&
                !!cmd.lutBindGroup &&
                !!this.planetLutPipe;
            if (useLut) {
                pass.setPipeline(this.planetLutPipe);
                pass.setBindGroup(0, cmd.bindGroup);
                pass.setBindGroup(1, cmd.lutBindGroup);
            }
            else {
                pass.setPipeline(this.planetDepthPipe);
                pass.setBindGroup(0, cmd.bindGroup);
            }
            pass.draw(6);
            this.lastBandCDrawCount++;
        }
    }
    dispose() {
        this.frameBuf?.destroy();
        this.sunBodyBuf?.destroy();
        for (const b of this.planetBodyBufs)
            b.destroy();
        this.planetBodyBufs = [];
        this.frameBuf = null;
        this.sunBodyBuf = null;
        this.lut?.dispose();
        this.lut = null;
        this.planetPipe = null;
        this.planetDepthPipe = null;
        this.planetLutPipe = null;
        this.sunPipe = null;
        this.lastFocusAtmMode = DEFAULT_FOCUS_ATM_MODE;
    }
}
//# sourceMappingURL=solar-body-gpu-layer.js.map