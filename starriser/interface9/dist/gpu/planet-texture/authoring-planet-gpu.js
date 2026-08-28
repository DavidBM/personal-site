/**
 * Full-res WebGPU planet authoring preview — solar-system disc impostor.
 *
 * Reuses PLANET_DISC_WGSL + PLANET_ATM_DEFAULTS. Bake maps are uploaded once as
 * equirect textures and layered at draw time (albedo, normal, liquid→spec,
 * clouds). Pose/light only rewrite uniforms — no CPU per-pixel multi-map raster.
 */
import { readGpuBuffer } from "../buffer-readback.js";
import { mat4CameraRight, mat4CameraUp, mat4LookAt, mat4Perspective, mat4ViewProj, } from "../math/mat4.js";
import { quatFromAxisAngle, quatMul, quatNormalize, quatRotateVec3, } from "../quat.js";
import { PLANET_ATM_DEFAULTS, } from "../solar-system/planet-atm-params.js";
import { PLANET_BODY_UNIFORM_SIZE, PLANET_DISC_WGSL, PLANET_FRAME_UNIFORM_SIZE, PLANET_KIND_OCEAN, } from "../solar-system/planet-disc.wgsl.js";
import { createDummyPoleTexture, createPoleSampler, uploadRgbaEquirect, } from "../solar-system/planet-textures.js";
import { buildTemperateCityNightRgba } from "./city-lights.js";
/** Zoom: 1 = default framing; higher = closer (zoom in). Range ~0.35–6. */
export const AUTHORING_ZOOM_MIN = 0.35;
export const AUTHORING_ZOOM_MAX = 6;
export function clampAuthoringZoom(z) {
    if (!Number.isFinite(z))
        return 1;
    return Math.max(AUTHORING_ZOOM_MIN, Math.min(AUTHORING_ZOOM_MAX, z));
}
export function defaultAuthoringOrientation() {
    // Match previous default yaw≈0.55, pitch≈0.18 as quat (Y then X)
    return orientationFromYawPitch(0.55, 0.18);
}
export function defaultAuthoringLightDir() {
    return lightDirFromAngles(-0.7, 0.35);
}
/** Normalize or fall back to +Z. */
export function normalizeLightDir(x, y, z) {
    const L = Math.hypot(x, y, z);
    if (!Number.isFinite(L) || L < 1e-12)
        return { x: 0, y: 0, z: 1 };
    return { x: x / L, y: y / L, z: z / L };
}
/**
 * Trackball delta: apply screen-space drag as world rotations about
 * view-up (horizontal drag) and view-right (vertical drag). No pitch clamp.
 * Composition: qOut = qDelta * qIn (apply previous, then delta).
 */
