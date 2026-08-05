/**
 * Educational multi-method planet surface demo on **disc impostors**
 * (solar-system style: camera-facing quad, FS spherization + ray-heightfield).
 * Shared rotation; equal tiles; per-method timing.
 */
import { createWebGpuBootstrap } from "../device.js";
import { mat4Identity, mat4LookAt, mat4Multiply, mat4Perspective, } from "../math/mat4.js";
import { SURFACE_METHODS, } from "./heightfield.js";
import { DEFAULT_QUALITY_PROFILE, getQualityProfile, QUALITY_PROFILES, } from "./quality-profiles.js";
import { bakeShapeSurfaceMaps, getTestShape, sampleShapeRadiusUV, TEST_RUN_HEIGHT_SCALE, TEST_SHAPES, } from "./shapes.js";
import { SPHERE_PARALLAX_MAX_ANG, SPHERE_PARALLAX_SCALE, } from "./sphere-parallax.js";
import { ASTEROID_MESH_WGSL, SPHERE_SURFACE_WGSL, } from "./shaders.js";
import { buildAsteroidMesh, VERTEX_STRIDE_FLOATS, } from "./mesh.js";
import { createSwarmInstances, stepSwarmInstances, SWARM_COUNT, } from "./swarm.js";
const METHOD_COUNT = SURFACE_METHODS.length;
/**
 * Fixed 4K UHD for **per-method timing** (not window × DPR).
 * Each method is timed drawing a full 3840×2160 impostor (true 4K pixel density).
 * The on-screen multi-tile grid is a separate untimed display pass.
 */
