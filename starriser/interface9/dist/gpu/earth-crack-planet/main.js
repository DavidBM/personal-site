/**
 * Single Earth planet: full Azure multi-map disc (albedo/normal/spec/night/cloud
 * + analytic atmosphere) with sphere-surface **classic ray-heightfield** on land
 * from crack-only height (~⅓ width). Clouds stay on geometric UVs (untouched).
 */
import { createWebGpuBootstrap } from "../device.js";
import { mat4Identity, mat4LookAt, mat4Multiply, mat4Perspective, } from "../math/mat4.js";
import { AZURE_ATM_PRESET } from "../solar-system/planet-atm-params.js";
import { PLANET_BODY_UNIFORM_SIZE, PLANET_FRAME_UNIFORM_SIZE, PLANET_KIND_OCEAN, } from "../solar-system/planet-disc.wgsl.js";
import { loadPlanetTexturePack } from "../solar-system/planet-textures.js";
import { EARTH_CRACK_ALBEDO_PATH, EARTH_CRACK_CAM_DIST, EARTH_CRACK_MAP_SIZE, EARTH_CRACK_METHOD_LABEL, EARTH_CRACK_WIDTH_SCALE, getEarthCrackPlanetConfig, } from "./config.js";
import { bakeCrackHeightRgba, CRACK_HEIGHT_SOURCE, } from "./crack-height.js";
import { createLayerState, LAYER_UNIFORM_FLOAT_BASE, packLayerUniforms, PARALLAX_DEPTH_MAX, PARALLAX_DEPTH_MIN, setLayerEnabled, setParallaxDepth, } from "./layer-ui.js";
import { PLANET_CRACK_DISC_WGSL } from "./planet-crack-disc.wgsl.js";
import { CRACK_CLASSIC_HEIGHT_SCALE } from "./crack-relief.js";
const PLANET_R = 0.85;
const DRAW_MARGIN = 1.48;
function $(id) {
    return document.getElementById(id);
}
function setStatus(msg, isError = false) {
    const el = $("status");
    if (!el)
        return;
    el.textContent = msg;
    el.classList.toggle("error", isError);
}
function billboardBasis(eyeX, eyeY, eyeZ, cx, cy, cz) {
    let lx = cx - eyeX;
    let ly = cy - eyeY;
    let lz = cz - eyeZ;
    const ll = Math.hypot(lx, ly, lz) || 1;
    lx /= ll;
    ly /= ll;
    lz /= ll;
    let rx = -lz;
    let ry = 0;
    let rz = lx;
    let rl = Math.hypot(rx, ry, rz);
    if (rl < 1e-5) {
        rx = 1;
        ry = 0;
        rz = 0;
        rl = 1;
    }
    rx /= rl;
    ry /= rl;
    rz /= rl;
    let ux = ry * lz - rz * ly;
    let uy = rz * lx - rx * lz;
    let uz = rx * ly - ry * lx;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    return { camRight: [rx, ry, rz], camUp: [ux, uy, uz] };
}
async function main() {
    const canvasEl = document.getElementById("canvas");
    if (!canvasEl) {
        setStatus("Missing #canvas", true);
        return;
    }
    const canvas = canvasEl;
    const cfg = getEarthCrackPlanetConfig();
    let layerState = createLayerState();
    setStatus("Loading Azure multi-maps + crack height…");
    let boot;
    try {
        boot = await createWebGpuBootstrap({
            canvas,
            label: "earth-crack-planet",
            clearColor: { r: 0.01, g: 0.012, b: 0.04, a: 1 },
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus(msg, true);
        return;
    }
    const { device, context, format, isLost, configureContext, clearColor } = boot;
    let maps;
    try {
        maps = await loadPlanetTexturePack(device);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus(`Texture pack failed: ${msg}`, true);
        return;
    }
    // Crack-only height atlas (~⅓ planar width) — not full sampleHeightUV
    const heightRgba = bakeCrackHeightRgba(EARTH_CRACK_MAP_SIZE, EARTH_CRACK_MAP_SIZE, EARTH_CRACK_WIDTH_SCALE);
    const heightTex = device.createTexture({
        label: "crack-only-height",
        size: [EARTH_CRACK_MAP_SIZE, EARTH_CRACK_MAP_SIZE],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.writeTexture({ texture: heightTex }, heightRgba, { bytesPerRow: EARTH_CRACK_MAP_SIZE * 4, rowsPerImage: EARTH_CRACK_MAP_SIZE }, [EARTH_CRACK_MAP_SIZE, EARTH_CRACK_MAP_SIZE]);
    const look = AZURE_ATM_PRESET;
    const shaderModule = device.createShaderModule({
        label: "planet-crack-disc",
        code: PLANET_CRACK_DISC_WGSL,
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
    const pipeline = device.createRenderPipeline({
        label: "earth-crack-planet-pipe",
        layout: "auto",
        vertex: { module: shaderModule, entryPoint: "vs_main" },
        fragment: {
            module: shaderModule,
            entryPoint: "fs_main",
            targets: [{ format, blend: blendPremul }],
        },
        primitive: { topology: "triangle-list" },
    });
    const frameBuf = device.createBuffer({
        size: PLANET_FRAME_UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: "earth-crack-frame",
    });
    const bodyBuf = device.createBuffer({
        size: PLANET_BODY_UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: "earth-crack-body",
    });
    const frameCPU = new Float32Array(PLANET_FRAME_UNIFORM_SIZE / 4);
    const bodyCPU = new Float32Array(PLANET_BODY_UNIFORM_SIZE / 4);
    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: frameBuf } },
            { binding: 1, resource: { buffer: bodyBuf } },
            { binding: 2, resource: maps.sampler },
            { binding: 3, resource: maps.albedo.createView() },
            { binding: 4, resource: maps.normal.createView() },
            { binding: 5, resource: maps.spec.createView() },
            { binding: 6, resource: maps.night.createView() },
            { binding: 7, resource: maps.cloud.createView() },
            { binding: 8, resource: maps.moon.createView() },
            { binding: 9, resource: heightTex.createView() },
            { binding: 10, resource: maps.poleSampler },
            { binding: 11, resource: maps.poleNorth.createView() },
            { binding: 12, resource: maps.poleSouth.createView() },
            { binding: 13, resource: maps.cloudPoleNorth.createView() },
            { binding: 14, resource: maps.cloudPoleSouth.createView() },
        ],
    });
    let yaw = 0.55;
    let pitch = -0.05;
    let camDist = EARTH_CRACK_CAM_DIST;
    let autoSpin = true;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let spinAngle = 0.35;
    const obliquity = 0.41;
    canvas.addEventListener("pointerdown", (e) => {
        dragging = true;
        autoSpin = false;
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
        const spinBtn = $("toggle-spin");
        if (spinBtn)
            spinBtn.textContent = "Resume spin";
    });
    canvas.addEventListener("pointermove", (e) => {
        if (!dragging)
            return;
        yaw += (e.clientX - lastX) * 0.008;
        pitch += (e.clientY - lastY) * 0.008;
        pitch = Math.max(-1.2, Math.min(1.2, pitch));
        lastX = e.clientX;
        lastY = e.clientY;
    });
    const endDrag = (e) => {
        dragging = false;
        try {
            canvas.releasePointerCapture(e.pointerId);
        }
        catch {
            /* ignore */
        }
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        camDist = Math.min(14, Math.max(1.6, camDist * Math.exp(e.deltaY * 0.0012)));
    }, { passive: false });
    const spinBtn = $("toggle-spin");
    if (spinBtn) {
        spinBtn.addEventListener("click", () => {
            autoSpin = !autoSpin;
            spinBtn.textContent = autoSpin ? "Pause spin" : "Resume spin";
        });
    }
    // --- Shader layer toggles + parallax depth slider ---
    const layerIds = [
        "land",
        "night",
        "clouds",
        "atmosphere",
        "parallax",
    ];
    function syncLayerUiFromState() {
        for (const id of layerIds) {
            const el = document.getElementById(`layer-${id}`);
            if (el)
                el.checked = layerState[id];
        }
        const depthEl = document.getElementById("parallax-depth");
        const depthVal = $("parallax-depth-val");
        if (depthEl) {
            depthEl.min = String(PARALLAX_DEPTH_MIN);
            depthEl.max = String(PARALLAX_DEPTH_MAX);
            depthEl.value = String(layerState.parallaxDepth);
        }
        if (depthVal) {
            depthVal.textContent = layerState.parallaxDepth.toFixed(3);
        }
    }
    for (const id of layerIds) {
        const el = document.getElementById(`layer-${id}`);
        if (!el)
            continue;
        el.addEventListener("change", () => {
            layerState = setLayerEnabled(layerState, id, el.checked);
        });
    }
    const depthEl = document.getElementById("parallax-depth");
    if (depthEl) {
        depthEl.addEventListener("input", () => {
            layerState = setParallaxDepth(layerState, Number(depthEl.value));
            const depthVal = $("parallax-depth-val");
            if (depthVal)
                depthVal.textContent = layerState.parallaxDepth.toFixed(3);
        });
    }
    // Default depth matches relief constant
    layerState = setParallaxDepth(layerState, CRACK_CLASSIC_HEIGHT_SCALE);
    syncLayerUiFromState();
    const albedoEl = $("hud-albedo");
    if (albedoEl)
        albedoEl.textContent = EARTH_CRACK_ALBEDO_PATH;
    const heightEl = $("hud-height");
    if (heightEl) {
        heightEl.textContent = `${CRACK_HEIGHT_SOURCE} · width×${EARTH_CRACK_WIDTH_SCALE.toFixed(2)}`;
    }
    const methodEl = $("hud-method");
    if (methodEl) {
        methodEl.textContent = `Azure disc · classic ray-heightfield · layer UI`;
    }
    const view = mat4Identity();
    const proj = mat4Identity();
    const viewProj = mat4Identity();
    const FOVY = (50 * Math.PI) / 180;
    let lastT = performance.now();
    let frames = 0;
    let fpsEma = 0;
    let timeSec = 0;
    function fillFrame(eyeX, eyeY, eyeZ, sunX, sunY, sunZ, t) {
        frameCPU.set(viewProj, 0);
        frameCPU[16] = eyeX;
        frameCPU[17] = eyeY;
        frameCPU[18] = eyeZ;
        frameCPU[19] = 1;
        frameCPU[20] = sunX;
        frameCPU[21] = sunY;
        frameCPU[22] = sunZ;
        frameCPU[23] = 1;
        frameCPU[24] = t;
        frameCPU[25] = 0;
        frameCPU[26] = 0;
        frameCPU[27] = 0;
    }
    function fillBody(eyeX, eyeY, eyeZ, viewportH, basis, spin) {
        const a = look;
        const cx = 0;
        const cy = 0;
        const cz = 0;
        bodyCPU[0] = cx;
        bodyCPU[1] = cy;
        bodyCPU[2] = cz;
        bodyCPU[3] = PLANET_R;
        bodyCPU[4] = 0.18;
        bodyCPU[5] = 0.42;
        bodyCPU[6] = 0.72;
        bodyCPU[7] = PLANET_KIND_OCEAN;
        bodyCPU[8] = 0.4;
        bodyCPU[9] = 0.7;
        bodyCPU[10] = 1.0;
        bodyCPU[11] = 1.35;
        bodyCPU[12] = spin;
        bodyCPU[13] = obliquity;
        bodyCPU[14] = DRAW_MARGIN * a.drawMarginMul;
        {
            const dist = Math.hypot(eyeX - cx, eyeY - cy, eyeZ - cz) || 1;
            const worldPerPx = (2 * dist * Math.tan(FOVY / 2)) / Math.max(viewportH, 1);
            const limbPx = PLANET_R / Math.max(worldPerPx, 1e-9);
            bodyCPU[15] = Math.max(a.edgeAaPx, 0.25) / Math.max(limbPx, 1);
        }
        bodyCPU[16] = basis.camRight[0];
        bodyCPU[17] = basis.camRight[1];
        bodyCPU[18] = basis.camRight[2];
        bodyCPU[19] = 0;
        bodyCPU[20] = basis.camUp[0];
        bodyCPU[21] = basis.camUp[1];
        bodyCPU[22] = basis.camUp[2];
        bodyCPU[23] = 0;
        // Exact Azure limb/atm packing (same as solar-system showcase).
        bodyCPU[24] = a.edgeInner;
        bodyCPU[25] = a.edgeOuter;
        bodyCPU[26] = a.atmOuter;
        bodyCPU[27] = a.atmThick;
        bodyCPU[28] = a.intensity;
        bodyCPU[29] = a.extScale;
        bodyCPU[30] = a.atmGain;
        bodyCPU[31] = a.camDist;
        bodyCPU[32] = a.rInner;
        bodyCPU[33] = a.glowMul;
        bodyCPU[34] = a.mieEmit;
        bodyCPU[35] = 0; // full product path
        bodyCPU[36] = a.colorR;
        bodyCPU[37] = a.colorG;
        bodyCPU[38] = a.colorB;
        bodyCPU[39] = a.texIntensity;
        // Slight limb lift so day N·L dark edge does not read as a gap under blue
        bodyCPU[40] = Math.max(a.ambient, 0.14);
        bodyCPU[41] = a.dayStrength;
        bodyCPU[42] = a.specStrength;
        bodyCPU[43] = a.specPower;
        bodyCPU[44] = a.cloudAmount;
        bodyCPU[45] = a.nightLights;
        bodyCPU[46] = a.normalStrength;
        {
            const dist = Math.hypot(eyeX - cx, eyeY - cy, eyeZ - cz) || 1;
            const worldPerPx = (2 * dist * Math.tan(FOVY / 2)) / Math.max(viewportH, 1);
            bodyCPU[47] = PLANET_R / Math.max(worldPerPx, 1e-9);
        }
        // CRACK_LAYER_UI @48 — land, night, atm, parallax, clouds, depth
        const packed = packLayerUniforms(layerState);
        const b = LAYER_UNIFORM_FLOAT_BASE;
        bodyCPU[b] = packed.layers0[0];
        bodyCPU[b + 1] = packed.layers0[1];
        bodyCPU[b + 2] = packed.layers0[2];
        bodyCPU[b + 3] = packed.layers0[3];
        bodyCPU[b + 4] = packed.layers1[0];
        bodyCPU[b + 5] = packed.layers1[1];
        bodyCPU[b + 6] = packed.layers1[2];
        bodyCPU[b + 7] = packed.layers1[3];
    }
    function frame(now) {
        if (isLost)
            return;
        const dt = Math.min(0.05, (now - lastT) / 1000);
        lastT = now;
        frames++;
        timeSec += dt;
        const instFps = dt > 0 ? 1 / dt : 0;
        fpsEma = fpsEma > 0 ? fpsEma * 0.9 + instFps * 0.1 : instFps;
        if (autoSpin) {
            yaw += dt * 0.12;
            spinAngle += dt * 0.55;
        }
        const cssW = canvas.clientWidth || 1;
        const cssH = canvas.clientHeight || 1;
        configureContext(cssW, cssH);
        const pw = canvas.width;
        const ph = canvas.height;
        // Orbit camera around origin
        const cp = Math.cos(pitch);
        const eyeX = camDist * Math.sin(yaw) * cp;
        const eyeY = camDist * Math.sin(pitch);
        const eyeZ = camDist * Math.cos(yaw) * cp;
        mat4LookAt(view, eyeX, eyeY, eyeZ, 0, 0, 0, 0, 1, 0);
        mat4Perspective(proj, FOVY, pw / Math.max(1, ph), 0.05, 100);
        mat4Multiply(viewProj, proj, view);
        // Sun off to the side for day/night + atm scatter
        const sunX = 8;
        const sunY = 3;
        const sunZ = 4;
        const basis = billboardBasis(eyeX, eyeY, eyeZ, 0, 0, 0);
        fillFrame(eyeX, eyeY, eyeZ, sunX, sunY, sunZ, timeSec);
        fillBody(eyeX, eyeY, eyeZ, ph, basis, spinAngle);
        device.queue.writeBuffer(frameBuf, 0, frameCPU);
        device.queue.writeBuffer(bodyBuf, 0, bodyCPU);
        const encoder = device.createCommandEncoder({ label: "earth-crack-frame" });
        const pass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: context.getCurrentTexture().createView(),
                    clearValue: clearColor,
                    loadOp: "clear",
                    storeOp: "store",
                },
            ],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.setViewport(0, 0, pw, ph, 0, 1);
        pass.draw(6);
        pass.end();
        device.queue.submit([encoder.finish()]);
        if (frames % 30 === 0) {
            const fpsEl = $("hud-fps");
            if (fpsEl)
                fpsEl.textContent = `${fpsEma.toFixed(0)} fps`;
        }
        requestAnimationFrame(frame);
    }
    window.__earthCrackPlanet = {
        ok: true,
        config: cfg,
        albedoPath: EARTH_CRACK_ALBEDO_PATH,
        heightSource: CRACK_HEIGHT_SOURCE,
        widthScale: EARTH_CRACK_WIDTH_SCALE,
        methodLabel: EARTH_CRACK_METHOD_LABEL,
        landMethod: "classic-parallax",
        shader: "planet-crack-disc",
        cloudsFollowCrack: false,
        urls: maps.urls,
        getLayerState: () => ({ ...layerState }),
        setLayer: (id, on) => {
            layerState = setLayerEnabled(layerState, id, on);
            syncLayerUiFromState();
        },
        setParallaxDepth: (d) => {
            layerState = setParallaxDepth(layerState, d);
            syncLayerUiFromState();
        },
    };
    requestAnimationFrame(frame);
    setStatus(`Ready · Azure multi-map · classic-parallax land · ${CRACK_HEIGHT_SOURCE} ×${EARTH_CRACK_WIDTH_SCALE.toFixed(2)} · clouds geometric`);
}
void main();
//# sourceMappingURL=main.js.map