export function trackballOrient(qIn, dxPx, dyPx, sens = 0.005) {
    // View-space axes for drag (billboard looking down −Z): right=+X, up=+Y
    // Transform those axes into world by current orientation so drag stays screen-relative.
    const right = quatRotateVec3(qIn.x, qIn.y, qIn.z, qIn.w, 1, 0, 0);
    const up = quatRotateVec3(qIn.x, qIn.y, qIn.z, qIn.w, 0, 1, 0);
    const yawAng = dxPx * sens; // rotate about up
    const pitchAng = dyPx * sens; // rotate about right
    const qYaw = quatFromAxisAngle(up.x, up.y, up.z, yawAng);
    const qPitch = quatFromAxisAngle(right.x, right.y, right.z, pitchAng);
    const qDelta = quatMul(qPitch.x, qPitch.y, qPitch.z, qPitch.w, qYaw.x, qYaw.y, qYaw.z, qYaw.w);
    const qOut = quatMul(qDelta.x, qDelta.y, qDelta.z, qDelta.w, qIn.x, qIn.y, qIn.z, qIn.w);
    return quatNormalize(qOut.x, qOut.y, qOut.z, qOut.w);
}
/** Rotate a light direction by the same trackball delta (view-relative). */
export function trackballLightDir(dir, orient, dxPx, dyPx, sens = 0.005) {
    const right = quatRotateVec3(orient.x, orient.y, orient.z, orient.w, 1, 0, 0);
    const up = quatRotateVec3(orient.x, orient.y, orient.z, orient.w, 0, 1, 0);
    const qYaw = quatFromAxisAngle(up.x, up.y, up.z, dxPx * sens);
    const qPitch = quatFromAxisAngle(right.x, right.y, right.z, dyPx * sens);
    const qDelta = quatMul(qPitch.x, qPitch.y, qPitch.z, qPitch.w, qYaw.x, qYaw.y, qYaw.z, qYaw.w);
    const d = quatRotateVec3(qDelta.x, qDelta.y, qDelta.z, qDelta.w, dir.x, dir.y, dir.z);
    return normalizeLightDir(d.x, d.y, d.z);
}
/** Seed orientation from legacy yaw/pitch (Y then X). */
export function orientationFromYawPitch(yaw, pitch) {
    const qy = quatFromAxisAngle(0, 1, 0, yaw);
    const qx = quatFromAxisAngle(1, 0, 0, pitch);
    const q = quatMul(qy.x, qy.y, qy.z, qy.w, qx.x, qx.y, qx.z, qx.w);
    return quatNormalize(q.x, q.y, q.z, q.w);
}
function solidRgba(r, g, b, a) {
    return new Uint8ClampedArray([r, g, b, a]);
}
function uploadSolid(device, r, g, b, a, label) {
    return uploadRgbaEquirect(device, 1, 1, solidRgba(r, g, b, a), label);
}
/**
 * Pack bake cloud RGBA for PLANET_DISC_WGSL.
 *
 * Bake stores A = coverage, RGB = cloud color/texture. Pass through so the disc
 * can soft-over with real stamp RGB (not mono whitening). Cover is A.
 * Solar greyscale clouds also keep cover in A; the disc lifts near-grey samples
 * to white for the classic Earth look.
 */
export function packBakeCloudsForDiscShader(bakeCloudRgba) {
    const packed = new Uint8ClampedArray(bakeCloudRgba.length);
    packed.set(bakeCloudRgba);
    return packed;
}
/**
 * Night-side emissive equirect for disc shader (texNight × nightAmt).
 * - Lava rivers: liquid mask + bright R-dominant albedo → orange/red glow.
 * - Temperate: land-only megacity / settlement lights (coast + lowland bias).
 * - Other classes: black.
 * Pure — callable from smoke without WebGPU.
 */
export function buildNightEmissiveRgba(set) {
    const W = set.albedo.width;
    const H = set.albedo.height;
    // Lava keeps dedicated melt emissive (even if class were temperate)
    if (set.params.liquidKind === "lava") {
        const out = new Uint8ClampedArray(W * H * 4);
        const alb = set.albedo.rgba;
        const liq = set.liquidMask.rgba;
        for (let i = 0; i < W * H; i++) {
            const o = i * 4;
            out[o + 3] = 255;
            const L = liq[o] / 255;
            if (L < 0.35)
                continue;
            const r = alb[o];
            const g = alb[o + 1];
            const b = alb[o + 2];
            // R-dominant liquid = lava
            if (r < 80 || r < b + 15)
                continue;
            // Soft dark neon in shadow: dimmer + softer than day (not full-bright under night)
            const k = 0.08 + L * 0.06;
            out[o] = Math.min(95, Math.round(r * k + 10));
            out[o + 1] = Math.min(36, Math.round(g * k * 0.35 + 2));
            out[o + 2] = Math.min(22, Math.round(b * k * 0.18 + 1));
        }
        return out;
    }
    // Temperate city lights (Black Marble–style coastal/lowland settlements)
    const city = buildTemperateCityNightRgba(set);
    if (city)
        return city;
    // Opaque black (A=255) so sample is defined
    const out = new Uint8ClampedArray(W * H * 4);
    for (let i = 3; i < out.length; i += 4)
        out[i] = 255;
    return out;
}
/** Classify night map for upload / nightAmt gating. */
export function nightEmissiveKind(set) {
    if (set.params.liquidKind === "lava")
        return "lava";
    if (set.params.planetClass === "temperate")
        return "city";
    return "black";
}
/**
 * In-memory bake → planet disc texture pack (no network).
 * liquidMask → texSpec (ocean/wet); missing clouds → transparent;
 * night = lava emissive or temperate city lights (or black).
 */