const RENDER_W = 3840;
const RENDER_H = 2160;
// viewProj(64) model(64) cam(16) light(16) camRight(16) camUp(16) params(16) steps(16) = 224 → 256
const UNIFORM_SIZE = 256;
const UNIFORM_STRIDE = 256;
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
function mat4RotationY(out, rad) {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    mat4Identity(out);
    out[0] = c;
    out[2] = -s;
    out[8] = s;
    out[10] = c;
    return out;
}
function mat4RotationX(out, rad) {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    mat4Identity(out);
    out[5] = c;
    out[6] = s;
    out[9] = -s;
    out[10] = c;
    return out;
}
function uploadTexture(device, data, width, height, label, format = "rgba8unorm") {
    const tex = device.createTexture({
        label,
        size: { width, height },
        format,
        usage: GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.writeTexture({ texture: tex }, data, { bytesPerRow: width * 4, rowsPerImage: height }, { width, height });
    return tex;
}
/**
 * Camera-facing disc basis (solar-system impostor style).
 * look = eye → origin (into scene). right = normalize(cross(look, worldUp)).
 * FS rebuilds camFwd = cross(right, up) which must point **toward** the camera
 * so nBill.z > 0 faces the viewer (ndotv > 0). Using cross(worldUp, look) flips
 * that and discards every on-disc fragment.
 */
function billboardBasis(eyeX, eyeY, eyeZ) {
    // look = from eye toward origin
    let lx = -eyeX;
    let ly = -eyeY;
    let lz = -eyeZ;
    const ll = Math.hypot(lx, ly, lz) || 1;
    lx /= ll;
    ly /= ll;
    lz /= ll;
    // right = cross(look, worldUp=(0,1,0))
    let rx = ly * 0 - lz * 1; // -lz
    let ry = lz * 0 - lx * 0; // 0
    let rz = lx * 1 - ly * 0; // lx
    // = (-lz, 0, lx)
    let rl = Math.hypot(rx, ry, rz);
    if (rl < 1e-5) {
        // look ≈ ±Y — pick X fallback
        rx = 1;
        ry = 0;
        rz = 0;
        rl = 1;
    }
    rx /= rl;
    ry /= rl;
    rz /= rl;
    // up = cross(right, look) — keeps right-handed, cross(right,up)=toward camera
    let ux = ry * lz - rz * ly;
    let uy = rz * lx - rx * lz;
    let uz = rx * ly - ry * lx;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    return {
        camRight: [rx, ry, rz],
        camUp: [ux, uy, uz],
    };
}
function writeUniforms(buf, base, viewProj, model, camX, camY, camZ, camRight, camUp, sphereR, method, heightScale, profile) {
    buf.set(viewProj, base + 0);
    buf.set(model, base + 16);
    buf[base + 32] = camX;
    buf[base + 33] = camY;
    buf[base + 34] = camZ;
    buf[base + 35] = 1;
    const lx = 0.45;
    const ly = 0.65;
    const lz = 0.6;
    const llen = Math.hypot(lx, ly, lz);
    buf[base + 36] = lx / llen;
    buf[base + 37] = ly / llen;
    buf[base + 38] = lz / llen;
    buf[base + 39] = 0;
    // camRight.xyz + sphere radius in w
    buf[base + 40] = camRight[0];
    buf[base + 41] = camRight[1];
    buf[base + 42] = camRight[2];
    buf[base + 43] = sphereR;
    buf[base + 44] = camUp[0];
    buf[base + 45] = camUp[1];
    buf[base + 46] = camUp[2];
    buf[base + 47] = 0;
    // params: method, heightScale, rayStep, normal blend
    buf[base + 48] = method;
    buf[base + 49] = heightScale;
    buf[base + 50] = profile.rayStep;
    buf[base + 51] = 0.78;
    void SPHERE_PARALLAX_MAX_ANG;
    void SPHERE_PARALLAX_SCALE;
    // steps: steep, pomLin, pomBin (+ linear refine), cone
    buf[base + 52] = profile.steep;
    buf[base + 53] = profile.pomLinear;
    buf[base + 54] = Math.max(profile.pomBinary, profile.binaryRefine);
    buf[base + 55] = profile.cone;
    // budget: classic, iterative, offset floors; maxSteps
    buf[base + 56] = profile.classic;
    buf[base + 57] = profile.iterative;
    buf[base + 58] = profile.offset;
    buf[base + 59] = profile.maxSteps;
}
function writeTexData(device, tex, data, width, height) {
    device.queue.writeTexture({ texture: tex }, data, { bytesPerRow: width * 4, rowsPerImage: height }, { width, height });
}
async function main() {
    const canvasEl = document.getElementById("canvas");
    if (!canvasEl) {
        setStatus("Missing #canvas", true);
        return;
    }
    const canvas = canvasEl;
    // Build label tiles in DOM
    const grid = $("method-grid");
    const timers = [];
    /** When non-null, only this method is displayed (full viewport) and timed. */
    let soloMethodIndex = null;
    /** Solo-only: 500 random disc-impostor instances (cleared on exit). */
    let swarmActive = false;
    /** Solo-only asteroid: 500 triangle-mesh instances (performance compare). */
    let meshSwarmActive = false;
    let swarmInstances = [];
    /**
     * Active test-run shape. Hoisted with solo/swarm state so UI handlers
     * (registered before await bootstrap) can gate mesh-500 on asteroid without TDZ.
     */
    let activeShapeId = "asteroid";
    {
        const urlShape = typeof location !== "undefined"
            ? /(?:\?|&)shape=([^&]+)/.exec(location.search || "")
            : null;
        if (urlShape) {
            try {
                activeShapeId = getTestShape(decodeURIComponent(urlShape[1])).id;
            }
            catch {
                /* keep default */
            }
        }
    }
    /** Camera distance; wheel / +− zoom only in solo fullscreen. */
    let camDist = 2.85;
    const CAM_DIST_DEFAULT = 2.85;
    const CAM_DIST_MIN = 1.15;
    /** Solo zoom-out can pull far back for overview / method comparison. */
    const CAM_DIST_MAX = 120;
    function clampCamDist(d) {
        return Math.min(CAM_DIST_MAX, Math.max(CAM_DIST_MIN, d));
    }
    /** Zoom camera: negative deltaY → zoom in (closer). Solo only. */
    function zoomCamera(deltaY) {
        if (soloMethodIndex == null)
            return;
        const factor = Math.exp(deltaY * 0.00115);
        camDist = clampCamDist(camDist * factor);
    }
    function clearSwarm() {
        swarmActive = false;
        meshSwarmActive = false;
        swarmInstances = [];
    }
    function enableSwarm() {
        if (soloMethodIndex == null)
            return;
        meshSwarmActive = false;
        swarmInstances = createSwarmInstances(SWARM_COUNT);
        swarmActive = true;
        // Pull back so the cloud is in view
        camDist = Math.max(camDist, 42);
        syncSoloUi();
        const m = SURFACE_METHODS[soloMethodIndex];
        setStatus(`Impostor swarm: ${SWARM_COUNT}× ${m.short} — disc FS · ✕ / Esc clears`);
    }
    function enableMeshSwarm() {
        if (soloMethodIndex == null)
            return;
        if (activeShapeId !== "asteroid") {
            setStatus("Mesh×500 is asteroid-only — switch Test run shape to asteroid", true);
            return;
        }
        swarmActive = false;
        swarmInstances = createSwarmInstances(SWARM_COUNT);
        meshSwarmActive = true;
        camDist = Math.max(camDist, 42);
        syncSoloUi();
        const m = SURFACE_METHODS[soloMethodIndex];
        setStatus(`Mesh swarm: ${SWARM_COUNT}× asteroid triangles (${m.short} maps) — compare vs disc 500`);
    }
    function toggleSwarm() {
        if (soloMethodIndex == null)
            return;
        if (swarmActive) {
            clearSwarm();
            syncSoloUi();
            setStatus(`Solo: ${SURFACE_METHODS[soloMethodIndex].short} — impostor swarm cleared`);
        }
        else {
            enableSwarm();
        }
    }
    function toggleMeshSwarm() {
        if (soloMethodIndex == null)
            return;
        if (meshSwarmActive) {
            clearSwarm();
            syncSoloUi();
            setStatus(`Solo: ${SURFACE_METHODS[soloMethodIndex].short} — mesh swarm cleared`);
        }
        else {
            enableMeshSwarm();
        }
    }
    function syncSoloUi() {
        const solo = soloMethodIndex;
        document.body.classList.toggle("solo-mode", solo != null);
        document.body.classList.toggle("swarm-mode", solo != null && swarmActive);
        document.body.classList.toggle("mesh-swarm-mode", solo != null && meshSwarmActive);
        if (!grid)
            return;
        const cards = grid.querySelectorAll(".method-card");
        cards.forEach((card, i) => {
            const el = card;
            const btn = el.querySelector(".method-fs");
            const swarmBtn = el.querySelector(".method-swarm");
            const meshBtn = el.querySelector(".method-mesh-swarm");
            if (solo == null) {
                el.classList.remove("solo-hidden", "is-solo");
                if (btn) {
                    btn.title = "Fullscreen this method";
                    btn.setAttribute("aria-label", `Fullscreen ${SURFACE_METHODS[i].short}`);
                    btn.textContent = "⛶";
                }
                if (swarmBtn) {
                    swarmBtn.hidden = true;
                    swarmBtn.classList.remove("is-on");
                }
                if (meshBtn) {
                    meshBtn.hidden = true;
                    meshBtn.classList.remove("is-on");
                }
            }
            else if (i === solo) {
                el.classList.remove("solo-hidden");
                el.classList.add("is-solo");
                if (btn) {
                    btn.title = "Exit fullscreen (Esc)";
                    btn.setAttribute("aria-label", "Exit fullscreen");
                    btn.textContent = "✕";
                }
                if (swarmBtn) {
                    swarmBtn.hidden = false;
                    swarmBtn.classList.toggle("is-on", swarmActive);
                    swarmBtn.textContent = swarmActive ? "1×" : "500";
                    swarmBtn.title = swarmActive
                        ? "Clear 500 disc-impostor swarm"
                        : `Spawn ${SWARM_COUNT} disc-impostor instances (same method)`;
                    swarmBtn.setAttribute("aria-label", swarmActive
                        ? "Clear impostor swarm"
                        : `Spawn ${SWARM_COUNT} impostor instances`);
                }
                if (meshBtn) {
                    const asteroid = activeShapeId === "asteroid";
                    meshBtn.hidden = false;
                    meshBtn.disabled = !asteroid && !meshSwarmActive;
                    meshBtn.classList.toggle("is-on", meshSwarmActive);
                    meshBtn.classList.toggle("is-disabled", !asteroid && !meshSwarmActive);
                    meshBtn.textContent = meshSwarmActive ? "M1×" : "M500";
                    meshBtn.title = !asteroid
                        ? "Mesh×500: asteroid shape only"
                        : meshSwarmActive
                            ? "Clear 500 triangle-mesh asteroids"
                            : `Spawn ${SWARM_COUNT} 3D mesh asteroids (perf compare)`;
                    meshBtn.setAttribute("aria-label", meshSwarmActive
                        ? "Clear mesh swarm"
                        : "Spawn 500 mesh asteroids");
                }
            }
            else {
                el.classList.add("solo-hidden");
                el.classList.remove("is-solo");
                if (swarmBtn)
                    swarmBtn.hidden = true;
                if (meshBtn)
                    meshBtn.hidden = true;
            }
        });
    }
    function enterSolo(methodIndex) {
        if (methodIndex < 0 || methodIndex >= METHOD_COUNT)
            return;
        clearSwarm();
        soloMethodIndex = methodIndex;
        // Fresh default framing when entering solo (zoom from a known base)
        camDist = CAM_DIST_DEFAULT;
        syncSoloUi();
        const m = SURFACE_METHODS[methodIndex];
        setStatus(`Solo: ${m.short} — 500 disc / M500 mesh(asteroid) · zoom · Esc exit`);
    }
    function exitSolo() {
        if (soloMethodIndex == null)
            return;
        clearSwarm();
        soloMethodIndex = null;
        camDist = CAM_DIST_DEFAULT;
        syncSoloUi();
        setStatus(`Grid restored — ${METHOD_COUNT} methods`);
    }
    function toggleSolo(methodIndex) {
        if (soloMethodIndex === methodIndex)
            exitSolo();
        else
            enterSolo(methodIndex);
    }
    if (grid) {
        grid.innerHTML = "";
        for (let i = 0; i < METHOD_COUNT; i++) {
            const m = SURFACE_METHODS[i];
            const card = document.createElement("div");
            card.className = "method-card";
            card.dataset.method = m.id;
            card.dataset.methodIndex = String(i);
            card.innerHTML =
                `<button type="button" class="method-fs" title="Fullscreen this method" ` +
                    `aria-label="Fullscreen ${m.short}">⛶</button>` +
                    `<button type="button" class="method-swarm" hidden title="Spawn 500 disc instances" ` +
                    `aria-label="Spawn ${SWARM_COUNT} disc instances">500</button>` +
                    `<button type="button" class="method-mesh-swarm" hidden title="Spawn 500 mesh asteroids" ` +
                    `aria-label="Spawn ${SWARM_COUNT} mesh asteroids">M500</button>` +
                    `<div class="method-label" data-method-label="${m.id}">${m.label}</div>` +
                    `<div class="method-time" id="time-${m.id}" data-method-time="${m.id}">— ms</div>`;
            const fsBtn = card.querySelector(".method-fs");
            fsBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleSolo(i);
            });
            const swarmBtn = card.querySelector(".method-swarm");
            swarmBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (soloMethodIndex !== i)
                    enterSolo(i);
                toggleSwarm();
            });
            const meshBtn = card.querySelector(".method-mesh-swarm");
            meshBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (soloMethodIndex !== i)
                    enterSolo(i);
                toggleMeshSwarm();
            });
            grid.appendChild(card);
            timers.push({
                ms: 0,
                ema: 0,
                el: card.querySelector(`#time-${m.id}`),
            });
        }
    }
    else {
        for (let i = 0; i < METHOD_COUNT; i++) {
            timers.push({ ms: 0, ema: 0, el: null });
        }
    }
    window.addEventListener("keydown", (e) => {
        if (soloMethodIndex == null)
            return;
        if (e.key === "Escape") {
            e.preventDefault();
            exitSolo();
            return;
        }
        // Solo zoom: +/= zoom in, -/_ zoom out, 0 reset
        if (e.key === "+" || e.key === "=") {
            e.preventDefault();
            zoomCamera(-120);
        }
        else if (e.key === "-" || e.key === "_") {
            e.preventDefault();
            zoomCamera(120);
        }
        else if (e.key === "0") {
            e.preventDefault();
            camDist = CAM_DIST_DEFAULT;
        }
    });
    let boot;
    try {
        boot = await createWebGpuBootstrap({
            canvas,
            label: "sphere-surface-methods",
            clearColor: { r: 0.02, g: 0.03, b: 0.07, a: 1 },
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus(msg, true);
        return;
    }
    const { device, context, format, isLost } = boot;
    /** Force swapchain + canvas buffer to fixed 4K (ignore window DPR). */
    function configureRender4k() {
        if (isLost)
            return;
        if (canvas.width === RENDER_W && canvas.height === RENDER_H)
            return;
        canvas.width = RENDER_W;
        canvas.height = RENDER_H;
        context.configure({
            device,
            format,
            alphaMode: "opaque",
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
    }
    configureRender4k();
    // Hard test-run shapes (cube / pyramid / small sphere / asteroid / cross / heart).
    // All eight methods share the active shape for fair timing comparison.
    // activeShapeId already resolved early (URL + default) before UI wiring.
    const MAP_W = 512;
    const MAP_H = 512;
    let maps = bakeShapeSurfaceMaps(activeShapeId, MAP_W, MAP_H);
    let activeHeightScale = maps.heightScale;
    // Albedo as sRGB so authored colors decode to linear on sample
    const albedoTex = uploadTexture(device, maps.albedo, maps.width, maps.height, "albedo", "rgba8unorm-srgb");
    const normalTex = uploadTexture(device, maps.normal, maps.width, maps.height, "normal", "rgba8unorm");
    const heightConeTex = uploadTexture(device, maps.heightCone, maps.width, maps.height, "height-cone", "rgba8unorm");
    function applyShapeMaps(next) {
        maps = next;
        activeHeightScale = next.heightScale;
        writeTexData(device, albedoTex, next.albedo, next.width, next.height);
        writeTexData(device, normalTex, next.normal, next.width, next.height);
        writeTexData(device, heightConeTex, next.heightCone, next.width, next.height);
    }
    function setActiveShape(id) {
        const shape = getTestShape(id);
        activeShapeId = shape.id;
        applyShapeMaps(bakeShapeSurfaceMaps(shape.id, MAP_W, MAP_H));
        // Mesh×500 is asteroid-only — drop mesh swarm when leaving asteroid
        if (meshSwarmActive && shape.id !== "asteroid") {
            clearSwarm();
        }
        const shapeVal = $("shape-run-val");
        if (shapeVal)
            shapeVal.textContent = shape.label;
        // Reset EMAs so rank re-samples under the new shell
        for (const t of timers) {
            t.ms = 0;
            t.ema = 0;
            if (t.el)
                t.el.textContent = "— ms";
        }
        syncSoloUi();
        setStatus(`Shape: ${shape.label} · hard heightScale=${TEST_RUN_HEIGHT_SCALE} · quality=${activeProfileId}`);
    }
    // HUD shape selector
    const shapeSelect = document.getElementById("shape-select");
    if (shapeSelect) {
        shapeSelect.innerHTML = "";
        for (const s of TEST_SHAPES) {
            const opt = document.createElement("option");
            opt.value = s.id;
            opt.textContent = s.label;
            if (s.id === activeShapeId)
                opt.selected = true;
            shapeSelect.appendChild(opt);
        }
        shapeSelect.addEventListener("change", () => {
            setActiveShape(shapeSelect.value);
        });
    }
    {
        const shapeVal = $("shape-run-val");
        if (shapeVal)
            shapeVal.textContent = getTestShape(activeShapeId).label;
    }
    // Quality / performance profile (ray-march budgets)
    let activeProfileId = DEFAULT_QUALITY_PROFILE;
    const urlQual = typeof location !== "undefined"
        ? /(?:\?|&)quality=([^&]+)/.exec(location.search || "")
        : null;
    if (urlQual) {
        try {
            activeProfileId = getQualityProfile(decodeURIComponent(urlQual[1]))
                .id;
        }
        catch {
            /* keep default */
        }
    }
    let activeProfile = getQualityProfile(activeProfileId);
    function resetTimers() {
        for (const t of timers) {
            t.ms = 0;
            t.ema = 0;
            if (t.el)
                t.el.textContent = "— ms";
        }
    }
    function setActiveProfile(id) {
        activeProfile = getQualityProfile(id);
        activeProfileId = activeProfile.id;
        const qVal = $("quality-run-val");
        if (qVal) {
            qVal.textContent =
                `${activeProfile.label} · max ${activeProfile.maxSteps} · step ${activeProfile.rayStep}`;
        }
        resetTimers();
        setStatus(`Quality: ${activeProfile.label} (maxSteps=${activeProfile.maxSteps}, rayStep=${activeProfile.rayStep}) · shape ${getTestShape(activeShapeId).label}`);
    }
    const qualitySelect = document.getElementById("quality-select");
    if (qualitySelect) {
        qualitySelect.innerHTML = "";
        for (const p of QUALITY_PROFILES) {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = p.label;
            if (p.id === activeProfileId)
                opt.selected = true;
            qualitySelect.appendChild(opt);
        }
        qualitySelect.addEventListener("change", () => {
            setActiveProfile(qualitySelect.value);
        });
    }
    setActiveProfile(activeProfileId);
    // Shape switch should not wipe quality; only reset timers (already in setActiveShape)
    // Rebind setActiveShape timer reset is already there.
    const sampler = device.createSampler({
        magFilter: "linear",
        minFilter: "linear",
        addressModeU: "repeat",
        addressModeV: "clamp-to-edge",
    });
    // Disc impostor: no mesh VBOs — vs_main builds a unit quad from vertex_index.
    const uniformBuf = device.createBuffer({
        size: UNIFORM_STRIDE * METHOD_COUNT,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: "sphere-uniforms",
    });
    const uniformCPU = new Float32Array((UNIFORM_STRIDE * METHOD_COUNT) / 4);
    const shaderModule = device.createShaderModule({
        label: "sphere-surface-impostor-wgsl",
        code: SPHERE_SURFACE_WGSL,
    });
    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: { type: "uniform", minBindingSize: UNIFORM_SIZE },
            },
            {
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,
                sampler: { type: "filtering" },
            },
            {
                binding: 2,
                visibility: GPUShaderStage.FRAGMENT,
                texture: { sampleType: "float" },
            },
            {
                binding: 3,
                visibility: GPUShaderStage.FRAGMENT,
                texture: { sampleType: "float" },
            },
            {
                binding: 4,
                visibility: GPUShaderStage.FRAGMENT,
                texture: { sampleType: "float" },
            },
        ],
    });
    const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
    });
    const pipeline = device.createRenderPipeline({
        label: "sphere-surface-impostor-pipeline",
        layout: pipelineLayout,
        vertex: {
            module: shaderModule,
            entryPoint: "vs_main",
            // No vertex buffers — disc corners from @builtin(vertex_index)
        },
        fragment: {
            module: shaderModule,
            entryPoint: "fs_main",
            // Opaque on ray hit; discard outside disc + true heightfield miss
            targets: [{ format }],
        },
        primitive: {
            topology: "triangle-list",
            cullMode: "none",
            frontFace: "ccw",
        },
        depthStencil: {
            format: "depth24plus",
            depthWriteEnabled: true,
            depthCompare: "less",
        },
    });
    // One bind group per method (different uniform offset)
    const bindGroups = [];
    for (let i = 0; i < METHOD_COUNT; i++) {
        bindGroups.push(device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: uniformBuf,
                        offset: i * UNIFORM_STRIDE,
                        size: UNIFORM_SIZE,
                    },
                },
                { binding: 1, resource: sampler },
                { binding: 2, resource: albedoTex.createView() },
                { binding: 3, resource: normalTex.createView() },
                { binding: 4, resource: heightConeTex.createView() },
            ],
        }));
    }
    // Solo swarm: 500 instance uniform slots (same maps/sampler as methods)
    const swarmUniformBuf = device.createBuffer({
        size: UNIFORM_STRIDE * SWARM_COUNT,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: "sphere-swarm-uniforms",
    });
    const swarmUniformCPU = new Float32Array((UNIFORM_STRIDE * SWARM_COUNT) / 4);
    const swarmBindGroups = [];
    for (let i = 0; i < SWARM_COUNT; i++) {
        swarmBindGroups.push(device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: swarmUniformBuf,
                        offset: i * UNIFORM_STRIDE,
                        size: UNIFORM_SIZE,
                    },
                },
                { binding: 1, resource: sampler },
                { binding: 2, resource: albedoTex.createView() },
                { binding: 3, resource: normalTex.createView() },
                { binding: 4, resource: heightConeTex.createView() },
            ],
        }));
    }
    // Per-instance model scratch (rotation + translation in col 3)
    const swarmModel = mat4Identity();
    const swarmRotY = mat4Identity();
    const swarmRotX = mat4Identity();
    // --- Asteroid triangle mesh (mesh-500 solo compare) ---
    const asteroidShape = getTestShape("asteroid");
    const asteroidCpuMesh = buildAsteroidMesh((u, v) => sampleShapeRadiusUV(asteroidShape, u, v));
    const meshVertexBuf = device.createBuffer({
        size: asteroidCpuMesh.vertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        label: "asteroid-mesh-vb",
    });
    device.queue.writeBuffer(meshVertexBuf, 0, asteroidCpuMesh.vertices);
    const meshIndexBuf = device.createBuffer({
        size: asteroidCpuMesh.indices.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        label: "asteroid-mesh-ib",
    });
    device.queue.writeBuffer(meshIndexBuf, 0, asteroidCpuMesh.indices);
    const meshIndexCount = asteroidCpuMesh.indexCount;
    const meshStrideBytes = VERTEX_STRIDE_FLOATS * 4;
    const meshShaderModule = device.createShaderModule({
        label: "asteroid-mesh-wgsl",
        code: ASTEROID_MESH_WGSL,
    });
    const meshPipeline = device.createRenderPipeline({
        label: "asteroid-mesh-pipeline",
        layout: pipelineLayout,
        vertex: {
            module: meshShaderModule,
            entryPoint: "vs_main",
            buffers: [
                {
                    arrayStride: meshStrideBytes,
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: "float32x3" }, // pos
                        { shaderLocation: 1, offset: 12, format: "float32x3" }, // normal
                        { shaderLocation: 2, offset: 24, format: "float32x2" }, // uv
                        { shaderLocation: 3, offset: 32, format: "float32x3" }, // tangent
                    ],
                },
            ],
        },
        fragment: {
            module: meshShaderModule,
            entryPoint: "fs_main",
            targets: [{ format }],
        },
        primitive: {
            topology: "triangle-list",
            cullMode: "back",
            frontFace: "ccw",
        },
        depthStencil: {
            format: "depth24plus",
            depthWriteEnabled: true,
            depthCompare: "less",
        },
    });
    console.info(`[sphere-surface] asteroid mesh: ${asteroidCpuMesh.vertexCount} verts, ${meshIndexCount} indices`);
    // Prefer GPU timestamps when stable; fall back to CPU wall timers.
    // Disable via ?nots=1. Some SwiftShader stacks are fragile with multi-pass timestamps.
    //
    // Timing integrity notes (past bugs):
    // - Chrome quantizes timestamp queries to ~100µs unless developer features are on.
    // - Offscreen targets with no consumer can look "free" under wall clocks if we only
    //   measure encode; we fence with a 1×1 readback so the GPU must finish.
    // - When a timestamp map is pending we must NOT fall into the wall path (that mixed
    //   two clocks and produced 0.000 / nonsense samples).
    // - Wall measure must own the queue alone (no concurrent display submits).
    const urlNoTs = typeof location !== "undefined" &&
        /(?:\?|&)nots=1(?:&|$)/.test(location.search || "");
    /** How many full-screen draws per method inside one timed pass (beats 100µs quantize). */
    const TIMED_DRAW_REPS = 4;
    let hasTs = !urlNoTs &&
        !!device.features?.has?.("timestamp-query") &&
        typeof device.createQuerySet === "function";
    let querySet = null;
    let resolveBuf = null;
    let readA = null;
    let readB = null;
    let useReadA = true;
    let mapPending = false;
    let tsPeriod = 1;
    let tsDisabled = false;
    /** 1×1 RGBA8 staging — forces real GPU completion for wall / sanity fences. */
    let fenceBuf = null;
    const enableTimestamps = () => {
        if (!hasTs || querySet)
            return;
        try {
            querySet = device.createQuerySet({
                type: "timestamp",
                count: METHOD_COUNT * 2,
                label: "method-timestamps",
            });
            const bytes = METHOD_COUNT * 2 * 8;
            resolveBuf = device.createBuffer({
                size: bytes,
                usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
            });
            readA = device.createBuffer({
                size: bytes,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });
            readB = device.createBuffer({
                size: bytes,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });
            tsPeriod =
                typeof device.queue.getTimestampPeriod === "function"
                    ? device.queue.getTimestampPeriod()
                    : 1;
            if (!(tsPeriod > 0) || !Number.isFinite(tsPeriod)) {
                tsPeriod = 1;
            }
        }
        catch (err) {
            console.warn("[sphere-surface] timestamp queries unavailable", err);
            hasTs = false;
            querySet = null;
        }
    };
    enableTimestamps();
    fenceBuf = device.createBuffer({
        size: 256,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        label: "sphere-time-fence-1px",
    });
    device.addEventListener?.("uncapturederror", ((ev) => {
        console.error("[sphere-surface] uncaptured GPU error", ev.error?.message ?? ev);
        // Disable timestamps after first validation fault (common on software adapters)
        if (hasTs && !tsDisabled) {
            tsDisabled = true;
            hasTs = false;
            const modeEl = $("timing-mode");
            if (modeEl) {
                modeEl.textContent =
                    `Wall GPU fence (timestamps disabled after GPU error) · ${RENDER_W}×${RENDER_H}×${TIMED_DRAW_REPS}`;
            }
        }
    }));
    /** Swapchain display depth (4K grid). */
    let depthTex = null;
    let depthView = null;
    /** Offscreen full-4K targets used only for per-method timing. */
    let timeColor = null;
    let timeColorView = null;
    let timeDepth = null;
    let timeDepthView = null;
    function ensureDepth(pixelW, pixelH) {
        if (depthTex &&
            depthTex.width === pixelW &&
            depthTex.height === pixelH) {
            return;
        }
        depthTex?.destroy();
        depthTex = device.createTexture({
            size: { width: pixelW, height: pixelH },
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
            label: "sphere-display-depth",
        });
        depthView = depthTex.createView();
    }
    function ensureTimeTargets() {
        if (timeColor && timeDepth)
            return;
        timeColor?.destroy();
        timeDepth?.destroy();
        // COPY_SRC: 1×1 readback fence so wall clocks cannot report encode-only 0.000ms
        // and drivers cannot treat the timed target as completely dead.
        timeColor = device.createTexture({
            size: { width: RENDER_W, height: RENDER_H },
            format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
            label: "sphere-time-4k-color",
        });
        timeColorView = timeColor.createView();
        timeDepth = device.createTexture({
            size: { width: RENDER_W, height: RENDER_H },
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
            label: "sphere-time-4k-depth",
        });
        timeDepthView = timeDepth.createView();
    }
    ensureDepth(RENDER_W, RENDER_H);
    ensureTimeTargets();
    // Shared rotation (yaw / pitch); camDist/zoom live with solo state above
    let yaw = 0.35;
    let pitch = -0.15;
    let autoSpin = true;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    canvas.addEventListener("pointerdown", (e) => {
        dragging = true;
        autoSpin = false;
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
        if (!dragging)
            return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        yaw += dx * 0.008;
        pitch += dy * 0.008;
        pitch = Math.max(-1.2, Math.min(1.2, pitch));
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
    // Solo fullscreen: wheel zoom (grid mode keeps fixed framing)
    canvas.addEventListener("wheel", (e) => {
        if (soloMethodIndex == null)
            return;
        e.preventDefault();
        zoomCamera(e.deltaY);
    }, { passive: false });
    const spinBtn = $("toggle-spin");
    if (spinBtn) {
        spinBtn.addEventListener("click", () => {
            autoSpin = !autoSpin;
            spinBtn.textContent = autoSpin ? "Pause spin" : "Resume spin";
        });
    }
    const timingModeEl = $("timing-mode");
    function updateTimingModeLabel() {
        if (!timingModeEl)
            return;
        if (hasTs && !tsDisabled) {
            timingModeEl.textContent =
                `GPU TS: ${RENDER_W}×${RENDER_H} ×${TIMED_DRAW_REPS} draws/method` +
                    (tsPeriod !== 1 ? ` (period=${tsPeriod})` : " · ~100µs quantize");
        }
        else {
            timingModeEl.textContent =
                `Wall GPU fence: ${RENDER_W}×${RENDER_H} ×${TIMED_DRAW_REPS} (serial, no concurrent display)`;
        }
    }
    updateTimingModeLabel();
    /**
     * Accept a per-method sample in **milliseconds**.
     * Single body: amortized per full-4K draw. Swarm: full cost of all 500.
     * Reject only non-finite / absurd outliers (do not treat sub-ms as "noise" —
     * that hid real 0.000 fence failures; we surface those as errors instead).
     */
    function applySample(i, ms, meta) {
        // Swarm of 500 can legitimately exceed 500ms on soft GPUs — raise cap
        const multi = meta?.source?.includes("swarm") ||
            (soloMethodIndex === i && (swarmActive || meshSwarmActive));
        const maxMs = multi ? 30000 : 500;
        if (!Number.isFinite(ms) || ms < 0 || ms > maxMs)
            return;
        // True zeros mean the fence/timestamp path failed — show it, do not rank it.
        if (ms < 1e-6) {
            const t0 = timers[i];
            if (t0.el)
                t0.el.textContent = "0.000 ms ⚠";
            console.warn(`[sphere-surface] method ${i} measured 0.000ms (${meta?.source ?? "?"}) — fence/timestamp broken`, meta);
            return;
        }
        const t = timers[i];
        t.ms = ms;
        t.ema = t.ema > 0 ? t.ema * 0.85 + ms * 0.15 : ms;
        if (t.el) {
            let swarmTag = "";
            if (multi) {
                const kind = meta?.source?.includes("mesh") || meshSwarmActive ? "mesh" : "disc";
                swarmTag = ` · ×${SWARM_COUNT} ${kind}`;
            }
            t.el.textContent = `${t.ema.toFixed(3)} ms${swarmTag}`;
        }
    }
    /** True when solo multi-instance swarm (disc or mesh) is live for this method. */
    function isMultiInstanceSwarm(methodIndex) {
        return (soloMethodIndex === methodIndex &&
            swarmInstances.length > 0 &&
            (swarmActive || meshSwarmActive));
    }
    /**
     * Encode timed full-viewport draw(s) into an open pass.
     * - Grid / solo single: TIMED_DRAW_REPS draws of one method (amortize clear).
     * - Solo disc swarm: 500× draw(6) impostors.
     * - Solo mesh swarm: 500× drawIndexed asteroid mesh (full cost timed).
     */
    function encodeMethodDraw(pass, methodIndex) {
        pass.setViewport(0, 0, RENDER_W, RENDER_H, 0, 1);
        pass.setScissorRect(0, 0, RENDER_W, RENDER_H);
        if (isMultiInstanceSwarm(methodIndex)) {
            const n = Math.min(SWARM_COUNT, swarmInstances.length);
            if (meshSwarmActive) {
                pass.setPipeline(meshPipeline);
                pass.setVertexBuffer(0, meshVertexBuf);
                pass.setIndexBuffer(meshIndexBuf, "uint32");
                for (let i = 0; i < n; i++) {
                    pass.setBindGroup(0, swarmBindGroups[i]);
                    pass.drawIndexed(meshIndexCount);
                }
            }
            else {
                pass.setPipeline(pipeline);
                for (let i = 0; i < n; i++) {
                    pass.setBindGroup(0, swarmBindGroups[i]);
                    pass.draw(6);
                }
            }
            return;
        }
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroups[methodIndex]);
        for (let r = 0; r < TIMED_DRAW_REPS; r++) {
            pass.draw(6);
        }
    }
    /**
     * Copy center pixel of the timed color target → fenceBuf and map it.
     * Returns wall ms from t0 until map resolves (GPU must have finished the copy).
     */
    async function fenceGpuMs(t0) {
        if (!timeColor || !fenceBuf) {
            const done = device.queue.onSubmittedWorkDone?.();
            if (done)
                await done;
            return performance.now() - t0;
        }
        // Bytes-per-row must be 256-aligned for copyTextureToBuffer.
        const enc = device.createCommandEncoder({ label: "sphere-time-fence" });
        enc.copyTextureToBuffer({
            texture: timeColor,
            origin: { x: Math.floor(RENDER_W / 2), y: Math.floor(RENDER_H / 2), z: 0 },
        }, { buffer: fenceBuf, bytesPerRow: 256 }, { width: 1, height: 1, depthOrArrayLayers: 1 });
        device.queue.submit([enc.finish()]);
        await fenceBuf.mapAsync(GPUMapMode.READ);
        // Touch mapped range so the map cannot be optimized away.
        const u8 = new Uint8Array(fenceBuf.getMappedRange(0, 4));
        void u8[0];
        fenceBuf.unmap();
        return performance.now() - t0;
    }
    /**
     * Pack swarm instance uniforms (same method/maps, unique model+radius).
     * Call after stepSwarmInstances for the frame.
     */
    function packSwarmUniforms(methodIndex, viewProjM, eyeX, eyeY, eyeZ, camRight, camUp) {
        const n = Math.min(SWARM_COUNT, swarmInstances.length);
        for (let i = 0; i < n; i++) {
            const s = swarmInstances[i];
            mat4RotationY(swarmRotY, s.yaw);
            mat4RotationX(swarmRotX, s.pitch);
            mat4Multiply(swarmModel, swarmRotY, swarmRotX);
            // Translation in column 3 (WGSL model[3].xyz)
            swarmModel[12] = s.x;
            swarmModel[13] = s.y;
            swarmModel[14] = s.z;
            swarmModel[15] = 1;
            writeUniforms(swarmUniformCPU, (i * UNIFORM_STRIDE) / 4, viewProjM, swarmModel, eyeX, eyeY, eyeZ, camRight, camUp, s.radius, methodIndex, activeHeightScale, activeProfile);
        }
        if (n > 0) {
            // Subarray length = element count written (bytes = n * UNIFORM_STRIDE)
            device.queue.writeBuffer(swarmUniformBuf, 0, swarmUniformCPU.subarray(0, (n * UNIFORM_STRIDE) / 4));
        }
    }
    function encodeDisplayTiles(encoder, cols, tileW, tileH, solo) {
        const colorView = context.getCurrentTexture().createView();
        const disp = encoder.beginRenderPass({
            label: solo != null
                ? meshSwarmActive
                    ? "display-solo-mesh-swarm"
                    : swarmActive
                        ? "display-solo-swarm"
                        : "display-solo"
                : "display-tiles",
            colorAttachments: [
                {
                    view: colorView,
                    loadOp: "clear",
                    storeOp: "store",
                    clearValue: { r: 0.02, g: 0.03, b: 0.07, a: 1 },
                },
            ],
            depthStencilAttachment: {
                view: depthView,
                depthLoadOp: "clear",
                depthStoreOp: "store",
                depthClearValue: 1,
            },
        });
        if (solo != null) {
            disp.setViewport(0, 0, RENDER_W, RENDER_H, 0, 1);
            disp.setScissorRect(0, 0, RENDER_W, RENDER_H);
            if ((swarmActive || meshSwarmActive) &&
                swarmInstances.length > 0) {
                const n = Math.min(SWARM_COUNT, swarmInstances.length);
                if (meshSwarmActive) {
                    disp.setPipeline(meshPipeline);
                    disp.setVertexBuffer(0, meshVertexBuf);
                    disp.setIndexBuffer(meshIndexBuf, "uint32");
                    for (let i = 0; i < n; i++) {
                        disp.setBindGroup(0, swarmBindGroups[i]);
                        disp.drawIndexed(meshIndexCount);
                    }
                }
                else {
                    disp.setPipeline(pipeline);
                    for (let i = 0; i < n; i++) {
                        disp.setBindGroup(0, swarmBindGroups[i]);
                        disp.draw(6);
                    }
                }
            }
            else {
                // Full viewport — only the selected method (disc impostor)
                disp.setPipeline(pipeline);
                disp.setBindGroup(0, bindGroups[solo]);
                disp.draw(6);
            }
        }
        else {
            disp.setPipeline(pipeline);
            for (let i = 0; i < METHOD_COUNT; i++) {
                const c = i % cols;
                const r = Math.floor(i / cols);
                const x = c * tileW;
                const y = r * tileH;
                disp.setBindGroup(0, bindGroups[i]);
                disp.setViewport(x, y, tileW, tileH, 0, 1);
                disp.setScissorRect(x, y, tileW, tileH);
                disp.draw(6);
            }
        }
        disp.end();
    }
    const view = mat4Identity();
    const proj = mat4Identity();
    const viewProj = mat4Identity();
    const model = mat4Identity();
    const rotY = mat4Identity();
    const rotX = mat4Identity();
    /** Live rank: fastest → slowest with Δms vs previous (faster) entry. */
    function refreshSpeedRank() {
        const list = $("speed-rank");
        if (!list)
            return;
        const rows = [];
        for (let i = 0; i < METHOD_COUNT; i++) {
            const ms = timers[i].ema;
            if (!(ms > 0) || !Number.isFinite(ms))
                continue;
            const m = SURFACE_METHODS[i];
            rows.push({ id: m.id, short: m.short, ms });
        }
        if (rows.length === 0) {
            list.innerHTML =
                '<li class="rank-empty"><span class="rank-name">Waiting for samples…</span></li>';
            return;
        }
        rows.sort((a, b) => a.ms - b.ms);
        let html = "";
        for (let r = 0; r < rows.length; r++) {
            const cur = rows[r];
            let deltaHtml = '<span class="rank-delta">—</span>';
            if (r > 0) {
                const d = cur.ms - rows[r - 1].ms;
                deltaHtml = `<span class="rank-delta plus">+${d.toFixed(3)}</span>`;
            }
            html +=
                `<li data-method="${cur.id}">` +
                    `<span class="rank-n">${r + 1}.</span>` +
                    `<span class="rank-name">${cur.short}</span>` +
                    `<span class="rank-ms">${cur.ms.toFixed(3)} ms</span>` +
                    deltaHtml +
                    `</li>`;
        }
        list.innerHTML = html;
    }
    // Rank list is independent of rAF so it keeps updating even if spin is paused.
    const rankTimer = window.setInterval(refreshSpeedRank, 100);
    void rankTimer;
    /**
     * @param methodIndices which method slots were written into resolve buffer
     *   consecutively as pairs (solo: one pair at offset 0; grid: all methods).
     */
    function readTimestamps(dest, methodIndices) {
        if (mapPending)
            return;
        mapPending = true;
        // Capture swarm flags for this submit (async map may complete after clear)
        const discSwarmSample = swarmActive &&
            soloMethodIndex != null &&
            swarmInstances.length > 0;
        const meshSwarmSample = meshSwarmActive &&
            soloMethodIndex != null &&
            swarmInstances.length > 0;
        dest
            .mapAsync(GPUMapMode.READ)
            .then(() => {
            const arr = new BigUint64Array(dest.getMappedRange());
            for (let k = 0; k < methodIndices.length; k++) {
                const i = methodIndices[k];
                const t0 = arr[k * 2];
                const t1 = arr[k * 2 + 1];
                const ticks = t1 >= t0 ? t1 - t0 : t1 + (0xffffffffffffffffn - t0) + 1n;
                const passMs = (Number(ticks) * tsPeriod) / 1e6;
                // Swarm: report full pass (all 500). Single: amortize TIMED_DRAW_REPS.
                const multi = (discSwarmSample || meshSwarmSample) && soloMethodIndex === i;
                const div = multi ? 1 : TIMED_DRAW_REPS;
                const reportMs = passMs / div;
                applySample(i, reportMs, {
                    raw: passMs,
                    source: meshSwarmSample
                        ? "gpu-ts-mesh-swarm"
                        : discSwarmSample
                            ? "gpu-ts-swarm"
                            : "gpu-ts",
                });
            }
            dest.unmap();
            mapPending = false;
        })
            .catch((err) => {
            mapPending = false;
            console.warn("[sphere-surface] timestamp map failed", err);
            try {
                dest.unmap();
            }
            catch {
                /* */
            }
        });
    }
    let lastT = performance.now();
    let frame = 0;
    /** When true, rAF keeps ticking but skips GPU submits (probe/readback exclusive). */
    let renderPaused = false;
    let probeBusy = false;
    /**
     * Wall-clock serial measure owns the queue exclusively.
     * Must NOT start while GPU timestamps are active (even if mapPending).
     */
    let wallMeasureBusy = false;
    let wallMeasureKick = false;
    function frameLoop(now) {
        if (isLost) {
            setStatus("WebGPU device lost — reload", true);
            return;
        }
        requestAnimationFrame(frameLoop);
        frame++;
        const dt = Math.min(0.05, (now - lastT) / 1000);
        lastT = now;
        if (autoSpin && !dragging && !swarmActive && !meshSwarmActive) {
            // Shared auto-spin only when not swarming (swarm has per-instance spin)
            yaw += dt * 0.45;
        }
        if ((swarmActive || meshSwarmActive) &&
            swarmInstances.length > 0) {
            stepSwarmInstances(swarmInstances, dt);
        }
        // Probes / wall measure own the device queue — no interleaved swapchain submits.
        if (renderPaused || probeBusy || wallMeasureBusy) {
            return;
        }
        // Fixed 4K buffer for display grid (CSS scales the element for the monitor)
        configureRender4k();
        ensureDepth(RENDER_W, RENDER_H);
        ensureTimeTargets();
        // On-screen layout (untimed preview): grid or solo fullscreen
        const cols = METHOD_COUNT <= 6 ? 3 : METHOD_COUNT <= 9 ? 3 : 4;
        const rows = Math.ceil(METHOD_COUNT / cols);
        const tileW = Math.floor(RENDER_W / cols);
        const tileH = Math.floor(RENDER_H / rows);
        const solo = soloMethodIndex;
        if (grid) {
            const cards = grid.querySelectorAll(".method-card");
            cards.forEach((card, i) => {
                const el = card;
                if (solo != null) {
                    if (i === solo) {
                        el.style.left = "0";
                        el.style.top = "0";
                        el.style.width = "100%";
                        el.style.height = "100%";
                    }
                    // hidden cards keep last layout; not visible
                }
                else {
                    const c = i % cols;
                    const r = Math.floor(i / cols);
                    el.style.left = `${(c / cols) * 100}%`;
                    el.style.top = `${(r / rows) * 100}%`;
                    el.style.width = `${100 / cols}%`;
                    el.style.height = `${100 / rows}%`;
                }
            });
        }
        // Which methods get timed this frame (solo disables the rest)
        const timedMethods = solo != null
            ? [solo]
            : Array.from({ length: METHOD_COUNT }, (_, i) => i);
        mat4RotationY(rotY, yaw);
        mat4RotationX(rotX, pitch);
        mat4Multiply(model, rotY, rotX);
        const eyeX = 0;
        const eyeY = 0.15;
        const eyeZ = camDist;
        mat4LookAt(view, eyeX, eyeY, eyeZ, 0, 0, 0, 0, 1, 0);
        // Full 16:9 for timed 4K and for tiles (same aspect)
        const aspect = RENDER_W / RENDER_H;
        // Far plane must clear camDist (solo zoom can sit at CAM_DIST_MAX)
        mat4Perspective(proj, (42 * Math.PI) / 180, aspect, 0.05, 400);
        mat4Multiply(viewProj, proj, view);
        const { camRight, camUp } = billboardBasis(eyeX, eyeY, eyeZ);
        const sphereR = 1.0;
        for (let i = 0; i < METHOD_COUNT; i++) {
            writeUniforms(uniformCPU, (i * UNIFORM_STRIDE) / 4, viewProj, model, eyeX, eyeY, eyeZ, camRight, camUp, sphereR, i, activeHeightScale, activeProfile);
        }
        device.queue.writeBuffer(uniformBuf, 0, uniformCPU);
        // Solo disc/mesh swarm: pack 500 instance models for multi-draw
        if (solo != null &&
            (swarmActive || meshSwarmActive) &&
            swarmInstances.length > 0) {
            packSwarmUniforms(solo, viewProj, eyeX, eyeY, eyeZ, camRight, camUp);
        }
        // True GPU-TS path only. mapPending → display-only this frame (never wall-fallback).
        const wantGpuTs = hasTs && !!querySet && !tsDisabled;
        const canRecordTs = wantGpuTs && !mapPending;
        // Wall only when timestamps are intentionally off or permanently disabled.
        const wantWall = urlNoTs || !hasTs || tsDisabled;
        if (canRecordTs) {
            // --- TIMED: full 4K offscreen (solo = only that method; grid = all) ---
            const encoder = device.createCommandEncoder({ label: "sphere-time-4k" });
            for (let k = 0; k < timedMethods.length; k++) {
                const i = timedMethods[k];
                const pass = encoder.beginRenderPass({
                    label: `time-${SURFACE_METHODS[i].id}`,
                    colorAttachments: [
                        {
                            view: timeColorView,
                            loadOp: "clear",
                            storeOp: "store",
                            clearValue: { r: 0.02, g: 0.03, b: 0.07, a: 1 },
                        },
                    ],
                    depthStencilAttachment: {
                        view: timeDepthView,
                        depthLoadOp: "clear",
                        depthStoreOp: "store",
                        depthClearValue: 1,
                    },
                    timestampWrites: {
                        querySet: querySet,
                        // Pack consecutive pairs in the query set (0..2n) for easy resolve
                        beginningOfPassWriteIndex: k * 2,
                        endOfPassWriteIndex: k * 2 + 1,
                    },
                });
                encodeMethodDraw(pass, i);
                pass.end();
            }
            const dest = useReadA ? readA : readB;
            useReadA = !useReadA;
            const qCount = timedMethods.length * 2;
            encoder.resolveQuerySet(querySet, 0, qCount, resolveBuf, 0);
            encoder.copyBufferToBuffer(resolveBuf, 0, dest, 0, qCount * 8);
            // Display: solo full-screen or multi-tile grid (untimed)
            encodeDisplayTiles(encoder, cols, tileW, tileH, solo);
            device.queue.submit([encoder.finish()]);
            readTimestamps(dest, timedMethods);
        }
        else if (wantWall && !wallMeasureKick) {
            // --- Serial wall fence: exclusive queue, 1×1 readback, no concurrent display ---
            wallMeasureKick = true;
            wallMeasureBusy = true;
            const wallSolo = solo;
            const wallDiscSwarm = swarmActive && wallSolo != null && swarmInstances.length > 0;
            const wallMeshSwarm = meshSwarmActive && wallSolo != null && swarmInstances.length > 0;
            const wallSwarm = wallDiscSwarm || wallMeshSwarm;
            const wallMethods = wallSolo != null
                ? [wallSolo]
                : Array.from({ length: METHOD_COUNT }, (_, i) => i);
            void (async () => {
                try {
                    // Drain anything already in flight before exclusive measure.
                    const drain = device.queue.onSubmittedWorkDone?.();
                    if (drain)
                        await drain;
                    for (const i of wallMethods) {
                        if (isLost)
                            break;
                        const enc = device.createCommandEncoder({
                            label: `wall-${SURFACE_METHODS[i].id}`,
                        });
                        const pass = enc.beginRenderPass({
                            colorAttachments: [
                                {
                                    view: timeColorView,
                                    loadOp: "clear",
                                    storeOp: "store",
                                    clearValue: { r: 0.02, g: 0.03, b: 0.07, a: 1 },
                                },
                            ],
                            depthStencilAttachment: {
                                view: timeDepthView,
                                depthLoadOp: "clear",
                                depthStoreOp: "store",
                                depthClearValue: 1,
                            },
                        });
                        // encodeMethodDraw already expands to 500 draws when swarm is on
                        encodeMethodDraw(pass, i);
                        pass.end();
                        const t0 = performance.now();
                        device.queue.submit([enc.finish()]);
                        // Fence = copy center pixel + map. This cannot return 0.000 if GPU ran.
                        const totalMs = await fenceGpuMs(t0);
                        const div = wallSwarm && wallSolo === i ? 1 : TIMED_DRAW_REPS;
                        applySample(i, totalMs / div, {
                            raw: totalMs,
                            source: wallMeshSwarm
                                ? "wall-fence-mesh-swarm"
                                : wallDiscSwarm
                                    ? "wall-fence-swarm"
                                    : "wall-fence",
                        });
                    }
                    // One display refresh after exclusive measure (queue free again).
                    if (!isLost) {
                        const enc = device.createCommandEncoder({
                            label: "sphere-display-after-wall",
                        });
                        encodeDisplayTiles(enc, cols, tileW, tileH, wallSolo);
                        device.queue.submit([enc.finish()]);
                    }
                }
                catch (err) {
                    console.error("[sphere-surface] wall measure failed", err);
                }
                finally {
                    wallMeasureBusy = false;
                    // Pause before next exclusive cycle so the tile grid can animate via
                    // display-only frames (wallMeasureKick stays true until then).
                    window.setTimeout(() => {
                        wallMeasureKick = false;
                    }, 250);
                }
            })();
        }
        else if (wantGpuTs && mapPending) {
            // Timestamp map in flight — refresh display only, do not start wall.
            const encoder = device.createCommandEncoder({ label: "sphere-display" });
            encodeDisplayTiles(encoder, cols, tileW, tileH, solo);
            device.queue.submit([encoder.finish()]);
        }
        else if (wantWall && wallMeasureKick && !wallMeasureBusy) {
            // Between wall cycles: keep tiles alive without measuring.
            const encoder = device.createCommandEncoder({ label: "sphere-display" });
            encodeDisplayTiles(encoder, cols, tileW, tileH, solo);
            device.queue.submit([encoder.finish()]);
        }
        if (frame === 1) {
            setStatus(`Ready — ${METHOD_COUNT} methods · each timed at ${RENDER_W}×${RENDER_H}` +
                ` ×${TIMED_DRAW_REPS} draws · ` +
                (wantGpuTs ? "GPU timestamps" : "wall GPU fence") +
                " · drag to rotate");
        }
    }
    /**
     * Offscreen render + pixel readback (does not rely on canvas present).
     * Returns mean RGB in 0..1 over a small center crop for the given method.
     * Pauses swapchain rAF while the probe owns the device queue.
     */
    async function probeMethodLuma(methodIndex) {
        if (isLost) {
            throw new Error("WebGPU device lost — cannot probe");
        }
        // Serialize probes; pause concurrent frame/timestamp submits
        while (probeBusy) {
            await new Promise((r) => setTimeout(r, 8));
        }
        probeBusy = true;
        renderPaused = true;
        try {
            // Drain in-flight swapchain work before exclusive probe
            const drain = device.queue.onSubmittedWorkDone?.();
            if (drain)
                await drain;
            const W = 128;
            const H = 128;
            // Match main pipeline color format (usually bgra8unorm-srgb on Chromium)
            const colorTex = device.createTexture({
                size: { width: W, height: H },
                format,
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
                label: "probe-color",
            });
            const depthProbe = device.createTexture({
                size: { width: W, height: H },
                format: "depth24plus",
                usage: GPUTextureUsage.RENDER_ATTACHMENT,
                label: "probe-depth",
            });
            // Fixed face-on pose for stable center albedo
            const probeYaw = 0.35;
            const probePitch = 0.12;
            mat4RotationY(rotY, probeYaw);
            mat4RotationX(rotX, probePitch);
            mat4Multiply(model, rotY, rotX);
            const eyeX = 0;
            const eyeY = 0.15;
            const eyeZ = camDist;
            mat4LookAt(view, eyeX, eyeY, eyeZ, 0, 0, 0, 0, 1, 0);
            mat4Perspective(proj, (42 * Math.PI) / 180, 1, 0.1, 20);
            mat4Multiply(viewProj, proj, view);
            // Same basis as live frameLoop (must face camera)
            const { camRight, camUp } = billboardBasis(eyeX, eyeY, eyeZ);
            const probeCPU = new Float32Array(UNIFORM_SIZE / 4);
            writeUniforms(probeCPU, 0, viewProj, model, eyeX, eyeY, eyeZ, camRight, camUp, 1.0, methodIndex, activeHeightScale, activeProfile);
            device.queue.writeBuffer(uniformBuf, methodIndex * UNIFORM_STRIDE, probeCPU);
            const enc = device.createCommandEncoder({ label: "probe-enc" });
            const pass = enc.beginRenderPass({
                colorAttachments: [
                    {
                        view: colorTex.createView(),
                        loadOp: "clear",
                        storeOp: "store",
                        clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    },
                ],
                depthStencilAttachment: {
                    view: depthProbe.createView(),
                    depthLoadOp: "clear",
                    depthStoreOp: "store",
                    depthClearValue: 1,
                },
            });
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroups[methodIndex]);
            pass.setViewport(0, 0, W, H, 0, 1);
            pass.setScissorRect(0, 0, W, H);
            pass.draw(6);
            pass.end();
            const bytesPerRow = Math.ceil((W * 4) / 256) * 256;
            const staging = device.createBuffer({
                size: bytesPerRow * H,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });
            enc.copyTextureToBuffer({ texture: colorTex }, { buffer: staging, bytesPerRow }, { width: W, height: H });
            device.queue.submit([enc.finish()]);
            const done = device.queue.onSubmittedWorkDone?.();
            if (done)
                await done;
            await staging.mapAsync(GPUMapMode.READ);
            const copy = new Uint8Array(staging.getMappedRange().slice(0));
            staging.unmap();
            staging.destroy();
            colorTex.destroy();
            depthProbe.destroy();
            // Center crop 32×32 — disc interior (not rim / clear)
            // bgra8unorm: bytes are B,G,R,A — remap for mean RGB labels
            const isBgra = format.startsWith("bgra");
            const x0 = (W - 32) >> 1;
            const y0 = (H - 32) >> 1;
            let sr = 0;
            let sg = 0;
            let sb = 0;
            let sa = 0;
            let n = 0;
            let nonBlack = 0;
            let opaque = 0;
            for (let y = y0; y < y0 + 32; y++) {
                for (let x = x0; x < x0 + 32; x++) {
                    const o = y * bytesPerRow + x * 4;
                    const b0 = copy[o] / 255;
                    const g0 = copy[o + 1] / 255;
                    const r0 = copy[o + 2] / 255;
                    const a0 = copy[o + 3] / 255;
                    const r = isBgra ? r0 : b0;
                    const g = g0;
                    const b = isBgra ? b0 : r0;
                    const a = a0;
                    sr += r;
                    sg += g;
                    sb += b;
                    sa += a;
                    n++;
                    if (r + g + b > 0.05)
                        nonBlack++;
                    if (a > 0.95)
                        opaque++;
                }
            }
            const meanR = sr / n;
            const meanG = sg / n;
            const meanB = sb / n;
            return {
                meanR,
                meanG,
                meanB,
                meanLuma: 0.2126 * meanR + 0.7152 * meanG + 0.0722 * meanB,
                nonBlackFrac: nonBlack / n,
                meanA: sa / n,
                opaqueFrac: opaque / n,
            };
        }
        finally {
            probeBusy = false;
            renderPaused = false;
        }
    }
    // Expose for tests / debug
    window.__sphereSurfaceDemo = {
        methods: SURFACE_METHODS.map((m) => m.id),
        getYaw: () => yaw,
        getPitch: () => pitch,
        setRotation: (y, p) => {
            yaw = y;
            pitch = p;
            autoSpin = false;
        },
        setRenderPaused: (v) => {
            renderPaused = !!v;
        },
        getTimings: () => timers.map((t, i) => ({
            id: SURFACE_METHODS[i].id,
            ms: t.ema,
        })),
        /** Fastest→slowest with delta vs previous (for tests / HUD). */
        getSpeedRank: () => {
            const rows = timers
                .map((t, i) => ({
                id: SURFACE_METHODS[i].id,
                short: SURFACE_METHODS[i].short,
                ms: t.ema,
            }))
                .filter((r) => r.ms > 0 && Number.isFinite(r.ms))
                .sort((a, b) => a.ms - b.ms);
            return rows.map((r, i) => ({
                ...r,
                rank: i + 1,
                deltaMs: i === 0 ? 0 : r.ms - rows[i - 1].ms,
            }));
        },
        maps,
        probeMethodLuma,
        ready: true,
    };
    // First paint of rank once samples exist
    refreshSpeedRank();
    setStatus("WebGPU ready — uploading…");
    requestAnimationFrame(frameLoop);
}
main().catch((err) => {
    console.error(err);
    setStatus(err instanceof Error ? err.message : String(err), true);
});
//# sourceMappingURL=main.js.map