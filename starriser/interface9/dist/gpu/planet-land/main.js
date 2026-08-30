/**
 * Real-time fractal-Voronoi planet land lab.
 * Entry: planet-land.html → dist/gpu/planet-land/main.js
 */
import { createWebGpuBootstrap } from "../device.js";
import { mat4Identity, mat4LookAt, mat4Multiply, mat4Perspective, } from "../math/mat4.js";
import { screenToNdc } from "../math/ground-pick.js";
import { pickRayFromNdc } from "../planet-lib/solar-pick.js";
import { rayVsSphere } from "../planet-lib/planet-scatter.js";
import { LAND_DISC_WGSL } from "./land-disc.wgsl.js";
import { LAND_BODY_UNIFORM_SIZE, LAND_FRAME_UNIFORM_SIZE, LAND_LAYER, LAND_OVERRIDE_UNIFORM_SIZE, LAND_PARAM_UNIFORM_SIZE, OVERRIDE_LAND, OVERRIDE_WATER, PAINT_TOOL, VIEW_MODE, classifyLand, clampLandParams, cloneLandParams, defaultLandParams, layerRoot, packLandUniforms, packOverrides, paramsForPreset, paramsFromQuery, paramsToQuery, upsertOverride, } from "./land-params.js";
const PLANET_R = 0.85;
const DRAW_MARGIN = 1.48;
const FOVY = (50 * Math.PI) / 180;
const KIND_LABEL = ["ocean", "continent", "island", "lake", "ice"];
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
function billboardBasis(eyeX, eyeY, eyeZ) {
    let lx = -eyeX;
    let ly = -eyeY;
    let lz = -eyeZ;
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
    return { camRight: [rx, ry, rz], camUp: [ux / ul, uy / ul, uz / ul] };
}
function rotateX(x, y, z, a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [x, y * c - z * s, y * s + z * c];
}
function rotateY(x, y, z, a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [x * c + z * s, y, -x * s + z * c];
}
function worldToBody(nx, ny, nz, spin, obl) {
    let t = rotateY(nx, ny, nz, spin);
    t = rotateX(t[0], t[1], t[2], obl);
    const L = Math.hypot(t[0], t[1], t[2]) || 1;
    return { x: t[0] / L, y: t[1] / L, z: t[2] / L };
}
const RANGE_KEYS = [
    "contFreq",
    "contFill",
    "contDepth",
    "islandFreq",
    "islandFill",
    "islandDepth",
    "lakeFreq",
    "lakeFill",
    "lakeDepth",
    "seed",
    "jitter",
    "warp",
    "coastWidth",
    "mountain",
    "iceLat",
    "searchR",
    "atmStrength",
];
function paintLayerForTool(tool, viewMode) {
    if (tool === PAINT_TOOL.island)
        return LAND_LAYER.island;
    if (viewMode === VIEW_MODE.islands)
        return LAND_LAYER.island;
    if (viewMode === VIEW_MODE.lakes)
        return LAND_LAYER.lake;
    return LAND_LAYER.continent;
}
async function main() {
    const canvasEl = document.getElementById("canvas");
    if (!canvasEl) {
        setStatus("Missing #canvas", true);
        return;
    }
    const canvas = canvasEl;
    let params = paramsFromQuery(typeof location !== "undefined" ? location.search : "", defaultLandParams());
    let overrides = [];
    let paintTool = PAINT_TOOL.continent;
    let hover = null;
    let hoverKind = -1;
    let hoverLayer = LAND_LAYER.continent;
    let boot;
    try {
        boot = await createWebGpuBootstrap({
            canvas,
            label: "planet-land",
            clearColor: { r: 0.01, g: 0.012, b: 0.04, a: 1 },
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus(msg, true);
        return;
    }
    const { device, context, format, isLost, configureContext, clearColor } = boot;
    device.addEventListener("uncapturederror", (ev) => {
        const err = ev.error;
        setStatus(`GPU: ${err?.message ?? "uncaptured error"}`, true);
    });
    let shaderModule;
    let pipeline;
    try {
        shaderModule = device.createShaderModule({
            label: "planet-land-disc",
            code: LAND_DISC_WGSL,
        });
        const getInfo = shaderModule.getCompilationInfo?.bind(shaderModule);
        if (getInfo) {
            const info = await getInfo();
            const errors = info.messages.filter((m) => m.type === "error");
            if (errors.length) {
                setStatus(errors.map((m) => `WGSL L${m.lineNum}: ${m.message}`).join(" · "), true);
                return;
            }
        }
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
        pipeline = device.createRenderPipeline({
            label: "planet-land-pipe",
            layout: "auto",
            vertex: { module: shaderModule, entryPoint: "vs_main" },
            fragment: {
                module: shaderModule,
                entryPoint: "fs_main",
                targets: [{ format, blend: blendPremul }],
            },
            primitive: { topology: "triangle-list" },
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus(`Pipeline: ${msg}`, true);
        return;
    }
    const frameBuf = device.createBuffer({
        size: LAND_FRAME_UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: "planet-land-frame",
    });
    const bodyBuf = device.createBuffer({
        size: LAND_BODY_UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: "planet-land-body",
    });
    const landBuf = device.createBuffer({
        size: LAND_PARAM_UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: "planet-land-params",
    });
    const ovBuf = device.createBuffer({
        size: LAND_OVERRIDE_UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: "planet-land-overrides",
    });
    const frameCPU = new Float32Array(LAND_FRAME_UNIFORM_SIZE / 4);
    const bodyCPU = new Float32Array(LAND_BODY_UNIFORM_SIZE / 4);
    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: frameBuf } },
            { binding: 1, resource: { buffer: bodyBuf } },
            { binding: 2, resource: { buffer: landBuf } },
            { binding: 3, resource: { buffer: ovBuf } },
        ],
    });
    let yaw = 0.55;
    let pitch = 0.18;
    let camDist = 3.4;
    let autoSpin = true;
    let dragging = false;
    let shifting = false;
    let lastX = 0;
    let lastY = 0;
    let downX = 0;
    let downY = 0;
    let spinAngle = 0.2;
    const obliquity = 0.28;
    let sunYaw = 0.85;
    let sunPitch = 0.32;
    const view = mat4Identity();
    const proj = mat4Identity();
    const viewProj = mat4Identity();
    const lastViewProj = new Float32Array(16);
    let urlTimer = 0;
    function pushUrl() {
        const qs = paramsToQuery(params);
        history.replaceState(null, "", `${location.pathname}?${qs}`);
    }
    function scheduleUrl() {
        window.clearTimeout(urlTimer);
        urlTimer = window.setTimeout(pushUrl, 180);
    }
    function fmt(n) {
        if (Math.abs(n - Math.round(n)) < 1e-6)
            return String(Math.round(n));
        return n.toFixed(n < 0.1 ? 3 : 2);
    }
    function syncUiFromParams() {
        for (const k of RANGE_KEYS) {
            const el = document.getElementById(k);
            const val = $(`${k}Val`);
            if (el)
                el.value = String(params[k]);
            if (val)
                val.textContent = fmt(params[k]);
        }
        const viewEl = $("viewMode");
        if (viewEl)
            viewEl.value = String(params.viewMode);
        const borderEl = $("showBorders");
        if (borderEl)
            borderEl.checked = params.showBorders;
        const spinEl = $("autoSpin");
        if (spinEl)
            spinEl.checked = autoSpin;
        const paintEl = $("hud-paint");
        if (paintEl)
            paintEl.textContent = String(overrides.length);
    }
    function readRanges() {
        const next = cloneLandParams(params);
        for (const k of RANGE_KEYS) {
            const el = document.getElementById(k);
            if (!el)
                continue;
            next[k] = Number(el.value);
        }
        params = clampLandParams(next);
        syncUiFromParams();
        scheduleUrl();
    }
    for (const k of RANGE_KEYS) {
        const el = document.getElementById(k);
        el?.addEventListener("input", readRanges);
    }
    $("viewMode")?.addEventListener("change", () => {
        const el = $("viewMode");
        params = clampLandParams({ ...params, viewMode: Number(el.value) });
        scheduleUrl();
    });
    $("showBorders")?.addEventListener("change", () => {
        const el = $("showBorders");
        params = { ...params, showBorders: el.checked };
        scheduleUrl();
    });
    $("autoSpin")?.addEventListener("change", () => {
        const el = $("autoSpin");
        autoSpin = el.checked;
    });
    document.querySelectorAll('input[name="paint"]').forEach((node) => {
        node.addEventListener("change", () => {
            const el = node;
            if (el.checked)
                paintTool = Number(el.value);
        });
    });
    $("clearPaint")?.addEventListener("click", () => {
        overrides = [];
        syncUiFromParams();
        setStatus("Paint cleared");
    });
    $("randSeed")?.addEventListener("click", () => {
        params = clampLandParams({
            ...params,
            seed: (Math.random() * 9998 + 1) | 0,
        });
        syncUiFromParams();
        scheduleUrl();
    });
    document.querySelectorAll("[data-preset]").forEach((node) => {
        node.addEventListener("click", () => {
            const id = node.getAttribute("data-preset");
            const seed = params.seed;
            params = paramsForPreset(id, seed);
            overrides = [];
            syncUiFromParams();
            scheduleUrl();
            setStatus(`Preset ${id}`);
        });
    });
    syncUiFromParams();
    function pickBodyNormal(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const ndc = screenToNdc(clientX - rect.left, clientY - rect.top, rect.width, rect.height);
        const ray = pickRayFromNdc(ndc.x, ndc.y, lastViewProj);
        if (!ray)
            return null;
        const dl = Math.hypot(ray.dx, ray.dy, ray.dz) || 1;
        const origin = { x: ray.originX, y: ray.originY, z: ray.originZ };
        const dir = { x: ray.dx / dl, y: ray.dy / dl, z: ray.dz / dl };
        const hit = rayVsSphere(origin, dir, PLANET_R);
        if (!(hit.tNear > 1e-4) || hit.tNear > 1e3)
            return null;
        const px = origin.x + dir.x * hit.tNear;
        const py = origin.y + dir.y * hit.tNear;
        const pz = origin.z + dir.z * hit.tNear;
        const L = Math.hypot(px, py, pz) || 1;
        return worldToBody(px / L, py / L, pz / L, spinAngle, obliquity);
    }
    function updateHover(clientX, clientY) {
        const n = pickBodyNormal(clientX, clientY);
        if (!n) {
            hover = null;
            hoverKind = -1;
            const cellEl = $("hud-cell");
            const kindEl = $("hud-kind");
            if (cellEl)
                cellEl.textContent = "—";
            if (kindEl)
                kindEl.textContent = "—";
            return;
        }
        hoverLayer = paintLayerForTool(paintTool, params.viewMode);
        hover = layerRoot(n, params, hoverLayer);
        const sample = classifyLand(n, params, overrides);
        hoverKind = sample.kind;
        const cellEl = $("hud-cell");
        const kindEl = $("hud-kind");
        if (cellEl && hover) {
            cellEl.textContent = `${hover.x},${hover.y},${hover.z}`;
        }
        if (kindEl) {
            kindEl.textContent = KIND_LABEL[hoverKind] ?? "—";
        }
    }
    function paintAt(clientX, clientY) {
        const n = pickBodyNormal(clientX, clientY);
        if (!n)
            return;
        const layer = paintLayerForTool(paintTool, params.viewMode);
        const cell = layerRoot(n, params, layer);
        let klass = 0;
        if (paintTool === PAINT_TOOL.erase)
            klass = 0;
        else if (paintTool === PAINT_TOOL.ocean)
            klass = OVERRIDE_WATER;
        else
            klass = OVERRIDE_LAND;
        overrides = upsertOverride(overrides, cell, layer, klass);
        syncUiFromParams();
        const sample = classifyLand(n, params, overrides);
        setStatus(`Paint ${KIND_LABEL[sample.kind] ?? "?"} cell ${cell.x},${cell.y},${cell.z} (${overrides.length} overrides)`);
    }
    canvas.addEventListener("pointerdown", (e) => {
        dragging = true;
        shifting = e.shiftKey;
        if (!shifting)
            autoSpin = false;
        const spinEl = $("autoSpin");
        if (spinEl && !shifting)
            spinEl.checked = false;
        lastX = e.clientX;
        lastY = e.clientY;
        downX = e.clientX;
        downY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
        if (!dragging) {
            updateHover(e.clientX, e.clientY);
            return;
        }
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        if (shifting) {
            sunYaw += dx * 0.01;
            sunPitch = Math.max(-1.1, Math.min(1.1, sunPitch + dy * 0.01));
            return;
        }
        yaw += dx * 0.008;
        pitch = Math.max(-1.2, Math.min(1.2, pitch + dy * 0.008));
    });
    const endDrag = (e) => {
        const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
        if (dragging && !shifting && moved < 5)
            paintAt(e.clientX, e.clientY);
        dragging = false;
        shifting = false;
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
        camDist = Math.min(12, Math.max(1.55, camDist * Math.exp(e.deltaY * 0.0012)));
    }, { passive: false });
    let lastT = performance.now();
    let frames = 0;
    let fpsEma = 0;
    let timeSec = 0;
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
            yaw += dt * 0.1;
            spinAngle += dt * 0.18;
        }
        const cssW = canvas.clientWidth || 1;
        const cssH = canvas.clientHeight || 1;
        configureContext(cssW, cssH);
        const pw = canvas.width;
        const ph = canvas.height;
        const cp = Math.cos(pitch);
        const eyeX = camDist * Math.sin(yaw) * cp;
        const eyeY = camDist * Math.sin(pitch);
        const eyeZ = camDist * Math.cos(yaw) * cp;
        mat4LookAt(view, eyeX, eyeY, eyeZ, 0, 0, 0, 0, 1, 0);
        mat4Perspective(proj, FOVY, pw / Math.max(1, ph), 0.05, 100);
        mat4Multiply(viewProj, proj, view);
        lastViewProj.set(viewProj);
        const sc = Math.cos(sunPitch);
        const sunX = 8 * Math.sin(sunYaw) * sc;
        const sunY = 8 * Math.sin(sunPitch);
        const sunZ = 8 * Math.cos(sunYaw) * sc;
        const basis = billboardBasis(eyeX, eyeY, eyeZ);
        frameCPU.set(viewProj, 0);
        frameCPU[16] = eyeX;
        frameCPU[17] = eyeY;
        frameCPU[18] = eyeZ;
        frameCPU[19] = 1;
        frameCPU[20] = sunX;
        frameCPU[21] = sunY;
        frameCPU[22] = sunZ;
        frameCPU[23] = 1;
        frameCPU[24] = timeSec;
        frameCPU[25] = 0;
        frameCPU[26] = 0;
        frameCPU[27] = 0;
        bodyCPU[0] = 0;
        bodyCPU[1] = 0;
        bodyCPU[2] = 0;
        bodyCPU[3] = PLANET_R;
        bodyCPU[4] = basis.camRight[0];
        bodyCPU[5] = basis.camRight[1];
        bodyCPU[6] = basis.camRight[2];
        bodyCPU[7] = 0;
        bodyCPU[8] = basis.camUp[0];
        bodyCPU[9] = basis.camUp[1];
        bodyCPU[10] = basis.camUp[2];
        bodyCPU[11] = 0;
        bodyCPU[12] = spinAngle;
        bodyCPU[13] = obliquity;
        bodyCPU[14] = DRAW_MARGIN;
        bodyCPU[15] = 0.004;
        const hl = hover ?? { x: 0, y: 0, z: 0 };
        const hlLayer = hover ? hoverLayer : -1;
        const landCPU = packLandUniforms(params, hl, hlLayer, paintTool);
        const ovCPU = packOverrides(overrides);
        device.queue.writeBuffer(frameBuf, 0, frameCPU);
        device.queue.writeBuffer(bodyBuf, 0, bodyCPU);
        device.queue.writeBuffer(landBuf, 0, landCPU);
        device.queue.writeBuffer(ovBuf, 0, ovCPU);
        const encoder = device.createCommandEncoder({ label: "planet-land-frame" });
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
    window.__planetLand = {
        ok: true,
        getParams: () => cloneLandParams(params),
        getOverrides: () => overrides.slice(),
        classify: classifyLand,
    };
    requestAnimationFrame(frame);
    setStatus("Ready · fractal Voronoi land · click cells to paint continents / islands");
}
void main();
//# sourceMappingURL=main.js.map