/**
 * Thruster texture creator UI — equation-layered jet/trail atlas authoring.
 * Entry: thruster-texture.html → dist/gpu/thruster-texture/main.js
 *
 * Preview + controls on main thread; generation/export use pure modules
 * (same as Node invariants) so PNG bytes match offline tests.
 */
import { cloneParams, generateThrusterTexture, paramsForPreset, } from "./generator.js";
import { encodePngRgba } from "./encode-png.js";
import { applyVerticalScrub, parseInputBounds } from "./number-scrub.js";
import { paramsFromQuery, paramsToQuery } from "./url-state.js";
const canvas = document.getElementById("preview");
const ctx = canvas.getContext("2d", { alpha: true });
const statusEl = document.getElementById("status");
const form = document.getElementById("controls");
// Restore generation params from URL on boot (shareable / reloadable edits).
let params = paramsFromQuery(typeof location !== "undefined" ? location.search : "", paramsForPreset("blue-jet", 512, 128));
let dirty = true;
let raf = 0;
let urlWriteTimer = 0;
function pushParamsToUrl() {
    if (typeof history === "undefined" || typeof location === "undefined")
        return;
    const q = paramsToQuery(params);
    const next = `${location.pathname}?${q}${location.hash ?? ""}`;
    const cur = `${location.pathname}${location.search}${location.hash ?? ""}`;
    if (next !== cur) {
        history.replaceState(null, "", next);
    }
}
function scheduleUrlWrite() {
    if (urlWriteTimer)
        return;
    urlWriteTimer = window.setTimeout(() => {
        urlWriteTimer = 0;
        pushParamsToUrl();
    }, 80);
}
function setStatus(msg, error = false) {
    statusEl.textContent = msg;
    statusEl.classList.toggle("error", error);
}
function num(id, fallback) {
    const el = document.getElementById(id);
    if (!el)
        return fallback;
    const v = Number(el.value);
    return Number.isFinite(v) ? v : fallback;
}
function checked(id) {
    const el = document.getElementById(id);
    return !!el?.checked;
}
function hexToRgb(hex) {
    const h = hex.replace("#", "").trim();
    const full = h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h;
    const n = parseInt(full.slice(0, 6), 16);
    if (!Number.isFinite(n))
        return { r: 1, g: 1, b: 1 };
    return {
        r: ((n >> 16) & 0xff) / 255,
        g: ((n >> 8) & 0xff) / 255,
        b: (n & 0xff) / 255,
    };
}
function rgbToHex(c) {
    const b = (n) => Math.round(Math.max(0, Math.min(1, n)) * 255)
        .toString(16)
        .padStart(2, "0");
    return `#${b(c.r)}${b(c.g)}${b(c.b)}`;
}
function readFormIntoParams() {
    params.widthPx = Math.max(16, Math.floor(num("widthPx", 512)));
    params.heightPx = Math.max(8, Math.floor(num("heightPx", 128)));
    params.trailWidth = Math.max(0.05, num("trailWidth", 1));
    params.trailLength = Math.max(0.05, num("trailLength", 1));
    params.exposure = Math.max(0.05, num("exposure", 1));
    params.gamma = Math.max(0.2, num("gamma", 0.9));
    const layers = [
        { key: "core", prefix: "core" },
        { key: "midGlow", prefix: "mid" },
        { key: "outerGlow", prefix: "outer" },
        { key: "wash", prefix: "wash" },
    ];
    for (const { key, prefix } of layers) {
        const L = params[key];
        L.enabled = checked(`${prefix}Enabled`);
        L.color = hexToRgb(document.getElementById(`${prefix}Color`)?.value ??
            "#ffffff");
        L.intensity = num(`${prefix}Intensity`, L.intensity);
        L.radialSigma = num(`${prefix}Sigma`, L.radialSigma);
        L.lengthDecay = num(`${prefix}Decay`, L.lengthDecay);
        L.lengthPower = num(`${prefix}Power`, L.lengthPower);
        L.lengthExtent = num(`${prefix}Extent`, L.lengthExtent);
    }
    params.rings.enabled = checked("ringsEnabled");
    params.rings.count = Math.max(0, Math.floor(num("ringsCount", 7)));
    params.rings.thickness = num("ringsThickness", 0.018);
    params.rings.intensity = num("ringsIntensity", 0.85);
    params.rings.color = hexToRgb(document.getElementById("ringsColor")?.value ??
        "#88ccff");
    params.rings.uStart = num("ringsUStart", 0.08);
    params.rings.uEnd = num("ringsUEnd", 0.72);
    params.rings.radialSigma = num("ringsSigma", 0.22);
    params.shocks.enabled = checked("shocksEnabled");
    params.shocks.count = Math.max(0, Math.floor(num("shocksCount", 5)));
    params.shocks.intensity = num("shocksIntensity", 1.1);
    params.shocks.color = hexToRgb(document.getElementById("shocksColor")?.value ??
        "#eef8ff");
    params.shocks.uStart = num("shocksUStart", 0.06);
    params.shocks.spacing = num("shocksSpacing", 0.11);
    params.shocks.halfLength = num("shocksHalf", 0.035);
    params.shocks.radialSigma = num("shocksSigma", 0.09);
    params.noise.enabled = checked("noiseEnabled");
    params.noise.intensity = num("noiseIntensity", 0.22);
    params.noise.freqU = num("noiseFreqU", 18);
    params.noise.freqV = num("noiseFreqV", 9);
}
function writeParamsToForm(p) {
    const set = (id, v) => {
        const el = document.getElementById(id);
        if (!el)
            return;
        if (typeof v === "boolean")
            el.checked = v;
        else
            el.value = String(v);
    };
    set("widthPx", p.widthPx);
    set("heightPx", p.heightPx);
    set("trailWidth", p.trailWidth);
    set("trailLength", p.trailLength);
    set("exposure", p.exposure);
    set("gamma", p.gamma);
    const map = [
        ["core", p.core],
        ["mid", p.midGlow],
        ["outer", p.outerGlow],
        ["wash", p.wash],
    ];
    for (const [prefix, L] of map) {
        set(`${prefix}Enabled`, L.enabled);
        set(`${prefix}Color`, rgbToHex(L.color));
        set(`${prefix}Intensity`, L.intensity);
        set(`${prefix}Sigma`, L.radialSigma);
        set(`${prefix}Decay`, L.lengthDecay);
        set(`${prefix}Power`, L.lengthPower);
        set(`${prefix}Extent`, L.lengthExtent);
    }
    set("ringsEnabled", p.rings.enabled);
    set("ringsCount", p.rings.count);
    set("ringsThickness", p.rings.thickness);
    set("ringsIntensity", p.rings.intensity);
    set("ringsColor", rgbToHex(p.rings.color));
    set("ringsUStart", p.rings.uStart);
    set("ringsUEnd", p.rings.uEnd);
    set("ringsSigma", p.rings.radialSigma);
    set("shocksEnabled", p.shocks.enabled);
    set("shocksCount", p.shocks.count);
    set("shocksIntensity", p.shocks.intensity);
    set("shocksColor", rgbToHex(p.shocks.color));
    set("shocksUStart", p.shocks.uStart);
    set("shocksSpacing", p.shocks.spacing);
    set("shocksHalf", p.shocks.halfLength);
    set("shocksSigma", p.shocks.radialSigma);
    set("noiseEnabled", p.noise.enabled);
    set("noiseIntensity", p.noise.intensity);
    set("noiseFreqU", p.noise.freqU);
    set("noiseFreqV", p.noise.freqV);
}
function renderPreview() {
    readFormIntoParams();
    scheduleUrlWrite();
    const t0 = performance.now();
    const buf = generateThrusterTexture(params);
    canvas.width = buf.width;
    canvas.height = buf.height;
    const img = ctx.createImageData(buf.width, buf.height);
    img.data.set(buf.rgba);
    ctx.putImageData(img, 0, 0);
    const ms = (performance.now() - t0).toFixed(1);
    setStatus(`${buf.width}×${buf.height} · ${ms} ms · equation layers (core/mid/outer/wash + rings + shocks + noise)`);
    dirty = false;
}
function scheduleRender() {
    dirty = true;
    if (raf)
        return;
    raf = requestAnimationFrame(() => {
        raf = 0;
        if (dirty)
            renderPreview();
    });
}
function downloadPng() {
    readFormIntoParams();
    const buf = generateThrusterTexture(params);
    const png = encodePngRgba(buf);
    const blob = new Blob([png.slice()], { type: "image/png" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `thruster-trail-${buf.width}x${buf.height}.png`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported PNG ${buf.width}×${buf.height} (${png.length} bytes)`);
}
function applyPreset(name) {
    params = cloneParams(paramsForPreset(name, params.widthPx, params.heightPx));
    writeParamsToForm(params);
    scheduleRender();
    scheduleUrlWrite();
}
// Wire controls
form.addEventListener("input", () => scheduleRender());
form.addEventListener("change", () => scheduleRender());
/**
 * Drag-scrub all number fields: drag up increases, drag down decreases.
 * Small click without movement still focuses for typing.
 * Shift = fine (0.1×), Alt = coarse (10×).
 */
function installNumberScrub(root) {
    const DRAG_THRESH_PX = 3;
    const PIXELS_PER_STEP = 4;
    let active = null;
    const sensitivity = (e) => {
        if (e.shiftKey)
            return 0.1;
        if (e.altKey)
            return 10;
        return 1;
    };
    const endScrub = (e) => {
        if (!active || e.pointerId !== active.pointerId)
            return;
        try {
            active.el.releasePointerCapture(e.pointerId);
        }
        catch {
            /* already released */
        }
        active.el.classList.remove("scrubbing");
        // If we scrubbed, suppress the click that would select-all / place caret oddly
        if (active.dragging) {
            const preventClick = (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                active?.el.removeEventListener("click", preventClick, true);
            };
            active.el.addEventListener("click", preventClick, true);
        }
        active = null;
    };
    root.addEventListener("pointerdown", (e) => {
        const t = e.target;
        if (!(t instanceof HTMLInputElement))
            return;
        if (t.type !== "number")
            return;
        if (e.button !== 0)
            return;
        // Allow normal interaction with spinner buttons if present
        const startValue = Number(t.value);
        if (!Number.isFinite(startValue))
            return;
        active = {
            el: t,
            pointerId: e.pointerId,
            startY: e.clientY,
            startValue,
            dragging: false,
            bounds: parseInputBounds(t),
        };
    });
    root.addEventListener("pointermove", (e) => {
        if (!active || e.pointerId !== active.pointerId)
            return;
        const dy = e.clientY - active.startY;
        if (!active.dragging) {
            if (Math.abs(dy) < DRAG_THRESH_PX)
                return;
            active.dragging = true;
            active.el.classList.add("scrubbing");
            try {
                active.el.setPointerCapture(e.pointerId);
            }
            catch {
                /* ignore */
            }
            // Avoid text selection while scrubbing
            e.preventDefault();
        }
        const next = applyVerticalScrub(active.startValue, dy, active.bounds, PIXELS_PER_STEP, sensitivity(e));
        const prev = active.el.value;
        active.el.value = String(next);
        if (active.el.value !== prev) {
            active.el.dispatchEvent(new Event("input", { bubbles: true }));
        }
    });
    root.addEventListener("pointerup", endScrub);
    root.addEventListener("pointercancel", endScrub);
}
installNumberScrub(form);
document.getElementById("btnExport")?.addEventListener("click", (e) => {
    e.preventDefault();
    downloadPng();
});
document.getElementById("btnPresetBlue")?.addEventListener("click", (e) => {
    e.preventDefault();
    applyPreset("blue-jet");
});
document.getElementById("btnPresetOrange")?.addEventListener("click", (e) => {
    e.preventDefault();
    applyPreset("orange-jet");
});
document.getElementById("btnPresetIon")?.addEventListener("click", (e) => {
    e.preventDefault();
    applyPreset("ion-needle");
});
document.getElementById("btnPresetPlasma")?.addEventListener("click", (e) => {
    e.preventDefault();
    applyPreset("soft-plasma");
});
// Checkerboard CSS is on the canvas wrapper; initial paint
writeParamsToForm(params);
renderPreview();
//# sourceMappingURL=main.js.map