export function uploadBakeTexturePack(device, set) {
    const W = set.albedo.width;
    const H = set.albedo.height;
    const albedo = uploadRgbaEquirect(device, W, H, set.albedo.rgba, "authoring-albedo");
    const normal = uploadRgbaEquirect(device, set.normal.width, set.normal.height, set.normal.rgba, "authoring-normal");
    // Liquid R/G used as ocean + spec in disc shader
    const spec = uploadRgbaEquirect(device, set.liquidMask.width, set.liquidMask.height, set.liquidMask.rgba, "authoring-spec-liquid");
    let cloud;
    if (set.clouds && set.clouds.rgba.length >= 4) {
        // Disc samples full RGBA: A = cover, RGB = cloud texture (passthrough pack).
        const packed = packBakeCloudsForDiscShader(set.clouds.rgba);
        cloud = uploadRgbaEquirect(device, set.clouds.width, set.clouds.height, packed, "authoring-cloud");
    }
    else {
        cloud = uploadSolid(device, 0, 0, 0, 0, "authoring-cloud-empty");
    }
    const nightKind = nightEmissiveKind(set);
    const nightRgba = buildNightEmissiveRgba(set);
    const night = nightKind === "black"
        ? uploadSolid(device, 0, 0, 0, 255, "authoring-night-black")
        : uploadRgbaEquirect(device, W, H, nightRgba, nightKind === "lava"
            ? "authoring-night-lava"
            : "authoring-night-city");
    const nightUrl = nightKind === "lava"
        ? "memory:lava-emissive"
        : nightKind === "city"
            ? "memory:city-lights"
            : "memory:black";
    const moon = uploadSolid(device, 80, 80, 80, 255, "authoring-moon-placeholder");
    const sampler = device.createSampler({
        label: "authoring-planet-equirect",
        addressModeU: "repeat",
        addressModeV: "clamp-to-edge",
        magFilter: "linear",
        minFilter: "linear",
        mipmapFilter: "nearest",
    });
    const poleSampler = createPoleSampler(device, "authoring-pole-clamp");
    const dummyPole = createDummyPoleTexture(device, "authoring-pole-dummy");
    const poleNorth = set.poleNorth && set.poleNorth.rgba.length >= 4
        ? uploadRgbaEquirect(device, set.poleNorth.width, set.poleNorth.height, set.poleNorth.rgba, "authoring-pole-n")
        : dummyPole;
    const poleSouth = set.poleSouth && set.poleSouth.rgba.length >= 4
        ? uploadRgbaEquirect(device, set.poleSouth.width, set.poleSouth.height, set.poleSouth.rgba, "authoring-pole-s")
        : dummyPole;
    const cloudPoleNorth = set.cloudsPoleNorth && set.cloudsPoleNorth.rgba.length >= 4
        ? uploadRgbaEquirect(device, set.cloudsPoleNorth.width, set.cloudsPoleNorth.height, set.cloudsPoleNorth.rgba, "authoring-cloud-pole-n")
        : dummyPole;
    const cloudPoleSouth = set.cloudsPoleSouth && set.cloudsPoleSouth.rgba.length >= 4
        ? uploadRgbaEquirect(device, set.cloudsPoleSouth.width, set.cloudsPoleSouth.height, set.cloudsPoleSouth.rgba, "authoring-cloud-pole-s")
        : dummyPole;
    return {
        albedo,
        normal,
        spec,
        night,
        cloud,
        moon,
        sampler,
        poleSampler,
        poleNorth,
        poleSouth,
        cloudPoleNorth,
        cloudPoleSouth,
        urls: {
            albedo: "memory:bake-albedo",
            normal: "memory:bake-normal",
            spec: "memory:bake-liquid",
            night: nightUrl,
            cloud: set.clouds ? "memory:bake-cloud" : "memory:empty",
            moon: "memory:placeholder",
            usedBakedAlbedo: true,
        },
    };
}
function destroyPack(pack) {
    if (!pack)
        return;
    const seen = new Set();
    for (const t of [
        pack.albedo,
        pack.normal,
        pack.spec,
        pack.night,
        pack.cloud,
        pack.moon,
        pack.poleNorth,
        pack.poleSouth,
        pack.cloudPoleNorth,
        pack.cloudPoleSouth,
    ]) {
        if (seen.has(t))
            continue;
        seen.add(t);
        try {
            t.destroy();
        }
        catch {
            /* */
        }
    }
}
export function lightDirFromAngles(yaw, pitch) {
    // Match planet-preview lightFromAngles: start +Z, pitch X then yaw Y
    let x = 0;
    let y = 0;
    let z = 1;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    let ny = y * cp - z * sp;
    let nz = y * sp + z * cp;
    y = ny;
    z = nz;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const nx = x * cy + z * sy;
    nz = -x * sy + z * cy;
    x = nx;
    z = nz;
    return normalizeLightDir(x, y, z);
}
/**
 * Decompose unit quat into yaw (Y) then pitch (X) for CPU preview fallback.
 * Roll is discarded — CPU path only has two angles; GPU uses full quat.
 */
