/**
 * WebGPU solar-system showcase — designed sun + quad-impostor planets.
 *
 * Entry: solar-system.html → dist/gpu/solar-system/main.js
 *
 * Planets: equirect multi-map Earth (albedo/normal/spec/night/clouds) for ocean
 * worlds, moon map for rocky, procedural gas/ice; reduced multi-sample atmosphere
 * on sized discs (not full-window). Sun: procedural impostor.
 */
import { createWebGpuBootstrap } from "../device.js";
import { assertWebGpuAvailable } from "../preferred-backend.js";
import { mat4LookAt, mat4Perspective, mat4ViewProj, mat4CameraRight, mat4CameraUp, } from "../math/mat4.js";
import { SHOWCASE_BODIES, bodyKindId, clampSelection, clampZoom, evaluateBodyPoses, zoomBoundsForBody, } from "./solar-bodies.js";
import { createSolarOrbitState, solarOrbitApplyDrag, solarOrbitApplyZoom, solarOrbitEye, solarOrbitSetFocus, } from "./solar-camera.js";
import { pickBodyFromScreen } from "./solar-pick.js";
import { PLANET_BODY_UNIFORM_SIZE, PLANET_DISC_WGSL, PLANET_FRAME_UNIFORM_SIZE, } from "./planet-disc.wgsl.js";
import { SUN_BODY_UNIFORM_SIZE, SUN_IMPOSTOR_WGSL, } from "./sun-impostor.wgsl.js";
import { loadPlanetTexturePack } from "./planet-textures.js";
import { ATM_PARAM_UI, PLANET_ATM_DEFAULTS, allBodyAtmFromQuery, allBodyAtmToQuery, atmParamBounds, clampAtmParams, cloneAtmParams, defaultAtmForBodyId, formatAllBodyAtmParams, formatAtmParams, parseAllBodyAtmParams, parseAtmParams, } from "./planet-atm-params.js";
import { SUN_LOOK_DEFAULTS, SUN_LOOK_PARAM_UI, clampSunLookParams, cloneSunLookParams, formatSunLookParams, parseSunLookParams, sunEffectiveDrawMargin, sunLookParamBounds, } from "./sun-look-params.js";
import { DEFAULT_SUN_TYPE_ID, SUN_TYPE_PRESETS, isSunTypeId, resolveSunType, } from "./sun-types.js";
import { createGpuFrameTimer } from "./gpu-frame-timer.js";
import { applyVerticalScrub, decimalsFromStep, } from "../thruster-texture/number-scrub.js";
const canvas = document.getElementById("canvas");
const statusEl = document.getElementById("status");
const hudFocus = document.getElementById("hud-focus");
const hudFps = document.getElementById("hud-fps");
const hudFrameMs = document.getElementById("hud-frame-ms");
const hudBodies = document.getElementById("hud-bodies");
const bodyList = document.getElementById("body-list");
const sunTypeButtons = document.getElementById("sun-type-buttons");
const sunTypeHint = document.getElementById("sun-type-hint");
const titleMain = document.getElementById("title-main");
const titleSub = document.getElementById("title-sub");
const atmPanel = document.getElementById("atm-controls");
const atmExport = document.getElementById("atm-export");
const atmImport = document.getElementById("atm-import");
function setStatus(msg, error = false) {
    statusEl.textContent = msg;
    statusEl.classList.toggle("error", error);
}
/** Simple additive orbit ring line (XZ circle). */
function buildOrbitRing(radius, segments = 128) {
    const out = new Float32Array(segments * 2 * 3);
    for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2;
        const a1 = ((i + 1) / segments) * Math.PI * 2;
        const o = i * 6;
        out[o] = Math.cos(a0) * radius;
        out[o + 1] = 0;
        out[o + 2] = Math.sin(a0) * radius;
        out[o + 3] = Math.cos(a1) * radius;
        out[o + 4] = 0;
        out[o + 5] = Math.sin(a1) * radius;
    }
    return out;
}
const RING_WGSL = /* wgsl */ `
struct U {
  viewProj : mat4x4<f32>,
  color : vec4<f32>,
};
@group(0) @binding(0) var<uniform> u : U;
@vertex
fn vs_main(@location(0) pos : vec3<f32>) -> @builtin(position) vec4<f32> {
  return u.viewProj * vec4<f32>(pos, 1.0);
}
@fragment
fn fs_main() -> @location(0) vec4<f32> {
  return u.color;
}
`;
async function main() {
    try {
        assertWebGpuAvailable();
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus(msg, true);
        throw e;
    }
    const boot = await createWebGpuBootstrap({
        canvas,
        label: "solar-system-showcase",
        clearColor: { r: 0.01, g: 0.012, b: 0.04, a: 1 },
        onDeviceLost: (info) => {
            console.error("[solar-system] device lost", info);
            setStatus(`Device lost (${info.reason}): ${info.message}`, true);
        },
    });
    const { device, context, format } = boot;
    setStatus("Loading planet maps…");
    const maps = await loadPlanetTexturePack(device);
    // --- Pipelines (layout:"auto" matches other gpu/* demos; minimal typings) ---
    const planetMod = device.createShaderModule({
        label: "planet-disc",
        code: PLANET_DISC_WGSL,
    });
    const sunMod = device.createShaderModule({
        label: "sun-impostor",
        code: SUN_IMPOSTOR_WGSL,
    });
    const ringMod = device.createShaderModule({
        label: "orbit-ring",
        code: RING_WGSL,
    });
    const blendAlpha = {
        color: {
            srcFactor: "src-alpha",
            dstFactor: "one-minus-src-alpha",
            operation: "add",
        },
        alpha: {
            srcFactor: "one",
            dstFactor: "one-minus-src-alpha",
            operation: "add",
        },
    };
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
    // Premultiplied: surface rgb is already * surfaceMask; atmosphere is pure
    // additive light (alpha=0 outside disc) so the limb glows over the sun
    // instead of darkening it with a (1-α) halo.
    const planetPipe = device.createRenderPipeline({
        label: "planet-disc-pipe",
        layout: "auto",
        vertex: { module: planetMod, entryPoint: "vs_main" },
        fragment: {
            module: planetMod,
            entryPoint: "fs_main",
            targets: [{ format, blend: blendPremul }],
        },
        primitive: { topology: "triangle-list" },
    });
    const sunPipe = device.createRenderPipeline({
        label: "sun-impostor-pipe",
        layout: "auto",
        vertex: { module: sunMod, entryPoint: "vs_main" },
        fragment: {
            module: sunMod,
            entryPoint: "fs_main",
            targets: [{ format, blend: blendPremul }],
        },
        primitive: { topology: "triangle-list" },
    });
    const ringPipe = device.createRenderPipeline({
        label: "orbit-ring-pipe",
        layout: "auto",
        vertex: {
            module: ringMod,
            entryPoint: "vs_main",
            buffers: [
                {
                    arrayStride: 12,
                    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
                },
            ],
        },
        fragment: {
            module: ringMod,
            entryPoint: "fs_main",
            targets: [{ format, blend: blendAlpha }],
        },
        primitive: { topology: "line-list" },
    });
    // --- Buffers ---
    const frameU = new Float32Array(PLANET_FRAME_UNIFORM_SIZE / 4);
    const frameBuf = device.createBuffer({
        size: PLANET_FRAME_UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Selection must exist before look UI (activeAtm / wireLookUi read it).
    let selected = 0; // sun
    // Per-body look params (left panel follows right-hand selection).
    // Azure uses its tuned preset so paste body=azure configs still match.
    const bodyAtmParams = SHOWCASE_BODIES.map((b) => defaultAtmForBodyId(b.id));
    let sunLook = cloneSunLookParams(SUN_LOOK_DEFAULTS);
    let sunTypeId = DEFAULT_SUN_TYPE_ID;
    let sunResolved = resolveSunType(DEFAULT_SUN_TYPE_ID);
    {
        const fromUrl = allBodyAtmFromQuery(typeof location !== "undefined" ? location.search : "", SHOWCASE_BODIES, PLANET_ATM_DEFAULTS, defaultAtmForBodyId);
        if (fromUrl) {
            for (let i = 0; i < bodyAtmParams.length; i++) {
                // Always take resolved slot (presets used when URL lacks that body id)
                if (fromUrl.params[i])
                    bodyAtmParams[i] = fromUrl.params[i];
            }
            if (fromUrl.selectedId) {
                const idx = SHOWCASE_BODIES.findIndex((b) => b.id === fromUrl.selectedId);
                if (idx >= 0)
                    selected = idx;
            }
        }
        // Optional sun= look + sunType= id
        if (typeof location !== "undefined") {
            try {
                const sp = new URLSearchParams(location.search);
                const typeRaw = sp.get("sunType");
                if (typeRaw && isSunTypeId(typeRaw)) {
                    sunTypeId = typeRaw;
                    sunResolved = resolveSunType(typeRaw);
                    sunLook = cloneSunLookParams(sunResolved.look);
                }
                const raw = sp.get("sun");
                if (raw) {
                    sunLook = parseSunLookParams(decodeURIComponent(raw).includes("=")
                        ? decodeURIComponent(raw)
                        : Object.entries(JSON.parse(decodeURIComponent(raw)))
                            .map(([k, v]) => `${k}=${v}`)
                            .join("\n"), sunLook);
                }
            }
            catch {
                /* ignore bad sun query */
            }
        }
    }
    let atmUrlTimer = 0;
    /** Last panel mode so we rebuild scrub rows when switching sun ↔ planet. */
    let lookUiMode = null;
    function activeAtm() {
        return bodyAtmParams[selected] ?? cloneAtmParams(PLANET_ATM_DEFAULTS);
    }
    function atmForBody(bodyIndex) {
        return bodyAtmParams[bodyIndex] ?? cloneAtmParams(PLANET_ATM_DEFAULTS);
    }
    function isSunSelected() {
        return SHOWCASE_BODIES[selected]?.kind === "sun";
    }
    function pushAtmUrl() {
        if (typeof history === "undefined" || typeof location === "undefined")
            return;
        const q = allBodyAtmToQuery(SHOWCASE_BODIES, bodyAtmParams, SHOWCASE_BODIES[selected]?.id ?? "sol");
        // Append compact sun look (key=val) + sun type for round-trip
        const sunQ = encodeURIComponent(Object.keys(SUN_LOOK_DEFAULTS)
            .map((k) => `${k}=${sunLook[k]}`)
            .join("&"));
        const next = `${location.pathname}?${q}&sunType=${encodeURIComponent(sunTypeId)}&sun=${sunQ}${location.hash ?? ""}`;
        const cur = `${location.pathname}${location.search}${location.hash ?? ""}`;
        if (next !== cur)
            history.replaceState(null, "", next);
    }
    function highlightSunTypeButtons() {
        if (!sunTypeButtons)
            return;
        sunTypeButtons.querySelectorAll("button").forEach((btn) => {
            const id = btn.getAttribute("data-sun-type");
            btn.classList.toggle("active", id === sunTypeId);
        });
    }
    function applySunType(id, pushUrl = true) {
        if (!isSunTypeId(id))
            return;
        sunTypeId = id;
        sunResolved = resolveSunType(id);
        sunLook = cloneSunLookParams(sunResolved.look);
        highlightSunTypeButtons();
        if (sunTypeHint) {
            const p = SUN_TYPE_PRESETS.find((x) => x.id === id);
            sunTypeHint.textContent = p
                ? `${p.label} — ${p.subtitle}. Radius ×${p.radiusScale.toFixed(2)}, planet light ×${p.planetLightMul.toFixed(2)}.`
                : "";
        }
        if (titleMain)
            titleMain.textContent = `${sunResolved.label} · WebGPU`;
        if (titleSub) {
            const p = SUN_TYPE_PRESETS.find((x) => x.id === id);
            titleSub.textContent = p?.subtitle ?? "Impostor discs · designed sun";
        }
        // Rebuild sun scrub UI if visible
        lookUiMode = null;
        wireLookUi();
        if (pushUrl)
            scheduleAtmUrl();
    }
    function scheduleAtmUrl() {
        if (atmUrlTimer)
            return;
        atmUrlTimer = window.setTimeout(() => {
            atmUrlTimer = 0;
            pushAtmUrl();
        }, 120);
    }
    function refreshAtmExport() {
        if (!atmExport)
            return;
        if (isSunSelected()) {
            atmExport.value = formatSunLookParams(sunLook);
        }
        else {
            atmExport.value = formatAllBodyAtmParams(SHOWCASE_BODIES, bodyAtmParams, SHOWCASE_BODIES[selected]?.id);
        }
    }
    function syncLookInputsFromSelection() {
        const label = document.getElementById("atm-body-label");
        if (label) {
            const b = SHOWCASE_BODIES[selected];
            label.textContent = b
                ? `${selected}: ${b.name} (${b.kind})`
                : "—";
        }
        if (isSunSelected()) {
            for (const { key } of SUN_LOOK_PARAM_UI) {
                const el = document.getElementById(`sun-${key}`);
                if (el) {
                    const dec = decimalsFromStep(sunLookParamBounds(key).step);
                    const v = sunLook[key];
                    el.value = dec > 0 ? v.toFixed(dec) : String(v);
                }
            }
        }
        else {
            const p = activeAtm();
            for (const { key } of ATM_PARAM_UI) {
                const el = document.getElementById(`atm-${key}`);
                if (el) {
                    const dec = decimalsFromStep(atmParamBounds(key).step);
                    const v = p[key];
                    el.value = dec > 0 ? v.toFixed(dec) : String(v);
                }
            }
        }
        refreshAtmExport();
    }
    function setActiveAtmParams(next, syncInputs = true) {
        bodyAtmParams[selected] = clampAtmParams(next);
        if (syncInputs)
            syncLookInputsFromSelection();
        else
            refreshAtmExport();
        scheduleAtmUrl();
    }
    function setSunLook(next, syncInputs = true) {
        sunLook = clampSunLookParams(next);
        if (syncInputs)
            syncLookInputsFromSelection();
        else
            refreshAtmExport();
        scheduleAtmUrl();
    }
    function wireScrub(input, bounds, defaultVal, onScrub) {
        input.min = String(bounds.min);
        input.max = String(bounds.max);
        input.step = String(bounds.step);
        input.classList.add("atm-scrub");
        input.title =
            "Drag up/down to scrub · Shift=fine · Alt=coarse · type to edit";
        let scrubbing = false;
        let startY = 0;
        let startVal = 0;
        input.addEventListener("pointerdown", (e) => {
            if (e.button !== 0)
                return;
            scrubbing = true;
            startY = e.clientY;
            startVal = Number(input.value);
            if (!Number.isFinite(startVal))
                startVal = defaultVal;
            input.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        input.addEventListener("pointermove", (e) => {
            if (!scrubbing)
                return;
            const sens = e.shiftKey ? 0.1 : e.altKey ? 10 : 1;
            const v = applyVerticalScrub(startVal, e.clientY - startY, bounds, 4, sens);
            input.value = String(v);
            onScrub(v);
        });
        const endScrub = (e) => {
            if (!scrubbing)
                return;
            scrubbing = false;
            try {
                input.releasePointerCapture(e.pointerId);
            }
            catch {
                /* ignore */
            }
        };
        input.addEventListener("pointerup", endScrub);
        input.addEventListener("pointercancel", endScrub);
    }
    function wireLookUi() {
        if (!atmPanel)
            return;
        const mode = isSunSelected() ? "sun" : "planet";
        if (mode === lookUiMode && atmPanel.childElementCount > 0) {
            syncLookInputsFromSelection();
            return;
        }
        lookUiMode = mode;
        atmPanel.innerHTML = "";
        const head = document.createElement("div");
        head.className = "atm-editing";
        head.innerHTML = `Editing: <strong id="atm-body-label">—</strong>`;
        atmPanel.appendChild(head);
        if (mode === "sun") {
            const groups = {};
            for (const g of ["disc", "rim", "rays", "corona", "shell"]) {
                const fs = document.createElement("fieldset");
                const leg = document.createElement("legend");
                leg.textContent =
                    g === "disc"
                        ? "Disc / core"
                        : g === "rim"
                            ? "Chromosphere / sheath"
                            : g === "rays"
                                ? "Rays / streamers"
                                : g === "corona"
                                    ? "Outer corona"
                                    : "Shell / margin";
                fs.appendChild(leg);
                atmPanel.appendChild(fs);
                groups[g] = fs;
            }
            for (const meta of SUN_LOOK_PARAM_UI) {
                const row = document.createElement("label");
                row.className = "atm-row";
                const span = document.createElement("span");
                span.textContent = meta.label;
                const input = document.createElement("input");
                input.type = "number";
                input.id = `sun-${meta.key}`;
                input.step = String(meta.step);
                input.addEventListener("change", () => {
                    const v = Number(input.value);
                    if (!Number.isFinite(v))
                        return;
                    setSunLook({ ...sunLook, [meta.key]: v }, false);
                });
                wireScrub(input, sunLookParamBounds(meta.key), SUN_LOOK_DEFAULTS[meta.key], (v) => setSunLook({ ...sunLook, [meta.key]: v }, false));
                row.appendChild(span);
                row.appendChild(input);
                groups[meta.group].appendChild(row);
            }
            const actions = document.createElement("div");
            actions.className = "atm-actions";
            const copyBtn = document.createElement("button");
            copyBtn.type = "button";
            copyBtn.textContent = "Copy sun look";
            copyBtn.addEventListener("click", async () => {
                refreshAtmExport();
                const text = atmExport?.value ?? formatSunLookParams(sunLook);
                try {
                    await navigator.clipboard.writeText(text);
                    setStatus("Sun look copied — paste to chat");
                }
                catch {
                    setStatus("Copy failed — select the export box manually", true);
                }
            });
            const applyBtn = document.createElement("button");
            applyBtn.type = "button";
            applyBtn.textContent = "Apply paste";
            applyBtn.addEventListener("click", () => {
                const src = atmImport?.value || atmExport?.value || "";
                setSunLook(parseSunLookParams(src, sunLook), true);
                setStatus("Applied sun look settings");
            });
            const resetBtn = document.createElement("button");
            resetBtn.type = "button";
            resetBtn.textContent = "Reset sun";
            resetBtn.addEventListener("click", () => {
                setSunLook(cloneSunLookParams(SUN_LOOK_DEFAULTS), true);
                setStatus("Sun look reset to defaults");
            });
            actions.appendChild(copyBtn);
            actions.appendChild(applyBtn);
            actions.appendChild(resetBtn);
            atmPanel.appendChild(actions);
        }
        else {
            const groups = {};
            for (const g of ["limb", "surface", "scatter", "color"]) {
                const fs = document.createElement("fieldset");
                const leg = document.createElement("legend");
                leg.textContent =
                    g === "limb"
                        ? "Planet / limb"
                        : g === "surface"
                            ? "Surface / texture"
                            : g === "scatter"
                                ? "Scatter atmosphere"
                                : "Atm color";
                fs.appendChild(leg);
                atmPanel.appendChild(fs);
                groups[g] = fs;
            }
            for (const meta of ATM_PARAM_UI) {
                const row = document.createElement("label");
                row.className = "atm-row";
                const span = document.createElement("span");
                span.textContent = meta.label;
                const input = document.createElement("input");
                input.type = "number";
                input.id = `atm-${meta.key}`;
                input.step = String(meta.step);
                input.addEventListener("change", () => {
                    const v = Number(input.value);
                    if (!Number.isFinite(v))
                        return;
                    setActiveAtmParams({ ...activeAtm(), [meta.key]: v }, false);
                });
                wireScrub(input, atmParamBounds(meta.key), PLANET_ATM_DEFAULTS[meta.key], (v) => setActiveAtmParams({ ...activeAtm(), [meta.key]: v }, false));
                row.appendChild(span);
                row.appendChild(input);
                groups[meta.group].appendChild(row);
            }
            const actions = document.createElement("div");
            actions.className = "atm-actions";
            const copyBtn = document.createElement("button");
            copyBtn.type = "button";
            copyBtn.textContent = "Copy all bodies";
            copyBtn.addEventListener("click", async () => {
                refreshAtmExport();
                const text = atmExport?.value ?? "";
                try {
                    await navigator.clipboard.writeText(text);
                    setStatus("All body settings copied — paste to chat");
                }
                catch {
                    setStatus("Copy failed — select the export box manually", true);
                }
            });
            const copyOneBtn = document.createElement("button");
            copyOneBtn.type = "button";
            copyOneBtn.textContent = "Copy this body";
            copyOneBtn.addEventListener("click", async () => {
                const b = SHOWCASE_BODIES[selected];
                const text = formatAtmParams(activeAtm(), {
                    bodyId: b.id,
                    bodyName: b.name,
                });
                if (atmExport)
                    atmExport.value = text;
                try {
                    await navigator.clipboard.writeText(text);
                    setStatus(`Settings for ${b.name} copied`);
                }
                catch {
                    setStatus("Copy failed — select the export box manually", true);
                }
            });
            const applyBtn = document.createElement("button");
            applyBtn.type = "button";
            applyBtn.textContent = "Apply paste";
            applyBtn.addEventListener("click", () => {
                const src = atmImport?.value || atmExport?.value || "";
                const parsed = parseAllBodyAtmParams(src, PLANET_ATM_DEFAULTS);
                if (parsed.byId.size > 0) {
                    for (let i = 0; i < SHOWCASE_BODIES.length; i++) {
                        const id = SHOWCASE_BODIES[i].id;
                        const p = parsed.byId.get(id);
                        if (p)
                            bodyAtmParams[i] = p;
                    }
                    if (parsed.selectedId) {
                        const idx = SHOWCASE_BODIES.findIndex((b) => b.id === parsed.selectedId);
                        if (idx >= 0) {
                            selected = idx;
                            focusSelected(false);
                        }
                    }
                    wireLookUi();
                    scheduleAtmUrl();
                    setStatus("Applied multi-body atmosphere settings");
                }
                else if (parsed.single) {
                    setActiveAtmParams(parsed.single, true);
                    setStatus(`Applied settings to ${SHOWCASE_BODIES[selected]?.name ?? "selection"}`);
                }
                else {
                    setActiveAtmParams(parseAtmParams(src, activeAtm()), true);
                    setStatus("Applied pasted settings to current body");
                }
            });
            const resetBtn = document.createElement("button");
            resetBtn.type = "button";
            resetBtn.textContent = "Reset this body";
            resetBtn.addEventListener("click", () => {
                const id = SHOWCASE_BODIES[selected]?.id ?? "";
                setActiveAtmParams(defaultAtmForBodyId(id), true);
                setStatus(`Reset ${SHOWCASE_BODIES[selected]?.name ?? "body"} to defaults`);
            });
            const resetAllBtn = document.createElement("button");
            resetAllBtn.type = "button";
            resetAllBtn.textContent = "Reset all planets";
            resetAllBtn.addEventListener("click", () => {
                for (let i = 0; i < bodyAtmParams.length; i++) {
                    const id = SHOWCASE_BODIES[i]?.id ?? "";
                    bodyAtmParams[i] = defaultAtmForBodyId(id);
                }
                syncLookInputsFromSelection();
                scheduleAtmUrl();
                setStatus("All planet looks reset (Azure keeps tuned preset)");
            });
            actions.appendChild(copyOneBtn);
            actions.appendChild(copyBtn);
            actions.appendChild(applyBtn);
            actions.appendChild(resetBtn);
            actions.appendChild(resetAllBtn);
            atmPanel.appendChild(actions);
        }
        syncLookInputsFromSelection();
    }
    wireLookUi();
    const mapEntries = [
        { binding: 2, resource: maps.sampler },
        { binding: 3, resource: maps.albedo.createView() },
        { binding: 4, resource: maps.normal.createView() },
        { binding: 5, resource: maps.spec.createView() },
        { binding: 6, resource: maps.night.createView() },
        { binding: 7, resource: maps.cloud.createView() },
        { binding: 8, resource: maps.moon.createView() },
    ];
    // One body uniform buffer + bind group per planet (queue-safe; tiny N).
    const planetSlots = [];
    for (let bi = 0; bi < SHOWCASE_BODIES.length; bi++) {
        const b = SHOWCASE_BODIES[bi];
        if (b.kind === "sun")
            continue;
        const buf = device.createBuffer({
            size: PLANET_BODY_UNIFORM_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const cpu = new Float32Array(PLANET_BODY_UNIFORM_SIZE / 4);
        const bg = device.createBindGroup({
            layout: planetPipe.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: frameBuf } },
                { binding: 1, resource: { buffer: buf } },
                ...mapEntries,
            ],
        });
        planetSlots.push({ buf, cpu, bg, bodyIndex: bi });
    }
    const sunBodyBuf = device.createBuffer({
        size: SUN_BODY_UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const sunBodyCpu = new Float32Array(SUN_BODY_UNIFORM_SIZE / 4);
    // Orbit rings for each planet
    const ringBufs = [];
    const ringCounts = [];
    for (const b of SHOWCASE_BODIES) {
        if (b.kind === "sun")
            continue;
        const v = buildOrbitRing(b.orbitRadius, 160);
        const buf = device.createBuffer({
            size: v.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(buf, 0, v);
        ringBufs.push(buf);
        ringCounts.push(v.length / 3);
    }
    const ringU = new Float32Array(20); // mat4 + color
    const ringUBuf = device.createBuffer({
        size: 80,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const sunBg = device.createBindGroup({
        layout: sunPipe.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: frameBuf } },
            { binding: 1, resource: { buffer: sunBodyBuf } },
        ],
    });
    const ringBg = device.createBindGroup({
        layout: ringPipe.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: ringUBuf } }],
    });
    // --- Camera / selection (selected declared earlier for atm UI) ---
    let orbit = createSolarOrbitState({
        yaw: 0.85,
        pitch: 0.38,
        radius: 42,
    });
    const poses = [];
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let simTime = 0;
    let lastTs = 0;
    let fpsEma = 60;
    let frames = 0;
    let fpsWindowStart = 0;
    /** When set, rAF loop yields to deterministic capture (no wall-clock drive). */
    let captureActive = false;
    /** EMA of actual GPU render work (timestamps or submit→done), not rAF idle. */
    let frameMsEma = 0;
    let gpuSampleCount = 0;
    const recentGpuSamples = [];
    const gpuTimer = createGpuFrameTimer(device);
    const noteGpuSample = (ms) => {
        frameMsEma = frameMsEma > 0 ? frameMsEma * 0.85 + ms * 0.15 : ms;
        gpuSampleCount++;
        recentGpuSamples.push(ms);
        if (recentGpuSamples.length > 64)
            recentGpuSamples.shift();
        if (hudFrameMs)
            hudFrameMs.textContent = frameMsEma.toFixed(2);
    };
    // Sun-type control strip (do not re-apply look — URL may have layered sun= knobs)
    if (sunTypeButtons) {
        sunTypeButtons.innerHTML = "";
        for (const p of SUN_TYPE_PRESETS) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = p.label;
            btn.setAttribute("data-sun-type", p.id);
            btn.title = p.subtitle;
            btn.addEventListener("click", () => applySunType(p.id, true));
            sunTypeButtons.appendChild(btn);
        }
        highlightSunTypeButtons();
        const p0 = SUN_TYPE_PRESETS.find((x) => x.id === sunTypeId);
        if (sunTypeHint && p0) {
            sunTypeHint.textContent = `${p0.label} — ${p0.subtitle}. Radius ×${p0.radiusScale.toFixed(2)}, planet light ×${p0.planetLightMul.toFixed(2)}.`;
        }
        if (titleMain)
            titleMain.textContent = `${sunResolved.label} · WebGPU`;
        if (titleSub && p0)
            titleSub.textContent = p0.subtitle;
    }
    function resize() {
        boot.configureContext(window.innerWidth, window.innerHeight);
    }
    window.addEventListener("resize", resize);
    resize();
    function focusSelected(preserveRadius = false) {
        const p = poses[selected];
        if (!p)
            return;
        const bodyR = p.def.kind === "sun" ? sunResolved.radius : p.def.radius;
        const bounds = zoomBoundsForBody(bodyR);
        const r = preserveRadius
            ? clampZoom(orbit.radius, bounds.min, bounds.max)
            : clampZoom(bodyR * 6.5, bounds.min, bounds.max);
        orbit = solarOrbitSetFocus(orbit, p.x, p.y, p.z, r);
        hudFocus.textContent =
            p.def.kind === "sun" ? sunResolved.label : p.def.name;
        highlightBodyList();
        // Rebuild scrub panel when switching sun ↔ planet layers
        wireLookUi();
    }
    function highlightBodyList() {
        const buttons = bodyList.querySelectorAll("button");
        buttons.forEach((btn, i) => {
            btn.classList.toggle("active", i === selected);
        });
    }
    // Build selection list HUD
    bodyList.innerHTML = "";
    SHOWCASE_BODIES.forEach((b, i) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = `${i}: ${b.name}`;
        btn.addEventListener("click", () => {
            selected = clampSelection(i, SHOWCASE_BODIES.length);
            focusSelected(false);
        });
        bodyList.appendChild(btn);
    });
    hudBodies.textContent = String(SHOWCASE_BODIES.length);
    canvas.addEventListener("pointerdown", (e) => {
        if (e.button !== 0)
            return;
        canvas.setPointerCapture(e.pointerId);
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
    });
    canvas.addEventListener("pointermove", (e) => {
        if (!dragging)
            return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        orbit = solarOrbitApplyDrag(orbit, dx, dy);
    });
    canvas.addEventListener("pointerup", (e) => {
        dragging = false;
        try {
            canvas.releasePointerCapture(e.pointerId);
        }
        catch {
            /* ignore */
        }
    });
    canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        const p = poses[selected];
        if (!p)
            return;
        const bounds = zoomBoundsForBody(p.def.radius);
        orbit = solarOrbitApplyZoom(orbit, e.deltaY, bounds.min, bounds.max);
    }, { passive: false });
    canvas.addEventListener("dblclick", (e) => {
        // Pick body under cursor (mat4Invert + rayFromNdc — same path as model-viewer)
        const rect = canvas.getBoundingClientRect();
        const cssW = rect.width || 1;
        const cssH = rect.height || 1;
        const eye = solarOrbitEye(orbit);
        const hit = pickBodyFromScreen(e.clientX - rect.left, e.clientY - rect.top, cssW, cssH, eye.eyeX, eye.eyeY, eye.eyeZ, eye.targetX, eye.targetY, eye.targetZ, poses);
        if (hit != null) {
            selected = hit;
            focusSelected(false);
        }
    });
    window.addEventListener("keydown", (e) => {
        if (e.key >= "0" && e.key <= "9") {
            const i = Number(e.key);
            if (i < SHOWCASE_BODIES.length) {
                selected = i;
                focusSelected(false);
            }
        }
        if (e.key === "[" || e.key === "ArrowLeft") {
            selected = clampSelection(selected - 1, SHOWCASE_BODIES.length);
            focusSelected(false);
        }
        if (e.key === "]" || e.key === "ArrowRight") {
            selected = clampSelection(selected + 1, SHOWCASE_BODIES.length);
            focusSelected(false);
        }
    });
    // Prime poses + focus
    evaluateBodyPoses(SHOWCASE_BODIES, 0, poses);
    focusSelected(false);
    setStatus(`WebGPU solar system — 1 sun + ${SHOWCASE_BODIES.filter((b) => b.kind !== "sun").length} planets · drag orbit · wheel zoom · [ ] select · double-click pick`);
    const view = new Float32Array(16);
    const proj = new Float32Array(16);
    const viewProj = new Float32Array(16);
    const camRight = new Float32Array(3);
    const camUp = new Float32Array(3);
    /** Shared camera/time only — per-body look lives on body uniforms (no last-draw flash). */
    function writeFrameUniforms(timeSec, eye) {
        viewProj.set(mat4ViewProj(viewProj, proj, view));
        frameU.set(viewProj, 0);
        frameU[16] = eye.eyeX;
        frameU[17] = eye.eyeY;
        frameU[18] = eye.eyeZ;
        frameU[19] = 1;
        frameU[20] = 0;
        frameU[21] = 0;
        frameU[22] = 0;
        frameU[23] = 1;
        frameU[24] = timeSec;
        frameU[25] = 0;
        frameU[26] = 0;
        frameU[27] = 0;
        device.queue.writeBuffer(frameBuf, 0, frameU);
    }
    function writeSunBody(pose, timeSec) {
        const L = sunLook;
        const S = sunResolved;
        sunBodyCpu[0] = pose.x;
        sunBodyCpu[1] = pose.y;
        sunBodyCpu[2] = pose.z;
        // Runtime type overrides (Sol = baseline showcase def)
        sunBodyCpu[3] = S.radius;
        sunBodyCpu[4] = S.glow[0];
        sunBodyCpu[5] = S.glow[1];
        sunBodyCpu[6] = S.glow[2];
        sunBodyCpu[7] = S.glowStrength;
        sunBodyCpu[8] = pose.spin * S.spinScale;
        sunBodyCpu[9] = sunEffectiveDrawMargin(S.drawMargin, L);
        sunBodyCpu[10] = timeSec;
        sunBodyCpu[11] = pose.def.obliquity; // body-frame lock (like planets)
        sunBodyCpu[12] = camRight[0];
        sunBodyCpu[13] = camRight[1];
        sunBodyCpu[14] = camRight[2];
        sunBodyCpu[15] = 0;
        sunBodyCpu[16] = camUp[0];
        sunBodyCpu[17] = camUp[1];
        sunBodyCpu[18] = camUp[2];
        sunBodyCpu[19] = 0;
        const eye = solarOrbitEye(orbit);
        sunBodyCpu[20] = eye.eyeX;
        sunBodyCpu[21] = eye.eyeY;
        sunBodyCpu[22] = eye.eyeZ;
        sunBodyCpu[23] = 1;
        // look0: discGain, coreLift, discWarm, limbSoft
        sunBodyCpu[24] = L.discGain;
        sunBodyCpu[25] = L.coreLift;
        sunBodyCpu[26] = L.discWarm;
        sunBodyCpu[27] = L.limbSoft;
        // look1: chromGain, sheathGain, rayGain, veilGain
        sunBodyCpu[28] = L.chromGain;
        sunBodyCpu[29] = L.sheathGain;
        sunBodyCpu[30] = L.rayGain;
        sunBodyCpu[31] = L.veilGain;
        // look2: unused/pad (legacy flareGain=0), outerGain, outerFalloff, glowMul
        sunBodyCpu[32] = 0;
        sunBodyCpu[33] = L.outerGain;
        sunBodyCpu[34] = L.outerFalloff;
        sunBodyCpu[35] = L.glowMul;
        // look3: outerFadeStart, outerFadeEnd, granGain, pad
        sunBodyCpu[36] = L.outerFadeStart;
        sunBodyCpu[37] = L.outerFadeEnd;
        sunBodyCpu[38] = L.granGain;
        sunBodyCpu[39] = 0;
        device.queue.writeBuffer(sunBodyBuf, 0, sunBodyCpu);
    }
    const FOVY = (50 * Math.PI) / 180;
    /**
     * ~N screen pixels expressed in disc `rr` units at this body (for limb AA).
     * limbWorld = radius → rr=1; worldPerPx from perspective at camera distance.
     */
    function edgeAaRrForBody(pose, eye, viewportH, look) {
        const dx = pose.x - eye.eyeX;
        const dy = pose.y - eye.eyeY;
        const dz = pose.z - eye.eyeZ;
        const dist = Math.hypot(dx, dy, dz) || 1;
        const worldPerPx = (2 * dist * Math.tan(FOVY / 2)) / Math.max(viewportH, 1);
        const limbPx = pose.def.radius / Math.max(worldPerPx, 1e-9);
        return Math.max(look.edgeAaPx, 0.25) / Math.max(limbPx, 1);
    }
    function fillPlanetBody(cpu, pose, eye, viewportH, look) {
        const a = look;
        const lightMul = sunResolved.planetLightMul;
        cpu[0] = pose.x;
        cpu[1] = pose.y;
        cpu[2] = pose.z;
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
        cpu[15] = edgeAaRrForBody(pose, eye, viewportH, a);
        cpu[16] = camRight[0];
        cpu[17] = camRight[1];
        cpu[18] = camRight[2];
        cpu[19] = 0;
        cpu[20] = camUp[0];
        cpu[21] = camUp[1];
        cpu[22] = camUp[2];
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
        // look2: rInner, glowMul, mieEmit, pad
        cpu[32] = a.rInner;
        cpu[33] = a.glowMul * lightMul;
        cpu[34] = a.mieEmit;
        cpu[35] = 0;
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
            const worldPerPx = (2 * dist * Math.tan(FOVY / 2)) / Math.max(viewportH, 1);
            cpu[47] = pose.def.radius / Math.max(worldPerPx, 1e-9);
        }
    }
    function uploadPlanetBodies(eye, viewportH) {
        for (const s of planetSlots) {
            const pose = poses[s.bodyIndex];
            fillPlanetBody(s.cpu, pose, eye, viewportH, atmForBody(s.bodyIndex));
            device.queue.writeBuffer(s.buf, 0, s.cpu);
        }
    }
    function bodyDrawOrder(eye) {
        const cmds = [{ kind: "sun" }];
        for (let i = 0; i < planetSlots.length; i++) {
            cmds.push({ kind: "planet", slot: i });
        }
        const dist2 = (bodyIndex) => {
            const p = poses[bodyIndex];
            const dx = p.x - eye.eyeX;
            const dy = p.y - eye.eyeY;
            const dz = p.z - eye.eyeZ;
            return dx * dx + dy * dy + dz * dz;
        };
        cmds.sort((a, b) => {
            const ia = a.kind === "sun" ? 0 : planetSlots[a.slot].bodyIndex;
            const ib = b.kind === "sun" ? 0 : planetSlots[b.slot].bodyIndex;
            return dist2(ib) - dist2(ia); // far first
        });
        return cmds;
    }
    /**
     * One GPU frame at absolute simTime `timeSec` (caller advances time).
     * Shared by rAF and deterministic capture.
     * @param targetView optional offscreen color view (capture); else swapchain
     * @param encoderHooks optional: called with encoder after pass (e.g. copy for fence)
     */
    function renderAtTime(timeSec, targetView, encoderHooks) {
        evaluateBodyPoses(SHOWCASE_BODIES, timeSec, poses);
        // Keep focus locked to selected body (orbits move)
        const focus = poses[selected];
        orbit = solarOrbitSetFocus(orbit, focus.x, focus.y, focus.z, orbit.radius);
        const eye = solarOrbitEye(orbit);
        const w = canvas.width || 1;
        const h = canvas.height || 1;
        mat4Perspective(proj, (50 * Math.PI) / 180, w / h, 0.05, 500);
        mat4LookAt(view, eye.eyeX, eye.eyeY, eye.eyeZ, eye.targetX, eye.targetY, eye.targetZ);
        mat4CameraRight(view, camRight);
        mat4CameraUp(view, camUp);
        writeFrameUniforms(timeSec, eye);
        writeSunBody(poses[0], timeSec);
        uploadPlanetBodies(eye, h);
        // Ring uniform
        ringU.set(mat4ViewProj(viewProj, proj, view), 0);
        ringU[16] = 0.35;
        ringU[17] = 0.45;
        ringU[18] = 0.7;
        ringU[19] = 0.22;
        device.queue.writeBuffer(ringUBuf, 0, ringU);
        const viewTex = targetView ?? context.getCurrentTexture().createView();
        const enc = device.createCommandEncoder();
        // GPU timer: pass timestamps when available (true pass duration);
        // fallback arms encode→onSubmittedWorkDone measurement.
        const tsWrites = gpuTimer.passTimestampWrites();
        const pass = enc.beginRenderPass({
            colorAttachments: [
                {
                    view: viewTex,
                    clearValue: boot.clearColor,
                    loadOp: "clear",
                    storeOp: "store",
                },
            ],
            ...(tsWrites ? { timestampWrites: tsWrites } : {}),
        });
        // Orbit rings — full showcase field (1 sun + 30 planet orbits).
        pass.setPipeline(ringPipe);
        pass.setBindGroup(0, ringBg);
        for (let i = 0; i < ringBufs.length; i++) {
            pass.setVertexBuffer(0, ringBufs[i]);
            pass.draw(ringCounts[i]);
        }
        // Full planet set: only skip true sub-pixel discs (not a draw-count cap).
        // User workload is 1 sun + 30 planets; never shrink the showcase to win ms.
        const hPx = canvas.height || 1;
        for (const cmd of bodyDrawOrder(eye)) {
            if (cmd.kind === "sun") {
                pass.setPipeline(sunPipe);
                pass.setBindGroup(0, sunBg);
                pass.draw(6);
            }
            else {
                const slot = planetSlots[cmd.slot];
                const pose = poses[slot.bodyIndex];
                const dx = pose.x - eye.eyeX;
                const dy = pose.y - eye.eyeY;
                const dz = pose.z - eye.eyeZ;
                const dist = Math.hypot(dx, dy, dz) || 1;
                const worldPerPx = (2 * dist * Math.tan(FOVY / 2)) / Math.max(hPx, 1);
                const screenR = pose.def.radius / Math.max(worldPerPx, 1e-9);
                if (screenR < 1.5 && slot.bodyIndex !== selected)
                    continue;
                pass.setPipeline(planetPipe);
                pass.setBindGroup(0, slot.bg);
                pass.draw(6);
            }
        }
        pass.end();
        gpuTimer.resolve(enc);
        if (encoderHooks)
            encoderHooks(enc);
        device.queue.submit([enc.finish()]);
        // Async: timestamp readback or submit→GPU-done (not rAF interval)
        gpuTimer.afterSubmit(noteGpuSample);
    }
    function frame(ts) {
        if (boot.isLost)
            return;
        if (!captureActive) {
            try {
                const dt = lastTs > 0 ? Math.min(0.05, (ts - lastTs) / 1000) : 1 / 60;
                lastTs = ts;
                if (fpsWindowStart <= 0)
                    fpsWindowStart = ts;
                simTime += dt;
                frames++;
                if (ts - fpsWindowStart >= 500) {
                    const inst = (frames * 1000) / (ts - fpsWindowStart);
                    fpsEma = fpsEma * 0.7 + inst * 0.3;
                    hudFps.textContent = fpsEma.toFixed(0);
                    frames = 0;
                    fpsWindowStart = ts;
                }
                renderAtTime(simTime);
            }
            catch (err) {
                console.error("[solar-system frame]", err);
                setStatus(err instanceof Error ? err.message : String(err), true);
            }
        }
        if (!boot.isLost)
            requestAnimationFrame(frame);
    }
    function resolveBodyIndex(body) {
        if (typeof body === "number" && Number.isFinite(body)) {
            return clampSelection(Math.floor(body), SHOWCASE_BODIES.length);
        }
        const key = String(body).toLowerCase();
        const byId = SHOWCASE_BODIES.findIndex((b) => b.id === key);
        if (byId >= 0)
            return byId;
        const byName = SHOWCASE_BODIES.findIndex((b) => b.name.toLowerCase() === key);
        if (byName >= 0)
            return byName;
        throw new Error(`Unknown body: ${body}`);
    }
    /**
     * Deterministic capture: fixed dt, fixed orbit angles, N frames, then PNG via
     * a readback-capable offscreen copy (CDP may also screenshot the canvas).
     */
    async function runCapture(opts = {}) {
        const nFrames = Math.max(1, Math.floor(opts.frames ?? 120));
        const dt = opts.dt ?? 1 / 60;
        const startTime = opts.startTime ?? 0;
        const yaw = opts.yaw ?? 0.85;
        const pitch = opts.pitch ?? 0.38;
        const radiusMul = opts.radiusMul ?? 6.5;
        // Target product resolution: 4K UHD (CSS pixels; DPR applied in configureContext).
        const cssW = Math.max(64, Math.floor(opts.width ?? 3840));
        const cssH = Math.max(64, Math.floor(opts.height ?? 2160));
        captureActive = true;
        try {
            // Pause rAF one tick so no concurrent getCurrentTexture during resize.
            await new Promise((r) => requestAnimationFrame(() => r()));
            // Always size to capture target (default 4K) for deterministic stills.
            boot.configureContext(cssW, cssH);
            try {
                await device.queue.onSubmittedWorkDone();
            }
            catch {
                /* device may still be settling after resize */
            }
            selected = resolveBodyIndex(opts.body ?? selected);
            evaluateBodyPoses(SHOWCASE_BODIES, startTime, poses);
            const focus = poses[selected];
            const bodyR = focus.def.kind === "sun" ? sunResolved.radius : focus.def.radius;
            const bounds = zoomBoundsForBody(bodyR);
            const r = clampZoom(bodyR * radiusMul, bounds.min, bounds.max);
            orbit = createSolarOrbitState({ yaw, pitch, radius: r });
            orbit = solarOrbitSetFocus(orbit, focus.x, focus.y, focus.z, r);
            hudFocus.textContent =
                focus.def.kind === "sun" ? sunResolved.label : focus.def.name;
            highlightBodyList();
            // Reset timing EMA for a clean capture median of the last samples
            frameMsEma = 0;
            gpuSampleCount = 0;
            recentGpuSamples.length = 0;
            simTime = startTime;
            // One draw per animation frame so the swapchain can present (required;
            // multi-submit without present can invalidate the device on some backends).
            const waitFrame = () => new Promise((r) => requestAnimationFrame((t) => r(t)));
            // Swapchain-only capture: one present per rAF. Avoid offscreen copy/map
            // fences that have been observed to lose the device on software adapters.
            const wallSamples = [];
            for (let i = 0; i < nFrames; i++) {
                if (boot.isLost)
                    break;
                await waitFrame();
                simTime = startTime + i * dt;
                const w0 = performance.now();
                try {
                    renderAtTime(simTime);
                }
                catch (err) {
                    console.error("[solar-system capture frame]", err);
                    break;
                }
                // Soft settle — do not await onSubmittedWorkDone every frame (can throw
                // OperationError and take the device down on some backends).
                wallSamples.push(performance.now() - w0);
            }
            // A few settling frames so the last present is visible for CDP screenshot
            for (let k = 0; k < 3 && !boot.isLost; k++) {
                await waitFrame();
                try {
                    renderAtTime(simTime);
                }
                catch {
                    break;
                }
            }
            await new Promise((r) => setTimeout(r, 32));
            const samples = recentGpuSamples.length > 4
                ? recentGpuSamples.slice()
                : wallSamples.slice();
            const sorted = samples.slice().sort((a, b) => a - b);
            const medianMs = sorted.length === 0
                ? frameMsEma
                : sorted.length % 2 === 1
                    ? sorted[(sorted.length - 1) >> 1]
                    : 0.5 *
                        (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]);
            if (!(frameMsEma > 0) && medianMs > 0)
                frameMsEma = medianMs;
            // Copy last presented frame via intermediate texture is hard with swapchain;
            // expose empty png and let CDP Page.captureScreenshot take the pixels.
            // Still try canvas.toDataURL when the browser allows it.
            let pngBase64 = "";
            try {
                const dataUrl = canvas.toDataURL("image/png");
                const comma = dataUrl.indexOf(",");
                if (comma >= 0)
                    pngBase64 = dataUrl.slice(comma + 1);
            }
            catch {
                pngBase64 = "";
            }
            const bodyDef = SHOWCASE_BODIES[selected];
            return {
                frameMs: frameMsEma,
                medianMs,
                samples,
                pngBase64,
                width: canvas.width,
                height: canvas.height,
                body: bodyDef.id,
                bodyIndex: selected,
                usesTimestamps: gpuTimer.usesTimestamps,
                frames: nFrames,
                simTime,
            };
        }
        finally {
            captureActive = false;
            lastTs = 0;
        }
    }
    // Test / capture surface for CDP harness and manual DevTools use.
    window.__solarSystemTest = {
        ready: true,
        usesTimestamps: gpuTimer.usesTimestamps,
        getFrameMs: () => frameMsEma,
        getMedianRecentMs: () => {
            const s = recentGpuSamples.slice().sort((a, b) => a - b);
            if (s.length === 0)
                return frameMsEma;
            return s.length % 2 === 1
                ? s[(s.length - 1) >> 1]
                : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2]);
        },
        getRecentSamples: () => recentGpuSamples.slice(),
        getSelected: () => selected,
        getBodyIds: () => SHOWCASE_BODIES.map((b) => b.id),
        selectBody: (body) => {
            selected = resolveBodyIndex(body);
            focusSelected(false);
        },
        setViewport: (w, h) => {
            boot.configureContext(Math.max(64, w | 0), Math.max(64, h | 0));
        },
        runCapture,
    };
    requestAnimationFrame(frame);
}
main().catch((err) => {
    console.error(err);
    setStatus(err instanceof Error ? err.message : String(err), true);
});
//# sourceMappingURL=main.js.map