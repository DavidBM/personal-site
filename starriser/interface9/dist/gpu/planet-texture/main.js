/**
 * Planet texture generator UI — offline batch bake up to 8K.
 * Entry: planet-texture.html → dist/gpu/planet-texture/main.js
 *
 * Bake is multi-pass (WebGPU when available). Sphere preview uses the
 * solar-system planet-disc WebGPU path (runtime map layering, full res drag).
 * CPU rasterizePlanetPreview remains for Node/tests and no-WebGPU fallback.
 */
import { applyImportedAlbedo, bakePlanetTextures, clampLightboxScale, cloneParams, defaultLightboxView, encodePngRgba, freshPresetSeed, hashTextureSet, hybridMixAlbedo, lightboxPan, lightboxPointerWasPan, lightboxShouldDismissOnClick, lightboxZoomAt, paramsForPreset, rasterizePlanetPreview, PureBiome, PURE_BIOME_DEBUG_RGB, PURE_BIOME_LABELS, validateEquirectAlbedo, PRESET_NAMES, RESOLUTION_OPTIONS, } from "./generator.js";
import { attachBiomeIntermediates, finishPlanetProduct, } from "./product-finish.js";
import { buildNightEmissiveRgba, clampAuthoringZoom, createAuthoringPlanetGpu, defaultAuthoringLightDir, defaultAuthoringOrientation, isAuthoringPlanetGpuAvailable, lightDirFromAngles, nightEmissiveKind, orientationFromYawPitch, trackballLightDir, trackballOrient, yawPitchFromOrientation, } from "./authoring-planet-gpu.js";
import { DEFAULT_POLE_SIZE, defaultPoleSizeForResolution, poleIceExtentScale, poleProductSide, rasterizePoleCap, } from "./pole-cap.js";
import { paramsFromQuery, paramsToQuery } from "./url-state.js";
const statusEl = document.getElementById("status");
const form = document.getElementById("controls");
const albedoCanvas = document.getElementById("albedo");
const normalCanvas = document.getElementById("normal");
const heightCanvas = document.getElementById("height");
const liquidCanvas = document.getElementById("liquid");
const nightCanvas = document.getElementById("night");
const poleNCanvas = document.getElementById("poleN");
const poleSCanvas = document.getElementById("poleS");
const cloudsCanvas = document.getElementById("clouds");
const cloudsPoleNCanvas = document.getElementById("cloudsPoleN");
const cloudsPoleSCanvas = document.getElementById("cloudsPoleS");
const biomeSplitCanvas = document.getElementById("biomeSplit");
const biomeLegendEl = document.getElementById("biome-legend");
const heightHeatCanvas = document.getElementById("heightHeat");
const planetPreviewCanvas = document.getElementById("planetPreview");
let params = paramsFromQuery(typeof location !== "undefined" ? location.search : "", paramsForPreset("azure-ocean", 512, 42));
let lastSet = null;
let baking = false;
/** Active bake AbortController — cancel button aborts between stages. */
let bakeAbort = null;
let urlWriteTimer = 0;
/** Preview orientation — free quaternion orbit (no pitch limits). */
let previewOrientation = defaultAuthoringOrientation();
let previewLightDir = defaultAuthoringLightDir();
/** Camera zoom (1 default; higher = closer). */
let previewZoom = 1;
let previewRaf = 0;
let dragMode = null;
let dragLastX = 0;
let dragLastY = 0;
/** Always-on hybrid note for status line. */
let lastHybridNote = "";
/** AI bank images actually used in last hybrid/patch step (gallery). */
let lastAiGallery = [];
/** Session AI library — lazy-filled per family so UI I/O matches the old path. */
let productFinishBanks = {
    clouds: [],
    patches: new Map(),
};
/** Solar-system-style WebGPU disc (null = CPU fallback). */
let planetGpu = null;
let planetGpuInit = null;
const progressWrap = document.getElementById("bake-progress-wrap");
const progressBar = document.getElementById("bake-progress");
const progressText = document.getElementById("bake-progress-text");
const mainEl = document.getElementById("main");
const planetWrap = document.getElementById("planet-preview-wrap");
function setStatus(msg, error = false) {
    // Preserve newlines for multi-line stage reports (CSS white-space: pre-wrap)
    statusEl.textContent = msg;
    statusEl.classList.toggle("error", error);
    statusEl.classList.toggle("multiline", msg.includes("\n"));
}
/** Show progress bar + dim previous maps / sphere while baking. */
function setBakingUi(active, frac = 0, stage = "") {
    progressWrap?.classList.toggle("active", active);
    mainEl?.classList.toggle("baking", active);
    planetWrap?.classList.toggle("baking", active);
    const bakeBtn = document.getElementById("btnBake");
    const cancelBtn = document.getElementById("btnCancelBake");
    if (bakeBtn)
        bakeBtn.disabled = active;
    if (cancelBtn)
        cancelBtn.disabled = !active;
    if (progressBar) {
        progressBar.value = Math.max(0, Math.min(100, Math.round(frac * 100)));
    }
    if (progressText) {
        const pct = Math.round(Math.max(0, Math.min(1, frac)) * 100);
        progressText.textContent = active
            ? stage
                ? `${stage} (${pct}%)`
                : `Baking… ${pct}%`
            : "Done";
    }
    if (active && document.body) {
        document.body.style.cursor = "progress";
    }
    else if (document.body) {
        document.body.style.cursor = "";
    }
}
function cancelBake() {
    if (!baking || !bakeAbort || bakeAbort.signal.aborted)
        return;
    bakeAbort.abort(new DOMException("Bake cancelled", "AbortError"));
    setBakingUi(true, progressBar ? progressBar.value / 100 : 0.5, "Cancelling…");
    setStatus("Cancelling bake…");
}
function pushParamsToUrl() {
    if (typeof history === "undefined" || typeof location === "undefined")
        return;
    const q = paramsToQuery(params);
    const next = `${location.pathname}?${q}${location.hash ?? ""}`;
    const cur = `${location.pathname}${location.search}${location.hash ?? ""}`;
    if (next !== cur)
        history.replaceState(null, "", next);
}
function scheduleUrlWrite() {
    if (urlWriteTimer)
        return;
    urlWriteTimer = window.setTimeout(() => {
        urlWriteTimer = 0;
        pushParamsToUrl();
    }, 80);
}
function num(id, fallback) {
    const el = document.getElementById(id);
    if (!el)
        return fallback;
    const v = Number(el.value);
    return Number.isFinite(v) ? v : fallback;
}
function str(id, fallback) {
    const el = document.getElementById(id);
    return el?.value ?? fallback;
}
function readFormIntoParams() {
    params.seed = Math.floor(num("seed", 42)) >>> 0;
    params.resolution = Math.floor(num("resolution", 512));
    params.poleSize = Math.floor(num("poleSize", defaultPoleSizeForResolution(params.resolution)));
    params.planetClass = str("planetClass", "ocean");
    params.liquidKind = str("liquidKind", "water");
    params.liquidLevel = num("liquidLevel", 0.55);
    params.heightOctaves = Math.max(2, Math.min(8, Math.floor(num("heightOctaves", 6))));
    params.heightFreq = num("heightFreq", 1.8);
    params.warp = num("warp", 0.45);
    params.thermalIters = Math.max(0, Math.min(8, Math.floor(num("thermalIters", 6))));
    params.hydraulicDrops = Math.floor(num("hydraulicDrops", 0));
    params.bandStrength = num("bandStrength", 0.85);
    params.stormDensity = num("stormDensity", 0.35);
    params.cloudCover = num("cloudCover", 0.8);
    params.colorBoost = num("colorBoost", 0.65);
    params.wetness = num("wetness", 0.85);
    params.continentScale = num("continentScale", 1.1);
    params.mountainScale = num("mountainScale", 0.85);
    params.softCoastEnabled = false;
    {
        const blend = str("terrainFeatureBlend", "linear");
        const ok = [
            "luminosity",
            "multiply",
            "softLight",
            "overlay",
            "screen",
            "linear",
            "lerp",
        ];
        params.terrainFeatureBlend = (ok.includes(blend)
            ? blend
            : "linear");
    }
    {
        // Prefer number field; keep range in sync
        const rangeEl = document.getElementById("terrainFeatureStrength");
        const numEl = document.getElementById("terrainFeatureStrengthNum");
        let s = num("terrainFeatureStrengthNum", num("terrainFeatureStrength", 1));
        if (!Number.isFinite(s))
            s = 1;
        s = Math.max(0, Math.min(1, s));
        params.terrainFeatureStrength = s;
        if (rangeEl)
            rangeEl.value = String(s);
        if (numEl)
            numEl.value = String(s);
    }
    params = cloneParams(params);
}
function writeParamsToForm(p) {
    const set = (id, v) => {
        const el = document.getElementById(id);
        if (el)
            el.value = String(v);
    };
    set("seed", p.seed);
    set("resolution", p.resolution);
    set("poleSize", p.poleSize);
    set("planetClass", p.planetClass);
    set("liquidKind", p.liquidKind);
    set("liquidLevel", p.liquidLevel);
    set("heightOctaves", p.heightOctaves);
    set("heightFreq", p.heightFreq);
    set("warp", p.warp);
    set("thermalIters", p.thermalIters);
    set("hydraulicDrops", p.hydraulicDrops);
    set("bandStrength", p.bandStrength);
    set("stormDensity", p.stormDensity);
    set("cloudCover", p.cloudCover);
    set("colorBoost", p.colorBoost);
    set("wetness", p.wetness);
    set("continentScale", p.continentScale);
    set("mountainScale", p.mountainScale);
    set("terrainFeatureBlend", p.terrainFeatureBlend ?? "linear");
    {
        const s = p.terrainFeatureStrength !== undefined &&
            Number.isFinite(p.terrainFeatureStrength)
            ? Math.max(0, Math.min(1, p.terrainFeatureStrength))
            : 1;
        set("terrainFeatureStrength", s);
        set("terrainFeatureStrengthNum", s);
    }
    {
        const el = document.getElementById("softCoastEnabled");
        if (el)
            el.checked = false;
    }
    const presetEl = document.getElementById("preset");
    if (presetEl) {
        // leave as user selection
    }
}
/** Full-res buffers keyed by map canvas id — used by texture lightbox. */
const mapFullBuffers = new Map();
function drawBuffer(canvas, buf, emptyMsg, title) {
    const ctx = canvas.getContext("2d");
    if (!ctx)
        return;
    if (!buf) {
        mapFullBuffers.delete(canvas.id);
        canvas.width = 256;
        canvas.height = 128;
        ctx.fillStyle = "#0a1020";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (emptyMsg) {
            ctx.fillStyle = "#5a7a9a";
            ctx.font = "12px sans-serif";
            ctx.fillText(emptyMsg, 12, 24);
        }
        return;
    }
    // Keep full-res for lightbox inspect (click thumbnail → popup)
    if (canvas.id) {
        mapFullBuffers.set(canvas.id, {
            width: buf.width,
            height: buf.height,
            rgba: buf.rgba,
            title: title || canvas.id,
        });
    }
    // Downscale preview if huge
    const maxW = 1024;
    const scale = buf.width > maxW ? maxW / buf.width : 1;
    const dw = Math.max(1, Math.floor(buf.width * scale));
    const dh = Math.max(1, Math.floor(buf.height * scale));
    canvas.width = dw;
    canvas.height = dh;
    if (scale >= 0.999) {
        const img = new ImageData(new Uint8ClampedArray(buf.rgba), buf.width, buf.height);
        ctx.putImageData(img, 0, 0);
    }
    else {
        // Draw via temp canvas
        const tmp = document.createElement("canvas");
        tmp.width = buf.width;
        tmp.height = buf.height;
        const tctx = tmp.getContext("2d");
        tctx.putImageData(new ImageData(new Uint8ClampedArray(buf.rgba), buf.width, buf.height), 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(tmp, 0, 0, dw, dh);
    }
}
function currentPose() {
    return {
        orientation: { ...previewOrientation },
        lightDir: { ...previewLightDir },
    };
}
/** Euler seed for CPU rasterizer (roll discarded). */
function currentEulerForCpu() {
    const { yaw, pitch } = yawPitchFromOrientation(previewOrientation);
    // Light: recover rough spherical from direction
    const L = previewLightDir;
    const lightYaw = Math.atan2(L.x, L.z);
    const lightPitch = Math.asin(Math.max(-1, Math.min(1, -L.y)));
    return { yaw, pitch, lightYaw, lightPitch };
}
function schedulePlanetPreview() {
    if (previewRaf)
        return;
    previewRaf = requestAnimationFrame(() => {
        previewRaf = 0;
        if (lastSet)
            paintPlanetPreview(lastSet);
    });
}
/** CPU disc path (Node / no WebGPU). Fills wrap min dimension at full CSS size. */
function paintPlanetPreviewCpu(set) {
    if (!planetPreviewCanvas)
        return;
    const ctx = planetPreviewCanvas.getContext("2d", { alpha: true });
    if (!ctx)
        return;
    const wrap = document.getElementById("planet-preview-wrap");
    const cssW = wrap?.clientWidth || 384;
    const cssH = wrap?.clientHeight || 384;
    const dpr = Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, 2);
    // Square disc using full smaller side of wrap (fills panel when square-ish)
    const size = Math.max(128, Math.floor(Math.min(cssW, cssH) * dpr * Math.min(previewZoom, 2)));
    const eu = currentEulerForCpu();
    // Temperate city lights / lava night map for CPU disc fallback
    const nightKind = nightEmissiveKind(set);
    const nightRgba = nightKind === "black" ? null : buildNightEmissiveRgba(set);
    const preview = rasterizePlanetPreview({
        albedo: set.albedo,
        normal: set.normal,
        liquidMask: set.liquidMask,
        clouds: set.clouds,
        night: nightRgba != null
            ? {
                width: set.albedo.width,
                height: set.albedo.height,
                rgba: nightRgba,
            }
            : null,
    }, {
        size,
        yaw: eu.yaw,
        pitch: eu.pitch,
        lightYaw: eu.lightYaw,
        lightPitch: eu.lightPitch,
        atmosphere: true,
        nightAmount: nightKind === "city" ? 1.15 : 1,
    });
    planetPreviewCanvas.width = preview.width;
    planetPreviewCanvas.height = preview.height;
    ctx.clearRect(0, 0, preview.width, preview.height);
    ctx.putImageData(new ImageData(new Uint8ClampedArray(preview.rgba), preview.width, preview.height), 0, 0);
}
function paintPlanetPreview(set) {
    if (planetGpu) {
        planetGpu.setPose(currentPose());
        planetGpu.setZoom(previewZoom);
        planetGpu.redraw();
        return;
    }
    paintPlanetPreviewCpu(set);
}
function showPlanetPreview(set) {
    if (planetGpu) {
        planetGpu.resize();
        planetGpu.setMaps(set);
        planetGpu.setPose(currentPose());
        planetGpu.setZoom(previewZoom);
        planetGpu.redraw();
        return;
    }
    paintPlanetPreviewCpu(set);
}
async function ensurePlanetGpu() {
    if (planetGpu)
        return;
    if (planetGpuInit)
        return planetGpuInit;
    if (!planetPreviewCanvas || !isAuthoringPlanetGpuAvailable())
        return;
    planetGpuInit = (async () => {
        try {
            planetGpu = await createAuthoringPlanetGpu(planetPreviewCanvas);
            planetGpu.resize();
            if (lastSet) {
                planetGpu.setMaps(lastSet);
                planetGpu.setPose(currentPose());
            }
            console.info("[planet-texture] WebGPU authoring disc ready (solar-system layering)");
        }
        catch (e) {
            console.warn("[planet-texture] WebGPU preview failed; CPU disc fallback", e);
            planetGpu = null;
        }
    })();
    await planetGpuInit;
}
function wirePlanetPreviewDrag() {
    const wrap = document.getElementById("planet-preview-wrap");
    const canvas = planetPreviewCanvas;
    if (!wrap || !canvas)
        return;
    wrap.style.cursor = "grab";
    wrap.title =
        "Drag: free rotate (quat; sun stays fixed) · Shift+drag: sun · Wheel: zoom · full-res WebGPU";
    const onDown = (e) => {
        if (!lastSet)
            return;
        dragMode = e.shiftKey ? "light" : "view";
        dragLastX = e.clientX;
        dragLastY = e.clientY;
        wrap.setPointerCapture(e.pointerId);
        wrap.style.cursor = "grabbing";
        e.preventDefault();
    };
    const onMove = (e) => {
        if (!dragMode || !lastSet)
            return;
        const dx = e.clientX - dragLastX;
        const dy = e.clientY - dragLastY;
        dragLastX = e.clientX;
        dragLastY = e.clientY;
        const sens = 0.005;
        if (dragMode === "view") {
            // Orbit camera about view axes (full sphere, no pitch clamp).
            // Also rotate light by the same delta so the sun stays fixed relative to
            // the view — wherever Shift+drag left it stays put while the planet turns.
            const orient0 = previewOrientation;
            previewLightDir = trackballLightDir(previewLightDir, orient0, dx, dy, sens);
            previewOrientation = trackballOrient(orient0, dx, dy, sens);
        }
        else {
            // Shift+drag: move sun only (view-relative axes from current orientation)
            previewLightDir = trackballLightDir(previewLightDir, previewOrientation, dx, dy, sens);
        }
        schedulePlanetPreview();
    };
    const onUp = (e) => {
        if (!dragMode)
            return;
        dragMode = null;
        wrap.style.cursor = "grab";
        try {
            wrap.releasePointerCapture(e.pointerId);
        }
        catch {
            /* ignore */
        }
        if (lastSet)
            paintPlanetPreview(lastSet);
    };
    const onWheel = (e) => {
        if (!lastSet)
            return;
        e.preventDefault();
        // Smooth exponential zoom (wheel up = zoom in)
        const factor = Math.exp(-e.deltaY * 0.0012);
        previewZoom = clampAuthoringZoom(previewZoom * factor);
        if (planetGpu) {
            planetGpu.setZoom(previewZoom);
            planetGpu.setPose(currentPose());
            planetGpu.redraw();
        }
        else {
            schedulePlanetPreview();
        }
    };
    wrap.addEventListener("pointerdown", onDown);
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerup", onUp);
    wrap.addEventListener("pointercancel", onUp);
    wrap.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", () => {
        refreshPlanetPreviewSize();
    });
}
/** GPU/CPU preview buffer → current wrap CSS size. */
function refreshPlanetPreviewSize() {
    if (planetGpu) {
        planetGpu.resize();
        if (lastSet) {
            planetGpu.setPose(currentPose());
            planetGpu.setZoom(previewZoom);
            planetGpu.redraw();
        }
    }
    else if (lastSet) {
        paintPlanetPreviewCpu(lastSet);
    }
}
/**
 * Drag handle on planet panel: column width (desktop) or row height (≤1100px).
 * Persists in localStorage; double-click restores default.
 */