export function yawPitchFromOrientation(q) {
    // forward = q * (0,0,1)
    const f = quatRotateVec3(q.x, q.y, q.z, q.w, 0, 0, 1);
    const yaw = Math.atan2(f.x, f.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, -f.y))); // keep finite
    return { yaw, pitch };
}
const CLEAR = { r: 0.02, g: 0.03, b: 0.06, a: 1 };
/**
 * Create WebGPU authoring disc on `canvas`. Throws if WebGPU unavailable.
 *
 * Device lifecycle is owned here (not createWebGpuBootstrap) so readback
 * staging buffers are never invalidated by an external destroy path mid-map.
 */
export async function createAuthoringPlanetGpu(canvas, opts) {
    if (!navigator.gpu) {
        throw new Error("WebGPU not available for authoring planet preview");
    }
    const adapter = await navigator.gpu.requestAdapter({
        powerPreference: "high-performance",
    });
    if (!adapter)
        throw new Error("No WebGPU adapter for authoring preview");
    const device = await adapter.requestDevice({
        label: "planet-texture-authoring-preview",
    });
    let deviceAlive = true;
    device.lost.then((info) => {
        deviceAlive = false;
        console.error(`[authoring-planet-gpu] device lost (${info.reason}): ${info.message}`);
    });
    device.addEventListener("uncapturederror", (ev) => {
        const e = ev;
        console.error("[authoring-planet-gpu] uncaptured:", e.error?.message ?? e);
    });
    const context = canvas.getContext("webgpu");
    if (!context) {
        device.destroy();
        throw new Error('canvas.getContext("webgpu") returned null');
    }
    // Swapchain: preferred format (often bgra8unorm). Forcing rgba8unorm on the
    // canvas kills SwiftShader SharedImage and destroys the device.
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    // Offscreen readback always rgba8unorm (portable + COPY_SRC friendly).
    const readFormat = "rgba8unorm";
    const atm = { ...PLANET_ATM_DEFAULTS, ...opts?.atm };
    const configureCanvas = (cssW, cssH) => {
        const dpr = typeof window !== "undefined"
            ? Math.min(window.devicePixelRatio || 1, 2)
            : 1;
        const w = Math.max(1, Math.floor(cssW * dpr));
        const h = Math.max(1, Math.floor(cssH * dpr));
        canvas.width = w;
        canvas.height = h;
        context.configure({
            device,
            format: canvasFormat,
            alphaMode: "opaque",
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        return { w, h };
    };
    const planetMod = device.createShaderModule({
        label: "authoring-planet-disc",
        code: PLANET_DISC_WGSL,
    });
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
    const mkPipe = (fmt, label) => device.createRenderPipeline({
        label,
        layout: "auto",
        vertex: { module: planetMod, entryPoint: "vs_main" },
        fragment: {
            module: planetMod,
            entryPoint: "fs_main",
            targets: [{ format: fmt, blend: blendPremul }],
        },
        primitive: { topology: "triangle-list" },
    });
    const planetPipe = mkPipe(canvasFormat, "authoring-planet-disc-pipe");
    const readPipe = mkPipe(readFormat, "authoring-planet-disc-readback-pipe");
    const frameBuf = device.createBuffer({
        label: "authoring-planet-frame",
        size: PLANET_FRAME_UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bodyBuf = device.createBuffer({
        label: "authoring-planet-body",
        size: PLANET_BODY_UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const frameU = new Float32Array(PLANET_FRAME_UNIFORM_SIZE / 4);
    const bodyCpu = new Float32Array(PLANET_BODY_UNIFORM_SIZE / 4);
    const view = new Float32Array(16);
    const proj = new Float32Array(16);
    const viewProj = new Float32Array(16);
    const camRight = new Float32Array(3);
    const camUp = new Float32Array(3);
    let pack = null;
    let bindGroup = null;
    let pose = {
        orientation: defaultAuthoringOrientation(),
        lightDir: defaultAuthoringLightDir(),
    };
    /** 1 = default distance; higher = zoom in (camera closer). */
    let zoom = 1;
    let bufW = 0;
    let bufH = 0;
    let destroyed = false;
    let dirty = true;
    /** Seconds origin for cloud drift (disc shader timePad.x). */
    const timeOriginSec = performance.now() * 0.001;
    let animRaf = 0;
    let bindGroupRead = null;
    const stopCloudAnim = () => {
        if (animRaf) {
            cancelAnimationFrame(animRaf);
            animRaf = 0;
        }
    };
    const startCloudAnim = () => {
        if (destroyed || animRaf || !pack)
            return;
        const loop = () => {
            animRaf = 0;
            if (destroyed || !pack || !deviceAlive)
                return;
            draw();
            animRaf = requestAnimationFrame(loop);
        };
        animRaf = requestAnimationFrame(loop);
    };
    const rebuildBindGroup = () => {
        if (!pack) {
            bindGroup = null;
            bindGroupRead = null;
            return;
        }
        const entries = [
            { binding: 0, resource: { buffer: frameBuf } },
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
        ];
        bindGroup = device.createBindGroup({
            label: "authoring-planet-bg",
            layout: planetPipe.getBindGroupLayout(0),
            entries,
        });
        // layout:"auto" may differ per pipeline — bind both
        bindGroupRead = device.createBindGroup({
            label: "authoring-planet-bg-read",
            layout: readPipe.getBindGroupLayout(0),
            entries,
        });
    };
    const writeUniforms = () => {
        const w = Math.max(1, bufW);
        const h = Math.max(1, bufH);
        const z = clampAuthoringZoom(zoom);
        // Zoom in = move camera closer
        const camDist = Math.max(atm.camDist, 2) / z;
        const eyeDist = Math.max(1.15, camDist);
        // Free orbit: orientation quat maps default +Z eye offset → world (full SO(3))
        const q = pose.orientation;
        const eye = quatRotateVec3(q.x, q.y, q.z, q.w, 0, 0, eyeDist);
        const up = quatRotateVec3(q.x, q.y, q.z, q.w, 0, 1, 0);
        const fov = (40 * Math.PI) / 180 / Math.sqrt(Math.max(z, 0.5));
        mat4Perspective(proj, fov, w / h, 0.05, 200);
        mat4LookAt(view, eye.x, eye.y, eye.z, 0, 0, 0, up.x, up.y, up.z);
        mat4ViewProj(viewProj, proj, view);
        mat4CameraRight(view, camRight);
        mat4CameraUp(view, camUp);
        frameU.set(viewProj, 0);
        frameU[16] = eye.x;
        frameU[17] = eye.y;
        frameU[18] = eye.z;
        frameU[19] = 1;
        // Sun far along free light direction (world) — no pitch limits
        const L = normalizeLightDir(pose.lightDir.x, pose.lightDir.y, pose.lightDir.z);
        const sunDist = 80;
        frameU[20] = L.x * sunDist;
        frameU[21] = L.y * sunDist;
        frameU[22] = L.z * sunDist;
        frameU[23] = 1;
        // Drive cloud UV drift in PLANET_DISC_WGSL (uvCloud += time * rate)
        frameU[24] = performance.now() * 0.001 - timeOriginSec;
        frameU[25] = 0;
        frameU[26] = 0;
        frameU[27] = 0;
        device.queue.writeBuffer(frameBuf, 0, frameU);
        const radius = 1;
        // Keep atmosphere shell in-frustum when zoomed out
        const drawMargin = 1.48 * atm.drawMarginMul * Math.max(1, 1 / Math.sqrt(z));
        // Full-quality shader LOD from on-screen radius
        const screenRpx = Math.min(w, h) * 0.48 * z;
        bodyCpu[0] = 0;
        bodyCpu[1] = 0;
        bodyCpu[2] = 0;
        bodyCpu[3] = radius;
        bodyCpu[4] = 0.2;
        bodyCpu[5] = 0.35;
        bodyCpu[6] = 0.55;
        bodyCpu[7] = PLANET_KIND_OCEAN;
        bodyCpu[8] = 0.2;
        bodyCpu[9] = 0.35;
        bodyCpu[10] = 0.8;
        bodyCpu[11] = 0.35;
        // UV spin/obl fixed — free rotation is camera orbit quat (no gimbal lock)
        bodyCpu[12] = 0;
        bodyCpu[13] = 0;
        bodyCpu[14] = drawMargin;
        bodyCpu[15] = Math.max(atm.edgeAaPx, 0.25) / Math.max(screenRpx, 1);
        bodyCpu[16] = camRight[0];
        bodyCpu[17] = camRight[1];
        bodyCpu[18] = camRight[2];
        bodyCpu[19] = 0;
        bodyCpu[20] = camUp[0];
        bodyCpu[21] = camUp[1];
        bodyCpu[22] = camUp[2];
        bodyCpu[23] = 0;
        bodyCpu[24] = atm.edgeInner;
        bodyCpu[25] = atm.edgeOuter;
        bodyCpu[26] = atm.atmOuter;
        bodyCpu[27] = atm.atmThick;
        bodyCpu[28] = atm.intensity;
        bodyCpu[29] = atm.extScale;
        bodyCpu[30] = atm.atmGain;
        bodyCpu[31] = atm.camDist;
        bodyCpu[32] = atm.rInner;
        bodyCpu[33] = atm.glowMul;
        bodyCpu[34] = atm.mieEmit;
        bodyCpu[35] = 0; // full product layer
        bodyCpu[36] = atm.colorR;
        bodyCpu[37] = atm.colorG;
        bodyCpu[38] = atm.colorB;
        bodyCpu[39] = atm.texIntensity;
        bodyCpu[40] = atm.ambient;
        bodyCpu[41] = atm.dayStrength;
        bodyCpu[42] = atm.specStrength;
        bodyCpu[43] = atm.specPower;
        // Bake stamps already store coverage in A — full amount, no dimming filter
        bodyCpu[44] = 1;
        // nightAmt: 1 when night map has lava / city lights (or any night content);
        // 0 would force night-side black even with a non-zero night texture.
        // Disc mixes: lit = mix(nightCol * nightAmt, dayLit, day) — lights only in shadow.
        bodyCpu[45] =
            pack && pack.urls.night && pack.urls.night.includes("lava")
                ? 1.0
                : pack && pack.urls.night && pack.urls.night.includes("city")
                    ? 1.15
                    : pack && pack.urls.night && pack.urls.night !== "memory:black"
                        ? 0.85
                        : 0;
        bodyCpu[46] = atm.normalStrength;
        bodyCpu[47] = screenRpx;
        device.queue.writeBuffer(bodyBuf, 0, bodyCpu);
    };
    const drawToView = (viewTex, pipe, bg) => {
        if (destroyed || !deviceAlive || !pack)
            return;
        writeUniforms();
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({
            colorAttachments: [
                {
                    view: viewTex,
                    clearValue: CLEAR,
                    loadOp: "clear",
                    storeOp: "store",
                },
            ],
        });
        pass.setPipeline(pipe);
        pass.setBindGroup(0, bg);
        pass.draw(6, 1, 0, 0);
        pass.end();
        device.queue.submit([enc.finish()]);
        dirty = false;
    };
    const draw = () => {
        if (destroyed || !deviceAlive || !bindGroup || !pack)
            return;
        drawToView(context.getCurrentTexture().createView(), planetPipe, bindGroup);
    };
    const api = {
        backend: "webgpu",
        ready: true,
        setMaps(set) {
            destroyPack(pack);
            pack = uploadBakeTexturePack(device, set);
            rebuildBindGroup();
            dirty = true;
            startCloudAnim();
        },
        setPose(p) {
            const o = p.orientation ?? defaultAuthoringOrientation();
            pose = {
                orientation: quatNormalize(o.x, o.y, o.z, o.w),
                lightDir: normalizeLightDir(p.lightDir?.x ?? 0, p.lightDir?.y ?? 0, p.lightDir?.z ?? 1),
            };
            dirty = true;
        },
        setZoom(z) {
            zoom = clampAuthoringZoom(z);
            dirty = true;
        },
        getZoom() {
            return zoom;
        },
        resize() {
            const wrap = canvas.parentElement;
            // Fill entire wrap at full CSS size × DPR (no artificial 720 / square cap).
            const cssW = Math.max(64, wrap?.clientWidth || canvas.clientWidth || 512);
            const cssH = Math.max(64, wrap?.clientHeight || canvas.clientHeight || 512);
            const sz = configureCanvas(cssW, cssH);
            bufW = sz.w;
            bufH = sz.h;
            dirty = true;
        },
        redraw() {
            if (pack && deviceAlive)
                draw();
        },
        async readFrameRgba() {
            if (destroyed || !deviceAlive || !bindGroupRead || !pack) {
                throw new Error(`readFrameRgba: destroyed=${destroyed} alive=${deviceAlive} pack=${!!pack}`);
            }
            // Full buffer size (cap extreme canvases only)
            const w = Math.min(Math.max(1, bufW), 512);
            const h = Math.min(Math.max(1, bufH), 512);
            writeUniforms();
            device.pushErrorScope("validation");
            const colorTex = device.createTexture({
                label: "authoring-readback-color",
                size: [w, h],
                format: readFormat,
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
            });
            const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
            const byteSize = bytesPerRow * h;
            const gpuCopy = device.createBuffer({
                label: "authoring-readback-copy",
                size: byteSize,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
            });
            try {
                const enc = device.createCommandEncoder({
                    label: "authoring-readback",
                });
                // Transparent clear so only disc fragments count as opaque in tests
                const pass = enc.beginRenderPass({
                    colorAttachments: [
                        {
                            view: colorTex.createView(),
                            clearValue: { r: 0, g: 0, b: 0, a: 0 },
                            loadOp: "clear",
                            storeOp: "store",
                        },
                    ],
                });
                pass.setPipeline(readPipe);
                pass.setBindGroup(0, bindGroupRead);
                pass.draw(6, 1, 0, 0);
                pass.end();
                enc.copyTextureToBuffer({ texture: colorTex }, { buffer: gpuCopy, bytesPerRow, rowsPerImage: h }, [w, h]);
                device.queue.submit([enc.finish()]);
                await device.queue.onSubmittedWorkDone();
                const valErr = await device.popErrorScope();
                if (valErr) {
                    throw new Error(`readFrameRgba validation: ${valErr.message}`);
                }
                if (!deviceAlive) {
                    throw new Error("readFrameRgba: device lost after submit");
                }
                const ab = await readGpuBuffer(device, gpuCopy, 0, byteSize);
                const mapped = new Uint8Array(ab);
                const rgba = new Uint8ClampedArray(w * h * 4);
                for (let y = 0; y < h; y++) {
                    const srcRow = y * bytesPerRow;
                    for (let x = 0; x < w; x++) {
                        const s = srcRow + x * 4;
                        const d = (y * w + x) * 4;
                        rgba[d] = mapped[s];
                        rgba[d + 1] = mapped[s + 1];
                        rgba[d + 2] = mapped[s + 2];
                        rgba[d + 3] = mapped[s + 3];
                    }
                }
                return { width: w, height: h, rgba };
            }
            finally {
                try {
                    gpuCopy.destroy();
                }
                catch {
                    /* */
                }
                try {
                    colorTex.destroy();
                }
                catch {
                    /* */
                }
            }
        },
        destroy() {
            destroyed = true;
            stopCloudAnim();
            destroyPack(pack);
            pack = null;
            bindGroup = null;
            bindGroupRead = null;
            try {
                frameBuf.destroy();
                bodyBuf.destroy();
            }
            catch {
                /* */
            }
            try {
                context.unconfigure();
            }
            catch {
                /* */
            }
            try {
                device.destroy();
            }
            catch {
                /* */
            }
            deviceAlive = false;
        },
        getBufferSize() {
            return { width: bufW, height: bufH };
        },
    };
    // Initial size (may be empty until maps)
    api.resize();
    return api;
}
/** True when authoring should prefer GPU disc (browser + navigator.gpu). */
export function isAuthoringPlanetGpuAvailable() {
    return typeof navigator !== "undefined" && !!navigator.gpu;
}
//# sourceMappingURL=authoring-planet-gpu.js.map