function wirePlanetPanelResize() {
    const layout = document.getElementById("layout");
    const handle = document.getElementById("planet-resize");
    if (!layout || !handle)
        return;
    const KEY_W = "galaxy.planetTexture.planetPanelW";
    const KEY_H = "galaxy.planetTexture.planetPanelH";
    const DEFAULT_W = "min(42vh, 480px)";
    const DEFAULT_H = "360px";
    const isNarrow = () => typeof matchMedia === "function" &&
        matchMedia("(max-width: 1100px)").matches;
    try {
        const sw = localStorage.getItem(KEY_W);
        if (sw && /^\d+$/.test(sw)) {
            layout.style.setProperty("--planet-panel-w", `${sw}px`);
        }
        const sh = localStorage.getItem(KEY_H);
        if (sh && /^\d+$/.test(sh)) {
            layout.style.setProperty("--planet-panel-h", `${sh}px`);
        }
    }
    catch {
        /* private mode */
    }
    let mode = null;
    let lastW = 0;
    let lastH = 0;
    let raf = 0;
    const flushPreview = () => {
        if (raf)
            return;
        raf = requestAnimationFrame(() => {
            raf = 0;
            refreshPlanetPreviewSize();
        });
    };
    const onDown = (e) => {
        if (e.button !== 0)
            return;
        mode = isNarrow() ? "h" : "w";
        handle.classList.add("dragging");
        document.body.classList.add("planet-resizing");
        if (mode === "h")
            document.body.classList.add("planet-resizing-row");
        handle.setPointerCapture(e.pointerId);
        e.preventDefault();
    };
    const onMove = (e) => {
        if (!mode)
            return;
        const rect = layout.getBoundingClientRect();
        if (mode === "w") {
            // Right column: width from pointer to layout right edge
            const maxW = Math.floor(rect.width * 0.62);
            const minW = 240;
            const w = Math.round(Math.min(maxW, Math.max(minW, rect.right - e.clientX)));
            lastW = w;
            layout.style.setProperty("--planet-panel-w", `${w}px`);
        }
        else {
            const maxH = Math.floor(rect.height * 0.72);
            const minH = 180;
            const h = Math.round(Math.min(maxH, Math.max(minH, rect.bottom - e.clientY)));
            lastH = h;
            layout.style.setProperty("--planet-panel-h", `${h}px`);
        }
        flushPreview();
    };
    const onUp = (e) => {
        if (!mode)
            return;
        const was = mode;
        mode = null;
        handle.classList.remove("dragging");
        document.body.classList.remove("planet-resizing", "planet-resizing-row");
        try {
            handle.releasePointerCapture(e.pointerId);
        }
        catch {
            /* ignore */
        }
        try {
            if (was === "w" && lastW > 0) {
                localStorage.setItem(KEY_W, String(lastW));
            }
            if (was === "h" && lastH > 0) {
                localStorage.setItem(KEY_H, String(lastH));
            }
        }
        catch {
            /* ignore */
        }
        refreshPlanetPreviewSize();
    };
    const resetDefault = () => {
        layout.style.setProperty("--planet-panel-w", DEFAULT_W);
        layout.style.setProperty("--planet-panel-h", DEFAULT_H);
        try {
            localStorage.removeItem(KEY_W);
            localStorage.removeItem(KEY_H);
        }
        catch {
            /* ignore */
        }
        refreshPlanetPreviewSize();
    };
    handle.addEventListener("pointerdown", onDown);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
    handle.addEventListener("dblclick", (e) => {
        e.preventDefault();
        resetDefault();
    });
    // Keyboard nudge (a11y)
    handle.addEventListener("keydown", (e) => {
        const narrow = isNarrow();
        const step = e.shiftKey ? 40 : 16;
        const prop = narrow ? "--planet-panel-h" : "--planet-panel-w";
        const key = narrow ? KEY_H : KEY_W;
        const rect = layout.getBoundingClientRect();
        const max = narrow
            ? Math.floor(rect.height * 0.72)
            : Math.floor(rect.width * 0.62);
        const min = narrow ? 180 : 240;
        const cur = parseInt(getComputedStyle(layout).getPropertyValue(prop).trim(), 10) || (narrow ? 360 : 400);
        let next = cur;
        if (narrow) {
            if (e.key === "ArrowUp")
                next = cur + step;
            else if (e.key === "ArrowDown")
                next = cur - step;
            else
                return;
        }
        else {
            if (e.key === "ArrowLeft")
                next = cur + step;
            else if (e.key === "ArrowRight")
                next = cur - step;
            else
                return;
        }
        e.preventDefault();
        next = Math.min(max, Math.max(min, next));
        layout.style.setProperty(prop, `${next}px`);
        try {
            localStorage.setItem(key, String(next));
        }
        catch {
            /* ignore */
        }
        refreshPlanetPreviewSize();
    });
}
function showBiomeLegend(counts, mapW, mapH) {
    if (!biomeLegendEl)
        return;
    if (!counts) {
        biomeLegendEl.textContent = "Bake to generate pure biome split.";
        return;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
    const order = [
        PureBiome.Ocean,
        PureBiome.Beach,
        PureBiome.Grass,
        PureBiome.Forest,
        PureBiome.Deep,
        PureBiome.Desert,
        PureBiome.Gray,
        PureBiome.Tundra,
        PureBiome.Snow,
    ];
    const parts = [
        `<span style="color:var(--muted)">${mapW}×${mapH} hard class · no blend</span>`,
    ];
    for (const id of order) {
        const n = counts[id] ?? 0;
        if (n <= 0)
            continue;
        const c = PURE_BIOME_DEBUG_RGB[id];
        const hex = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
        const pct = ((100 * n) / total).toFixed(1);
        parts.push(`<span><span class="swatch" style="background:${hex}"></span>${PURE_BIOME_LABELS[id]} ${pct}%</span>`);
    }
    biomeLegendEl.innerHTML = parts.join("");
}
/** Build pure biome intermediate map (capped res) and attach to set. */
function fillPureBiomeIntermediate(set) {
    attachBiomeIntermediates(set);
}
function showSet(set) {
    drawBuffer(albedoCanvas, set.albedo, undefined, "Albedo (equirect)");
    drawBuffer(normalCanvas, set.normal, undefined, "Normal");
    drawBuffer(heightCanvas, set.height, undefined, "Height");
    drawBuffer(liquidCanvas, set.liquidMask, undefined, "Liquid / material");
    // Night lights equirect (same builder as disc texNight) — temperate cities / lava
    if (nightCanvas) {
        const nightRgba = buildNightEmissiveRgba(set);
        const nightKind = nightEmissiveKind(set);
        if (nightKind === "black") {
            drawBuffer(nightCanvas, null, "no night lights", "Night lights");
        }
        else {
            drawBuffer(nightCanvas, {
                width: set.albedo.width,
                height: set.albedo.height,
                rgba: nightRgba,
            }, undefined, nightKind === "lava"
                ? "Night lights (lava emissive)"
                : "Night lights (city)");
        }
    }
    const pn = set.poleNorth;
    const ps = set.poleSouth;
    drawBuffer(poleNCanvas, pn, undefined, `Pole north (${pn.width}×${pn.height})`);
    drawBuffer(poleSCanvas, ps, undefined, `Pole south (${ps.width}×${ps.height})`);
    // Update card headings so poleSize changes are obvious (CSS width:100% alone hides size)
    const poleNH = document.querySelector("#poleN")?.closest(".card")?.querySelector("h2");
    const poleSH = document.querySelector("#poleS")?.closest(".card")?.querySelector("h2");
    if (poleNH) {
        poleNH.textContent = `Pole north ${pn.width}×${pn.height} (α)`;
    }
    if (poleSH) {
        poleSH.textContent = `Pole south ${ps.width}×${ps.height} (α)`;
    }
    // Intrinsic pixel size for poles so larger caps display larger (up to card width)
    poleNCanvas.style.width = "auto";
    poleNCanvas.style.maxWidth = "100%";
    poleSCanvas.style.width = "auto";
    poleSCanvas.style.maxWidth = "100%";
    drawBuffer(cloudsCanvas, set.clouds, "no clouds", "Clouds");
    if (cloudsPoleNCanvas) {
        drawBuffer(cloudsPoleNCanvas, set.cloudsPoleNorth ?? null, "no cloud poles", "Clouds pole north");
        cloudsPoleNCanvas.style.width = "auto";
        cloudsPoleNCanvas.style.maxWidth = "100%";
    }
    if (cloudsPoleSCanvas) {
        drawBuffer(cloudsPoleSCanvas, set.cloudsPoleSouth ?? null, "no cloud poles", "Clouds pole south");
        cloudsPoleSCanvas.style.width = "auto";
        cloudsPoleSCanvas.style.maxWidth = "100%";
    }
    {
        const cpn = set.cloudsPoleNorth;
        const cps = set.cloudsPoleSouth;
        const cpnH = document
            .querySelector("#cloudsPoleN")
            ?.closest(".card")
            ?.querySelector("h2");
        const cpsH = document
            .querySelector("#cloudsPoleS")
            ?.closest(".card")
            ?.querySelector("h2");
        if (cpnH) {
            cpnH.textContent = cpn
                ? `Clouds pole north ${cpn.width}×${cpn.height} (α)`
                : "Clouds pole north";
        }
        if (cpsH) {
            cpsH.textContent = cps
                ? `Clouds pole south ${cps.width}×${cps.height} (α)`
                : "Clouds pole south";
        }
    }
    // Intermediate: pure biome class + land height heat
    if (!set.intermediates?.heightHeat) {
        fillPureBiomeIntermediate(set);
    }
    const pure = set.intermediates?.pureBiomeSplit ?? null;
    if (biomeSplitCanvas) {
        drawBuffer(biomeSplitCanvas, pure, "n/a for this planet class", "Pure biome split (hard class)");
    }
    showBiomeLegend(set.intermediates?.pureBiomeCounts, pure?.width ?? 0, pure?.height ?? 0);
    if (heightHeatCanvas) {
        drawBuffer(heightHeatCanvas, set.intermediates?.heightHeat ?? null, "no height", "Continent height (heat)");
    }
    showPlanetPreview(set);
}
async function applyAlwaysOnHybrid(set, signal) {
    lastHybridNote = "";
    lastAiGallery = [];
    const result = await finishPlanetProduct(set, {
        signal,
        banks: productFinishBanks,
    });
    lastHybridNote = result.note;
    lastAiGallery = result.gallery;
    renderAiGallery(lastAiGallery);
}
function renderAiGallery(entries) {
    const root = document.getElementById("ai-gallery");
    const thumbs = document.getElementById("ai-gallery-thumbs");
    if (!root || !thumbs)
        return;
    thumbs.innerHTML = "";
    if (!entries.length) {
        root.classList.remove("has-items");
        thumbs.textContent = "No AI sources used yet — bake to populate.";
        return;
    }
    root.classList.add("has-items");
    for (const e of entries) {
        const card = document.createElement("div");
        card.className = "ai-gallery-card";
        const label = document.createElement("div");
        label.className = "ai-gallery-label";
        label.textContent = `${e.role}: ${e.path.replace(/^assets\/planets\/ai\//, "")}`;
        card.appendChild(label);
        if (e.path.startsWith("procedural:")) {
            const note = document.createElement("div");
            note.className = "ai-gallery-proc";
            note.textContent = "synthesized orbit canopy";
            card.appendChild(note);
        }
        else {
            const img = document.createElement("img");
            img.src = e.path;
            img.alt = e.path;
            img.loading = "lazy";
            img.title = e.path;
            card.appendChild(img);
        }
        thumbs.appendChild(card);
    }
}
async function runBake() {
    if (baking)
        return;
    baking = true;
    bakeAbort = new AbortController();
    const signal = bakeAbort.signal;
    readFormIntoParams();
    scheduleUrlWrite();
    const t0 = performance.now();
    setBakingUi(true, 0.02, "Starting bake");
    setStatus(`Baking ${params.resolution}×${params.resolution / 2} (${params.planetClass})…`);
    // Yield so UI can paint spinner / dimmed previous textures
    await new Promise((r) => setTimeout(r, 16));
    try {
        const { throwIfBakeAborted } = await import("./bake.js");
        throwIfBakeAborted(signal);
        const onProg = (msg, frac) => {
            throwIfBakeAborted(signal);
            const f = Math.min(0.9, Math.max(0.02, frac * 0.9));
            setBakingUi(true, f, msg);
            setStatus(`Baking… ${(f * 100).toFixed(0)}% — ${msg}`);
        };
        // WebGPU product path only — no silent CPU full-bake fallback
        let set;
        let backend = "webgpu-full";
        const { bakePlanetTexturesAuto, formatStageReport } = await import("./bake-gpu.js");
        const tBake0 = performance.now();
        setBakingUi(true, 0.04, "Baking…");
        const r = await bakePlanetTexturesAuto(params, { onProgress: onProg, signal });
        set = r.set;
        backend = r.backend;
        const bakeMs = Math.round(performance.now() - tBake0);
        // AI patches = stamp bank textures as soft surface patches (not full-equirect noise)
        throwIfBakeAborted(signal);
        setBakingUi(true, 0.92, "AI surface patches");
        setStatus("AI surface patches…");
        const tHyb0 = performance.now();
        await applyAlwaysOnHybrid(set, signal);
        const aiPatchesMs = Math.round(performance.now() - tHyb0);
        throwIfBakeAborted(signal);
        setBakingUi(true, 0.98, "Updating previews");
        const tPrev0 = performance.now();
        lastSet = set;
        showSet(set);
        const previewMs = Math.round(performance.now() - tPrev0);
        const ms = performance.now() - t0;
        const h = hashTextureSet(set);
        setBakingUi(false, 1, "Done");
        // Always attach post-bake host phases so the Done panel never lacks a breakdown
        const stageMs = {
            ...(set.stats.stageMs ?? {}),
            "ai-patches": aiPatchesMs,
            preview: previewMs,
        };
        if (!set.stats.stageMs) {
            stageMs.bake = bakeMs;
        }
        set.stats.stageMs = stageMs;
        let totalMs = 0;
        for (const v of Object.values(stageMs))
            totalMs += v;
        set.stats.totalMs = Math.round(totalMs * 10) / 10;
        const iceScale = poleIceExtentScale(set.params.poleSize);
        const header = `Done in ${(ms / 1000).toFixed(2)}s · ${backend}` +
            ` · peaks ${set.stats.landLocalMaxima}` +
            ` · layers ${set.stats.effectiveLayers}` +
            ` · poles ${set.poleNorth.width}×${set.poleNorth.height}` +
            ` · ice×${iceScale.toFixed(2)} (ctrl ${set.params.poleSize})` +
            ` · ${lastHybridNote || "procedural"}` +
            ` · hash ${h.slice(0, 16)}…`;
        const kind = backend === "webgpu-full" ? "GPU stages (fenced)" : "Node gpu-cpu-ref (wall)";
        const report = formatStageReport(stageMs, set.stats.totalMs);
        const statusMsg = report
            ? `${header}\n\n${kind}:\n${report}`
            : header;
        console.log("[planet-bake stageMs]\n" + (report || "(none)"), "total", set.stats.totalMs);
        setStatus(statusMsg);
    }
    catch (e) {
        const { isBakeAbortError } = await import("./bake.js");
        if (isBakeAbortError(e)) {
            setBakingUi(false, 0, "Cancelled");
            setStatus("Bake cancelled.");
            console.info("[planet-bake] cancelled");
        }
        else {
            setBakingUi(false, 0, "Failed");
            const msg = e instanceof Error ? e.message : String(e);
            const stack = e instanceof Error && e.stack && e.stack !== msg
                ? `\n\n${e.stack}`
                : "";
            console.error("[planet-bake] failed", e);
            setStatus(`Bake failed (no CPU fallback)\n\n${msg}${stack}`, true);
        }
    }
    finally {
        baking = false;
        bakeAbort = null;
        setBakingUi(false, 1);
    }
}
function downloadBuf(name, buf) {
    const png = encodePngRgba(buf);
    const blob = new Blob([png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)], {
        type: "image/png",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
}
function exportAll() {
    if (!lastSet) {
        setStatus("Bake first, then export.", true);
        return;
    }
    const s = lastSet;
    const tag = `${s.params.planetClass}_s${s.params.seed}_${s.params.resolution}`;
    downloadBuf(`planet_${tag}_albedo.png`, s.albedo);
    downloadBuf(`planet_${tag}_height.png`, s.height);
    downloadBuf(`planet_${tag}_normal.png`, s.normal);
    downloadBuf(`planet_${tag}_liquid.png`, s.liquidMask);
    downloadBuf(`planet_${tag}_pole_n.png`, s.poleNorth);
    downloadBuf(`planet_${tag}_pole_s.png`, s.poleSouth);
    if (s.clouds)
        downloadBuf(`planet_${tag}_clouds.png`, s.clouds);
    if (s.cloudsPoleNorth) {
        downloadBuf(`planet_${tag}_clouds_pole_n.png`, s.cloudsPoleNorth);
    }
    if (s.cloudsPoleSouth) {
        downloadBuf(`planet_${tag}_clouds_pole_s.png`, s.cloudsPoleSouth);
    }
    setStatus(`Exported multi-map set (${tag}).`);
}
function applyPreset() {
    const el = document.getElementById("preset");
    const name = (el?.value ?? "azure-ocean");
    // Fresh seed every Apply so successive applies diverge (bake stays deterministic for a fixed seed)
    const seed = freshPresetSeed();
    const res = Math.floor(num("resolution", 512));
    // Keep user's pole cap size — do not force res/2 (e.g. 512 at 1K)
    const keepPole = Math.floor(num("poleSize", 250));
    params = paramsForPreset(name, res, seed, keepPole);
    writeParamsToForm(params);
    scheduleUrlWrite();
    void runBake();
}
function fillPresetSelect() {
    const el = document.getElementById("preset");
    if (!el)
        return;
    el.innerHTML = "";
    for (const n of PRESET_NAMES) {
        const o = document.createElement("option");
        o.value = n;
        o.textContent = n;
        el.appendChild(o);
    }
    el.value = "azure-ocean";
}
function fillResolutionSelect() {
    const el = document.getElementById("resolution");
    if (!el || el.tagName !== "SELECT")
        return;
    const sel = el;
    sel.innerHTML = "";
    for (const r of RESOLUTION_OPTIONS) {
        const o = document.createElement("option");
        o.value = String(r);
        o.textContent = r >= 8192 ? `${r} (8K)` : String(r);
        sel.appendChild(o);
    }
    sel.value = String(params.resolution);
}
// --- Texture lightbox (click map thumbnail → zoom/pan full res) ---
const lightboxEl = document.getElementById("tex-lightbox");
const lightboxStage = document.getElementById("tex-lightbox-stage");
const lightboxImg = document.getElementById("tex-lightbox-img");
const lightboxTitle = document.getElementById("tex-lightbox-title");
const lightboxClose = document.getElementById("tex-lightbox-close");
let lightboxView = defaultLightboxView();
/** Active pointer drag sample (last position). */
let lightboxDrag = null;
/** Gesture origin — used with lightboxPointerWasPan after pointerup. */
let lightboxDragOrigin = null;
/**
 * True if the last completed gesture moved past the pan threshold.
 * Survives pointerup so the synthetic click that follows a pan does not dismiss.
 */
let lightboxDidPan = false;
let lightboxObjectUrl = null;
function applyLightboxTransform() {
    if (!lightboxImg || !lightboxStage)
        return;
    const v = lightboxView;
    const s = clampLightboxScale(v.scale);
    // Center in stage, then pan, then scale about center
    lightboxImg.style.transform = `translate(calc(-50% + ${v.panX}px), calc(-50% + ${v.panY}px)) scale(${s})`;
}
function closeTextureLightbox() {
    if (!lightboxEl)
        return;
    lightboxEl.classList.remove("open");
    lightboxEl.setAttribute("hidden", "");
    lightboxDrag = null;
    lightboxDragOrigin = null;
    lightboxDidPan = false;
    lightboxStage?.classList.remove("dragging");
    if (lightboxObjectUrl) {
        URL.revokeObjectURL(lightboxObjectUrl);
        lightboxObjectUrl = null;
    }
    if (lightboxImg)
        lightboxImg.removeAttribute("src");
}
function openTextureLightbox(canvasId) {
    const buf = mapFullBuffers.get(canvasId);
    if (!buf || !lightboxEl || !lightboxImg || !lightboxStage)
        return;
    // Rasterize full map to blob URL for crisp zoom
    const tmp = document.createElement("canvas");
    tmp.width = buf.width;
    tmp.height = buf.height;
    const tctx = tmp.getContext("2d");
    if (!tctx)
        return;
    tctx.putImageData(new ImageData(new Uint8ClampedArray(buf.rgba), buf.width, buf.height), 0, 0);
    if (lightboxObjectUrl)
        URL.revokeObjectURL(lightboxObjectUrl);
    lightboxObjectUrl = tmp.toDataURL("image/png");
    lightboxImg.src = lightboxObjectUrl;
    lightboxImg.width = buf.width;
    lightboxImg.height = buf.height;
    if (lightboxTitle)
        lightboxTitle.textContent = buf.title;
    lightboxView = defaultLightboxView();
    lightboxDidPan = false;
    lightboxDrag = null;
    lightboxDragOrigin = null;
    // Fit width into stage roughly (scale 1 = natural; browser will show full size)
    applyLightboxTransform();
    lightboxEl.classList.add("open");
    lightboxEl.removeAttribute("hidden");
}
function wireTextureLightbox() {
    if (!lightboxEl || !lightboxStage || !lightboxImg)
        return;
    const mapIds = [
        "albedo",
        "normal",
        "height",
        "liquid",
        "clouds",
        "poleN",
        "poleS",
    ];
    for (const id of mapIds) {
        const c = document.getElementById(id);
        if (!c)
            continue;
        c.setAttribute("title", "Click to inspect (zoom / pan)");
        c.addEventListener("click", () => {
            if (!mapFullBuffers.has(id))
                return;
            openTextureLightbox(id);
        });
    }
    lightboxClose?.addEventListener("click", (e) => {
        e.stopPropagation();
        closeTextureLightbox();
    });
    // Dismiss only on true shell backdrop (not stage / image). Stage is pan/zoom
    // surface — never close on stage click or pan-release (see lightboxDidPan).
    lightboxEl.addEventListener("click", (e) => {
        const t = e.target;
        const targetIsStage = t === lightboxStage ||
            (t != null && lightboxStage.contains(t) && t !== lightboxEl);
        const targetIsShell = t === lightboxEl;
        if (lightboxShouldDismissOnClick({
            targetIsStage,
            targetIsShell,
            didPan: lightboxDidPan,
        })) {
            closeTextureLightbox();
        }
        // Reset pan flag after click settles so next pure shell click can dismiss
        lightboxDidPan = false;
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && lightboxEl.classList.contains("open")) {
            closeTextureLightbox();
        }
    });
    lightboxStage.addEventListener("pointerdown", (e) => {
        if (!lightboxEl.classList.contains("open"))
            return;
        // Primary button only (ignore right-click etc.)
        if (e.button !== 0)
            return;
        lightboxDragOrigin = { x: e.clientX, y: e.clientY };
        lightboxDrag = { x: e.clientX, y: e.clientY };
        lightboxDidPan = false;
        lightboxStage.classList.add("dragging");
        lightboxStage.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    lightboxStage.addEventListener("pointermove", (e) => {
        if (!lightboxDrag || !lightboxDragOrigin)
            return;
        const dx = e.clientX - lightboxDrag.x;
        const dy = e.clientY - lightboxDrag.y;
        lightboxDrag = { x: e.clientX, y: e.clientY };
        if (lightboxPointerWasPan(lightboxDragOrigin.x, lightboxDragOrigin.y, e.clientX, e.clientY)) {
            lightboxDidPan = true;
        }
        // Only apply pan once past threshold (avoids 1px jitter on click)
        if (lightboxDidPan && (dx !== 0 || dy !== 0)) {
            lightboxView = lightboxPan(lightboxView, dx, dy);
            applyLightboxTransform();
        }
    });
    const endDrag = (e) => {
        if (!lightboxDrag)
            return;
        // Latch didPan before clearing drag so the following click event sees it
        if (lightboxDragOrigin &&
            lightboxPointerWasPan(lightboxDragOrigin.x, lightboxDragOrigin.y, e.clientX, e.clientY)) {
            lightboxDidPan = true;
        }
        lightboxDrag = null;
        lightboxDragOrigin = null;
        lightboxStage.classList.remove("dragging");
        try {
            lightboxStage.releasePointerCapture(e.pointerId);
        }
        catch {
            /* ignore */
        }
    };
    lightboxStage.addEventListener("pointerup", endDrag);
    lightboxStage.addEventListener("pointercancel", endDrag);
    lightboxStage.addEventListener("wheel", (e) => {
        if (!lightboxEl.classList.contains("open"))
            return;
        e.preventDefault();
        const rect = lightboxStage.getBoundingClientRect();
        const cx = e.clientX - rect.left - rect.width / 2;
        const cy = e.clientY - rect.top - rect.height / 2;
        const factor = Math.exp(-e.deltaY * 0.0015);
        lightboxView = lightboxZoomAt(lightboxView, factor, cx, cy);
        applyLightboxTransform();
    }, { passive: false });
}
// Keep terrain-feature strength range ↔ number fields in sync
function wireTerrainFeatureStrengthInputs() {
    const rangeEl = document.getElementById("terrainFeatureStrength");
    const numEl = document.getElementById("terrainFeatureStrengthNum");
    if (!rangeEl || !numEl)
        return;
    const sync = (from, to) => {
        let v = Number(from.value);
        if (!Number.isFinite(v))
            v = 1;
        v = Math.max(0, Math.min(1, v));
        from.value = String(v);
        to.value = String(v);
        scheduleUrlWrite();
    };
    rangeEl.addEventListener("input", () => sync(rangeEl, numEl));
    numEl.addEventListener("input", () => sync(numEl, rangeEl));
    document
        .getElementById("terrainFeatureBlend")
        ?.addEventListener("change", () => scheduleUrlWrite());
}
// Boot
fillPresetSelect();
fillResolutionSelect();
writeParamsToForm(params);
wireTerrainFeatureStrengthInputs();
wireTextureLightbox();
form?.addEventListener("submit", (e) => {
    e.preventDefault();
    void runBake();
});
document.getElementById("btnCancelBake")?.addEventListener("click", () => {
    cancelBake();
});
document.getElementById("btnBake")?.addEventListener("click", () => {
    void runBake();
});
document.getElementById("btnExport")?.addEventListener("click", () => {
    exportAll();
});
document.getElementById("btnPreset")?.addEventListener("click", () => {
    applyPreset();
});
document.getElementById("preset")?.addEventListener("change", () => {
    applyPreset();
});
// Resolution change: keep ice control (poleSize) but product maps always
// follow res via poleProductSide — update status hint so UI is not confusing.
document.getElementById("resolution")?.addEventListener("change", () => {
    const res = Math.floor(num("resolution", 512));
    const pole = Math.floor(num("poleSize", DEFAULT_POLE_SIZE));
    const side = poleProductSide(res, pole);
    const ice = poleIceExtentScale(pole);
    setStatus(`Resolution ${res}: pole product maps will be ${side}×${side} · ice footprint scale=${ice.toFixed(2)} (control=${pole}). Re-bake to apply.`);
});
// Pole ice control: product maps do not change size — ice footprint does after re-bake.
document.getElementById("poleSize")?.addEventListener("change", () => {
    const res = Math.floor(num("resolution", 512));
    const pole = Math.floor(num("poleSize", DEFAULT_POLE_SIZE));
    const ice = poleIceExtentScale(pole);
    const side = poleProductSide(res, pole);
    setStatus(`Pole ice size ${pole} → footprint scale ${ice.toFixed(2)} (1.0=full). ` +
        `N/S product maps stay ${side}×${side} (resolution-only). Re-bake to apply.`);
});
// AI/DCC equirect import (optional override of bank mix)
document.getElementById("btnImportAlbedo")?.addEventListener("click", () => {
    document.getElementById("importAlbedoFile")?.click();
});
document.getElementById("importAlbedoFile")?.addEventListener("change", (ev) => {
    const input = ev.target;
    const file = input.files?.[0];
    if (!file || !lastSet) {
        setStatus("Bake first, then import an equirect albedo (2:1 PNG/JPG).", true);
        return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const id = ctx.getImageData(0, 0, c.width, c.height);
        const imported = {
            width: c.width,
            height: c.height,
            rgba: id.data,
        };
        const v = validateEquirectAlbedo(imported);
        if (!v.ok) {
            setStatus(`Import rejected: ${v.messages.filter((m) => !m.startsWith("pole")).join("; ")}`, true);
            URL.revokeObjectURL(url);
            return;
        }
        // Prefer hybrid mix over full replace when we have liquid mask
        const hv = hybridMixAlbedo(lastSet, imported, {
            landDetail: lastSet.params.hybridLandDetail ?? 0.78,
            oceanDetail: lastSet.params.hybridOceanDetail ?? 0.25,
        });
        if (!hv.ok) {
            applyImportedAlbedo(lastSet, imported, { allowSeamWarn: true, seamThreshold: 96 });
            lastSet.poleNorth = rasterizePoleCap(lastSet.albedo.rgba, lastSet.albedo.width, lastSet.albedo.height, lastSet.params.poleSize, true);
            lastSet.poleSouth = rasterizePoleCap(lastSet.albedo.rgba, lastSet.albedo.width, lastSet.albedo.height, lastSet.params.poleSize, false);
        }
        showSet(lastSet);
        setStatus(`Hybrid import ${v.width}×${v.height} · seam=${hv.seamScore ?? v.seamScore} · ${hv.ok ? "ok" : "forced"}`);
        URL.revokeObjectURL(url);
    };
    img.onerror = () => {
        setStatus("Failed to decode image.", true);
        URL.revokeObjectURL(url);
    };
    img.src = url;
    input.value = "";
});
// Expose for CDP / smoke tests
window.__planetTexture = {
    bake: runBake,
    getParams: () => cloneParams(params),
    setParams: (p) => {
        params = cloneParams({ ...params, ...p });
        writeParamsToForm(params);
    },
    getLastSet: () => lastSet,
    hashLast: () => (lastSet ? hashTextureSet(lastSet) : null),
    bakeSync: (p) => {
        if (p)
            params = cloneParams({ ...params, ...p });
        // CDP/tests only: sequential gpu-cpu-ref (product UI uses async WebGPU)
        lastSet = bakePlanetTextures(params);
        showSet(lastSet);
        const eu0 = currentEulerForCpu();
        const preview = rasterizePlanetPreview({
            albedo: lastSet.albedo,
            normal: lastSet.normal,
            liquidMask: lastSet.liquidMask,
            clouds: lastSet.clouds,
        }, {
            size: 128,
            yaw: eu0.yaw,
            pitch: eu0.pitch,
            lightYaw: eu0.lightYaw,
            lightPitch: eu0.lightPitch,
            atmosphere: true,
        });
        return {
            width: lastSet.albedo.width,
            height: lastSet.albedo.height,
            liquidFraction: lastSet.stats.liquidFraction,
            albedoVariance: lastSet.stats.albedoVariance,
            hash: hashTextureSet(lastSet),
            poleNAlphaCenter: lastSet.poleNorth.rgba[(Math.floor(lastSet.poleNorth.height / 2) * lastSet.poleNorth.width +
                Math.floor(lastSet.poleNorth.width / 2)) *
                4 +
                3],
            maxResolutionSupported: 8192,
            planetPreview: {
                width: preview.width,
                height: preview.height,
                discPixelCount: preview.discPixelCount,
                interiorLuminanceSpan: preview.interiorLuminanceSpan,
                atmMax: preview.atmMax,
                hasCanvas: !!planetPreviewCanvas,
            },
        };
    },
    rasterizePreview: (size = 128) => {
        if (!lastSet)
            return null;
        const eu = currentEulerForCpu();
        return rasterizePlanetPreview({
            albedo: lastSet.albedo,
            normal: lastSet.normal,
            liquidMask: lastSet.liquidMask,
            clouds: lastSet.clouds,
        }, {
            size,
            yaw: eu.yaw,
            pitch: eu.pitch,
            lightYaw: eu.lightYaw,
            lightPitch: eu.lightPitch,
            atmosphere: true,
        });
    },
    setPreviewPose: (pose) => {
        if (pose.orientation) {
            previewOrientation = { ...pose.orientation };
        }
        else if (pose.yaw != null || pose.pitch != null) {
            previewOrientation = orientationFromYawPitch(pose.yaw ?? 0.55, pose.pitch ?? 0.18);
        }
        if (pose.lightDir) {
            previewLightDir = { ...pose.lightDir };
        }
        else if (pose.lightYaw != null || pose.lightPitch != null) {
            previewLightDir = lightDirFromAngles(pose.lightYaw ?? -0.7, pose.lightPitch ?? 0.35);
        }
        if (lastSet)
            paintPlanetPreview(lastSet);
    },
    getPreviewPose: () => ({
        orientation: { ...previewOrientation },
        lightDir: { ...previewLightDir },
    }),
    setPreviewZoom: (z) => {
        previewZoom = clampAuthoringZoom(z);
        if (planetGpu) {
            planetGpu.setZoom(previewZoom);
            planetGpu.redraw();
        }
        else if (lastSet) {
            paintPlanetPreviewCpu(lastSet);
        }
    },
    getPreviewZoom: () => previewZoom,
    /** Authoring sphere preview backend: webgpu disc or cpu raster. */
    getPreviewBackend: () => (planetGpu ? "webgpu" : "cpu"),
    getPreviewBufferSize: () => planetGpu
        ? planetGpu.getBufferSize()
        : planetPreviewCanvas
            ? { width: planetPreviewCanvas.width, height: planetPreviewCanvas.height }
            : { width: 0, height: 0 },
};
wirePlanetPreviewDrag();
wirePlanetPanelResize();
setStatus("Ready — Azure ocean. Drag free-rotate (sun stays put) · Shift+drag sun · Wheel zoom.");
// Boot WebGPU disc, then auto-bake small default
void (async () => {
    await ensurePlanetGpu();
    void runBake();
})();
//# sourceMappingURL=main.js.map